import { describe, expect, it } from "vitest";
import {
  BOARD_PRESETS,
  EXPERT_CATALOG,
  FAST_PAID_DEFAULT_EXPERT_MODEL,
  FRONTIER_DEFAULT_EXPERT_MODEL,
  catalogAvatar,
  defaultExpertModelForTier,
  findCatalogExpert,
  resolveExpertModelForContext,
  TIER_EXPERT_LIMITS,
} from "../shared/expert-catalog";
import { BOARDROOM_FRONTIER_MODEL_ALLOWLIST, HOUSE_KEY_PAID_MODEL_ALLOWLIST } from "../shared/models";
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
      expect(expert.defaultModel.endsWith(":free"), expert.role).toBe(false);
      expect(HOUSE_KEY_PAID_MODEL_ALLOWLIST as readonly string[], expert.role).toContain(expert.defaultModel);
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

  it("UI tier copy matches server tiers and has no free entry", () => {
    expect(TIER_EXPERT_LIMITS).not.toHaveProperty("free");
    expect(TIER_EXPERT_LIMITS.pro).toBe(TIERS.pro.maxExperts);
    expect(TIER_EXPERT_LIMITS.boardroom).toBe(TIERS.boardroom.maxExperts);
    expect(TIER_EXPERT_LIMITS.enterprise).toBe(TIERS.enterprise.maxExperts);
  });

  it("defaults every paid and session board seat to a paid model in its allowlist", () => {
    // A legacy no-plan row still resolves to a paid default (never a free slug).
    expect(defaultExpertModelForTier("free")).toBe(FAST_PAID_DEFAULT_EXPERT_MODEL);

    expect(defaultExpertModelForTier("pro")).toBe(FAST_PAID_DEFAULT_EXPERT_MODEL);
    expect(defaultExpertModelForTier("boardroom")).toBe(FRONTIER_DEFAULT_EXPERT_MODEL);
    expect(defaultExpertModelForTier("enterprise")).toBe(FRONTIER_DEFAULT_EXPERT_MODEL);

    expect(HOUSE_KEY_PAID_MODEL_ALLOWLIST).toContain(FAST_PAID_DEFAULT_EXPERT_MODEL);
    expect(BOARDROOM_FRONTIER_MODEL_ALLOWLIST).toContain(FRONTIER_DEFAULT_EXPERT_MODEL);
    expect(FAST_PAID_DEFAULT_EXPERT_MODEL.endsWith(":free")).toBe(false);
    expect(FRONTIER_DEFAULT_EXPERT_MODEL.endsWith(":free")).toBe(false);
  });

  it("rewrites a stale free seat to the paid default on every paid or credit context", () => {
    const contexts = [
      { name: "pro", context: { paid: true, allowFrontier: false }, allowed: HOUSE_KEY_PAID_MODEL_ALLOWLIST },
      { name: "$5 fast session", context: { paid: true, allowFrontier: false }, allowed: HOUSE_KEY_PAID_MODEL_ALLOWLIST },
      { name: "boardroom", context: { paid: true, allowFrontier: true }, allowed: [...HOUSE_KEY_PAID_MODEL_ALLOWLIST, ...BOARDROOM_FRONTIER_MODEL_ALLOWLIST] },
      { name: "$15 boardroom session", context: { paid: true, allowFrontier: true }, allowed: [...HOUSE_KEY_PAID_MODEL_ALLOWLIST, ...BOARDROOM_FRONTIER_MODEL_ALLOWLIST] },
    ] as const;
    for (const { name, context, allowed } of contexts) {
      for (const expert of EXPERT_CATALOG) {
        const resolved = resolveExpertModelForContext(expert.defaultModel, context);
        expect(resolved.endsWith(":free"), `${name}: ${expert.role}`).toBe(false);
        expect(allowed as readonly string[], `${name}: ${expert.role}`).toContain(resolved);
      }
      expect(resolveExpertModelForContext("google/gemma-4-31b-it:free", context).endsWith(":free")).toBe(false);
    }

    // A no-plan / legacy context resolves to a paid default too.
    expect(resolveExpertModelForContext("google/gemma-4-31b-it:free", { paid: false, allowFrontier: false }))
      .toBe(FAST_PAID_DEFAULT_EXPERT_MODEL);
    expect(resolveExpertModelForContext(null, { paid: false, allowFrontier: false }))
      .toBe(FAST_PAID_DEFAULT_EXPERT_MODEL);
  });
});
