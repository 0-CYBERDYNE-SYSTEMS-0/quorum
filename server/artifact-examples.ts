// Training inputs are fictional and separate from the Chair's actual evidence.
export const artifactExamples = [
  {
    request: "Chair supplies monthly sign-up conversion rates: SMB 18% in April and 22% in May; enterprise 11% and 14%. Compare segments.",
    output: {
      type: "vega-lite", title: "Sign-up conversion by segment · April–May", theme: "ink", sources: ["Chair"],
      description: "Both supplied segments improved. Two months do not establish a durable trend.",
      data: [{ month: "April", segment: "SMB", rate: 18 }, { month: "May", segment: "SMB", rate: 22 }, { month: "April", segment: "Enterprise", rate: 11 }, { month: "May", segment: "Enterprise", rate: 14 }],
      spec: { mark: { type: "line", point: true }, encoding: { x: { field: "month", type: "ordinal", sort: ["April", "May"], title: "Month" }, y: { field: "rate", type: "quantitative", title: "Conversion (%)" }, color: { field: "segment", type: "nominal" }, tooltip: [{ field: "segment" }, { field: "month" }, { field: "rate", title: "Conversion (%)" }] } },
    },
  },
  {
    request: "Chair supplies monthly support tickets: product A 120 in April and 95 in May; product B 80 and 88. Compare products.",
    output: {
      type: "vega-lite", title: "Support tickets by product · April–May", theme: "ocean", sources: ["Chair"],
      description: "Product A's supplied ticket count fell while product B's rose. Ticket volume alone does not establish customer satisfaction.",
      data: [{ month: "April", product: "A", tickets: 120 }, { month: "May", product: "A", tickets: 95 }, { month: "April", product: "B", tickets: 80 }, { month: "May", product: "B", tickets: 88 }],
      spec: { mark: { type: "rect", tooltip: true }, encoding: { x: { field: "month", type: "ordinal", sort: ["April", "May"], title: "Month" }, y: { field: "product", type: "nominal", title: "Product" }, color: { field: "tickets", type: "quantitative", title: "Tickets", scale: { zero: true } }, tooltip: [{ field: "product" }, { field: "month" }, { field: "tickets" }] } },
    },
  },
  {
    request: "Chair supplies revenue of $120k in April and $180k in May and gross margin of 62% and 58%. Show the measures without implying causation.",
    output: {
      type: "vega-lite", title: "Revenue and gross margin · April–May", theme: "ocean", sources: ["Chair"],
      description: "Separate aligned panels preserve units. Revenue rose while gross margin declined; two months do not establish a cause.",
      data: [{ month: "April", revenue: 120, margin: 62 }, { month: "May", revenue: 180, margin: 58 }],
      spec: { vconcat: [
        { mark: { type: "bar", tooltip: true }, encoding: { x: { field: "month", type: "ordinal", title: "Month" }, y: { field: "revenue", type: "quantitative", title: "Revenue ($k)" } } },
        { mark: { type: "line", point: true, tooltip: true }, encoding: { x: { field: "month", type: "ordinal", title: "Month" }, y: { field: "margin", type: "quantitative", title: "Gross margin (%)" } } },
      ], resolve: { scale: { x: "shared" } } },
    },
  },
  {
    request: "Chair supplies quoted implementation costs: internal build $48,000, vendor A $36,000, vendor B $52,000. Compare upfront cost only.",
    output: {
      type: "vega-lite", title: "Implementation options · quoted upfront cost", theme: "ink", sources: ["Chair"],
      description: "Vendor A has the lowest quoted upfront cost. Support, migration, and operating costs are not provided, so this is not a total-cost recommendation.",
      data: [{ option: "Internal build", usd: 48000 }, { option: "Vendor A", usd: 36000 }, { option: "Vendor B", usd: 52000 }],
      spec: { layer: [
        { mark: { type: "point", filled: true, size: 100 } },
        { mark: { type: "text", align: "left", dx: 10 }, encoding: { text: { field: "usd", type: "quantitative", format: "$,.0f" } } },
      ], encoding: { y: { field: "option", type: "nominal", sort: { field: "usd" }, title: null }, x: { field: "usd", type: "quantitative", title: "Quoted upfront cost (USD)", scale: { zero: true } }, tooltip: [{ field: "option" }, { field: "usd", format: "$,.0f", title: "Quoted cost" }] } },
    },
  },
];

export function artifactExamplesForRequest(request: string): string {
  if (!/\b(chart|charts|visuali[sz]\w*|graph|graphs|plot|plots|dashboard|heatmap)\b/i.test(request)) return "";
  return "VISUAL DESIGN TRAINING EXAMPLES: The following Chair inputs are fictional training context, never evidence for this decision. Use the designs as inspiration, not a fixed menu. Return chart JSON inside a chart fence.\n" +
    artifactExamples.map(example => `Example Chair input: ${example.request}\nExample chart output: ${JSON.stringify(example.output)}`).join("\n\n");
}
