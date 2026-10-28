import { describe, expect, it } from "vitest";
import { parseVegaChart } from "../shared/chart-artifact";
import { niceScale, toChartModel, type BarModel, type LineModel, type StackedModel } from "../shared/chart-model";

const toBarModel = (chart: Parameters<typeof toChartModel>[0]) => { const model = toChartModel(chart); return model?.kind === "bars" ? model : null; };

const base = { type: "vega-lite", title: "t", theme: "ink", sources: ["Chair"] };
const revenue = [{ category: "Escalator-capped", revenue: 3338000, share: 39.6 }, { category: "Mutual-consent", revenue: 1014000, share: 12 }, { category: "Month-to-month tail", revenue: 2628000, share: 31.2 }];
const shareSpec = {
  layer: [{ mark: { type: "bar", tooltip: true } }, { mark: { type: "text", align: "left", dx: 5 }, encoding: { text: { field: "label", type: "nominal" } } }],
  transform: [{ calculate: "'x'", as: "label" }],
  encoding: { y: { field: "category", type: "nominal", title: null }, x: { field: "revenue", type: "quantitative", title: "Annual revenue (USD)" }, tooltip: [{ field: "category" }, { field: "share", title: "Share of $8.42M (%)", format: ".1f" }] },
};

describe("toBarModel", () => {
  it("turns one-bar-per-category specs into ranked rows with unit-aware labels", () => {
    const model = toBarModel(parseVegaChart({ ...base, data: revenue, spec: shareSpec })!)!;
    expect(model.rows.map(row => row.name)).toEqual(["Escalator-capped", "Month-to-month tail", "Mutual-consent"]);
    expect(model.rows[0].label).toBe("$3.338M · 39.6%");
    expect(model.rows[0].details.map(item => item.value)).toEqual(["Escalator-capped", "39.6%"]);
    expect(model.ranged).toBe(false);
  });
  it("keeps ranges, flags called-out rows, and respects an explicit sort", () => {
    const data = [{ path: "No increase", low: 660, high: 660 }, { path: "Segmented", low: 891, high: 924 }, { path: "Covenant floor", low: 550, high: 550 }];
    const spec = { mark: "bar", encoding: { y: { field: "path", type: "nominal", sort: ["Covenant floor", "No increase", "Segmented"] }, x: { field: "low", type: "quantitative", title: "EBITDA ($K)" }, x2: { field: "high" }, color: { condition: { test: "datum.path === 'Covenant floor'", value: "#b33" }, value: "#356" } } };
    const model = toBarModel(parseVegaChart({ ...base, data, spec })!)!;
    expect(model.rows.map(row => row.name)).toEqual(["Covenant floor", "No increase", "Segmented"]);
    expect(model.rows.map(row => row.flagged)).toEqual([true, false, false]);
    expect(model.rows[2].label).toBe("$891K–$924K");
    expect(model.ranged).toBe(true);
  });
  it("declines shapes it cannot draw faithfully", () => {
    const line = { mark: "line", encoding: { x: { field: "category", type: "ordinal" }, y: { field: "revenue", type: "quantitative" } } };
    const series = { mark: "bar", encoding: { y: { field: "category", type: "nominal" }, x: { field: "revenue", type: "quantitative" }, color: { field: "category", type: "nominal" } } };
    expect(toBarModel(parseVegaChart({ ...base, data: revenue, spec: line })!)).toBeNull();
    expect(toBarModel(parseVegaChart({ ...base, data: revenue, spec: series })!)).toBeNull();
  });
  it("reads vertical ranges as a waterfall with signed steps and totals", () => {
    const data = [{ step: "Base", from: 0, to: 660 }, { step: "Escalators", from: 660, to: 760 }, { step: "Tail", from: 760, to: 891 }, { step: "Cost", from: 891, to: 850 }];
    const spec = { mark: "bar", encoding: { x: { field: "step", type: "ordinal", sort: null, title: "Step" }, y: { field: "from", type: "quantitative", title: "EBITDA ($K)" }, y2: { field: "to" } } };
    const model = toBarModel(parseVegaChart({ ...base, data, spec })!)!;
    expect(model.vertical).toBe(true);
    expect(model.rows.map(row => row.name)).toEqual(["Base", "Escalators", "Tail", "Cost"]);
    expect(model.rows.map(row => row.label)).toEqual(["$660K", "+$100K", "+$131K", "−$41K"]);
  });
  it("handles a waterfall written with y as the end and y2 as the start, and tests on any field", () => {
    const data = [{ step: "Base", from: 0, to: 660, kind: "total" }, { step: "Uplift", from: 660, to: 760, kind: "change" }, { step: "Floor", from: 0, to: 550, kind: "floor" }];
    const spec = { mark: "bar", encoding: { x: { field: "step", type: "nominal", sort: null }, y: { field: "to", type: "quantitative", title: "EBITDA ($K)" }, y2: { field: "from" }, color: { condition: [{ test: "datum.kind === 'floor'", value: "alert" }, { test: "datum.kind === 'total'", value: "accent" }], value: "muted" } } };
    const model = toBarModel(parseVegaChart({ ...base, data, spec })!)!;
    expect(model.rows.map(row => row.label)).toEqual(["$660K", "+$100K", "$550K"]);
    expect(model.rows.map(row => row.tone)).toEqual(["accent", "muted", "alert"]);
  });
  it("maps color tokens to tones for highlighted columns", () => {
    const data = [{ who: "Us", price: 31.4 }, { who: "Cardinal", price: 33.1 }];
    const spec = { mark: "bar", encoding: { x: { field: "who", type: "nominal", sort: null }, y: { field: "price", type: "quantitative", title: "Price per hour (USD)" }, color: { condition: { test: "datum.who === 'Us'", value: "accent" }, value: "muted" } } };
    const model = toBarModel(parseVegaChart({ ...base, data, spec })!)!;
    expect(model.rows.map(row => [row.tone, row.label])).toEqual([["accent", "$31.40"], ["muted", "$33.10"]]);
  });
  it("builds 100% stacks in the expert's series order with token colors", () => {
    const data = [{ plan: "5%", reaction: "Accept", pct: 63 }, { plan: "5%", reaction: "Ask competitors", pct: 10 }, { plan: "5%", reaction: "Complain", pct: 27 }, { plan: "15%", reaction: "Accept", pct: 21 }, { plan: "15%", reaction: "Ask competitors", pct: 48 }, { plan: "15%", reaction: "Complain", pct: 31 }];
    const spec = { mark: "bar", encoding: { y: { field: "plan", type: "nominal", sort: ["5%", "15%"] }, x: { field: "pct", type: "quantitative", stack: "normalize", title: "Share (%)" }, color: { field: "reaction", type: "nominal", sort: ["Accept", "Complain", "Ask competitors"], scale: { range: ["accent", "muted", "alert"] } } } };
    const model = toChartModel(parseVegaChart({ ...base, data, spec })!) as StackedModel;
    expect(model.kind).toBe("stacked");
    expect(model.series).toEqual([{ name: "Accept", tone: "accent" }, { name: "Complain", tone: "muted" }, { name: "Ask competitors", tone: "alert" }]);
    expect(model.categories.map(item => item.name)).toEqual(["5%", "15%"]);
    expect(model.categories[1].cells[2].share).toBeCloseTo(0.48);
  });
  it("builds lines in data order for category x and by value for dates", () => {
    const data = [{ month: "Oct", wage: 18.4 }, { month: "Nov", wage: 18.48 }, { month: "Dec", wage: 18.55 }];
    const spec = { mark: { type: "line", point: true }, encoding: { x: { field: "month", type: "ordinal", sort: null }, y: { field: "wage", type: "quantitative", title: "Hourly wage (USD)" } } };
    const model = toChartModel(parseVegaChart({ ...base, data, spec })!) as LineModel;
    expect(model.kind).toBe("lines");
    expect(model.xs.map(point => point.label)).toEqual(["Oct", "Nov", "Dec"]);
    expect(model.format(18.4)).toBe("$18.40");
    const dated = [{ day: "2026-03-01", wage: 2 }, { day: "2026-01-01", wage: 1 }];
    const byDate = toChartModel(parseVegaChart({ ...base, data: dated, spec: { mark: "line", encoding: { x: { field: "day", type: "temporal" }, y: { field: "wage", type: "quantitative" } } } })!) as LineModel;
    expect(byDate.series[0].points).toEqual([1, 2]);
  });
  it("leaves anything it cannot draw faithfully to the Vega renderer", () => {
    const rows = [{ k: "a", v: 5 }, { k: "b", v: -3 }, { k: "c", v: 9 }];
    const bars = (extra: object, data = rows) => parseVegaChart({ ...base, data, spec: { mark: "bar", encoding: { y: { field: "k", type: "nominal" }, x: { field: "v", type: "quantitative" }, ...extra } } })!;
    expect(toChartModel(bars({}))).toBeNull();                                                         // negative bar
    const positive = rows.filter(row => row.v > 0);
    expect(toChartModel(bars({}, positive))).not.toBeNull();
    expect(toChartModel(bars({ color: { condition: { test: "datum.v > 6", value: "accent" }, value: "muted" } }, positive))).toBeNull(); // unparseable test
    const rescaled = parseVegaChart({ ...base, data: positive, spec: { mark: "bar", transform: [{ calculate: "datum.v / 1000", as: "v" }], encoding: { y: { field: "k", type: "nominal" }, x: { field: "v", type: "quantitative" } } } })!;
    expect(toChartModel(rescaled)).toBeNull();                                                         // shadowing calculate
    const scatter = parseVegaChart({ ...base, data: [{ a: 1, b: 2 }, { a: 1, b: 3 }, { a: 2, b: 5 }], spec: { mark: "point", encoding: { x: { field: "a", type: "quantitative" }, y: { field: "b", type: "quantitative" } } } })!;
    expect(toChartModel(scatter)).toBeNull();                                                          // scatter is not a line
    const series = [{ m: "Jan", g: "x", n: 1 }, { m: "Feb", g: "x", n: 2 }, { m: "Jan", g: "y", n: 3 }, { m: "Feb", g: "y", n: 4 }];
    const stackedArea = parseVegaChart({ ...base, data: series, spec: { mark: "area", encoding: { x: { field: "m", type: "ordinal" }, y: { field: "n", type: "quantitative" }, color: { field: "g", type: "nominal" } } } })!;
    expect(toChartModel(stackedArea)).toBeNull();                                                      // areas stack by default
  });
  it("drops series with no numbers instead of crashing the line chart", () => {
    const data = [{ m: "Jan", g: "x", n: 1 }, { m: "Feb", g: "x", n: 2 }, { m: "Jan", g: "y", n: null }, { m: "Feb", g: "y", n: null }];
    const spec = { mark: "line", encoding: { x: { field: "m", type: "ordinal" }, y: { field: "n", type: "quantitative" }, color: { field: "g", type: "nominal" } } };
    const model = toChartModel(parseVegaChart({ ...base, data, spec })!) as LineModel;
    expect(model.series.map(item => item.name)).toEqual(["x"]);
  });
  it("keeps ordinal categories in the expert's order", () => {
    const data = [{ band: "0-1 yr", n: 3 }, { band: "1-3 yr", n: 9 }, { band: "3+ yr", n: 5 }];
    const spec = { mark: "bar", encoding: { y: { field: "band", type: "ordinal" }, x: { field: "n", type: "quantitative" } } };
    expect(toBarModel(parseVegaChart({ ...base, data, spec })!)!.rows.map(row => row.name)).toEqual(["0-1 yr", "1-3 yr", "3+ yr"]);
  });
  it("picks round gridlines", () => {
    expect(niceScale(3338000)).toEqual({ step: 1000000, top: 4000000 });
    expect(niceScale(0)).toEqual({ step: 1, top: 1 });
  });
});
