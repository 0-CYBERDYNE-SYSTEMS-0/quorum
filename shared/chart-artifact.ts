import { z } from "zod";

export const visualThemes = {
  earth: ["#276354", "#447b9d", "#b77835", "#866394", "#6c7837", "#bd6262"],
  ocean: ["#216582", "#487e70", "#a66b40", "#77609c", "#a64f68", "#687337"],
  ink: ["#35465e", "#9b6336", "#457c76", "#886487", "#7e792f", "#ae5760"],
} as const;

/** Same hues, lifted for dark paper so marks keep their contrast. */
export const visualThemesDark = {
  earth: ["#5fb59d", "#7fb0d4", "#e0a566", "#b896c6", "#a3b560", "#e08e8e"],
  ocean: ["#63b4d3", "#7fc0ab", "#dda06f", "#b09ad4", "#d88aa1", "#a8b566"],
  ink: ["#8fa7c9", "#e0a36e", "#7fc2b9", "#c39cc0", "#c4bf6a", "#dd8d96"],
} as const;

export type ChartMode = "light" | "dark";

const chartInk = {
  light: { text: "#151A21", soft: "#4F5A66", grid: "#E3DED3", mark: "#A2773E", surface: "#FFFFFF" },
  dark: { text: "#ECE8DF", soft: "#B4B9BF", grid: "#262D36", mark: "#D4A869", surface: "#1D232B" },
} as const;

export const vegaChartSchema = z.object({
  type: z.literal("vega-lite"),
  title: z.string().trim().min(1).max(180),
  description: z.string().max(1200).optional(),
  theme: z.enum(["earth", "ocean", "ink"]).default("earth"),
  sources: z.array(z.string().min(1)).min(1).max(30),
  data: z.array(z.record(z.union([z.string(), z.number().finite(), z.boolean(), z.null()]))).min(1).max(5000),
  spec: z.record(z.unknown()),
});

export type VegaChart = z.infer<typeof vegaChartSchema>;

/** One inline dataset; no remote loaders, images, links, or executable HTML. */
export function parseVegaChart(value: unknown): VegaChart | null {
  const result = vegaChartSchema.safeParse(value);
  if (!result.success) return null;
  const spec = result.data.spec;
  if (!["mark", "layer", "facet", "repeat", "concat", "hconcat", "vconcat"].some(key => key in spec)) return null;
  function safe(node: unknown, depth = 0): boolean {
    if (depth > 40) return false;
    if (Array.isArray(node)) return node.every(item => safe(item, depth + 1));
    if (!node || typeof node !== "object") return true;
    return Object.entries(node).every(([key, child]) => {
      if (["data", "datasets", "url", "href", "usermeta", "__proto__", "constructor", "prototype"].includes(key)) return false;
      if ((key === "mark" && child === "image") || (key === "type" && child === "image")) return false;
      return safe(child, depth + 1);
    });
  }
  return safe(spec) ? result.data : null;
}

const colorLiteral = /^(#|rgb|hsl)/i;
const solidMarks = new Set(["bar", "area", "line", "trail", "point", "circle", "square", "tick", "arc", "rect", "geoshape"]);

/**
 * Brand the expert's spec without changing what it says. Directors may use the tokens "accent",
 * "muted" and "alert" for colors; literal colors on data marks are dropped so the theme applies,
 * every data mark gets a hover tooltip, and range bars whose ends are identical are collapsed.
 */
function refineSpec(spec: Record<string, unknown>, data: VegaChart["data"], palette: readonly string[], mode: ChartMode): Record<string, unknown> {
  const tokens: Record<string, string> = { accent: palette[0], muted: mode === "dark" ? "#4A525C" : "#C9C3B6", alert: palette[5] };
  const flat = (field: unknown, other: unknown) => typeof field === "string" && field === other && data.every(row => typeof row[field] === "number");
  const resolve = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(resolve);
    if (!node || typeof node !== "object") return node;
    return Object.fromEntries(Object.entries(node).map(([key, child]) =>
      [key, typeof child === "string" && ["value", "color", "fill", "stroke"].includes(key) && Object.hasOwn(tokens, child) ? tokens[child] : resolve(child)]));
  };
  const refine = (node: Record<string, unknown>, tooltipped: boolean) => {
    const encoding = node.encoding as Record<string, Record<string, unknown>> | undefined;
    const hasTooltip = tooltipped || Boolean(encoding?.tooltip);
    if (node.mark !== undefined) {
      const mark: Record<string, unknown> = typeof node.mark === "string" ? { type: node.mark } : { ...(node.mark as Record<string, unknown>) };
      if (solidMarks.has(String(mark.type))) for (const key of ["color", "fill", "stroke"]) if (typeof mark[key] === "string" && colorLiteral.test(mark[key] as string)) delete mark[key];
      if (mark.type !== "text" && mark.tooltip === undefined && !hasTooltip) mark.tooltip = true;
      node.mark = mark;
    }
    if (encoding) {
      for (const [low, high] of [["x", "x2"], ["y", "y2"]]) if (encoding[high] && flat(encoding[low]?.field, encoding[high].field)) delete encoding[high];
      for (const channel of ["color", "fill", "stroke"]) {
        const scale = encoding[channel]?.scale as Record<string, unknown> | undefined;
        if (!scale) continue;
        if (Array.isArray(scale.range)) scale.range = scale.range.map((item, index) => (typeof item === "string" && colorLiteral.test(item) ? palette[index % palette.length] : item));
        delete scale.scheme;
      }
    }
    for (const key of ["layer", "hconcat", "vconcat", "concat"]) {
      const children = node[key];
      if (Array.isArray(children)) children.forEach(child => child && typeof child === "object" && refine(child as Record<string, unknown>, hasTooltip));
    }
    if (node.spec && typeof node.spec === "object") refine(node.spec as Record<string, unknown>, hasTooltip);
  };
  const refined = structuredClone(spec);
  refine(refined, false);
  return resolve(refined) as Record<string, unknown>;
}

/** Theme defaults leave encodings, composition, transforms, and interactions to the expert. */
export function themedVegaSpec(chart: VegaChart, width = 600, mode: ChartMode = "light"): Record<string, unknown> {
  const { config: _config, $schema: _schema, ...raw } = chart.spec;
  const ink = chartInk[mode];
  const palette = [...(mode === "dark" ? visualThemesDark : visualThemes)[chart.theme]];
  const spec = refineSpec(raw, chart.data, palette, mode);
  const composed = ["facet", "repeat", "concat", "hconcat", "vconcat"].some(key => key in spec);
  const sans = '"Inter", system-ui, sans-serif';
  const serif = '"Instrument Serif", Georgia, serif';
  return {
    ...spec,
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    data: { values: chart.data },
    // `fit` makes width/height the total size including axes, so labels can never push the plot past its card.
    ...(composed ? {} : { width: Math.max(220, width - 8), height: 320, autosize: { type: "fit", contains: "padding" } }),
    padding: { left: 4, right: 28, top: 8, bottom: 4 },
    config: {
      background: "transparent",
      font: sans,
      view: { stroke: null, continuousWidth: Math.max(180, width / (Array.isArray(spec.hconcat) ? spec.hconcat.length : 1) - 80), continuousHeight: 240 },
      mark: { color: palette[0] },
      range: {
        category: palette,
        ramp: [mode === "dark" ? "#232b36" : "#efe9dc", palette[0]],
        heatmap: [mode === "dark" ? "#232b36" : "#efe9dc", palette[0]],
        diverging: [palette[0], mode === "dark" ? "#232b36" : "#efe9dc", palette[2]],
      },
      axis: { labelFont: sans, titleFont: sans, labelFontSize: 12, titleFontSize: 11, titleFontWeight: 500, titlePadding: 14, labelPadding: 8, labelColor: ink.soft, titleColor: ink.soft, domain: false, tickSize: 0, gridColor: ink.grid, gridOpacity: 1, gridWidth: 1 },
      axisX: { grid: false },
      legend: { orient: "bottom", symbolFillColor: palette[0], symbolStrokeColor: palette[0], gradientThickness: 10, gradientLength: 200, gradientStrokeWidth: 0, rowPadding: 6, labelFont: sans, titleFont: sans, labelFontSize: 12, titleFontSize: 11, labelColor: ink.soft, titleColor: ink.soft, padding: 12, symbolType: "circle" },
      bar: { cornerRadiusEnd: 3, binSpacing: 2 },
      area: { opacity: 0.5, line: { strokeWidth: 2 } },
      line: { strokeWidth: 2.5, strokeCap: "round", strokeJoin: "round" },
      point: { filled: true, size: 55, stroke: ink.surface, strokeWidth: 1.5 },
      circle: { opacity: 0.8, stroke: ink.surface, strokeWidth: 1.6 },
      square: { opacity: 0.85, stroke: ink.surface, strokeWidth: 1.2 },
      rect: { stroke: ink.surface, strokeWidth: 2, cornerRadius: 3 },
      axisTemporal: { format: "%b %Y" },
      tick: { thickness: 2.5, cornerRadius: 1 },
      rule: { stroke: ink.mark, strokeWidth: 1.25, strokeDash: [5, 4] },
      text: { font: sans, fontSize: 11.5, fontWeight: 500, color: ink.text },
      title: { anchor: "start", font: serif, fontSize: 19, fontWeight: 400, color: ink.text, offset: 14 },
    },
  };
}

/** The theme's colors for renderers that draw charts without Vega: lead, alert, muted, and the ordered series palette. */
export function chartColors(chart: VegaChart, mode: ChartMode = "light") {
  const series = (mode === "dark" ? visualThemesDark : visualThemes)[chart.theme];
  return { accent: series[0], alert: series[5], muted: mode === "dark" ? "#4A525C" : "#C9C3B6", series };
}
