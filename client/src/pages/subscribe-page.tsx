import { useState } from "react";
import { Redirect, Link } from "wouter";
import { Check, Loader2, Lock } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { QuorumLogo } from "@/components/brand";
import { Btn, Chip } from "@/components/design";
import { cn } from "@/lib/utils";

const FEATURES = [
  "Up to 8 seated directors",
  "1,000 chair briefs a month",
  "Bring your own OpenRouter key",
  "Decision memos, artifacts, and deliverable versioning",
  "Markdown export of every session",
];

function friendly(err: unknown): string {
  const text = err instanceof Error ? err.message : "";
  const json = text.slice(text.indexOf("{"));
  try {
    const body = JSON.parse(json);
    if (typeof body?.message === "string") return body.message;
  } catch {
    /* not JSON */
  }
  return "Billing is not available on this instance yet. Keep using the free board; nothing is lost.";
}

export default function SubscribePage() {
  const { user, isLoading } = useAuth();
  const [interval, setBillingInterval] = useState<"month" | "year">("month");
  const [redirecting, setRedirecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (!isLoading && !user) return <Redirect to="/auth" />;

  const checkout = async () => {
    setRedirecting(true);
    setNotice(null);
    try {
      const res = await apiRequest("POST", "/api/create-checkout-session", { interval });
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error(data?.message || "No checkout URL returned.");
    } catch (err) {
      setNotice(friendly(err));
      setRedirecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-[980px] items-center justify-between px-5">
          <Link href="/">
            <QuorumLogo compact />
          </Link>
          <Link href="/" className="text-[12px] text-muted-ink hover:text-ink">
            Back to the boardroom
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[980px] px-5 py-14">
        <p className="eyebrow">Membership</p>
        <h1 className="mt-3 font-display text-[40px] leading-tight text-ink">Keep the room open.</h1>
        <p className="mt-3 max-w-[520px] text-[14px] leading-relaxed text-muted-ink">
          The Associate board is free forever. Executive adds seats, volume, and your own model key.
        </p>

        <div className="mt-9 grid gap-5 md:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-xl border border-bronze/40 bg-surface p-6 shadow-quiet">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-semibold text-ink">Executive</p>
                <p className="mt-1 text-[11.5px] text-muted-ink">For operators in the chair weekly.</p>
              </div>
              <Chip tone="bronze">Current plan: {user?.tier ?? "free"}</Chip>
            </div>

            <div className="mt-5 flex items-baseline gap-2">
              <span className="font-display text-[46px] leading-none text-ink">{interval === "month" ? "$10" : "$96"}</span>
              <span className="text-[12px] text-faint-ink">{interval === "month" ? "/ month" : "/ year · save 20%"}</span>
            </div>

            <div className="mt-4 inline-flex rounded-md border border-line bg-paper p-0.5" role="group" aria-label="Billing interval">
              {(["month", "year"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setBillingInterval(value)}
                  aria-pressed={interval === value}
                  className={cn(
                    "rounded px-3 py-1 text-[11.5px] font-medium transition-colors",
                    interval === value ? "bg-ink text-paper" : "text-muted-ink hover:text-ink",
                  )}
                >
                  {value === "month" ? "Monthly" : "Annual"}
                </button>
              ))}
            </div>

            <ul className="mt-6 space-y-2.5 border-t border-line pt-5">
              {FEATURES.map((feature) => (
                <li key={feature} className="flex gap-2 text-[12.5px] text-ink-soft">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bronze" /> {feature}
                </li>
              ))}
            </ul>

            <Btn variant="bronze" size="lg" className="mt-6 w-full" onClick={checkout} disabled={redirecting}>
              {redirecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Continue to checkout
            </Btn>
            <p className="mt-3 text-center text-[10.5px] leading-relaxed text-faint-ink">
              Secure checkout by Stripe. Cancel any time; the Associate board stays free.
            </p>

            {notice && (
              <p role="alert" className="mt-4 rounded-md border border-bronze/30 bg-bronze-wash px-3 py-2 text-[11.5px] leading-relaxed text-bronze-ink">
                {notice}
              </p>
            )}
          </section>

          <section className="flex flex-col rounded-xl border border-line bg-surface p-6">
            <p className="text-[13px] font-semibold text-ink">Enterprise</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-ink">
              Unlimited seats, private deployment, SSO, audit review, and named onboarding.
            </p>
            <div className="mt-5 flex-1">
              <ul className="space-y-2 border-t border-line pt-5 text-[12px] text-ink-soft">
                {["Unlimited seats and briefs", "Self-host or private cloud", "SSO and audit review", "Named operator onboarding"].map(
                  (item) => (
                    <li key={item} className="flex gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bronze" /> {item}
                    </li>
                  ),
                )}
              </ul>
            </div>
            <a href="mailto:admin@desmond-digital.com?subject=Quorum%20Enterprise" className="mt-6">
              <Btn variant="outline" className="w-full">
                Talk to us
              </Btn>
            </a>
          </section>
        </div>
      </main>
    </div>
  );
}
