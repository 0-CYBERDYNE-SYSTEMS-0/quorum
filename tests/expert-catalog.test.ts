import { describe, expect, it } from "vitest";
import { BOARD_PRESETS, EXPERT_CATALOG, catalogAvatar, findCatalogExpert, TIER_EXPERT_LIMITS } from "../shared/expert-catalog";
import { TIERS } from "../server/tiers";

const TARGET_ROLES = [
  "Chief Strategy Officer", "Chief Financial Officer", "Chief Marketing Officer", "Chief Revenue Officer",
  "Chief Operating Officer", "Chief Technology Officer", "General Counsel", "Risk & Compliance Lead",
  "Chief People Officer", "Data & Analytics Lead", "Market Research Analyst", "Corporate Development Lead",
  "Customer Advocate", "Chief of Staff",
];

describe("board expert catalog", () => {
  it("covers the fourteen specified roles with unique names and four-to-six sentence prompts", () => {
    expect(EXPERT_CATALOG.map(expert => expert.role)).toEqual(TARGET_ROLES);
    expect(new Set(EXPERT_CATALOG.map(expert => expert.role)).size).toBe(14);
    for (const expert of EXPERT_CATALOG) {
      expect(expert.description.trim().split(/[.!?]+/).filter(Boolean), expert.role).toHaveLength(1);
      expect(expert.rolePrompt.trim().split(/(?<=[.!?])\s+/).length, expert.role).toBeGreaterThanOrEqual(4);
      expect(expert.rolePrompt.trim().split(/(?<=[.!?])\s+/).length, expert.role).toBeLessThanOrEqual(6);
      expect(expert.rolePrompt, expert.role).toMatch(/\b(Own|Advis|Frame|Surface|Maintain|Evaluate)\b/);
      expect(expert.rolePrompt, expert.role).toMatch(/\b(demand|prefer|prioritize)\b/i);
      expect(expert.rolePrompt, expert.role).toMatch(/\bHand\b/);
      expect(expert.defaultModel.endsWith(":free"), expert.role).toBe(true);
    }
  });

  it("marks exactly the recommended board seats and includes required finance and legal boundaries", () => {
    expect(EXPERT_CATALOG.filter(expert => expert.recommended).map(expert => expert.role)).toEqual([
      "Chief Strategy Officer", "Chief Financial Officer", "Chief Marketing Officer", "General Counsel", "Chief of Staff",
    ]);
    expect(findCatalogExpert("Chief Financial Officer")?.rolePrompt).toContain("cash runway");
    expect(findCatalogExpert("Chief Financial Officer")?.rolePrompt).toContain("cohort gross margin");
    expect(findCatalogExpert("Chief Financial Officer")?.rolePrompt).toContain("capex versus opex");
    expect(findCatalogExpert("General Counsel")?.rolePrompt).toContain("not legal advice");
    expect(findCatalogExpert("Risk & Compliance Lead")?.rolePrompt).toContain("not the auditor");
  });

  it("provides the four board presets", () => {
    expect(Object.keys(BOARD_PRESETS)).toEqual(["growth", "capital", "operating", "full"]);
    for (const preset of Object.values(BOARD_PRESETS)) {
      expect(preset.name.trim()).not.toBe("");
      expect(preset.description.trim()).not.toBe("");
      expect(preset.roles.length).toBeGreaterThan(0);
      expect(preset.roles.every(role => TARGET_ROLES.includes(role))).toBe(true);
    }
    expect(BOARD_PRESETS.full.roles).toEqual(TARGET_ROLES);
  });

  it("avatars are self-contained data URIs and custom experts use a neutral glyph", () => {
    for (const expert of EXPERT_CATALOG) expect(catalogAvatar(expert.role)).toMatch(/^data:image\/svg\+xml/);
    expect(catalogAvatar("Board Observer")).toMatch(/^data:image\/svg\+xml/);
    expect(catalogAvatar("Board Observer")).toContain(encodeURIComponent("🧑‍💼"));
  });

  it("UI tier copy matches server tiers", () => {
    expect(TIER_EXPERT_LIMITS.free).toBe(TIERS.free.maxExperts);
    expect(TIER_EXPERT_LIMITS.pro).toBe(TIERS.pro.maxExperts);
  });
});
