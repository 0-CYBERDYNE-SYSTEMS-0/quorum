/**
 * Tier System Unit Tests
 *
 * Quorum has no free plan. A stored tier of "free" (or an unknown value) is a
 * legacy "no plan" account: zero seats, zero messages, no house-key models.
 *
 * Covers:
 *  - isPaidModel() / isFreeModel() slug classification
 *  - getTierLimits() returns correct limits per plan and no-plan defaults
 *  - Expert addition blocked at each plan's cap
 *  - Paid models allowed on paid plans and refused without one
 */

import { describe, it, expect } from "vitest";
import { isPaidModel, isFreeModel, getTierLimits, TIERS, NO_PLAN_LIMITS } from "../server/tiers";

describe("Tier System", () => {
  describe("isPaidModel()", () => {
    it("returns true for non-free models", () => {
      expect(isPaidModel("deepseek/deepseek-v4.1-flash")).toBe(true);
      expect(isPaidModel("anthropic/claude-sonnet-5.5")).toBe(true);
      expect(isPaidModel("openai/gpt-6-luna")).toBe(true);
      expect(isPaidModel("local/llama3.1")).toBe(true);
    });

    it("returns false for free models (ends with :free)", () => {
      expect(isPaidModel("deepseek/deepseek-v3:free")).toBe(false);
      expect(isPaidModel("google/gemma-4b:free")).toBe(false);
    });

    it("returns true for empty string", () => {
      expect(isPaidModel("")).toBe(true);
    });
  });

  describe("isFreeModel()", () => {
    it("returns true for models ending with :free", () => {
      expect(isFreeModel("deepseek/deepseek-v3:free")).toBe(true);
      expect(isFreeModel("google/gemma-4b:free")).toBe(true);
    });

    it("returns false for paid models", () => {
      expect(isFreeModel("anthropic/claude-sonnet-5.5")).toBe(false);
      expect(isFreeModel("openai/gpt-6-luna")).toBe(false);
    });
  });

  describe("getTierLimits()", () => {
    it("treats a stored 'free' tier as no plan", () => {
      const limits = getTierLimits("free");
      expect(limits).toMatchObject(NO_PLAN_LIMITS);
      expect(limits.maxExperts).toBe(0);
      expect(limits.maxMessages).toBe(0);
      expect(limits.allowPaidModels).toBe(false);
      expect(limits.name).toBe("No plan");
    });

    it("returns correct limits for pro tier", () => {
      const limits = getTierLimits("pro");
      expect(limits.maxExperts).toBe(8);
      expect(limits.maxMessages).toBe(1000);
      expect(limits.allowPaidModels).toBe(true);
      expect(limits.allowFrontierModels).toBe(false);
      expect(limits.name).toBe("Executive");
    });

    it("returns correct limits for boardroom tier", () => {
      const limits = getTierLimits("boardroom");
      expect(limits.maxExperts).toBe(12);
      expect(limits.maxMessages).toBe(3000);
      expect(limits.allowPaidModels).toBe(true);
      expect(limits.allowFrontierModels).toBe(true);
      expect(limits.name).toBe("Boardroom");
    });

    it("returns correct limits for enterprise tier", () => {
      const limits = getTierLimits("enterprise");
      expect(limits.maxExperts).toBe(999);
      expect(limits.maxMessages).toBe(999999);
      expect(limits.allowPaidModels).toBe(true);
      expect(limits.name).toBe("Enterprise");
    });

    it("defaults unknown tier names to no plan", () => {
      const limits = getTierLimits("nonexistent");
      expect(limits.maxExperts).toBe(0);
      expect(limits.allowPaidModels).toBe(false);
      expect(limits.name).toBe("No plan");
    });

    it("returns a copy (mutation-safe)", () => {
      const limits = getTierLimits("pro");
      limits.maxExperts = 999;
      const fresh = getTierLimits("pro");
      expect(fresh.maxExperts).toBe(8);
    });
  });

  describe("TIERS constant", () => {
    it("has exactly three paid tiers and no free entry", () => {
      expect(Object.keys(TIERS)).toHaveLength(3);
      expect(TIERS).not.toHaveProperty("free");
      expect(TIERS).toHaveProperty("pro");
      expect(TIERS).toHaveProperty("boardroom");
      expect(TIERS).toHaveProperty("enterprise");
    });

    it("boardroom has more seats and messages than pro, and frontier access", () => {
      expect(TIERS.boardroom.maxExperts).toBeGreaterThan(TIERS.pro.maxExperts);
      expect(TIERS.boardroom.maxMessages).toBeGreaterThan(TIERS.pro.maxMessages);
      expect(TIERS.pro.allowFrontierModels).toBe(false);
      expect(TIERS.boardroom.allowFrontierModels).toBe(true);
    });
  });

  describe("Expert limit enforcement (business rule)", () => {
    it("blocks any expert addition without a plan", () => {
      const currentExperts = 0;
      const limits = getTierLimits("free");
      expect(currentExperts < limits.maxExperts).toBe(false);
    });

    it("allows up to 8 experts for pro tier", () => {
      const limits = getTierLimits("pro");
      expect(limits.maxExperts).toBe(8);
      expect(7 < limits.maxExperts).toBe(true);
      expect(8 < limits.maxExperts).toBe(false);
    });

    it("allows up to 12 experts for boardroom tier", () => {
      const limits = getTierLimits("boardroom");
      expect(limits.maxExperts).toBe(12);
      expect(11 < limits.maxExperts).toBe(true);
      expect(12 < limits.maxExperts).toBe(false);
    });

    it("allows many experts for enterprise tier", () => {
      const limits = getTierLimits("enterprise");
      expect(limits.maxExperts).toBe(999);
      expect(100 < limits.maxExperts).toBe(true);
    });
  });

  describe("Paid model blocking (business rule)", () => {
    it("blocks paid models without a plan", () => {
      const limits = getTierLimits("free");
      expect(limits.allowPaidModels).toBe(false);
    });

    it("allows paid models for pro and boardroom plans", () => {
      expect(getTierLimits("pro").allowPaidModels).toBe(true);
      expect(getTierLimits("boardroom").allowPaidModels).toBe(true);
      expect(getTierLimits("enterprise").allowPaidModels).toBe(true);
    });
  });
});
