import { describe, it, expect, vi } from "vitest";

process.env.DATABASE_URL = "";
process.env.SESSION_SECRET = "vitest-deliverable-secret";
process.env.NODE_ENV = "test";

const { mockProviderChat, mockProviderChatStream } = vi.hoisted(() => ({
  mockProviderChat: vi.fn(),
  mockProviderChatStream: vi.fn(),
}));
vi.mock("../server/ai-providers", () => ({
  getProvider: vi.fn(() => ({ chat: mockProviderChat, chatStream: mockProviderChatStream })),
}));

import { storage } from "../server/storage";
import { getExpertResponseStream, commitPendingDeliverable, discardPendingDeliverable } from "../server/ai";
import { pendingDeliverableByMessage } from "../server/pending-deliverables";

const doc = "Here is the plan.\n```deliverable\ntitle: Drying Plan\n---\n## Steps\n1. Dry to 15% before binning.\n```\nSTANCE: agree | 4 | Dry first";

function expertFor(convId: number, role: string) {
  return { id: 1, conversationId: convId, name: role, role, model: "x/y:free", systemPrompt: "", avatarUrl: null } as any;
}

async function turnForExpert(expert: any, content: string) {
  const response = { message: { role: "assistant", content } };
  mockProviderChatStream.mockResolvedValue(response);
  return getExpertResponseStream(expert, [], "plan?", [], [expert.role], () => {});
}

async function turn(convId: number, role: string) {
  return turnForExpert(expertFor(convId, role), doc);
}

describe("deliverables are saved only for accepted turns", () => {
  it("discarded turn leaves no file; committed turn saves v1 and fills the line", async () => {
    const convo = await storage.createConversation({ userId: 1, title: "docs" });
    const dropped = await turn(convo.id, "Crop Specialist");
    discardPendingDeliverable(dropped);
    expect(await storage.getConversationFiles(convo.id)).toHaveLength(0);

    const kept = await turn(convo.id, "Farm Finance Advisor");
    expect(kept.content).toContain("{{deliverable}}");
    await commitPendingDeliverable(kept);
    expect(kept.content).toContain("Created deliverable **Drying Plan** (v1)");
    expect(kept.content).not.toMatch(/STANCE|\{\{deliverable\}\}/);
    const files = await storage.getConversationFiles(convo.id);
    expect(files).toHaveLength(1);

    const revised = await turn(convo.id, "Farm Finance Advisor");
    await commitPendingDeliverable(revised);
    expect(revised.content).toContain("Updated deliverable **Drying Plan** (v2)");
  });

  it("keeps only the retained reply's deliverable when the rejected repair also carried one", async () => {
    const convo = await storage.createConversation({ userId: 1, title: "repair docs" });
    const expert = expertFor(convo.id, "Crop Specialist");
    const repairDoc =
      "Here is the replacement plan.\n```deliverable\ntitle: Marketing Launch Brief\n---\n## Steps\n1. Launch the campaign.\n```\nSTANCE: conditional | 3 | Test first";

    // Both the original reply and the stance repair run through the same
    // expert and each parses its own deliverable.
    const original = await turnForExpert(expert, doc);
    const repair = await turnForExpert(expert, repairDoc);
    expect(pendingDeliverableByMessage.get(original)?.deliverable.title).toBe("Drying Plan");
    expect(pendingDeliverableByMessage.get(repair)?.deliverable.title).toBe("Marketing Launch Brief");

    // The orchestrator keeps the original when the repair lacks a valid
    // stance, so only the rejected repair's pending deliverable is dropped.
    discardPendingDeliverable(repair);
    expect(pendingDeliverableByMessage.get(repair)).toBeUndefined();
    expect(pendingDeliverableByMessage.get(original)?.deliverable.title).toBe("Drying Plan");

    await commitPendingDeliverable(original);
    expect(pendingDeliverableByMessage.get(original)).toBeUndefined();
    const files = await storage.getConversationFiles(convo.id);
    expect(files).toHaveLength(1);
    expect(files[0].filename).toContain("drying-plan");
    expect(files[0].filename).not.toContain("marketing-launch-brief");

    // Committing the rejected repair after cleanup must not resurrect it.
    await commitPendingDeliverable(repair);
    expect(await storage.getConversationFiles(convo.id)).toHaveLength(1);
  });
});
