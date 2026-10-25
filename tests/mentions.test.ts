import { describe, it, expect } from "vitest";
import { extractFarmerQuestions, extractMentions } from "../shared/mentions";

const ROSTER = ["Chief Strategy Officer", "Chief Financial Officer", "Chief Technology Officer", "Chief Operating Officer"];

describe("extractMentions", () => {
  it("matches exact bracketed roles case-insensitively and tolerates whitespace", () => {
    expect(extractMentions("@[ chief   financial officer ] and @[CHIEF TECHNOLOGY OFFICER]", ROSTER)).toEqual([
      "Chief Financial Officer",
      "Chief Technology Officer",
    ]);
  });

  it("recognizes reserved Chair tags outside the role roster", () => {
    expect(extractMentions("@[ user ] and @[ cHaIr ]", ROSTER)).toEqual(["User"]);
    expect(extractMentions("@[Chair]", [])).toEqual(["User"]);
  });

  it("filters unknown and unterminated bracketed roles", () => {
    expect(extractMentions("@[Unknown Role] and @[Chief Strategy Officer]", ROSTER)).toEqual(["Chief Strategy Officer"]);
    expect(extractMentions("@[Chief Strategy Officer", ROSTER)).toEqual([]);
  });

  it("prefix-matches bare role names and prefers the longest matching role", () => {
    expect(extractMentions("@chief strategy, please review", ROSTER)).toEqual(["Chief Strategy Officer"]);
    expect(extractMentions("@grow", ["Growth Lead", "Growth Manager"])).toEqual(["Growth Manager"]);
    expect(extractMentions("@chief", ["Chief", "Chief Strategy Officer"])).toEqual(["Chief"]);
  });

  it("resolves a unique display alias", () => {
    expect(extractMentions("@Market Expert", ["Market Research Analyst"])).toEqual(["Market Research Analyst"]);
  });

  it("returns roles in first-appearance order and deduplicates mixed mention forms", () => {
    const content = "@[Chief Technology Officer] first, then @chief strategy, again @[Chief Strategy Officer]";
    expect(extractMentions(content, ROSTER)).toEqual(["Chief Technology Officer", "Chief Strategy Officer"]);
  });

  it("ignores empty, trailing, unknown, and email-address mentions", () => {
    expect(extractMentions("what about @", ROSTER)).toEqual([]);
    expect(extractMentions("@ and @[]", ROSTER)).toEqual([]);
    expect(extractMentions("email me at chair@example.com", ROSTER)).toEqual([]);
    expect(extractMentions("@everyone please look at this", ROSTER)).toEqual([]);
    expect(extractMentions("", ROSTER)).toEqual([]);
  });
});

describe("extractFarmerQuestions", () => {
  it("extracts Board questions and Chair-tagged questions with paired assumptions", () => {
    expect(extractFarmerQuestions(
      "Board question: What is the current cash runway?\nAssuming expenses remain near the latest forecast.\n" +
      "@[Chair] Which segment is most affected?\nAssuming enterprise customers are at higher risk.",
    )).toEqual([
      { question: "What is the current cash runway?", assumption: "expenses remain near the latest forecast." },
      { question: "Which segment is most affected?", assumption: "enterprise customers are at higher risk." },
    ]);
  });

  it("accepts optional bullets and whitespace around the question pair", () => {
    expect(extractFarmerQuestions(
      "  - @[ user ] Which segment is active?  \n  * Assuming the enterprise segment has launched.  ",
    )).toEqual([{
      question: "Which segment is active?",
      assumption: "the enterprise segment has launched.",
    }]);
  });

  it("skips malformed question and assumption pairs", () => {
    expect(extractFarmerQuestions([
      "@[Chair] Which segment is most exposed?",
      "Because the forecast is incomplete.",
      "Board question: This line has no question mark",
      "Assuming the latest forecast is accurate.",
      "Board question: Which month was the churn spike?",
      "Assuming",
    ].join("\n"))).toEqual([]);
  });

  it("preserves order and removes exact duplicate question-assumption pairs", () => {
    expect(extractFarmerQuestions([
      "Board question: What is the current renewal rate?",
      "Assuming the latest cohort is representative.",
      "@[Chair] Who owns the retention plan?",
      "Assuming the Chief Revenue Officer owns it.",
      "- Board question: What is the current renewal rate?",
      "- Assuming the latest cohort is representative.",
      "Board question: What is the current renewal rate?",
      "Assuming the renewal rate is measured by logo count.",
    ].join("\n"))).toEqual([
      { question: "What is the current renewal rate?", assumption: "the latest cohort is representative." },
      { question: "Who owns the retention plan?", assumption: "the Chief Revenue Officer owns it." },
      { question: "What is the current renewal rate?", assumption: "the renewal rate is measured by logo count." },
    ]);
  });
});
