import { useState } from "react";
import { Redirect, Link } from "wouter";
import { Check, Loader2, Lock, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { QuorumLogo } from "@/components/brand";
import { Btn, Chip } from "@/components/design";
import { cn } from "@/lib/utils";
import { PLAN_PRICING, SESSION_PRICING, YEARLY_MONTHS_FREE, type BillingInterval, type PlanKey, type SessionKind } from "@shared/pricing";
import { BOARDROOM_FRONTIER_MODEL_ALLOWLIST, modelLabel } from "@/lib/model-options";

type CheckoutBody =
  | { plan: "pro" | "boardroom"; interval: BillingInterval }
  | { session: SessionKind };

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

function PlanColumn({
  plan,
  interval,
  currentTier,
  busy,
  onSubscribe,
}: {
  plan: PlanKey;
  interval: BillingInterval;
  currentTier: string;
  busy: boolean;
  onSubscribe: (plan: PlanKey) => void;
}) {
  const pricing = PLAN_PRICING[plan];
  const isFree = plan === "free";
  const isBoardroom = plan === "boardroom";
  const amount = interval === "year" ? pricing.annualUsd : pricing.monthlyUsd;
  const isCurrent = currentTier === plan || (plan === "pro" && currentTier === "pro");

  return (
    <section
      className={cn(
        "relative flex flex-col rounded-xl border bg-surface p-6",
        isBoardroom ? "border-bronze/60 shadow-lifted" : "border-line shadow-quiet",
      )}
    >
      {isBoardroom && (
        <span className="absolute -top-3 left-6 rounded-full bg-bronze px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
          Best models
        </span>
      )}

      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold text-ink">{pricing.name}</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-ink">{pricing.tagline}</p>
        </div>
        {isCurrent && <Chip tone="bronze">Current</Chip>}
      </div>

      <div className="mt-5 flex items-baseline gap-2">
        <span className="font-display text-[38px] leading-none text-ink">
          {isFree ? "$0" : `$${amount}`}
        </span>
        <span className="text-[11.5px] text-faint-ink">
          {isFree ? "forever" : interval === "year" ? "/ year" : "/ month"}
        </span>
      </div>
      {!isFree && interval === "year" && (
        <p className="mt-1 text-[10.5px] text-bronze-ink">
          {YEARLY_MONTHS_FREE} months free versus monthly (${pricing.monthlyUsd * YEARLY_MONTHS_FREE} saved)
        </p>
      )}

      <ul className="mt-5 flex-1 space-y-2.5 border-t border-line pt-5">
        {pricing.features.map((feature) => (
          <li key={feature} className="flex gap-2 text-[12px] text-ink-soft">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bronze" /> {feature}
          </li>
        ))}
      </ul>

      {isFree ? (
        <Link href="/" className="mt-6">
          <Btn variant="outline" className="w-full">
            {currentTier === "free" || !currentTier ? "Open the free board" : "Included forever"}
          </Btn>
        </Link>
      ) : (
        <Btn
          variant={isBoardroom ? "bronze" : "primary"}
          size="lg"
          className="mt-6 w-full"
          onClick={() => onSubscribe(plan)}
          disabled={busy || isCurrent}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
          {isCurrent ? "Current plan" : `Choose ${pricing.name}`}
        </Btn>
      )}
    </section>
  );
}

export default function SubscribePage() {
  const { user, isLoading } = useAuth();
  const [interval, setBillingInterval] = useState<BillingInterval>("month");
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!isLoading && !user) return <Redirect to="/auth" />;

  const checkout = async (label: string, body: CheckoutBody) => {
    setPending(label);
    setNotice(null);
    try {
      const res = await apiRequest("POST", "/api/create-checkout-session", body);
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      if (data?.updated) {
        // Plan change on an existing subscription: Stripe prorates in place,
        // so there is nothing to pay again. Back to the board.
        window.location.href = "/?checkout=upgraded";
        return;
      }
      throw new Error(data?.message || "No checkout URL returned.");
    } catch (err) {
      setNotice(friendly(err));
      setPending(null);
    }
  };

  const portal = async () => {
    setPending("portal");
    setNotice(null);
    try {
      const res = await apiRequest("POST", "/api/billing-portal", {});
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error(data?.message || "Billing portal is unavailable.");
    } catch (err) {
      setNotice(friendly(err));
      setPending(null);
    }
  };

  const currentTier = user?.tier ?? "free";

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-[1060px] items-center justify-between px-5">
          <Link href="/">
            <QuorumLogo compact />
          </Link>
          <Link href="/" className="text-[12px] text-muted-ink hover:text-ink">
            Back to the boardroom
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1060px] px-5 py-14">
        <p className="eyebrow">Pricing</p>
        <h1 className="mt-3 font-display text-[40px] leading-tight text-ink">Keep the room open.</h1>
        <p className="mt-3 max-w-[560px] text-[14px] leading-relaxed text-muted-ink">
          The Associate board is free forever. Executive adds seats, volume, and fast paid models.
          Boardroom adds the frontier models and the full table.
        </p>

        <div className="mt-7 inline-flex rounded-md border border-line bg-surface p-0.5" role="group" aria-label="Billing interval">
          {(["month", "year"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setBillingInterval(value)}
              aria-pressed={interval === value}
              className={cn(
                "rounded px-3.5 py-1.5 text-[11.5px] font-medium transition-colors",
                interval === value ? "bg-ink text-paper" : "text-muted-ink hover:text-ink",
              )}
            >
              {value === "month" ? "Monthly" : "Yearly · 2 months free"}
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-3">
          <PlanColumn plan="free" interval={interval} currentTier={currentTier} busy={false} onSubscribe={() => {}} />
          <PlanColumn
            plan="pro"
            interval={interval}
            currentTier={currentTier}
            busy={pending === "pro"}
            onSubscribe={() => void checkout("pro", { plan: "pro", interval })}
          />
          <PlanColumn
            plan="boardroom"
            interval={interval}
            currentTier={currentTier}
            busy={pending === "boardroom"}
            onSubscribe={() => void checkout("boardroom", { plan: "boardroom", interval })}
          />
        </div>

        <section className="mt-8 rounded-xl border border-line bg-surface p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-[13px] font-semibold text-ink">Just one roundtable?</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted-ink">
                No subscription. One session credit, consumed when you open the next board — its
                limits apply for that conversation.
              </p>
            </div>
            <Chip tone="neutral">One-time</Chip>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {(["fast", "boardroom"] as const).map((kind) => {
              const session = SESSION_PRICING[kind];
              return (
                <div key={kind} className="flex items-center justify-between gap-4 rounded-lg border border-line bg-paper/60 p-4">
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-medium text-ink">
                      {session.name} · ${session.priceUsd}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-faint-ink">{session.blurb}</p>
                  </div>
                  <Btn
                    variant={kind === "boardroom" ? "bronze" : "outline"}
                    size="sm"
                    onClick={() => void checkout(`session-${kind}`, { session: kind })}
                    disabled={pending === `session-${kind}`}
                  >
                    {pending === `session-${kind}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Buy ${session.priceUsd}
                  </Btn>
                </div>
              );
            })}
          </div>

          <p className="mt-4 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-faint-ink">
            <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-bronze" />
            A Boardroom Session includes {BOARDROOM_FRONTIER_MODEL_ALLOWLIST.slice(0, 3).map(modelLabel).join(", ")} and{" "}
            {BOARDROOM_FRONTIER_MODEL_ALLOWLIST.slice(3).map(modelLabel).join(", ")} for one conversation.
          </p>
        </section>

        <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-6 py-5">
          <div>
            <p className="text-[13px] font-semibold text-ink">Enterprise</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-ink">
              Unlimited seats, private deployment, SSO, audit review, and named onboarding.
            </p>
          </div>
          <a href="mailto:admin@desmond-digital.com?subject=Quorum%20Enterprise">
            <Btn variant="outline">Talk to us</Btn>
          </a>
        </section>

        {user?.stripeCustomerId && (
          <p className="mt-6 text-center text-[11px] text-faint-ink">
            <button type="button" onClick={() => void portal()} className="underline hover:text-ink" disabled={pending === "portal"}>
              {pending === "portal" ? "Opening billing portal…" : "Manage billing, invoices, and cancellation"}
            </button>
          </p>
        )}

        {notice && (
          <p role="alert" className="mx-auto mt-5 max-w-[560px] rounded-md border border-bronze/30 bg-bronze-wash px-3 py-2 text-center text-[11.5px] leading-relaxed text-bronze-ink">
            {notice}
          </p>
        )}

        <p className="mt-6 text-center text-[10.5px] leading-relaxed text-faint-ink">
          Secure checkout by Stripe. Cancel any time; the Associate board stays free. Prices in USD.
        </p>
      </main>
    </div>
  );
}
