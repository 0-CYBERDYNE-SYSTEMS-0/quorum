import type { VegaChart } from "./chart-artifact";

/** "accent", "muted" and "alert" are the director-facing color tokens; a number picks from the theme's series palette. */
export type Tone = "accent" | "muted" | "alert" | number;

export interface BarRow {
  name: string;
  value: number;
  /** Upper end when the row is a range (x2/y2); null for a single value. */
  high: number | null;
  /** The expert called this row out (a conditional color), e.g. a covenant floor. */
  flagged: boolean;
  tone: Tone;
  label: string;
  details: { name: string; value: string }[];
}

export interface BarModel {
  kind: "bars";
  /** Vertical columns (category on x). With ranges they read as a waterfall. */
  vertical: boolean;
  rows: BarRow[];
  axisTitle: string;
  ranged: boolean;
  /** One dot per category (a point mark) rather than a bar; drawn as a lollipop. */
  dots: boolean;
  /** The expert asked for an axis that does not start at zero (scale.zero false). */
  truncated: boolean;
  format: (n: number) => string;
  tick: (n: number) => string;
}

export interface StackedModel {
  kind: "stacked";
  categories: { name: string; total: number; cells: { value: number; share: number; label: string }[] }[];
  series: { name: string; tone: Tone }[];
  normalized: boolean;
  axisTitle: string;
  format: (n: number) => string;
}

export interface LineModel {
  kind: "lines";
  xs: { label: string; num: number }[];
  /** Position by value (dates, numbers) rather than by order (categories). */
  continuous: boolean;
  /** colorIndex is the series' place in the palette, stable when an empty series is not drawn. */
  series: { name: string; points: (number | null)[]; colorIndex: number }[];
  area: boolean;
  zero: boolean;
  /** An explicit y axis range from the expert; honored over the zero baseline. */
  domain: [number, number] | null;
  yTitle: string;
  format: (n: number) => string;
  tick: (n: number) => string;
}

export type ChartModel = BarModel | StackedModel | LineModel;

type Loose = Record<string, any>;
type Formatter = { full: (n: number) => string; tick: (n: number) => string };

/** A cell as a number; null, empty and non-numeric cells are NaN, never zero. */
const cellNumber = (cell: unknown) => (cell === null || cell === undefined || cell === "" ? NaN : Number(cell));
const trim = (n: number, digits = 2) => Number(n.toFixed(digits)).toLocaleString("en-US");

function money(n: number, digits: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${n < 0 ? "-" : ""}$${trim(abs / 1e6, digits)}M`;
  if (abs >= 1e4) return `${n < 0 ? "-" : ""}$${trim(abs / 1e3, digits > 1 ? 1 : 0)}K`;
  return `${n < 0 ? "-" : ""}$${Number.isInteger(abs) ? trim(abs, 0) : abs.toFixed(2)}`;
}

/** The d3 formats directors reach for: $.2f, ,.0f, .1f, .0%. Anything else is left to the unit rules below. */
function d3Format(format?: string): ((n: number) => string) | null {
  const m = /^(\$)?(,)?\.(\d)([f%])$/.exec(format ?? "");
  if (!m) return null;
  const digits = Number(m[3]);
  return n => {
    const body = (m[4] === "%" ? n * 100 : n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: Boolean(m[2]) });
    return `${n < 0 ? "-" : ""}${m[1] ?? ""}${body.replace("-", "")}${m[4] === "%" ? "%" : ""}`;
  };
}

/** Units come from the expert's own axis title or format string; anything unrecognised prints plainly. */
function formatter(title: string, format?: string): Formatter {
  if (/\(\$K\)/i.test(title)) return { full: n => `${n < 0 ? "-" : ""}$${trim(Math.abs(n), Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2)}K`, tick: n => (n === 0 ? "$0" : Math.abs(n) >= 1000 ? `$${trim(n / 1000, 1)}M` : `$${trim(n)}K`) };
  if (format?.includes("%")) return { full: d3Format(format) ?? (n => `${trim(n * 100, 1)}%`), tick: n => `${trim(n * 100, 0)}%` };
  if (!/\(%\)/.test(title) && (format?.startsWith("$") || /\$|\busd\b/i.test(title))) return { full: d3Format(format) ?? (n => money(n, 3)), tick: n => money(n, 1) };
  if (/\(%\)|\bpct\b|percent/i.test(title)) {
    const digits = /^\.(\d)f$/.exec(format ?? "")?.[1];
    return { full: n => `${digits === undefined ? trim(n, 1) : n.toFixed(Number(digits))}%`, tick: n => `${trim(n, 0)}%` };
  }
  return { full: n => trim(n), tick: n => trim(n) };
}

/** Whole words of a field name (snake_case, kebab-case, camelCase), so "total" is never read as "to". */
const words = (field: string) => field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const hasWord = (field: string, set: Set<string>) => words(field).some(word => set.has(word));
const startWords = new Set(["from", "start", "prev", "previous", "prior", "before", "base", "open", "begin"]);
const endWords = new Set(["to", "end", "after", "close", "next"]);

const markType = (node: Loose) => (typeof node.mark === "string" ? node.mark : node.mark?.type);
const categorical = (channel?: Loose) => ["nominal", "ordinal"].includes(channel?.type);
const toneOf = (token: unknown, fallback: Tone): Tone => (token === "accent" || token === "muted" || token === "alert" ? token : fallback);
const tooltipsOf = (enc: Loose): Loose[] => [enc.tooltip].flat().filter(Boolean);

/**
 * Evaluates the simple tests experts write in color conditions: equality, indexOf/startsWith/includes,
 * joined by ||. Returns null when a part is something else, so the caller can fall back to Vega.
 */
function testMatches(test: unknown, raw: Record<string, unknown>): boolean | null {
  let matched = false;
  for (const part of String(test ?? "").split("||")) {
    const eq = /^\s*datum\.(\w+)\s*(===|==|!==|!=)\s*(?:'([^']*)'|"([^"]*)"|(-?[\d.]+))\s*$/.exec(part);
    const index = /^\s*datum\.(\w+)\.indexOf\((?:'([^']*)'|"([^"]*)")\)\s*(===|>=|>|!==)\s*(-?\d+)\s*$/.exec(part);
    const has = /^\s*datum\.(\w+)\.(startsWith|endsWith|includes)\((?:'([^']*)'|"([^"]*)")\)\s*$/.exec(part);
    if (eq) {
      const same = String(raw[eq[1]]) === (eq[3] ?? eq[4] ?? eq[5]);
      matched ||= eq[2].startsWith("!") ? !same : same;
    } else if (index) {
      const at = String(raw[index[1]]).indexOf(index[2] ?? index[3]);
      const want = Number(index[5]);
      matched ||= index[4] === "===" ? at === want : index[4] === "!==" ? at !== want : index[4] === ">=" ? at >= want : at > want;
    } else if (has) {
      matched ||= String(raw[has[1]])[has[2] as "startsWith" | "endsWith" | "includes"](has[3] ?? has[4]);
    } else return null;
  }
  return matched;
}

/** calculate steps that only add fields (never shadow data) are safe to ignore; anything else changes the numbers. */
function transformsSafe(node: Loose, data: VegaChart["data"]): boolean {
  const steps: Loose[] = Array.isArray(node.transform) ? node.transform : [];
  return steps.every(step => "calculate" in step && typeof step.as === "string" && !data.some(row => step.as in row));
}

function detailsFor(raw: Record<string, unknown>, tooltips: Loose[]) {
  return tooltips.flatMap(item => {
    const cell = raw[item.field];
    if (cell == null) return [];
    const title = String(item.title ?? item.field);
    return [{ name: title, value: typeof cell === "number" ? formatter(title, item.format).full(cell) : String(cell) }];
  });
}

/** One bar per category, horizontal or vertical, with optional ranges (x2/y2) for lollipops and waterfalls. */
function toBarModel(chart: VegaChart, spec: Loose, layers: Loose[]): BarModel | null {
  const solid = (node: Loose) => ["bar", "point", "circle"].includes(markType(node));
  if (layers.some(node => !solid(node) && markType(node) !== "text")) return null;
  const bar = layers.find(solid);
  if (!bar) return null;
  const dots = markType(bar) !== "bar";
  const enc: Loose = { ...spec.encoding, ...bar.encoding };
  const { x, y } = enc;
  const vertical = categorical(x) && y?.type === "quantitative";
  if (dots && vertical) return null;
  if (!x?.field || !y?.field || !(vertical || (categorical(y) && x.type === "quantitative"))) return null;
  const cat: Loose = vertical ? x : y;
  const val: Loose = vertical ? y : x;
  const high: Loose | undefined = vertical ? enc.y2 : enc.x2;
  if (enc.color?.field || enc.xOffset || enc.yOffset || val.aggregate || cat.aggregate || val.stack || val.bin || cat.bin || val.timeUnit || cat.timeUnit) return null;

  const title = String(val.title ?? val.axis?.title ?? val.field);
  const { full, tick } = formatter(title, val.axis?.format);
  const textEnc: Loose | undefined = layers.find(node => markType(node) === "text")?.encoding?.text;
  const textField: string | undefined = textEnc?.field;
  const textFormat = d3Format(textEnc?.format);
  const conditions: Loose[] = [enc.color?.condition].flat().filter(Boolean);
  if (conditions.some(item => testMatches(item.test, {}) === null)) return null;
  const baseTone = toneOf(enc.color?.value, "accent");
  // y/y2 are just two ends; field names say which one is the start of the step (so "to"/"from" can come in either order).
  const swapped = high?.field && (hasWord(high.field, startWords) || hasWord(val.field, endWords));
  const tooltips = tooltipsOf(enc);

  const rows: BarRow[] = [];
  for (const raw of chart.data) {
    let value = cellNumber(raw[val.field]);
    if (!Number.isFinite(value) || (!vertical && value < 0)) return null;
    let end = high?.field && Number.isFinite(cellNumber(raw[high.field])) ? cellNumber(raw[high.field]) : null;
    if (swapped && end !== null) [value, end] = [end, value];
    if (!vertical && end !== null && end < 0) return null;
    const range = end !== null && end !== value;
    const name = String(raw[cat.field]);
    const details = detailsFor(raw, tooltips);
    const share = details.find(item => /share|%/i.test(item.name) && /%$/.test(item.value));
    const span = range ? `${full(value)}–${full(end!)}` : full(value);
    // A vertical range is a waterfall step: show the change, and totals (which start at zero) as plain values.
    const step = vertical && range ? (value === 0 ? full(end!) : `${end! >= value ? "+" : "−"}${full(Math.abs(end! - value))}`) : null;
    const label = textField && textFormat && Number.isFinite(Number(raw[textField])) ? textFormat(Number(raw[textField])) : textField && raw[textField] != null && !textFormat ? String(raw[textField]) : `${step ?? span}${share ? ` · ${share.value}` : ""}`;
    const match = conditions.find(item => testMatches(item.test, raw as Record<string, unknown>) === true);
    const flagged = Boolean(match);
    rows.push({ name, value, high: range ? end : null, flagged, tone: match ? toneOf(match.value, "alert") : baseTone, label, details: details.length ? details : [{ name: title, value: step ? `${step} (${span})` : span }] });
  }
  if (!rows.length || new Set(rows.map(row => row.name)).size !== rows.length) return null;

  // Sorts follow Vega-Lite: "x"/"y" sort by that channel (the value axis orders by value, the category axis by name),
  // "ascending"/"descending" order by name, null keeps data order. Only an absent sort is ours: horizontal bars rank by value.
  const order: unknown = cat.sort;
  const valueChannel = vertical ? "y" : "x";
  const catChannel = vertical ? "x" : "y";
  const byValue = (dir: number) => rows.sort((a, b) => dir * ((a.high ?? a.value) - (b.high ?? b.value)));
  const byName = (dir: number) => rows.sort((a, b) => dir * (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (Array.isArray(order)) rows.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  else if (order === undefined) { if (!vertical && cat.type === "nominal") byValue(-1); }
  else if (order !== null) {
    const spec: Loose = typeof order === "string" ? { encoding: order.replace(/^-/, ""), order: order.startsWith("-") ? "descending" : "ascending" } : (order as Loose);
    const dir = spec.order === "descending" ? -1 : 1;
    if (order === "ascending" || order === "descending") byName(dir);
    else if (spec.encoding === valueChannel || (spec.field && spec.field === val.field)) byValue(dir);
    else if (spec.encoding === catChannel || (spec.field && spec.field === cat.field)) byName(dir);
    else return null;
  }
  return { kind: "bars", vertical, rows, axisTitle: String(val.title ?? val.axis?.title ?? ""), ranged: rows.some(row => row.high !== null), dots, truncated: val.scale?.zero === false, format: full, tick };
}

/** Horizontal bars split by a series (color): a count or a 100% stack, with the series order the expert gave. */
function toStackedModel(chart: VegaChart, spec: Loose, layers: Loose[]): StackedModel | null {
  const bars = layers.filter(node => markType(node) === "bar");
  if (!bars.length || layers.some(node => !["bar", "text"].includes(markType(node)))) return null;
  const enc: Loose = { ...spec.encoding, ...bars[0].encoding };
  const { x, y, color } = enc;
  if (!categorical(y) || x?.type !== "quantitative" || !x.field || !y.field || !color?.field || enc.xOffset || x.aggregate) return null;

  const title = String(x.title ?? x.axis?.title ?? x.field);
  const normalized = x.stack === "normalize";
  const { full } = formatter(title, x.axis?.format);
  const seen = (field: string) => Array.from(new Set(chart.data.map(row => String(row[field]))));
  // An order list must name every value in the data; otherwise rows would silently disappear and shares would misstate the whole.
  const orderOf = (preset: unknown, found: string[]): string[] | null => {
    if (!Array.isArray(preset) || !preset.every(item => typeof item === "string")) return found;
    return found.every(item => preset.includes(item)) ? (preset as string[]).filter(item => found.includes(item)) : null;
  };
  const seriesNames = orderOf(color.sort ?? color.scale?.domain, seen(color.field));
  const names = orderOf(y.sort, seen(y.field));
  if (!seriesNames || !names) return null;
  const range: unknown[] = Array.isArray(color.scale?.range) ? color.scale.range : [];
  const series = seriesNames.map((name, index) => ({ name, tone: toneOf(range[index], index) }));
  if (series.length < 2 || series.length > 6) return null;

  const cell = new Map<string, number>();
  for (const raw of chart.data) {
    const key = `${raw[y.field]}\u0000${raw[color.field]}`;
    const value = cellNumber(raw[x.field]);
    if (!Number.isFinite(value) || value < 0 || cell.has(key)) return null;
    cell.set(key, value);
  }
  const categories: StackedModel["categories"] = [];
  for (const name of names) {
    const values: number[] = [];
    for (const item of series) {
      const value = cell.get(`${name}\u0000${item.name}`);
      if (value === undefined) return null; // a missing cell is missing, not zero
      values.push(value);
    }
    const total = values.reduce((sum, value) => sum + value, 0);
    categories.push({ name, total, cells: values.map(value => ({ value, share: total ? value / total : 0, label: full(value) })) });
  }
  if (!categories.length || categories.every(item => item.total === 0)) return null;
  return { kind: "stacked", categories, series, normalized, axisTitle: String(x.title ?? x.axis?.title ?? ""), format: full };
}

const dateLabel = (time: number, spanDays: number) => {
  const date = new Date(time);
  return spanDays > 400
    ? date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    : date.toLocaleDateString("en-US", { month: "short", day: spanDays > 90 ? undefined : "numeric", timeZone: "UTC" });
};

/** Lines and areas over an ordered x, one series or several. */
function toLineModel(chart: VegaChart, spec: Loose, layers: Loose[]): LineModel | null {
  if (layers.some(node => !["line", "area", "point", "text"].includes(markType(node)))) return null;
  const main = layers.find(node => ["line", "area"].includes(markType(node)));
  if (!main) return null;
  const enc: Loose = { ...spec.encoding, ...main.encoding };
  const { x, y, color } = enc;
  if (!x?.field || !y?.field || y.type !== "quantitative" || !["temporal", "ordinal", "nominal", "quantitative"].includes(x.type)) return null;
  if (y.aggregate || x.aggregate || x.timeUnit || y.timeUnit || x.bin || y.bin || y.stack || enc.y2 || enc.x2) return null;

  const title = String(y.title ?? y.axis?.title ?? y.field);
  const { full, tick } = formatter(title, y.axis?.format);
  const continuous = x.type === "temporal" || x.type === "quantitative";
  const num = (value: unknown, index: number) => (x.type === "temporal" ? Date.parse(String(value)) : x.type === "quantitative" ? Number(value) : index);
  const keys: string[] = [];
  for (const raw of chart.data) { const key = String(raw[x.field]); if (!keys.includes(key)) keys.push(key); }
  if (continuous) keys.sort((a, b) => num(a, 0) - num(b, 0));
  else if (Array.isArray(x.sort)) keys.sort((a, b) => x.sort.indexOf(a) - x.sort.indexOf(b));
  const xs = keys.map((key, index) => ({ label: key, num: num(key, index) }));
  if (xs.length < 2 || xs.some(point => !Number.isFinite(point.num))) return null;
  // Distinct labels can parse to the same position ("2026-01-01" and "2026-01-01T00:00"); that cannot be drawn.
  if (continuous && xs.some((point, index) => index > 0 && point.num === xs[index - 1].num)) return null;
  if (x.type === "temporal") {
    const span = (xs[xs.length - 1].num - xs[0].num) / 864e5;
    xs.forEach(point => { point.label = dateLabel(point.num, span); });
  }

  // Vega colors a nominal series by its sorted position (or the expert's order), so use the same order and keep it when a series is empty.
  const found = color?.field ? Array.from(new Set(chart.data.map(raw => String(raw[color.field])))) : [title];
  const preset: unknown = color?.sort ?? color?.scale?.domain;
  const names = Array.isArray(preset) && found.every(name => preset.includes(name)) ? preset.filter(name => found.includes(name)) : [...found].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (names.length > 6) return null;
  const series = names.map(name => {
    const points: (number | null)[] = keys.map(() => null);
    for (const raw of chart.data) {
      if (color?.field && String(raw[color.field]) !== name) continue;
      const at = keys.indexOf(String(raw[x.field]));
      const value = cellNumber(raw[y.field]);
      if (at >= 0 && Number.isFinite(value)) points[at] = value;
    }
    return { name, points };
  }).map((item, colorIndex) => ({ ...item, colorIndex }));
  const area = layers.some(node => markType(node) === "area");
  // Vega stacks multi-series areas by default; overlaying them would misstate the total.
  if (area && series.length > 1 && y.stack !== false && y.stack !== null) return null;
  const drawn = series.filter(item => item.points.some(point => point !== null));
  if (!drawn.length) return null;
  const given: unknown = y.scale?.domain;
  const domain = Array.isArray(given) && given.length === 2 && given.every(item => Number.isFinite(item)) && given[0] < given[1] ? ([given[0], given[1]] as [number, number]) : null;
  return { kind: "lines", xs, continuous, series: drawn, area, zero: !domain && (area || y.scale?.zero === true), domain, yTitle: String(y.title ?? y.axis?.title ?? ""), format: full, tick };
}

/** Maps an expert's Vega-Lite spec onto a purpose-built renderer; null means "use the Vega renderer". */
export function toChartModel(chart: VegaChart): ChartModel | null {
  const spec = chart.spec as Loose;
  const layers: Loose[] = Array.isArray(spec.layer) ? spec.layer : [spec];
  if (!transformsSafe(spec, chart.data) || layers.some(node => node !== spec && !transformsSafe(node, chart.data))) return null;
  if (layers.some(node => node.mark === undefined)) return null;
  const enc: Loose = { ...spec.encoding, ...layers.find(node => ["bar", "line", "area", "point", "circle"].includes(markType(node)))?.encoding };
  const bar = layers.some(node => markType(node) === "bar")
    || (layers.some(node => ["point", "circle"].includes(markType(node))) && !layers.some(node => ["line", "area"].includes(markType(node))) && categorical(enc.y) && enc.x?.type === "quantitative");
  return bar ? (enc.color?.field ? toStackedModel(chart, spec, layers) : toBarModel(chart, spec, layers)) : toLineModel(chart, spec, layers);
}

/** A round upper bound and step for about five gridlines. */
export function niceScale(max: number): { step: number; top: number } {
  if (!(max > 0)) return { step: 1, top: 1 };
  const raw = max / 5;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].map(k => k * power).find(candidate => candidate >= raw)) ?? 10 * power;
  return { step, top: Math.ceil(max / step) * step };
}
