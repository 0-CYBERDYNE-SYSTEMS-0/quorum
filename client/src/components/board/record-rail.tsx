import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  Download,
  FileDown,
  FileText,
  HelpCircle,
  Loader2,
  MessageSquareQuote,
  Paperclip,
  Pencil,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { Expert, File as FileRecord, Insight, Message, OpenQuestion } from "@shared/schema";
import { Btn, Chip, Monogram } from "@/components/design";
import { excerpt, initialsFor, roleColor, stanceLabel, stanceOf, stanceTone, type StanceValue } from "@/lib/board";
import { cn } from "@/lib/utils";

type Tab = "record" | "files";

export function RecordRail({
  conversation,
  experts,
  messages,
  openQuestions,
  insights,
  files,
  onAnswer,
  onEditCharter,
  onRefreshInsights,
  isRefreshingInsights,
  onExport,
  onOpenBoard,
  onDownloadFile,
  className,
}: {
  conversation: { id: number; title: string | null; charter: string | null } | null;
  experts: Expert[];
  messages: Message[];
  openQuestions: OpenQuestion[];
  insights: Insight[];
  files: FileRecord[];
  onAnswer: (questionId: number, answer: string) => void;
  onEditCharter: () => void;
  onRefreshInsights: () => void;
  isRefreshingInsights: boolean;
  onExport: () => void;
  onOpenBoard: () => void;
  onDownloadFile: (file: FileRecord) => void;
  className?: string;
}) {
  const [tab, setTab] = useState<Tab>("record");
  const [answering, setAnswering] = useState<number | null>(null);
  const [expandedPositions, setExpandedPositions] = useState<Set<number>>(new Set());
  const [answerDraft, setAnswerDraft] = useState("");

  const positions = useMemo(() => {
    const latest = new Map<number, Message>();
    for (const message of messages) {
      if (message.expertId && message.stance) latest.set(message.expertId, message);
    }
    return experts.map((expert) => {
      const message = latest.get(expert.id);
      const stance = message ? stanceOf(message) : null;
      return { expert, stance };
    });
  }, [experts, messages]);

  const counts = useMemo(() => {
    const base: Record<StanceValue, number> = { agree: 0, conditional: 0, disagree: 0, abstain: 0 };
    for (const position of positions) if (position.stance) base[position.stance.stance] += 1;
    return base;
  }, [positions]);

  const reported = counts.agree + counts.conditional + counts.disagree + counts.abstain;
  const artifacts = useMemo(
    () => messages.flatMap((message) => (message.artifacts ?? []).map((artifact) => ({ artifact, message }))),
    [messages],
  );
  const deliverables = files.filter((file) => !file.supersededAt && file.uploadedBy.startsWith("Expert:"));
  const memo = useMemo(() => [...messages].reverse().find((message) => message.isSynthesis), [messages]);

  if (!conversation) return null;

  return (
    <aside className={cn("flex h-full flex-col border-l border-line bg-paper", className)}>
      <div className="flex h-[60px] shrink-0 items-center gap-1 border-b border-line px-4">
        {(
          [
            ["record", "Record"],
            ["files", `Files${files.length ? ` · ${files.length}` : ""}`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "h-7 rounded-md px-2.5 text-[11.5px] font-medium transition-colors",
              tab === value ? "bg-ink text-paper" : "text-muted-ink hover:bg-slatewash hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={onExport}
          className="ml-auto flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-muted-ink hover:bg-slatewash hover:text-ink"
          title="Export the transcript"
        >
          <FileDown className="h-3.5 w-3.5" /> Export
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "record" ? (
          <div className="divide-y divide-line">
            {/* The motion */}
            <section className="px-4 py-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-ink">The decision</p>
                <button
                  type="button"
                  onClick={onEditCharter}
                  className="flex items-center gap-1 text-[10.5px] text-faint-ink hover:text-ink"
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
              </div>
              {conversation.charter ? (
                <p className="mt-2 font-display text-[15.5px] leading-snug text-ink">{conversation.charter}</p>
              ) : (
                <button
                  type="button"
                  onClick={onEditCharter}
                  className="mt-2 w-full rounded-md border border-dashed border-line-strong px-3 py-3 text-left text-[12px] leading-relaxed text-faint-ink hover:border-bronze/50 hover:text-ink"
                >
                  No motion on the table yet. Write the decision and the guardrails so every director
                  argues the same question.
                </button>
              )}
            </section>

            {/* Positions */}
            <section className="px-4 py-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-ink">Positions</p>
                <span className="text-[10.5px] text-faint-ink">
                  {reported}/{experts.length} reported
                </span>
              </div>

              {reported > 0 ? (
                <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-line">
                  {counts.agree > 0 && <span className="bg-emerald" style={{ width: `${(counts.agree / experts.length) * 100}%` }} />}
                  {counts.conditional > 0 && <span className="bg-bronze" style={{ width: `${(counts.conditional / experts.length) * 100}%` }} />}
                  {counts.disagree > 0 && <span className="bg-oxblood" style={{ width: `${(counts.disagree / experts.length) * 100}%` }} />}
                  {counts.abstain > 0 && <span className="bg-line-strong" style={{ width: `${(counts.abstain / experts.length) * 100}%` }} />}
                </div>
              ) : (
                <p className="mt-2 text-[11.5px] leading-relaxed text-faint-ink">
                  Stances appear here as directors report.
                </p>
              )}

              <ul className="mt-3 space-y-2">
                {positions.map(({ expert, stance }) => (
                  <li key={expert.id} className="flex items-start gap-2.5">
                    <Monogram
                      name={expert.role}
                      color={expert.avatarUrl?.startsWith("#") ? expert.avatarUrl : roleColor(expert.role, expert.id)}
                      size={22}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11.5px] font-medium text-ink">{expert.role}</p>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedPositions((current) => {
                            const next = new Set(current);
                            if (next.has(expert.id)) next.delete(expert.id);
                            else next.add(expert.id);
                            return next;
                          })
                        }
                        title={stance?.position || undefined}
                        className={cn(
                          "block w-full text-left text-[10.5px] leading-snug text-faint-ink hover:text-ink-soft",
                          !expandedPositions.has(expert.id) && "line-clamp-2",
                        )}
                      >
                        {stance ? stance.position || stanceLabel[stance.stance] : "Has not reported"}
                      </button>
                    </div>
                    {stance && (
                      <Chip tone={stanceTone[stance.stance]} className="mt-0.5 shrink-0 px-1.5 text-[9.5px]">
                        {stanceLabel[stance.stance]}
                      </Chip>
                    )}
                  </li>
                ))}
                {experts.length === 0 && (
                  <li>
                    <button
                      type="button"
                      onClick={onOpenBoard}
                      className="text-[11.5px] text-bronze-ink hover:underline"
                    >
                      Seat the first director →
                    </button>
                  </li>
                )}
              </ul>
            </section>

            {/* Open questions */}
            <section className="px-4 py-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-ink">Open questions</p>
                <span className="text-[10.5px] text-faint-ink">{openQuestions.length}</span>
              </div>
              {openQuestions.length === 0 ? (
                <p className="mt-2 text-[11.5px] leading-relaxed text-faint-ink">
                  No director is waiting on you. Facts only the Chair can supply will land here.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {openQuestions.map((question) => (
                    <li key={question.id} className="rounded-lg border border-line bg-surface p-3">
                      <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-ink">
                        <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bronze" />
                        {question.question}
                      </p>
                      {question.assumption && (
                        <p className="mt-1.5 pl-5 text-[10.5px] italic leading-relaxed text-faint-ink">
                          Proceeding on: {question.assumption}
                        </p>
                      )}
                      {answering === question.id ? (
                        <div className="mt-2">
                          <textarea
                            autoFocus
                            value={answerDraft}
                            onChange={(event) => setAnswerDraft(event.target.value)}
                            rows={2}
                            className="w-full resize-none rounded-md border border-line-strong bg-surface-raised px-2 py-1.5 text-[11.5px] text-ink outline-none focus:border-bronze/60"
                            placeholder="Answer for the record…"
                          />
                          <div className="mt-1.5 flex justify-end gap-1.5">
                            <Btn variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setAnswering(null)}>
                              Cancel
                            </Btn>
                            <Btn
                              variant="primary"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              disabled={!answerDraft.trim()}
                              onClick={() => {
                                onAnswer(question.id, answerDraft.trim());
                                setAnswering(null);
                                setAnswerDraft("");
                              }}
                            >
                              Answer
                            </Btn>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setAnswering(question.id);
                            setAnswerDraft("");
                          }}
                          className="mt-2 pl-5 text-[10.5px] font-medium text-bronze-ink hover:underline"
                        >
                          Answer this
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Memo + artifacts */}
            <section className="px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-ink">Artifacts</p>
              {memo && (
                <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-bronze/25 bg-bronze-wash/60 p-3">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-bronze" />
                  <div className="min-w-0">
                    <p className="text-[11.5px] font-medium text-ink">Decision memo</p>
                    <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-muted-ink">
                      {excerpt(memo.content.replace(/^#{1,6}\s*/gm, "").replace(/[*_`]/g, ""), 120)}
                    </p>
                  </div>
                </div>
              )}
              {artifacts.length === 0 && !memo ? (
                <p className="mt-2 text-[11.5px] leading-relaxed text-faint-ink">
                  Charts, tables, and memos created by the board collect here.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {artifacts.map(({ artifact, message }, index) => (
                    <li key={`${message.id}-${index}`} className="flex items-center gap-2 text-[11.5px] text-ink-soft">
                      <Sparkles className="h-3 w-3 shrink-0 text-bronze" />
                      <span className="truncate">{artifact.title || artifact.type}</span>
                      <span className="ml-auto shrink-0 font-mono text-[9.5px] uppercase text-faint-ink">{artifact.type}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Insights */}
            <section className="px-4 py-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-ink">Signals</p>
                <button
                  type="button"
                  onClick={onRefreshInsights}
                  disabled={isRefreshingInsights || messages.length === 0}
                  className="flex items-center gap-1 text-[10.5px] text-faint-ink hover:text-ink disabled:opacity-40"
                >
                  {isRefreshingInsights ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  {insights.length === 0 ? "Generate" : "Refresh"}
                </button>
              </div>
              {insights.length === 0 ? (
                <p className="mt-2 text-[11.5px] leading-relaxed text-faint-ink">
                  Generate a plain-language read of where this board actually landed.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {insights.slice(0, 3).map((insight) => (
                    <li key={insight.id}>
                      <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink">
                        <MessageSquareQuote className="h-3 w-3 text-bronze" /> {insight.title}
                      </p>
                      <ul className="mt-1 space-y-1 pl-4">
                        {(insight.points ?? []).slice(0, 4).map((point, index) => (
                          <li key={index} className="list-disc text-[10.5px] leading-relaxed text-muted-ink">
                            {point}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-ink">Circulate</p>
              <div className="mt-2 space-y-1.5">
                <button
                  type="button"
                  onClick={onExport}
                  className="flex w-full items-center justify-between rounded-md border border-line bg-surface px-3 py-2 text-[11.5px] text-ink-soft hover:border-line-strong"
                >
                  Transcript (Markdown) <Download className="h-3 w-3" />
                </button>
                {deliverables.slice(0, 4).map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => onDownloadFile(file)}
                    className="flex w-full items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[11.5px] text-ink-soft hover:border-line-strong"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Paperclip className="h-3 w-3 shrink-0" />
                      <span className="truncate">{file.filename}</span>
                    </span>
                    {file.version ? <span className="shrink-0 font-mono text-[9.5px] text-faint-ink">v{file.version}</span> : null}
                  </button>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div className="p-4">
            {files.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center">
                <Paperclip className="mx-auto h-4 w-4 text-faint-ink" />
                <p className="mt-2 text-[12px] font-medium text-ink-soft">No files yet</p>
                <p className="mt-1 text-[11px] leading-relaxed text-faint-ink">
                  Attach a document to the session, or ask the Chief of Staff for a memo.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {files.map((file) => (
                  <li key={file.id}>
                    <button
                      type="button"
                      onClick={() => onDownloadFile(file)}
                      className="flex w-full items-start gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-left hover:border-line-strong"
                    >
                      <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bronze" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium text-ink">{file.filename}</span>
                        <span className="mt-0.5 block truncate text-[10.5px] text-faint-ink">
                          {file.uploadedBy} {file.version ? `· v${file.version}` : ""}
                          {file.supersededAt ? " · superseded" : ""}
                        </span>
                      </span>
                      <ArrowUpRight className="h-3 w-3 shrink-0 text-faint-ink" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
