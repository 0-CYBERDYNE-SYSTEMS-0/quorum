/**
 * Dashboard plan + session-credit summary. Source of truth is
 * GET /api/user/tier, which reports the plan and the remaining one-time
 * session credits for the signed-in account.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, Ticket } from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";
import { PLAN_PRICING, type PlanKey } from "@shared/pricing";

export type TierStatus = {
  tier: string;
  planName?: string;
  hasPlan?: boolean;
  limits: { name: string; maxExperts: number; maxMessages: number };
  usage: { period: string; messages: number; aiSpendUsd?: number };
  aiBudgetUsd: number | null;
  sessionCredits: { available: number; fast: number; boardroom: number; used: number };
};

function planLabel(tier: string, fallback?: string): string {
  if (tier === "enterprise") return "Enterprise";
  const plan = PLAN_PRICING[tier as PlanKey];
  return plan?.name ?? fallback ?? "No plan";
}

export function PlanCard() {
  const { data, isLoading } = useQuery<TierStatus | null>({
    queryKey: ["/api/user/tier"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  if (isLoading || !data) {
    return (
      <div className="mx-1 mb-1 flex items-center gap-2 rounded-lg border border-line/60 px-2.5 py-2 text-[10.5px] text-faint-ink">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading plan…
      </div>
    );
  }

  const credits = data.sessionCredits;
  // Pro sees only the $15 Boardroom Session; Boardroom/Enterprise see none.
  const visibleFast = data.tier === "pro" ? 0 : credits.fast;
  const visibleCredits = visibleFast + credits.boardroom;
  const planName = planLabel(data.tier, data.planName);
  const showsCredits = data.tier !== "boardroom" && data.tier !== "enterprise";

  return (
    <Link
      href="/subscribe"
      className="mx-1 mb-1 block rounded-lg border border-line/60 bg-surface/50 px-2.5 py-2 transition-colors hover:border-line-strong"
      title="Plans and session credits"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-ink">
          {data.tier === "pro" || data.tier === "boardroom" || data.tier === "enterprise" ? `${planName} plan` : planName}
        </span>
        {!data.hasPlan && <span className="text-[9.5px] uppercase tracking-[0.1em] text-bronze">Upgrade</span>}
      </div>
      {showsCredits && (
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-faint-ink">
          <Ticket className="h-3 w-3 shrink-0 text-bronze" />
          {visibleCredits > 0 ? (
            <span>
              {visibleCredits} session credit{visibleCredits === 1 ? "" : "s"} ready
              {visibleFast > 0 && credits.boardroom > 0
                ? ` (${visibleFast} fast · ${credits.boardroom} boardroom)`
                : ""}
            </span>
          ) : (
            <span>No session credits</span>
          )}
        </div>
      )}
      <div className="mt-0.5 text-[9.5px] text-faint-ink">
        {data.hasPlan ? `${data.usage.messages}/${data.limits.maxMessages} briefs this month` : "Open a board with a plan or a session"}
        {data.aiBudgetUsd ? ` · $${data.aiBudgetUsd} AI budget` : ""}
      </div>
    </Link>
  );
}
