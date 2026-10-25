import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import {
  parseToolPlan, parseDuckDuckGoResults, runToolCalls, formatToolResultsForPrompt, assertPublicUrl, buildToolPlanningPrompt,
  extractDeliverable, saveExpertDeliverable, validateChartArtifact, filterChartArtifacts, toolCallLimitForTier, buildToolUsePrompt,
  MAX_TOOL_CALLS_PER_TURN,
} from "../server/expert-tools";

const DDG = `<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2F93.184.216.34%2Frevenue&amp;rut=x">Revenue <b>growth</b></a> ... <a class="result__snippet" href="#">Recurring revenue grew over the prior period</a>`;

describe("tool planning", () => {
  it("parses SEARCH/FETCH lines, caps the count, ignores chatter", () => {
    const plan = parseToolPlan("SEARCH: SaaS customer acquisition trends\nsure!\nFETCH: https://sec.gov/x\nSEARCH: a third\nSEARCH: a fourth", 3);
    expect(plan).toEqual([
      { tool: "search", query: "SaaS customer acquisition trends" },
      { tool: "fetch", url: "https://sec.gov/x" },
      { tool: "search", query: "a third" },
    ]);
    expect(parseToolPlan("NONE", 3)).toEqual([]);
  });
  it("requires authoritative research for higher-stakes decisions without overriding Chair-provided facts", () => {
    const prompt = buildToolPlanningPrompt("Chief Financial Officer", "Should we expand paid acquisition?", 2);
    expect(prompt).toContain("do not reply NONE merely because you know the general advice");
    expect(prompt).toContain("markets, financial obligations, safety, employment, privacy, or regulation");
    expect(prompt).toContain("Never contradict a company fact or price supplied by the Chair");
  });
  it("requires business and market research to use current authoritative sources", () => {
    const prompt = buildToolPlanningPrompt("Market Research Analyst", "How large is this customer segment?", 2);
    expect(prompt).toContain("Prefer filings, regulator data, official statistics, and reputable press");
    expect(prompt).toContain("Use company data, periods, and assumptions exactly as supplied");
  });
  it("tier caps: free 2, paid up to MAX", () => {
    expect(toolCallLimitForTier("free")).toBe(2);
    expect(toolCallLimitForTier("pro")).toBe(MAX_TOOL_CALLS_PER_TURN);
  });
});

describe("research citation guidance", () => {
  it("requires claim-level support from fetched source text", () => {
    const prompt = buildToolUsePrompt();
    expect(prompt).toContain("a citation supports only what the fetched page states");
    expect(prompt).toContain("Split separate claims into separate sentences");
    expect(prompt).toContain("Every cited number must appear in the fetched text");
    expect(prompt).toContain("qualify, omit, or say you could not verify it");
  });
});

describe("search + fetch", () => {
  it("decodes DuckDuckGo redirect links", () => {
    expect(parseDuckDuckGoResults(DDG)).toEqual([{ url: "https://93.184.216.34/revenue", title: "Revenue growth", snippet: "Recurring revenue grew over the prior period" }]);
  });
  it("numbers only fetched pages as citable sources", async () => {
    const ok = vi.fn()
      .mockResolvedValueOnce(new Response(DDG, { status: 200 }))
      .mockResolvedValueOnce(new Response("<html><title>Revenue basics</title><p>Recurring revenue grew over the prior period.</p></html>", {
        status: 200, headers: { "content-type": "text/html" },
      })) as any;
    const run = await runToolCalls([{ tool: "search", query: "x" }], ok);
    expect(run.sources[0]).toMatchObject({
      id: "S1", title: "Revenue basics", url: "https://93.184.216.34/revenue",
      snippet: "Revenue basics Recurring revenue grew over the prior period.",
    });
    expect(formatToolResultsForPrompt(run)).toContain("[S1] Revenue basics — https://93.184.216.34/revenue");
    expect(formatToolResultsForPrompt(run)).toContain("MANDATORY CITATION CONTRACT");
    expect(ok).toHaveBeenCalledTimes(2);

    const inaccessible = vi.fn()
      .mockResolvedValueOnce(new Response(DDG, { status: 200 }))
      .mockResolvedValueOnce(new Response("denied", { status: 403 })) as any;
    const noPage = await runToolCalls([{ tool: "search", query: "x" }], inaccessible);
    expect(noPage.sources).toEqual([]);
    expect(noPage.notes.join(" ")).toMatch(/no fetchable source/);

    const down = vi.fn(async () => { throw new Error("offline"); }) as any;
    const failed = await runToolCalls([{ tool: "search", query: "x" }], down);
    expect(failed.sources).toEqual([]);
    expect(formatToolResultsForPrompt(failed)).toMatch(/could not verify/);
  });
  it("blocks private/SSRF targets", async () => {
    await expect(assertPublicUrl("http://127.0.0.1:5001/api/user")).rejects.toThrow();
    await expect(assertPublicUrl("http://localhost/")).rejects.toThrow();
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow();
    await expect(assertPublicUrl("http://169.254.169.254/latest")).rejects.toThrow();
  });
});

describe("deliverables", () => {
    const text = "Answer here.\n```deliverable\ntitle: Launch readiness plan\n---\n## Steps\n1. Confirm the target segment\n2. Review conversion data\n```";
  it("extracts and strips the block", () => {
    const { deliverable, cleanContent } = extractDeliverable(text);
    expect(deliverable?.title).toBe("Launch readiness plan");
    expect(deliverable?.content).toContain("Confirm the target segment");
    expect(cleanContent).toBe("Answer here.");
  });
  it("creates then revises the same document by title", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffrt-"));
    let current: any; const saves: any[] = [];
    const store = {
      getCurrentDeliverableFile: async () => current,
      saveDeliverableVersion: async (file: any, req: any) => { saves.push(req); current = { id: saves.length, filename: file.filename, version: saves.length }; return { file: current, created: true }; },
    };
    const a = await saveExpertDeliverable(store, 1, { name: "Morgan", role: "Chief Strategy Officer" }, extractDeliverable(text).deliverable!, dir);
    const b = await saveExpertDeliverable(store, 1, { name: "Morgan", role: "Chief Strategy Officer" }, extractDeliverable(text).deliverable!, dir);
    expect([a.revised, b.revised]).toEqual([false, true]);
    expect(saves[1]).toMatchObject({ mode: "revise", expectedCurrentFileId: 1, deliverableId: "expert-launch-readiness-plan" });
    expect(fs.readdirSync(dir)).toHaveLength(2);
  });
});

describe("charts must be sourced", () => {
  const data = [{ month: "June", arr_m: 1.2 }];
  it("drops fabricated or generic charts", () => {
    expect(validateChartArtifact(JSON.stringify({ type: "line", title: "chart artifact", data, sources: ["Chair"] }), [])).toBeNull();
    expect(validateChartArtifact(JSON.stringify({ type: "line", title: "Rain", data }), [])).toBeNull();
    expect(validateChartArtifact(JSON.stringify({ type: "line", title: "Rain", data, sources: ["https://made.up/x"] }), ["https://real.edu/a"])).toBeNull();
  });
  it("uses a valid legacy source when the sources array is empty", () => {
    const validated = validateChartArtifact(JSON.stringify({ type: "line", title: "ARR by month", data, sources: [], source: "Chair" }), []);
    expect(JSON.parse(validated!.json).sources).toEqual(["Chair"]);
  });
  it("keeps charts whose sources are retrieved URLs or Chair-provided data", () => {
    expect(validateChartArtifact(JSON.stringify({ type: "line", title: "June ARR", data, sources: ["https://sec.gov/a"] }), ["https://sec.gov/a"])?.title).toBe("June ARR");
    const { kept, dropped } = filterChartArtifacts([
      { type: "chart", content: JSON.stringify({ title: "ARR 2023-25", data, sources: ["Chair"] }) },
      { type: "chart", content: JSON.stringify({ title: "Illustrative", data }) },
      { type: "table", content: "| a |" },
    ], []);
    expect(dropped).toBe(1);
    expect(kept.map(k => k.type)).toEqual(["chart", "table"]);
  });

  it("infers a missing Chair source only when every numeric chart value appears in that evidence", () => {
    const chart = { type: "vega-lite", title: "ARR by month", theme: "ink", data, spec: { mark: "line", encoding: { x: { field: "month", type: "ordinal" }, y: { field: "arr_m", type: "quantitative" } } } };
    const inferred = validateChartArtifact(JSON.stringify(chart), [], { farmerText: "ARR was $1.2 million in June." });
    expect(JSON.parse(inferred!.json).sources).toEqual(["Chair"]);
    expect(validateChartArtifact(JSON.stringify(chart), [], { farmerText: "ARR was $2.4 million in June." })).toBeNull();
  });
});

describe("deliverable extraction edge cases (seen live)", () => {
  it("keeps nested tables inside the document and handles a missing closing fence", () => {
    const text = "Intro.\n```deliverable\ntitle: Build vs Buy Checklist\n---\n### Table\n```table\n| a | b |\n|---|---|\n| 1 | 2 |\n```\nEnd of checklist\n---\n";
    const { deliverable, cleanContent } = extractDeliverable(text);
    expect(deliverable?.title).toBe("Build vs Buy Checklist");
    expect(deliverable?.content).toContain("| 1 | 2 |");
    expect(deliverable?.content).toContain("End of checklist");
    expect(cleanContent).toBe("Intro.");
  });
  it("stops at the closing fence and keeps trailing prose", () => {
    const { deliverable, cleanContent } = extractDeliverable("A\n```deliverable\ntitle: Plan\n---\nStep one is to review the capacity plan.\n```\nAfter text");
    expect(deliverable?.content).toBe("Step one is to review the capacity plan.");
    expect(cleanContent).toBe("A\n\nAfter text".replace("\n\n", "\n"));
  });
});

describe("unfenced deliverable (seen live in a revise turn)", () => {
  it("parses a **deliverable** header with a title line and revises by title", () => {
    const text = "**deliverable**\ntitle: Build vs. Buy Checklist\n---\n# Build vs. Buy Checklist\n### Cost Comparison\n1. Estimated savings = 20 - 15";
    const { deliverable, cleanContent } = extractDeliverable(text);
    expect(deliverable?.title).toBe("Build vs. Buy Checklist");
    expect(deliverable?.content).toContain("Cost Comparison");
    expect(cleanContent).toBe("");
  });
  it("ignores the word deliverable in prose", () => {
    expect(extractDeliverable("The deliverable is ready.\ntitle: nope").deliverable).toBeNull();
  });
});
