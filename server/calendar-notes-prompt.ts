export const CALENDAR_NOTES_PROMPT = `
CALENDAR NOTES / TASK INSTRUCTIONS:
An event's DESCRIPTION becomes Notes or Description in calendar apps. Make it a self-contained, readable task brief, not a compressed reminder. Use plain-text section labels, blank lines between sections, and one numbered step per line. Do not cram steps, sources and prompts into one paragraph or use HTML, Markdown tables, or code fences. Keep each description within 4,000 characters; shorten deliberately rather than cutting off a section.

Use only sections useful for that event:
OBJECTIVE — the specific result to achieve.
BEFORE YOU START — required inputs, prerequisites, dependencies and assumptions. Ask for missing inputs; never invent measurements.
STEPS — ordered, actionable instructions, one step per line.
RATES AND QUANTITIES — only where useful: quote financial rates, service levels, or quantities from a verified source or Chair-provided input, with units, time period, and relevant limits. Identify the exact supporting URL. Separate quoted values from calculations, show the calculation and supplied inputs, and do not guess missing values or extrapolate beyond the evidence. Omit this section when it does not apply.
SOURCES — a short resource name and exact retrieved or Chair-supplied URL, on separate lines. Say what each link is for; never fabricate links or imply an unfetched source was verified.
COMPLETION CHECK — what output or evidence confirms the task is complete.
AI HANDOFF (optional) — a copyable prompt for another AI/agent, with Task, Context, Inputs needed, Expected output, Completion checks, and Limits / human approval. Include enough context to stand alone without this chat. Ask it to flag missing inputs, cite its sources and separate assumptions from facts. A calendar note is not authorization to execute an action: the agent must obtain the user's explicit approval before sending messages, changing records, spending money, or controlling equipment.

For example, a literature-review event can use:
OBJECTIVE
Create a source-backed evidence summary.

STEPS
1. Open the supplied reference links and confirm their scope.
2. Record what each source states and what remains unknown.
3. Summarize the findings without unsupported extrapolation.

COMPLETION CHECK
A concise summary with source URLs and an explicit list of evidence gaps.

AI HANDOFF
Task: Review the references listed in this event.
Context: This is a desk-research review for a business decision.
Inputs needed: The reference URLs and the research question; ask if either is missing.
Expected output: A brief summary, source list and unresolved questions.
Completion checks: Every factual claim has appropriate support; uncertainty is explicit.
Limits / human approval: Prepare a draft only. Do not publish, contact others or change external records without approval.
Never copy this example as actual event content without tailoring it to the user's task.
`;
