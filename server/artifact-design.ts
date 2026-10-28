/**
 * Design guidance for boardroom artifacts. Deliberately short: a long prompt
 * crowds out the director's role and the argument. Calendar/ICS generation lives
 * in the scheduling endpoints, not in every director's context.
 */
export const ARTIFACT_DESIGN_PROMPT = `
DELIVERABLES AND VISUALS:
When the Chair asks for a document (memo, action plan, risk register, 30-60-90 plan), write a
specific title, short sections, explicit units, owners where known, and decision checkpoints.
Separate inputs, calculations, totals, and assumptions. Prefer plain structure over decoration.

If — and only if — real numeric rows are available from the Chair or from sources retrieved this
turn, you may add one fenced chart block containing valid JSON:

\`\`\`chart
{"type":"vega-lite","title":"Specific metric, segment and period","description":"What to notice, with limits.","theme":"ink","sources":["Chair"],"data":[{"month":"2026-04","value":12}],"spec":{"mark":{"type":"line","point":true},"encoding":{"x":{"field":"month","type":"ordinal","title":"Month"},"y":{"field":"value","type":"quantitative","title":"Value (unit)"}}}}
\`\`\`

Chart craft: one idea per chart, with a title naming the metric, segment and period and the takeaway in
"description". Compare categories with one bar per category, sorted by value, with the value in a text
layer (dx or dy offset, format "$,.0f" or ".0%"). Color with the tokens "accent" (the one bar or
series that matters), "muted" (the rest) and "alert" (a breach) instead of hex, e.g. the bar color
{"condition":{"test":"datum.name === 'X'","value":"accent"},"value":"muted"}. For a target, floor or covenant add a
rule layer at that value with a text label. Lines: at most four series, label the last point. Never
use a second y axis; use two stacked panels instead. Use range encodings (x2/y2) only when each row truly
has a low and a high that differ.

Rules: every plotted number must come from the Chair, the company context, or a URL retrieved this
turn; list that provenance in "sources". Use the simplest chart that reveals the relationship, label
units, never invent or copy the example's numbers, and never imply causation from correlation.
Deliverable contents and chart JSON are exempt from the 180-word conversational limit.
`;
