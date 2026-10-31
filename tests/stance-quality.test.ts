import { describe, expect, it } from "vitest";
import { generateSystemPrompt, parseTrailingStanceLine } from "../server/ai";
import { isDeferentialOneLiner } from "../server/orchestrator";
import { MemStorage } from "../server/storage";

describe("independent director stances", () => {
  it("prompts each three-seat director for a substantive role-specific position and rejects deferential metadata", () => {
    const roles = ["Chief Strategy Officer", "Chief Financial Officer", "Chief Marketing Officer"];
    for (const role of roles) {
      const prompt = generateSystemPrompt({ role }, roles);
      expect(prompt).toContain("Take an independent, role-specific position");
      expect(prompt).toContain("never defer to the Chair or another director");
      expect(prompt).toContain("a substantive reason, evidence, condition, or risk from your function");
    }

    const deferred = parseTrailingStanceLine("I would leave the decision to finance.\nSTANCE: agree | 4 | I defer to the CFO.");
    expect(deferred.stance).toBeNull();
    expect(deferred.content).toBe("I would leave the decision to finance.\n");
  });

  it("filters bare deference and agreement while keeping reasoned and conditional positions", () => {
    const bareDeferral = parseTrailingStanceLine("Recommendation.\nSTANCE: agree | 4 | I defer to the CFO.");
    expect(bareDeferral.stance).toBeNull();

    const modalDeferral = parseTrailingStanceLine("Recommendation.\nSTANCE: agree | 4 | I would defer to the CFO.");
    expect(modalDeferral.stance).toBeNull();

    const bareAgreement = parseTrailingStanceLine("Recommendation.\nSTANCE: agree | 4 | I agree with the CFO.");
    expect(bareAgreement.stance).toBeNull();

    const bareSupport = parseTrailingStanceLine("Recommendation.\nSTANCE: agree | 4 | I support the proposal.");
    expect(bareSupport.stance).toBeNull();

    const agreementWithReason = parseTrailingStanceLine("Recommendation.\nSTANCE: agree | 4 | I agree with the CFO because the labor cost is missing.");
    expect(agreementWithReason.stance).toEqual({
      stance: "agree",
      confidence: 4,
      position: "I agree with the CFO because the labor cost is missing.",
    });

    const conditionalSupport = parseTrailingStanceLine("Recommendation.\nSTANCE: conditional | 4 | I support the proposal only if payback stays below six months.");
    expect(conditionalSupport.stance).toEqual({
      stance: "conditional",
      confidence: 4,
      position: "I support the proposal only if payback stays below six months.",
    });
  });

  it("flags modal deferential one-liners but keeps reasoned agreement and conditional support", () => {
    expect(isDeferentialOneLiner("I would defer to the CFO.")).toBe(true);
    expect(isDeferentialOneLiner("I agree with the CFO because the labor cost is missing.")).toBe(false);
    expect(isDeferentialOneLiner("I support the proposal only if payback stays below six months.")).toBe(false);
  });

  it("persists a distinct substantive position for each eligible seat", async () => {
    const roles = ["Chief Strategy Officer", "Chief Financial Officer", "Chief Marketing Officer"];
    const positions = [
      "Limit the pilot to the segment that validates the strategic thesis.",
      "Fund the pilot only after the payback model includes support costs.",
      "Validate segment-specific conversion before scaling acquisition spend.",
    ];
    const storage = new MemStorage();

    for (let index = 0; index < roles.length; index += 1) {
      await storage.createMessage({
        conversationId: 52,
        expertId: index + 1,
        userId: null,
        content: `${positions[index]} The board should measure the result against the stated objective and revisit the recommendation if the relevant evidence changes.`,
        role: "assistant",
        expertName: roles[index],
        expertRole: roles[index],
        stance: { stance: "conditional", confidence: 4, position: positions[index] },
      });
    }

    const persisted = await storage.getConversationMessages(52);
    expect(persisted).toHaveLength(3);
    expect(persisted.every(message => message.stance && message.content.split(/\s+/).length > 20)).toBe(true);
    expect(new Set(persisted.map(message => message.stance!.position)).size).toBe(3);
  });
});
