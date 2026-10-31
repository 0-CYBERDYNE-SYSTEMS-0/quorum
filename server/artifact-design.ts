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

When the decision question asks to compare, rank, or trace at least two numeric rows, add one fenced
chart block if real comparable numbers are available from the Chair or sources retrieved this turn.
Do not chart a single isolated figure or numbers that have incompatible units or scopes. Use words
when the evidence does not form a meaningful comparison. A chart block contains valid JSON:

\`\`\`chart
{"type":"vega-lite","title":"Specific metric, segment and period","description":"What to notice, with limits.","theme":"ink","sources":["Chair"],"data":[{"month":"2026-04","value":12}],"spec":{"mark":{"type":"line","point":true},"encoding":{"x":{"field":"month","type":"ordinal","title":"Month"},"y":{"field":"value","type":"quantitative","title":"Value (unit)"}}}}
\`\`\`

Chart craft: one idea per chart, with a title naming the metric, segment and period and the takeaway in
"description". Compare categories with one bar per category, sorted by value, with the value in a text
layer (dx or dy offset, format "$,.0f" or ".0%"). For a bar and value label, put both marks in
"spec.layer" and keep shared x/y encodings on "spec.encoding", for example:
{"layer":[{"mark":{"type":"bar"}},{"mark":{"type":"text","dy":-8},"encoding":{"text":{"field":"value","type":"quantitative","format":"$,.0f"}}}],"encoding":{"x":{"field":"category","type":"nominal"},"y":{"field":"value","type":"quantitative"}}}.
Never put a top-level "spec.mark" together with "spec.layer". Color with the tokens "accent" (the one bar or
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
