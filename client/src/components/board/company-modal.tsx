import { useEffect, useState } from "react";
import { Building2, Loader2 } from "lucide-react";
import { Btn, Field, Input, Modal, TextArea } from "@/components/design";
import type { CompanyProfileView } from "@/hooks/use-board-room";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const STAGES = ["Pre-seed", "Seed", "Series A", "Series B+", "Profitable", "PE / acquired"];
const HEADS = ["1-10", "11-50", "51-200", "201-1,000", "1,000+"];
const REVENUE = ["Pre-revenue", "<$1M", "$1M-$5M", "$5M-$25M", "$25M-$100M", "$100M+"];
const RISK = [
  { value: "conservative", label: "Conservative", blurb: "Protect the downside." },
  { value: "balanced", label: "Balanced", blurb: "Asymmetric bets." },
  { value: "aggressive", label: "Aggressive", blurb: "Speed over certainty." },
];

const blank: CompanyProfileView = {
  companyName: "",
  industry: "",
  stage: "",
  headcount: "",
  revenueBand: "",
  businessModel: "",
  markets: [],
  constraints: "",
  riskAppetite: "balanced",
};

export function CompanyModal({
  open,
  onOpenChange,
  profile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: CompanyProfileView | null;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CompanyProfileView>(blank);
  const [markets, setMarkets] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const next = profile ? { ...blank, ...profile } : blank;
    setForm(next);
    setMarkets((next.markets ?? []).join(", "));
    setError(null);
  }, [open, profile]);

  const update = <K extends keyof CompanyProfileView>(key: K, value: CompanyProfileView[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        companyName: form.companyName.trim() || "My Company",
        markets: markets
          .split(",")
          .map((market) => market.trim())
          .filter(Boolean),
      };
      await apiRequest("PUT", "/api/protected/company-profile", payload);
      await queryClient.invalidateQueries({ queryKey: ["/api/protected/company-profile"] });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save company context.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Company context"
      description="Every director reads this before they speak. The more precise the constraints, the less generic the advice."
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Btn>
          <Btn variant="bronze" size="sm" onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save context
          </Btn>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company" className="sm:col-span-2">
          <div className="relative">
            <Building2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint-ink" />
            <Input
              value={form.companyName}
              onChange={(event) => update("companyName", event.target.value)}
              placeholder="Northwind Logistics"
              className="pl-9"
            />
          </div>
        </Field>

        <Field label="Industry">
          <Input value={form.industry} onChange={(event) => update("industry", event.target.value)} placeholder="B2B logistics software" />
        </Field>
        <Field label="Business model">
          <Input value={form.businessModel} onChange={(event) => update("businessModel", event.target.value)} placeholder="SaaS + usage" />
        </Field>

        <Field label="Stage">
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map((stage) => (
              <button
                key={stage}
                type="button"
                onClick={() => update("stage", stage)}
                className={cn(
                  "min-w-[calc(33.333%-4px)] flex-1 rounded-full border px-2 py-1 text-[11px] transition-colors",
                  form.stage === stage
                    ? "border-bronze/40 bg-bronze-wash text-bronze-ink"
                    : "border-line-strong text-muted-ink hover:text-ink",
                )}
              >
                {stage}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Headcount">
          <div className="flex flex-wrap gap-1.5">
            {HEADS.map((head) => (
              <button
                key={head}
                type="button"
                onClick={() => update("headcount", head)}
                className={cn(
                  "min-w-[calc(33.333%-4px)] flex-1 rounded-full border px-2 py-1 text-[11px] transition-colors",
                  form.headcount === head
                    ? "border-bronze/40 bg-bronze-wash text-bronze-ink"
                    : "border-line-strong text-muted-ink hover:text-ink",
                )}
              >
                {head}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Revenue">
          <div className="flex flex-wrap gap-1.5">
            {REVENUE.map((band) => (
              <button
                key={band}
                type="button"
                onClick={() => update("revenueBand", band)}
                className={cn(
                  "min-w-[calc(33.333%-4px)] flex-1 rounded-full border px-2 py-1 text-[11px] transition-colors",
                  form.revenueBand === band
                    ? "border-bronze/40 bg-bronze-wash text-bronze-ink"
                    : "border-line-strong text-muted-ink hover:text-ink",
                )}
              >
                {band}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Markets" hint="comma separated">
          <Input value={markets} onChange={(event) => setMarkets(event.target.value)} placeholder="US, UK, DACH" />
        </Field>

        <Field label="Constraints" hint="the honest ones" className="sm:col-span-2">
          <TextArea
            value={form.constraints}
            onChange={(event) => update("constraints", event.target.value)}
            placeholder="e.g. 11 months of runway, one engineer on the platform, no enterprise sales team, must keep gross margin above 70%."
            className="min-h-[92px]"
          />
        </Field>

        <Field label="Risk appetite" className="sm:col-span-2">
          <div className="grid gap-2 sm:grid-cols-3">
            {RISK.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => update("riskAppetite", option.value)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left transition-colors",
                  form.riskAppetite === option.value
                    ? "border-bronze/40 bg-bronze-wash"
                    : "border-line hover:border-line-strong",
                )}
              >
                <span className="block text-[12px] font-medium text-ink">{option.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-ink">{option.blurb}</span>
              </button>
            ))}
          </div>
        </Field>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-oxblood/25 bg-oxblood-wash px-3 py-2 text-[12px] text-oxblood">
          {error}
        </p>
      )}
    </Modal>
  );
}
