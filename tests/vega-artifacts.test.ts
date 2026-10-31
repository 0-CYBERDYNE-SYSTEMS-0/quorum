import { describe, expect, it } from "vitest";
import { compile, type TopLevelSpec } from "vega-lite";
import { parse, View } from "vega";
import { expressionInterpreter } from "vega-interpreter";
import { parseVegaChart, themedVegaSpec } from "../shared/chart-artifact";
import { toChartModel } from "../shared/chart-model";
import { extractArtifacts } from "../server/artifact-extractor";
import { filterChartArtifacts, validateChartArtifact } from "../server/expert-tools";
import { artifactExamples, artifactExamplesForRequest } from "../server/artifact-examples";
import { allowedChartSourceUrls, generateSystemPrompt } from "../server/ai";
import { MemStorage } from "../server/storage";

const chart = {
  type: "vega-lite", title: "Monthly revenue · Q2", theme: "ink", sources: ["Chair"],
  data: [{ date: "2026-04-01", segment: "SMB", revenue: 12 }, { date: "2026-04-02", segment: "SMB", revenue: 15 }, { date: "2026-04-01", segment: "Enterprise", revenue: 9 }],
  spec: { mark: "area", encoding: { x: { field: "date", type: "temporal" }, y: { field: "revenue", type: "quantitative", title: "Revenue ($k)" }, color: { field: "segment", type: "nominal" } } },
};

describe("themed Vega-Lite artifacts", () => {
  it.each(artifactExamples)("keeps the complete training example valid: $request", async example => {
    const validated = validateChartArtifact(JSON.stringify(example.output), []);
    expect(validated).not.toBeNull();
    const chart = parseVegaChart(JSON.parse(validated!.json))!;
    const spec = compile(themedVegaSpec(chart) as unknown as TopLevelSpec).spec;
    const view = new View(parse(spec, undefined, { ast: true }), { renderer: "none", expr: expressionInterpreter });
    try { await view.runAsync(); expect(await view.toSVG()).toContain("<svg"); }
    finally { view.finalize(); }
  });
  it("fits single-view charts to their container and themes light and dark", async () => {
    const parsed = parseVegaChart(chart)!;
    const light = themedVegaSpec(parsed, 500) as Record<string, any>;
    const dark = themedVegaSpec(parsed, 500, "dark") as Record<string, any>;
    expect(light.autosize).toEqual({ type: "fit", contains: "padding" });
    expect(light.width).toBeLessThanOrEqual(500);
    expect(light.config.range.category).not.toEqual(dark.config.range.category);
    expect(light.config.axis.labelColor).not.toBe(dark.config.axis.labelColor);
    const spec = compile(dark as unknown as TopLevelSpec).spec;
    const view = new View(parse(spec, undefined, { ast: true }), { renderer: "none", expr: expressionInterpreter });
    try { await view.runAsync(); expect(await view.toSVG()).toContain("<svg"); }
    finally { view.finalize(); }
  });
  it("brands the expert's spec: tokens resolve, literal mark colors drop, tooltips and flat ranges are fixed", async () => {
    const spec = {
      layer: [
        { mark: { type: "bar", color: "#4c78a8" }, encoding: { color: { condition: { test: "datum.segment === 'SMB'", value: "accent" }, value: "muted" } } },
        { mark: { type: "text" }, encoding: { text: { field: "revenue", type: "quantitative" } } },
      ],
      encoding: { y: { field: "revenue", type: "quantitative" }, y2: { field: "revenue" }, x: { field: "segment", type: "nominal" } },
    };
    const parsed = parseVegaChart({ ...chart, spec })!;
    const light = themedVegaSpec(parsed, 500) as Record<string, any>;
    const dark = themedVegaSpec(parsed, 500, "dark") as Record<string, any>;
    expect(light.layer[0].mark).toEqual({ type: "bar", tooltip: true });
    expect(light.layer[1].mark.tooltip).toBeUndefined();
    expect(light.layer[0].encoding.color.condition.value).toBe(light.config.range.category[0]);
    expect(light.layer[0].encoding.color.value).not.toBe(dark.layer[0].encoding.color.value);
    expect(light.encoding.y2).toBeUndefined();
    expect(light.config.mark.color).toBe(light.config.range.category[0]);
    expect(parsed.spec.layer).toHaveLength(2);
    expect((parsed.spec as any).layer[0].mark.color).toBe("#4c78a8");
  });
  it("renders the stored root-bar plus text-layer shape as three actual bars", async () => {
    const storedChart = {
      type: "vega-lite", title: "Monthly gross sales by preorder volume · Illustrative scenario", theme: "ink", sources: ["Chair"],
      data: [{ ordersPerDay: 10, sales: 1560 }, { ordersPerDay: 20, sales: 3120 }, { ordersPerDay: 30, sales: 4680 }],
      spec: {
        mark: { type: "bar" },
        layer: [{ mark: { type: "text" } }],
        encoding: {
          x: { field: "ordersPerDay", type: "ordinal", title: "Orders per day", sort: { field: "sales", order: "descending" } },
          y: { field: "sales", type: "quantitative", title: "Monthly gross sales ($)" },
          color: { condition: { test: "datum.ordersPerDay === 30", value: "alert" }, value: "accent" },
        },
      },
    };
    const parsed = parseVegaChart(storedChart)!;
    const model = toChartModel(parsed);
    expect(model?.kind).toBe("bars");
    expect(model?.kind === "bars" ? model.rows.map(row => row.value) : []).toEqual([4680, 3120, 1560]);

    const spec = themedVegaSpec(parsed) as Record<string, any>;
    expect(spec.mark).toBeUndefined();
    expect(spec.layer.map((layer: Record<string, any>) => layer.mark.type)).toEqual(["bar", "text"]);
    expect(spec.encoding.x).toEqual(storedChart.spec.encoding.x);
    expect(spec.encoding.y).toEqual(storedChart.spec.encoding.y);
    expect(spec.encoding.color.condition.test).toBe("datum.ordersPerDay === 30");

    const compiled = compile(spec as unknown as TopLevelSpec).spec;
    const markTypes = (node: any): string[] => [
      ...(typeof node?.type === "string" ? [node.type] : []),
      ...(Array.isArray(node?.marks) ? node.marks.flatMap(markTypes) : []),
    ];
    expect(markTypes(compiled)).toContain("rect");
    const view = new View(parse(compiled, undefined, { ast: true }), { renderer: "none", expr: expressionInterpreter });
    try {
      await view.runAsync();
      const svg = await view.toSVG();
      expect(svg).toContain("<svg");
      expect(svg).toMatch(/class="mark-rect role-mark\b/);
      expect((svg.match(/aria-roledescription="bar"/g) ?? []).length).toBe(3);
    } finally { view.finalize(); }
  });
  it("only swaps color tokens, never inherited object properties", () => {
    const parsed = parseVegaChart({ ...chart, spec: { layer: [{ mark: { type: "text" }, encoding: { text: { value: "toString" }, color: { value: "constructor" } } }, { mark: { type: "bar" }, encoding: { color: { value: "accent" } } }] } })!;
    const [text, bar] = (themedVegaSpec(parsed) as { layer: { encoding: Record<string, { value: unknown }> }[] }).layer;
    expect(text.encoding.color.value).toBe("constructor");
    expect(text.encoding.text.value).toBe("toString");
    expect(bar.encoding.color.value).toMatch(/^#/);
  });
  it("loads examples for visualization requests without adding them to ordinary discussion", () => {
    expect(artifactExamplesForRequest("Make an immersive visualization")).toContain("fictional training context, never evidence");
    expect(artifactExamplesForRequest("What should I scout next?")).toBe("");
  });
  it("produces a renderable stored chart for a sourced numeric comparison without a visual keyword", async () => {
    const question = "Compare 2024 and 2025 reported revenue using cited filings.";
    const sourceUrl = "https://example.org/revenue-filings";
    const sourcedChart = {
      type: "vega-lite",
      title: "Reported revenue · 2024–2025",
      description: "Revenue increased between the two reported periods.",
      theme: "ink",
      sources: [sourceUrl],
      data: [{ year: "2024", revenue: 120 }, { year: "2025", revenue: 145 }],
      spec: {
        mark: { type: "bar", tooltip: true },
        encoding: {
          x: { field: "year", type: "ordinal", title: "Year" },
          y: { field: "revenue", type: "quantitative", title: "Reported revenue ($m)" },
        },
      },
    };

    expect(artifactExamplesForRequest(question)).toContain("fictional training context, never evidence");
    expect(generateSystemPrompt({ role: "Market Research Analyst" })).toContain("add one fenced\nchart block");

    const extracted = extractArtifacts(`Reported revenue was $120m in 2024 and $145m in 2025.\n\n\`\`\`chart\n${JSON.stringify(sourcedChart)}\n\`\`\``);
    const allowedUrls = allowedChartSourceUrls(null, [sourceUrl]);
    const filtered = filterChartArtifacts(extracted.artifacts, allowedUrls);
    expect(filtered.kept).toHaveLength(1);
    expect(filtered.dropped).toBe(0);

    const storage = new MemStorage();
    const stored = await storage.createMessage({
      conversationId: 44,
      expertId: 9,
      userId: null,
      content: extracted.cleanContent,
      role: "assistant",
      expertName: "Market Research Analyst",
      expertRole: "Market Research Analyst",
      artifacts: filtered.kept,
    });
    const restored = (await storage.getConversationMessages(44)).find(message => message.id === stored.id)!;
    const parsed = parseVegaChart(JSON.parse(restored.artifacts![0].content));
    expect(restored.artifacts).toHaveLength(1);
    expect(parsed).not.toBeNull();
    expect(toChartModel(parsed!)).not.toBeNull();
  });
  it("extracts a sourced chart and renders it using the CSP-safe interpreter", async () => {
    const extracted = extractArtifacts("```chart\n" + JSON.stringify(chart) + "\n```");
    const validated = validateChartArtifact(extracted.artifacts[0].content, []);
    const parsed = parseVegaChart(JSON.parse(validated!.json))!;
    const spec = compile(themedVegaSpec(parsed) as unknown as TopLevelSpec).spec;
    const view = new View(parse(spec, undefined, { ast: true }), { renderer: "none", expr: expressionInterpreter });
    try {
      await view.runAsync();
      expect(await view.toSVG()).toContain("Revenue ($k)");
    } finally { view.finalize(); }
  });

  it.each([
    { layer: [{ mark: "line", encoding: chart.spec.encoding }, { mark: "point", encoding: chart.spec.encoding }] },
    { facet: { field: "segment", type: "nominal" }, spec: { mark: "line", encoding: chart.spec.encoding } },
    { hconcat: [{ mark: "area", encoding: chart.spec.encoding }, { mark: "point", encoding: chart.spec.encoding }] },
    { mark: "point", params: [{ name: "pick", select: { type: "point", fields: ["segment"] }, bind: "legend" }], encoding: chart.spec.encoding },
    { mark: "rect", encoding: { x: { field: "date", type: "ordinal" }, y: { field: "segment", type: "nominal" }, color: { field: "revenue", type: "quantitative" } } },
  ])("allows composition and interaction beyond a fixed chart menu: %j", spec => {
    expect(validateChartArtifact(JSON.stringify({ ...chart, spec }), [])).not.toBeNull();
  });

  it.each([
    { ...chart.spec, data: { url: "https://example.com/private" } },
    { layer: [{ mark: "line", data: { values: [{ revenue: 99 }] } }] },
    { mark: "image" },
    { mark: "point", encoding: { href: { value: "javascript:alert(1)" } } },
    { mark: "point", usermeta: { embedOptions: { loader: "https://example.com" } } },
  ])("rejects resource loading, links and datasets outside the evidence envelope", spec => {
    expect(validateChartArtifact(JSON.stringify({ ...chart, spec }), [])).toBeNull();
  });

  it("retains citation checks and rejects malformed specs", () => {
    expect(validateChartArtifact(JSON.stringify({ ...chart, sources: ["https://invented.test"] }), [])).toBeNull();
    expect(validateChartArtifact(JSON.stringify({ ...chart, spec: { layer: "invalid" } }), [])).toBeNull();
    expect(parseVegaChart({ ...chart, data: [] })).toBeNull();
  });
  it("treats a json-fenced vega-lite block as a chart but leaves other json alone", () => {
    expect(extractArtifacts("```json\n" + JSON.stringify(chart) + "\n```").artifacts[0].type).toBe("chart");
    expect(extractArtifacts('```json\n{"a":1}\n```').artifacts[0].type).toBe("json");
  });
  it("repairs missing trailing closers but rejects other malformed JSON", () => {
    const text = JSON.stringify(chart);
    expect(validateChartArtifact(text.slice(0, -1), [])).not.toBeNull();
    expect(validateChartArtifact(text.slice(0, -2), [])).not.toBeNull();
    expect(validateChartArtifact(text.slice(0, 40), [])).toBeNull();
    expect(validateChartArtifact(text.replace('"Corn"', '"Co}rn"').slice(0, -1), [])).not.toBeNull();
    expect(validateChartArtifact(text + "}", [])).toBeNull();
  });
});
