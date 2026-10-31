import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenQuestion } from "../shared/schema";

const { mockChatStream, mockCreateMessage, mockGetConversation, mockGetConversationExperts, mockGetConversationMessages, mockGetCompanyProfile, mockListOpenQuestions } = vi.hoisted(() => ({
  mockChatStream: vi.fn(),
  mockCreateMessage: vi.fn(),
  mockGetConversation: vi.fn(),
  mockGetConversationExperts: vi.fn(),
  mockGetConversationMessages: vi.fn(),
  mockGetCompanyProfile: vi.fn(),
  mockListOpenQuestions: vi.fn(),
}));

vi.mock("../server/ai-providers", () => ({
  getProvider: vi.fn(() => ({ chat: vi.fn(), chatStream: mockChatStream })),
}));

vi.mock("../server/storage", () => ({
  storage: {
    createMessage: mockCreateMessage,
    getConversation: mockGetConversation,
    getConversationExperts: mockGetConversationExperts,
    getConversationMessages: mockGetConversationMessages,
    getCompanyProfile: mockGetCompanyProfile,
    listOpenQuestions: mockListOpenQuestions,
  },
}));

import { generateClosingSynthesis } from "../server/ai";

const memoWithOmittedAssumption = [
  "## Decision",
  "Proceed conditionally.",
  "## Rationale",
  "The record supports a limited pilot.",
  "## Where the board disagreed",
  "No material dissent was recorded.",
  "## Risks and mitigations",
  "Capacity risk; stage the rollout.",
  "## Next actions",
  "Operations owns the pilot review within 30 days.",
  "## Open questions for the Chair",
  "- What is the current cash runway?",
  "- Which customer cohort is representative?",
  "## Assumptions awaiting confirmation",
  "- Cash remains above the six-month threshold.",
  "None remain.",
].join("\n");

describe("closing decision memo assumptions", () => {
  beforeEach(() => {
    mockChatStream.mockReset();
    mockCreateMessage.mockReset();
    mockGetConversation.mockReset().mockResolvedValue({ id: 61, userId: 1, charter: null });
    mockGetConversationExperts.mockReset().mockResolvedValue([]);
    mockGetConversationMessages.mockReset().mockResolvedValue([]);
    mockGetCompanyProfile.mockReset().mockResolvedValue(undefined);
    mockListOpenQuestions.mockReset();
    mockCreateMessage.mockImplementation(async (message: Record<string, unknown>) => ({
      ...message,
      id: 72,
      timestamp: new Date("2026-10-28T00:00:00Z"),
    }));
    mockChatStream.mockImplementation(async (_messages: unknown, _model: string, onToken: (token: string) => void) => {
      onToken(memoWithOmittedAssumption);
      return { message: { role: "assistant", content: memoWithOmittedAssumption } };
    });
    mockListOpenQuestions.mockResolvedValue([
      {
        id: 11,
        conversationId: 61,
        messageId: 10,
        expertRole: "Chief Financial Officer",
        question: "What is the current cash runway?",
        assumption: "Cash remains above the six-month threshold.",
        status: "open",
        answerMessageId: null,
        createdAt: new Date("2026-10-27T00:00:00Z"),
      },
      {
        id: 12,
        conversationId: 61,
        messageId: 10,
        expertRole: "Chief Strategy Officer",
        question: "Which customer cohort is representative?",
        assumption: "The latest cohort reflects the full customer base.",
        status: "open",
        answerMessageId: null,
        createdAt: new Date("2026-10-27T00:00:00Z"),
      },
    ] satisfies OpenQuestion[]);
  });

  afterEach(() => vi.clearAllMocks());

  it("persists every still-open assumption under the seven-heading memo section", async () => {
    mockGetConversationMessages.mockResolvedValue([
      {
        role: "assistant",
        expertName: "Chief Strategy Officer",
        expertRole: "Chief Strategy Officer",
        content: "Board question: Which customer cohort is representative?\nAssuming the latest cohort reflects the full customer base.",
      },
    ]);
    const broadcast = vi.fn();
    await generateClosingSynthesis(61, {
      id: null,
      conversationId: 61,
      name: "Moderator",
      role: "Moderator",
      model: "test/closing:free",
      systemPrompt: "Facilitate the board.",
    }, broadcast, {});

    const stored = mockCreateMessage.mock.calls[0][0] as { content: string };
    expect(stored.content).toContain("Chief Financial Officer: Cash remains above the six-month threshold. (pending: What is the current cash runway?)");
    expect(stored.content).toContain("Chief Strategy Officer: The latest cohort reflects the full customer base. (pending: Which customer cohort is representative?)");
    expect(stored.content.match(/The latest cohort reflects the full customer base\./g)).toHaveLength(1);
    expect(stored.content).not.toMatch(/None remain\./i);
    expect(stored.content.match(/^## /gm)).toHaveLength(7);
  });

  it("uses each seat's latest validated persisted stance instead of a stale ledger", async () => {
    const roles = ["Chief Strategy Officer", "Chief Financial Officer", "Chief Marketing Officer"];
    mockGetConversationExperts.mockResolvedValue(roles.map((role, id) => ({
      id: id + 1,
      conversationId: 61,
      name: role,
      role,
      model: "test/board:free",
      systemPrompt: "",
    })));
    mockGetConversationMessages.mockResolvedValue([
      {
        id: 1,
        timestamp: new Date("2026-10-28T00:00:00Z"),
        role: "assistant",
        expertName: "Chief Marketing Officer",
        expertRole: "Chief Marketing Officer",
        content: "Marketing needs demand validation.",
        stance: { stance: "abstain", confidence: 2, position: "Need survey results before estimating demand." },
      },
      {
        id: 2,
        timestamp: new Date("2026-10-28T00:01:00Z"),
        role: "assistant",
        expertName: "Chief Marketing Officer",
        expertRole: "Chief Marketing Officer",
        content: "Marketing conditionally supports the pilot.",
        stance: { stance: "conditional", confidence: 4, position: "Approve the pilot after segment conversion is validated." },
      },
      {
        id: 3,
        timestamp: new Date("2026-10-28T00:02:00Z"),
        role: "assistant",
        expertName: "Chief Financial Officer",
        expertRole: "Chief Financial Officer",
        content: "Finance needs current cost inputs.",
        stance: { stance: "abstain", confidence: 4, position: "Cannot approve without platform fees and current margins." },
      },
      {
        id: 4,
        timestamp: new Date("2026-10-28T00:03:00Z"),
        role: "assistant",
        expertName: "Chief Strategy Officer",
        expertRole: "Chief Strategy Officer",
        content: "Strategy supports a bounded pilot.",
        stance: { stance: "conditional", confidence: 3, position: "Run a six-week pilot after the break-even case is checked." },
      },
      {
        id: 5,
        timestamp: new Date("2026-10-28T00:04:00Z"),
        role: "assistant",
        expertName: "Chief Strategy Officer",
        expertRole: "Chief Strategy Officer",
        content: "I agree with the other director.",
        stance: { stance: "agree", confidence: 4, position: "I agree with the other director." },
      },
    ]);

    await generateClosingSynthesis(61, {
      id: null,
      conversationId: 61,
      name: "Moderator",
      role: "Moderator",
      model: "test/closing:free",
      systemPrompt: "Facilitate the board.",
    }, vi.fn(), {
      "Chief Marketing Officer": { stance: "abstain", confidence: 2, position: "Need survey results before estimating demand." },
      "Chief Financial Officer": null,
      "Chief Strategy Officer": null,
    });

    const messages = mockChatStream.mock.calls[0][0];
    const prompt = messages.find((message: { role: string }) => message.role === "user").content as string;
    const start = "Latest expert stance ledger (null means no valid structured stance was recorded):\n";
    const end = "\n\nCurrent open questions for the Chair";
    const ledger = JSON.parse(prompt.slice(prompt.indexOf(start) + start.length, prompt.indexOf(end)));
    expect(ledger).toEqual([
      {
        expertRole: "Chief Strategy Officer",
        stance: "conditional",
        confidence: 3,
        position: "Run a six-week pilot after the break-even case is checked.",
      },
      {
        expertRole: "Chief Financial Officer",
        stance: "abstain",
        confidence: 4,
        position: "Cannot approve without platform fees and current margins.",
      },
      {
        expertRole: "Chief Marketing Officer",
        stance: "conditional",
        confidence: 4,
        position: "Approve the pilot after segment conversion is validated.",
      },
    ]);
  });

  it("replaces misattributed memo assumptions with canonical source assumptions", async () => {
    const memoWithMisattributedAssumptions = [
      "## Decision",
      "Proceed conditionally.",
      "## Rationale",
      "The record supports a limited pilot.",
      "## Where the board disagreed",
      "No material dissent was recorded.",
      "## Risks and mitigations",
      "Capacity risk; stage the rollout.",
      "## Next actions",
      "Operations owns the pilot review within 30 days.",
      "## Open questions for the Chair",
      "- What is the current cash runway?",
      "- Which customer cohort is representative?",
      "## Assumptions awaiting confirmation",
      "- Chief Financial Officer: Cash stays above the six-month threshold. (pending: What is the current cash runway?)",
      "- Treasurer: Cash stays above the six-month threshold.",
      "- Chief Financial Officer: The latest cohort reflects the full customer base.",
      "- Chair: The Chair's recommendation is correct.",
      "None remain.",
    ].join("\n");
    mockChatStream.mockImplementation(async (_messages: unknown, _model: string, onToken: (token: string) => void) => {
      onToken(memoWithMisattributedAssumptions);
      return { message: { role: "assistant", content: memoWithMisattributedAssumptions } };
    });
    mockListOpenQuestions.mockResolvedValue([
      {
        id: 21,
        conversationId: 61,
        messageId: 101,
        expertRole: "Chief Financial Officer",
        question: "What is the current cash runway?",
        assumption: "Cash stays above the six-month threshold.",
        status: "open",
        answerMessageId: null,
        createdAt: new Date("2026-10-27T00:00:00Z"),
      },
      {
        id: 22,
        conversationId: 61,
        messageId: 102,
        expertRole: "Chief Strategy Officer",
        question: "Which customer cohort is representative?",
        assumption: "The latest cohort reflects the full customer base.",
        status: "open",
        answerMessageId: null,
        createdAt: new Date("2026-10-27T00:00:00Z"),
      },
      {
        id: 23,
        conversationId: 61,
        messageId: 103,
        expertRole: "Chief Operating Officer",
        question: "Should the recommendation stand?",
        assumption: "The Chair's recommendation is correct.",
        status: "open",
        answerMessageId: null,
        createdAt: new Date("2026-10-27T00:00:00Z"),
      },
      {
        id: 24,
        conversationId: 61,
        messageId: 104,
        expertRole: "Treasurer",
        question: "Has the board reached consensus?",
        assumption: "The board has reached consensus.",
        status: "open",
        answerMessageId: null,
        createdAt: new Date("2026-10-27T00:00:00Z"),
      },
    ] satisfies OpenQuestion[]);
    mockGetConversationMessages.mockResolvedValue([
      {
        id: 101,
        role: "assistant",
        expertName: "Treasurer",
        expertRole: "Treasurer",
        content: "Assuming Cash stays above the six-month threshold.",
      },
      {
        id: 102,
        role: "assistant",
        expertName: "Chief Strategy Officer",
        expertRole: "Chief Strategy Officer",
        content: "Assumption: The latest cohort reflects the full customer base.",
      },
      {
        id: 103,
        role: "assistant",
        expertName: "Chair",
        expertRole: "Chief Operating Officer",
        content: "Assuming the Chair's recommendation is correct.",
      },
      {
        id: 104,
        role: "assistant",
        expertName: "Moderator",
        expertRole: "Treasurer",
        content: "Assumption: The board has reached consensus.",
      },
      {
        id: 105,
        role: "assistant",
        expertName: "Chief Operating Officer",
        expertRole: "Chief Operating Officer",
        content: "Assumption: Pilot capacity remains below the support limit.",
      },
    ]);

    await generateClosingSynthesis(61, {
      id: null,
      conversationId: 61,
      name: "Moderator",
      role: "Moderator",
      model: "test/closing:free",
      systemPrompt: "Facilitate the board.",
    }, vi.fn(), {});

    const stored = mockCreateMessage.mock.calls[0][0] as { content: string };
    const assumptionsSection = stored.content.split("## Assumptions awaiting confirmation\n")[1];
    expect(assumptionsSection?.trim().split("\n")).toEqual([
      "- Treasurer: Cash stays above the six-month threshold. (pending: What is the current cash runway?)",
      "- Chief Strategy Officer: The latest cohort reflects the full customer base. (pending: Which customer cohort is representative?)",
      "- Chief Operating Officer: Pilot capacity remains below the support limit.",
    ]);
    expect(assumptionsSection).not.toContain("Chief Financial Officer");
    expect(assumptionsSection).not.toContain("Chair's recommendation");
    expect(assumptionsSection).not.toContain("board has reached consensus");
    expect(assumptionsSection?.match(/Cash stays above the six-month threshold\./g)).toHaveLength(1);
    expect(assumptionsSection?.match(/The latest cohort reflects the full customer base\./g)).toHaveLength(1);
    expect(assumptionsSection).not.toContain("Chief Operating Officer: The Chair's recommendation is correct.");
    expect(assumptionsSection).not.toContain("Treasurer: The board has reached consensus.");
    expect(stored.content.match(/^## .*$/gm)).toEqual(memoWithMisattributedAssumptions.match(/^## .*$/gm));
  });

  it("preserves standalone director assumptions without adding Chair or Moderator assumptions", async () => {
    mockGetConversationMessages.mockResolvedValue([
      {
        role: "assistant",
        expertName: "Chief Strategy Officer",
        expertRole: "Chief Strategy Officer",
        content: "Assuming the enterprise retention rate is representative.\nAssumption: THE ENTERPRISE RETENTION RATE IS REPRESENTATIVE.\nAssumption: Expansion will remain below support capacity.",
      },
      {
        role: "assistant",
        expertName: "Chair",
        expertRole: "Chair",
        content: "Assuming all customers have the same needs.",
      },
      {
        role: "assistant",
        expertName: "Moderator",
        expertRole: "Moderator",
        content: "Assumption: The board has reached consensus.",
      },
    ]);
    mockListOpenQuestions.mockResolvedValue([]);

    await generateClosingSynthesis(61, {
      id: null,
      conversationId: 61,
      name: "Moderator",
      role: "Moderator",
      model: "test/closing:free",
      systemPrompt: "Facilitate the board.",
    }, vi.fn(), {});

    const stored = mockCreateMessage.mock.calls[0][0] as { content: string };
    expect(stored.content).toContain("- Chief Strategy Officer: the enterprise retention rate is representative.");
    expect(stored.content).toContain("- Chief Strategy Officer: Expansion will remain below support capacity.");
    expect(stored.content.match(/enterprise retention rate is representative\./gi)).toHaveLength(1);
    expect(stored.content).not.toContain("all customers have the same needs");
    expect(stored.content).not.toContain("The board has reached consensus");
    expect(stored.content.match(/^## /gm)).toHaveLength(7);
  });

  it("appends the assumptions heading and canonical bullets when the memo omits that heading", async () => {
    const memoWithoutAssumptionsHeading = [
      "## Decision",
      "Proceed conditionally.",
      "## Rationale",
      "The record supports a limited pilot.",
      "## Where the board disagreed",
      "No material dissent was recorded.",
      "## Risks and mitigations",
      "Capacity risk; stage the rollout.",
      "## Next actions",
      "Operations owns the pilot review within 30 days.",
      "## Open questions for the Chair",
      "- What is the current cash runway?",
      "- Which customer cohort is representative?",
    ].join("\n");
    mockChatStream.mockImplementation(async (_messages: unknown, _model: string, onToken: (token: string) => void) => {
      onToken(memoWithoutAssumptionsHeading);
      return { message: { role: "assistant", content: memoWithoutAssumptionsHeading } };
    });

    await generateClosingSynthesis(61, {
      id: null,
      conversationId: 61,
      name: "Moderator",
      role: "Moderator",
      model: "test/closing:free",
      systemPrompt: "Facilitate the board.",
    }, vi.fn(), {});

    const stored = mockCreateMessage.mock.calls[0][0] as { content: string };
    expect(stored.content).toContain([
      "## Assumptions awaiting confirmation",
      "- Chief Financial Officer: Cash remains above the six-month threshold. (pending: What is the current cash runway?)",
      "- Chief Strategy Officer: The latest cohort reflects the full customer base. (pending: Which customer cohort is representative?)",
    ].join("\n"));
    expect(stored.content.match(/^## .*$/gm)).toEqual([
      "## Decision",
      "## Rationale",
      "## Where the board disagreed",
      "## Risks and mitigations",
      "## Next actions",
      "## Open questions for the Chair",
      "## Assumptions awaiting confirmation",
    ]);
  });
});
