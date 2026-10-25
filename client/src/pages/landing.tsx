import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  Check,
  ChevronRight,
  FileText,
  Fingerprint,
  Gavel,
  KeyRound,
  Layers,
  Lock,
  Scale,
  Server,
  Sparkles,
} from "lucide-react";
import { QuorumLogo, QuorumMark } from "@/components/brand";
import { Btn, Chip, SectionLabel } from "@/components/design";
import { EXPERT_CATALOG } from "@shared/expert-catalog";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-all duration-300",
        scrolled ? "border-b border-line bg-paper/85 backdrop-blur-md" : "border-b border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-5 md:px-8">
        <Link href="/" aria-label="Quorum home">
          <QuorumLogo compact />
        </Link>
        <nav className="hidden items-center gap-7 text-[13px] text-muted-ink md:flex">
          <a className="transition-colors hover:text-ink" href="#room">The room</a>
          <a className="transition-colors hover:text-ink" href="#session">A session</a>
          <a className="transition-colors hover:text-ink" href="#record">The record</a>
          <a className="transition-colors hover:text-ink" href="#pricing">Pricing</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/auth" className="hidden text-[13px] text-muted-ink transition-colors hover:text-ink sm:block">
            Sign in
          </Link>
          <Link href="/auth?mode=register">
            <Btn variant="bronze" size="sm" className="pl-3.5 pr-3">
              Convene a board <ArrowRight className="h-3.5 w-3.5" />
            </Btn>
          </Link>
        </div>
      </div>
    </header>
  );
}

function StanceRow({
  role,
  initials,
  color,
  stance,
  confidence,
  line,
}: {
  role: string;
  initials: string;
  color: string;
  stance: "Agree" | "Conditional" | "Disagree";
  confidence: number;
  line: string;
}) {
  const tone = stance === "Agree" ? "emerald" : stance === "Disagree" ? "oxblood" : "bronze";
  return (
    <div className="flex items-start gap-3 border-t border-line px-4 py-3 first:border-t-0">
      <span
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
        style={{ background: color }}
      >
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-medium text-ink">{role}</span>
          <Chip tone={tone as never} className="shrink-0">
            {stance} · {confidence}/5
          </Chip>
        </div>
        <p className="mt-0.5 line-clamp-1 text-[12.5px] text-ink-soft">{line}</p>
      </div>
    </div>
  );
}

function BoardPreview() {
  return (
    <div className="relative">
      {/* stacked paper */}
      <div className="absolute -right-3 -top-3 h-full w-full rounded-xl border border-line bg-surface/70" aria-hidden />
      <div className="absolute -right-1.5 -top-1.5 h-full w-full rounded-xl border border-line bg-surface/85" aria-hidden />
      <div className="relative overflow-hidden rounded-xl border border-line bg-surface shadow-quiet">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2.5">
            <QuorumMark size={18} className="text-bronze" />
            <div>
              <p className="text-[12px] font-medium leading-none text-ink">Board session</p>
              <p className="mt-1 text-[10.5px] uppercase tracking-[0.12em] text-faint-ink">Series B · pricing</p>
            </div>
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-bronze/25 bg-bronze-wash px-2 py-0.5 text-[10px] font-medium text-bronze-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-bronze animate-pulse" /> Deliberating
          </span>
        </div>

        <div className="border-b border-line bg-paper/60 px-4 py-4">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint-ink">The decision</p>
          <p className="mt-1.5 font-display text-[21px] leading-snug text-ink">
            Should we retire the self-serve tier and move upmarket in Q1?
          </p>
        </div>

        <StanceRow
          role="Chief Financial Officer"
          initials="CF"
          color="#3F5B52"
          stance="Conditional"
          confidence={3}
          line="Only if net revenue retention clears 115% first."
        />
        <StanceRow
          role="Chief Revenue Officer"
          initials="CR"
          color="#8A6A3B"
          stance="Disagree"
          confidence={4}
          line="Self-serve is the top of the funnel; we would lose 38% of pipeline."
        />
        <StanceRow
          role="General Counsel"
          initials="GC"
          color="#6B4A4A"
          stance="Agree"
          confidence={4}
          line="No contractual blockers; enterprise terms already standard."
        />
        <StanceRow
          role="Chief Strategy Officer"
          initials="CS"
          color="#3D4A5C"
          stance="Conditional"
          confidence={5}
          line="Move upmarket, but keep a paid starter as the feeder."
        />

        <div className="flex items-center justify-between border-t border-line bg-paper/60 px-4 py-2.5">
          <span className="text-[10.5px] text-faint-ink">4 of 5 seats reported · 1 open question</span>
          <span className="flex items-center gap-1 text-[10.5px] font-medium text-bronze-ink">
            <FileText className="h-3 w-3" /> Decision memo draft
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1200px 520px at 78% -8%, hsl(var(--bronze) / 0.13), transparent 62%), radial-gradient(900px 480px at 4% 18%, hsl(160 22% 40% / 0.07), transparent 60%)",
        }}
      />
      <div className="pointer-events-none absolute inset-0 -z-10 rule-grid opacity-[0.35] [mask-image:radial-gradient(ellipse_at_top,black,transparent_72%)]" />

      <div className="mx-auto max-w-[1180px] px-5 pb-12 pt-12 md:px-8 md:pb-16 md:pt-16">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-bronze" />
              <span className="text-[11.5px] font-medium uppercase tracking-[0.16em] text-bronze-ink">The AI boardroom</span>
            </div>
            <h1 className="mt-5 font-display text-[clamp(2.9rem,5.6vw,4.9rem)] leading-[0.98] tracking-[-0.02em] text-ink">
              Bring the board in
              <span className="block italic text-bronze-ink">before</span>
              the decision.
            </h1>
            <p className="mt-6 max-w-[545px] text-[17px] leading-[1.65] text-ink-soft">
              Quorum seats AI directors — finance, strategy, legal, operations — around one table.
              They deliberate in rounds, disagree on the record, and leave you a decision memo
              you can actually circulate.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/auth?mode=register">
                <Btn variant="bronze" size="lg" className="px-5">
                  Convene a board <ArrowRight className="h-4 w-4" />
                </Btn>
              </Link>
              <a href="#session">
                <Btn variant="outline" size="lg" className="px-5">
                  See a session run
                </Btn>
              </a>
            </div>
            <p className="mt-4 text-[12px] text-faint-ink">
              Three seats on the house. No card. Your workspace stays private.
            </p>

            <dl className="mt-10 grid max-w-[540px] grid-cols-3 gap-4 border-t border-line pt-5">
              {[
                ["14", "functional seats"],
                ["4", "board presets"],
                ["1", "decision record"],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt className="num font-display text-[26px] leading-none text-ink">{value}</dt>
                  <dd className="mt-1 text-[11.5px] leading-tight text-muted-ink">{label}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="animate-fade-up">
            <BoardPreview />
          </div>
        </div>
      </div>

      <div className="border-y border-line bg-surface/60">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-4 text-[12.5px] text-ink-soft md:px-8">
          <span className="flex items-center gap-2"><Scale className="h-3.5 w-3.5 text-bronze" /> Functional tension, not persona theater</span>
          <span className="flex items-center gap-2"><Gavel className="h-3.5 w-3.5 text-bronze" /> Every dissent recorded</span>
          <span className="flex items-center gap-2"><Layers className="h-3.5 w-3.5 text-bronze" /> Memos, models, and 30-60-90 plans</span>
          <span className="flex items-center gap-2"><Lock className="h-3.5 w-3.5 text-bronze" /> Your instance, your keys</span>
        </div>
      </div>
    </section>
  );
}

function SessionSection() {
  const steps = [
    {
      n: "01",
      title: "State the decision",
      body: "Write the question and the constraints in the charter. Quorum refuses to start from a blank prompt — the board needs a motion on the table.",
    },
    {
      n: "02",
      title: "Let them argue",
      body: "Directors speak in structured rounds. Each answers the previous point, then declares a stance and a confidence. You can pause, direct a seat, or answer an open question mid-session.",
    },
    {
      n: "03",
      title: "Leave with the memo",
      body: "The session closes with a decision memo: rationale, dissent, risks, owners, and 30/60/90 actions. Export Markdown, or pull the deliverables into your own docs.",
    },
  ];

  return (
    <section id="session" className="mx-auto max-w-[1180px] px-5 py-20 md:px-8 md:py-28">
      <SectionLabel>Inside a session</SectionLabel>
      <div className="mt-8 grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div>
          <h2 className="font-display text-[clamp(2rem,3.6vw,3.1rem)] leading-[1.04] text-ink">
            A meeting with minutes,
            <span className="italic text-bronze-ink"> not a chat log.</span>
          </h2>
          <p className="mt-5 max-w-[440px] text-[15px] leading-[1.7] text-ink-soft">
            One-shot answers collapse under scrutiny. A board holds a position, hears the
            counter-argument, and puts the disagreement in writing. That is the artifact you take
            to your co-founder, your investor, or your leadership team.
          </p>
          <div className="mt-8 space-y-6">
            {steps.map((step) => (
              <div key={step.n} className="flex gap-4">
                <span className="mt-0.5 font-mono text-[11px] tracking-widest text-bronze">{step.n}</span>
                <div>
                  <h3 className="text-[14.5px] font-semibold text-ink">{step.title}</h3>
                  <p className="mt-1.5 max-w-[430px] text-[14px] leading-[1.65] text-ink-soft">{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <figure className="relative overflow-hidden rounded-xl border border-line bg-surface shadow-quiet">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <span className="h-2 w-2 rounded-full bg-line-strong" />
            <span className="h-2 w-2 rounded-full bg-line-strong" />
            <span className="h-2 w-2 rounded-full bg-line-strong" />
            <span className="ml-2 font-mono text-[10px] text-faint-ink">quorum · boardroom</span>
          </div>
          <img
            src="/shots/transcript.png"
            alt="Two directors responding to the same decision in a Quorum session, with stance and confidence recorded."
            className="block w-full"
            loading="lazy"
          />
          <figcaption className="border-t border-line px-4 py-2.5 text-[11px] text-faint-ink">
            A live session. Chair brief on the left, dissent and artifacts on the record.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

function RoomSection() {
  return (
    <section id="room" className="border-y border-line bg-surface/50">
      <div className="mx-auto max-w-[1180px] px-5 py-20 md:px-8 md:py-28">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <SectionLabel>Seats at the table</SectionLabel>
            <h2 className="mt-6 max-w-[640px] font-display text-[clamp(2rem,3.6vw,3.1rem)] leading-[1.04] text-ink">
              Fourteen functions. One room.
              <span className="italic text-bronze-ink"> You choose who sits.</span>
            </h2>
          </div>
          <p className="max-w-[310px] text-[13.5px] leading-[1.65] text-ink-soft">
            Each seat carries a real brief: the artifacts it owns, the numbers it demands, and the
            questions it hands to another director.
          </p>
        </div>

        <div className="mt-10 grid gap-x-12 md:grid-cols-2">
          {EXPERT_CATALOG.map((expert) => (
            <div key={expert.role} className="group flex items-start gap-3.5 border-t border-line py-4">
              <span
                className="mt-[3px] flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px]"
                style={{ background: `${expert.color}1A`, color: expert.color }}
              >
                {expert.emoji}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <p className="text-[14px] font-medium text-ink">{expert.role}</p>
                  <span className="text-[9.5px] uppercase tracking-[0.12em] text-faint-ink">{expert.category}</span>
                </div>
                <p className="mt-1 text-[13px] leading-[1.6] text-ink-soft">{expert.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function RecordSection() {
  return (
    <section id="record" className="ink-band relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "radial-gradient(circle at 20% 10%, white, transparent 45%)" }} />
      <div className="mx-auto grid max-w-[1180px] gap-14 px-5 py-20 md:px-8 md:py-28 lg:grid-cols-[1fr_0.9fr] lg:items-center">
        <div>
          <SectionLabel>What survives the meeting</SectionLabel>
          <h2 className="mt-6 font-display text-[clamp(2rem,3.6vw,3.2rem)] leading-[1.03] text-[hsl(40_25%_94%)]">
            The decision, the dissent,
            <span className="italic text-[hsl(38_46%_66%)]"> and the reasons.</span>
          </h2>
          <p className="mt-5 max-w-[490px] text-[15.5px] leading-[1.7] text-[hsl(40_12%_78%)]">
            Quorum keeps a decision record beside the transcript: where the board agreed, where it
            split, which questions are still open, and what was assumed. The closing synthesis is a
            memo, not a summary.
          </p>

          <div className="mt-10 grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {[
              ["Positions", "Every director declares stance and confidence. No silent agents."],
              ["Dissent", "Minority views are named in the memo, not smoothed away."],
              ["Open questions", "Facts only you can supply stay open until you answer them."],
              ["Deliverables", "Memo, risk register, 30-60-90 plan — versioned, downloadable."],
            ].map(([title, body]) => (
              <div key={title} className="border-t border-white/10 pt-3">
                <p className="text-[13px] font-medium text-[hsl(40_22%_90%)]">{title}</p>
                <p className="mt-1 text-[13px] leading-[1.6] text-[hsl(40_10%_72%)]">{body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/12 bg-[hsl(220_22%_12%)] p-6 shadow-lifted">
          <p className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[hsl(38_30%_62%)]">
            <FileText className="h-3.5 w-3.5" /> Decision memo · draft
          </p>
          <h3 className="mt-4 font-display text-[22px] leading-snug text-[hsl(40_25%_94%)]">
            Retire self-serve in Q1 — conditional
          </h3>
          <div className="mt-5 space-y-4 text-[13px] leading-[1.65] text-[hsl(40_12%_80%)]">
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[hsl(38_30%_58%)]">Decision</p>
              <p>Move upmarket, but keep a $99 starter as the feeder. Revisit in 90 days against NRR.</p>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[hsl(38_30%_58%)]">Where the board disagreed</p>
              <p>CRO dissents: self-serve is 38% of pipeline. CFO conditions on NRR ≥ 115%. Strategy holds the majority view.</p>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[hsl(38_30%_58%)]">Next actions</p>
              <ul className="space-y-1">
                <li className="flex gap-2"><Check className="mt-0.5 h-3 w-3 text-[hsl(158_32%_58%)]" /> CFO — NRR cohort pull · 30 days</li>
                <li className="flex gap-2"><Check className="mt-0.5 h-3 w-3 text-[hsl(158_32%_58%)]" /> CRO — pipeline attribution · 45 days</li>
                <li className="flex gap-2"><Check className="mt-0.5 h-3 w-3 text-[hsl(158_32%_58%)]" /> GC — enterprise terms refresh · 60 days</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function EnterpriseSection() {
  const items = [
    { icon: Server, title: "Self-host or private cloud", body: "Docker and Postgres. Run it inside your own perimeter; no vendor tenancy required." },
    { icon: KeyRound, title: "Bring your own model keys", body: "OpenRouter, or a local OpenAI-compatible endpoint. Your spend, your routing." },
    { icon: Fingerprint, title: "A record you can audit", body: "Sessions, decisions, and deliverables persist in your database — export any time." },
    { icon: ShieldIcon, title: "Built with restraint", body: "No training on your content. No third-party analytics. No surprise surfaces." },
  ];
  return (
    <section className="mx-auto max-w-[1180px] px-5 py-20 md:px-8 md:py-24">
      <SectionLabel>For teams that get audited</SectionLabel>
      <div className="mt-8 grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div>
          <h2 className="font-display text-[clamp(1.9rem,3.2vw,2.8rem)] leading-[1.05] text-ink">
            Enterprise manners,
            <span className="italic text-bronze-ink"> without the enterprise theater.</span>
          </h2>
          <p className="mt-5 max-w-[390px] text-[14.5px] leading-[1.65] text-ink-soft">
            A boardroom is where sensitive things get said. Quorum is designed to keep them in the
            room: private deployment, explicit model routing, and a clean export when you leave.
          </p>
          <Link href="/auth?mode=register" className="mt-7 inline-flex items-center gap-1.5 text-[13px] font-medium text-bronze-ink hover:underline">
            Start with three seats <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {items.map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <Icon className="h-4 w-4 text-bronze" strokeWidth={1.6} />
              <p className="mt-3 text-[13.5px] font-semibold text-ink">{title}</p>
              <p className="mt-1 text-[13px] leading-[1.6] text-ink-soft">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ShieldIcon({ className, strokeWidth }: { className?: string; strokeWidth?: number }) {
  return <Lock className={className} strokeWidth={strokeWidth} />;
}

function Pricing() {
  const plans = [
    {
      name: "Associate",
      price: "$0",
      cadence: "forever",
      line: "For the first decision.",
      features: ["3 board seats", "100 chair briefs / month", "House models", "Decision memos & exports"],
      cta: "Start free",
      href: "/auth?mode=register",
      featured: false,
    },
    {
      name: "Executive",
      price: "$10",
      cadence: "per month",
      line: "For operators in the chair weekly.",
      features: ["8 board seats", "1,000 chair briefs / month", "Bring your own model key", "Artifacts, charts, and deliverable versioning"],
      cta: "Convene a board",
      href: "/auth?mode=register",
      featured: true,
    },
    {
      name: "Enterprise",
      price: "Custom",
      cadence: "annual",
      line: "For leadership teams and regulated rooms.",
      features: ["Unlimited seats", "Private deployment", "SSO and audit review", "Named onboarding"],
      cta: "Talk to us",
      href: "mailto:admin@desmond-digital.com?subject=Quorum%20Enterprise",
      featured: false,
    },
  ];
  return (
    <section id="pricing" className="border-y border-line bg-surface/60">
      <div className="mx-auto max-w-[1180px] px-5 py-20 md:px-8 md:py-24">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <SectionLabel>Pricing</SectionLabel>
            <h2 className="mt-6 font-display text-[clamp(1.9rem,3.2vw,2.8rem)] leading-[1.05] text-ink">
              Cheaper than one bad decision.
            </h2>
          </div>
          <p className="text-[12px] text-faint-ink">USD. Monthly or $96/year. Cancel any time.</p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                "relative flex flex-col rounded-xl border bg-surface p-6",
                plan.featured ? "border-bronze/50 shadow-quiet" : "border-line",
              )}
            >
              {plan.featured && (
                <span className="absolute -top-2.5 left-6 rounded-full border border-bronze/30 bg-bronze-wash px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-bronze-ink">
                  Most convened
                </span>
              )}
              <p className="text-[13px] font-semibold text-ink">{plan.name}</p>
              <p className="mt-3 flex items-baseline gap-1.5">
                <span className="font-display text-[40px] leading-none text-ink">{plan.price}</span>
                <span className="text-[11px] text-faint-ink">{plan.cadence}</span>
              </p>
              <p className="mt-2 text-[12.5px] text-ink-soft">{plan.line}</p>
              <ul className="mt-6 flex-1 space-y-2.5 border-t border-line pt-5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2 text-[13px] text-ink-soft">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bronze" /> {feature}
                  </li>
                ))}
              </ul>
              <Link href={plan.href} className="mt-6">
                <Btn variant={plan.featured ? "bronze" : "outline"} className="w-full">
                  {plan.cta}
                </Btn>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto max-w-[1180px] px-5 py-24 text-center md:px-8 md:py-32">
        <QuorumMark size={34} className="mx-auto text-bronze" />
        <h2 className="mx-auto mt-6 max-w-[760px] font-display text-[clamp(2.2rem,4.6vw,3.9rem)] leading-[1.02] text-ink">
          The decision is Monday.
          <span className="block italic text-bronze-ink">Convene the board tonight.</span>
        </h2>
        <div className="mt-8 flex justify-center">
          <Link href="/auth?mode=register">
            <Btn variant="bronze" size="lg" className="px-6">
              Convene a board <ArrowRight className="h-4 w-4" />
            </Btn>
          </Link>
        </div>
        <p className="mt-4 text-[12px] text-faint-ink">Three seats on the house. Sign in with the same account across devices.</p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-10 md:flex-row md:items-center md:justify-between md:px-8">
        <div className="flex items-center gap-3">
          <QuorumLogo compact />
          <span className="text-[11.5px] text-faint-ink">The AI boardroom for consequential decisions.</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11.5px] text-muted-ink">
          <a href="#room" className="hover:text-ink">The room</a>
          <a href="#pricing" className="hover:text-ink">Pricing</a>
          <Link href="/auth" className="hover:text-ink">Sign in</Link>
          <span className="text-faint-ink">© {new Date().getFullYear()} Quorum</span>
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main>
        <Hero />
        <SessionSection />
        <RoomSection />
        <RecordSection />
        <EnterpriseSection />
        <Pricing />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}
