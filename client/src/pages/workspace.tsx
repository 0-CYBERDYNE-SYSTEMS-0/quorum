import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Redirect } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Building2,
  Command,
  Download,
  FileText,
  Gauge,
  Loader2,
  Moon,
  Plus,
  Search,
  Settings2,
  Sun,
  Users,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBoardRoom } from "@/hooks/use-board-room";
import { useTheme } from "@/lib/theme";
import { apiRequest } from "@/lib/queryClient";
import { EXPERT_CATALOG } from "@shared/expert-catalog";
import { BoardModal } from "@/components/board/board-modal";
import { CharterModal } from "@/components/board/charter-modal";
import { CompanyModal } from "@/components/board/company-modal";
import { Composer } from "@/components/board/composer";
import { Minutes } from "@/components/board/minutes";
import { RecordRail } from "@/components/board/record-rail";
import { SessionList, type SessionSummary } from "@/components/board/session-list";
import { TopBar } from "@/components/board/top-bar";
import { Btn, Chip, Field, Kbd, Modal, TextArea } from "@/components/design";
import { BOARD_PRESETS, dayLabel, excerpt, roleColor } from "@/lib/board";
import { cn } from "@/lib/utils";

function EmptyBoard({
  onConvene,
  isCreating,
}: {
  onConvene: (decision: string, presetId: string) => Promise<void>;
  isCreating: boolean;
}) {
  const [decision, setDecision] = useState("");
  const [presetId, setPresetId] = useState("full");

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-1 flex-col justify-center px-6 py-16">
      <div className="animate-fade-up">
        <p className="eyebrow flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-bronze" /> No session open
        </p>
        <h1 className="mt-4 max-w-[640px] font-display text-[clamp(2.1rem,4vw,3.2rem)] leading-[1.05] text-ink">
          What decision is on the table?
        </h1>
        <p className="mt-3 max-w-[520px] text-[14px] leading-relaxed text-muted-ink">
          State the motion and the guardrails. Quorum convenes a board, opens the deliberation, and
          keeps the record.
        </p>

        <div className="mt-8 rounded-xl border border-line-strong bg-surface p-3 shadow-quiet">
          <TextArea
            autoFocus
            value={decision}
            onChange={(event) => setDecision(event.target.value)}
            placeholder="Should we retire the self-serve tier and move upmarket in Q1? Guardrails: gross margin ≥ 70%, no new headcount before March, keep the PLG funnel for mid-market."
            className="min-h-[104px] border-0 bg-transparent px-2 py-1 font-display text-[17px] leading-relaxed shadow-none focus:ring-0"
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-2 pt-3">
            <span className="text-[10.5px] text-faint-ink">
              The charter and the board are chosen next. You can revise both mid-session.
            </span>
            <Btn variant="bronze" size="md" onClick={() => onConvene(decision, presetId)} disabled={!decision.trim() || isCreating}>
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Convene board
            </Btn>
          </div>
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-ink">Choose a starting board</p>
            <button
              type="button"
              onClick={() => onConvene(decision, "empty")}
              disabled={!decision.trim() || isCreating}
              className="text-[10.5px] text-faint-ink hover:text-ink disabled:opacity-40"
            >
              Seat them manually →
            </button>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {BOARD_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setPresetId(preset.id)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  presetId === preset.id
                    ? "border-bronze/40 bg-bronze-wash/50"
                    : "border-line bg-surface/60 hover:border-line-strong",
                )}
              >
                <span className="flex items-center justify-between">
                  <span className="text-[12.5px] font-medium text-ink">{preset.name}</span>
                  <span className="font-mono text-[9.5px] text-faint-ink">{preset.roles.length} seats</span>
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-ink">{preset.blurb}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionIntro({
  title,
  charter,
  createdAt,
  seats,
  onEditCharter,
  onOpenBoard,
}: {
  title: string;
  charter: string | null;
  createdAt: string | Date | null | undefined;
  seats: { role: string; color: string }[];
  onEditCharter: () => void;
  onOpenBoard: () => void;
}) {
  return (
    <div className="border-b border-line pb-7 pt-9">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">Board session · {dayLabel(createdAt)}</p>
        <button type="button" onClick={onEditCharter} className="text-[10.5px] text-faint-ink hover:text-ink">
          Edit charter
        </button>
      </div>
      <h1 className="mt-3 font-display text-[clamp(1.8rem,3.2vw,2.6rem)] leading-[1.08] text-ink">
        {title}
      </h1>
      {charter ? (
        <div className="mt-4 border-l-2 border-bronze/50 pl-4">
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-soft">{charter}</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={onEditCharter}
          className="mt-4 w-full rounded-lg border border-dashed border-line-strong px-4 py-3 text-left text-[12px] leading-relaxed text-faint-ink hover:border-bronze/50 hover:text-ink"
        >
          This session has no charter. Write the motion and the guardrails so every director argues
          the same question.
        </button>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onOpenBoard}
          className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[10.5px] text-muted-ink hover:border-line-strong hover:text-ink"
        >
          <Users className="h-3 w-3" />
          {seats.length} {seats.length === 1 ? "seat" : "seats"}
        </button>
        {seats.slice(0, 6).map((seat) => (
          <span key={seat.role} className="flex items-center gap-1.5 text-[10.5px] text-faint-ink">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: seat.color }} />
            {seat.role}
          </span>
        ))}
      </div>
    </div>
  );
}

function CommandPalette({
  open,
  onOpenChange,
  conversations,
  onSelect,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: SessionSummary[];
  onSelect: (id: number) => void;
  actions: { label: string; hint?: string; icon: React.ReactNode; run: () => void }[];
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sessionRows = conversations.slice(0, 8).map((conversation) => ({
      key: `session-${conversation.id}`,
      label: conversation.title || "Untitled session",
      hint: dayLabel(conversation.updatedAt ?? conversation.createdAt),
      icon: <FileText className="h-3.5 w-3.5" />,
      run: () => onSelect(conversation.id),
      section: "Sessions",
    }));
    const actionRows = actions.map((action) => ({ key: action.label, section: "Actions", ...action }));
    const all = [...actionRows, ...sessionRows];
    if (!needle) return all;
    return all.filter((row) => row.label.toLowerCase().includes(needle));
  }, [actions, conversations, onSelect, query]);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Command" description="Jump to a session or run an action.">
      <input
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setIndex((value) => (value + 1) % Math.max(rows.length, 1));
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setIndex((value) => (value - 1 + rows.length) % Math.max(rows.length, 1));
          }
          if (event.key === "Enter" && rows[index]) {
            event.preventDefault();
            rows[index].run();
            onOpenChange(false);
          }
        }}
        placeholder="Type a command or session…"
        className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-[13px] text-ink outline-none focus:border-bronze/60"
      />
      <div className="mt-3 max-h-[320px] overflow-y-auto">
        {rows.length === 0 && <p className="px-2 py-6 text-center text-[12px] text-faint-ink">Nothing matches.</p>}
        {rows.map((row, rowIndex) => (
          <button
            key={row.key}
            type="button"
            onMouseEnter={() => setIndex(rowIndex)}
            onClick={() => {
              row.run();
              onOpenChange(false);
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12.5px]",
              rowIndex === index ? "bg-bronze-wash text-bronze-ink" : "text-ink-soft hover:bg-slatewash",
            )}
          >
            <span className="text-faint-ink">{row.icon}</span>
            <span className="flex-1 truncate">{row.label}</span>
            {row.hint && <span className="text-[10px] text-faint-ink">{row.hint}</span>}
          </button>
        ))}
      </div>
      <p className="mt-3 border-t border-line pt-2 text-[10px] text-faint-ink">
        <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move · <Kbd>↵</Kbd> to run · <Kbd>esc</Kbd> to close
      </p>
    </Modal>
  );
}

export default function WorkspacePage() {
  const { user, isLoading, logoutMutation } = useAuth();
  const board = useBoardRoom();
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  const [boardOpen, setBoardOpen] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [charterOpen, setCharterOpen] = useState(false);
  const [concludeOpen, setConcludeOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [convening, setConvening] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const autoOpenedCompany = useRef(false);

  const active = board.activeConversationData as SessionSummary | null;

  const scrollToBottom = useCallback(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [board.messages.length, board.streamingMessages.size, board.activeConversation, scrollToBottom]);

  // First-run company context prompt, once per browser.
  useEffect(() => {
    if (!user || board.companyProfileLoading || autoOpenedCompany.current) return;
    autoOpenedCompany.current = true;
    if (board.companyProfile) return;
    try {
      if (localStorage.getItem("qCompanyDismissed") === "1") return;
    } catch {
      /* storage unavailable */
    }
    setCompanyOpen(true);
  }, [user, board.companyProfile, board.companyProfileLoading]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (meta && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void board.startSession();
      }
      if (meta && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setRecordOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [board]);

  useEffect(() => {
    setRecordOpen(window.innerWidth >= 1280);
  }, []);

  const convene = async (decision: string, presetId: string) => {
    const text = decision.trim();
    if (!text) return;
    setConvening(true);
    try {
      const title = text.length > 72 ? `${text.slice(0, 69).trimEnd()}…` : text;
      const conversation = await board.startSession(title);
      await apiRequest("PUT", `/api/protected/conversations/${conversation.id}`, { charter: text });
      const preset = BOARD_PRESETS.find((item) => item.id === presetId);
      const seats = (preset?.roles ?? [])
        .map((role) => EXPERT_CATALOG.find((entry) => entry.role === role))
        .filter((entry): entry is (typeof EXPERT_CATALOG)[number] => !!entry)
        .map((entry) => ({
          name: entry.role,
          role: entry.role,
          model: entry.defaultModel,
          avatarUrl: entry.color,
        }));
      if (seats.length > 0) {
        await board.seatExperts(seats);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/protected/conversations"] });
      if (!preset) setBoardOpen(true);
      if (user) {
        await apiRequest("POST", `/api/protected/conversations/${conversation.id}/messages`, {
          content: text,
          userId: user.id,
        });
        board.invalidateConversation(conversation.id);
      }
    } finally {
      setConvening(false);
    }
  };

  const applyBoard = async (
    adds: { role: string; name: string; model: string; avatarUrl: string; customInstructions?: string }[],
    removes: number[],
  ) => {
    await board.seatExperts(adds);
    for (const id of removes) await board.removeSeat(id);
  };

  const exportTranscript = () => {
    if (!board.activeConversation) return;
    window.open(`/api/protected/conversations/${board.activeConversation}/export`, "_blank");
  };

  const downloadFile = (file: { id: number; filename: string }) => {
    if (!board.activeConversation) return;
    window.open(`/api/protected/conversations/${board.activeConversation}/files/${file.id}/download`, "_blank");
  };

  const statusText = board.isConcluding
    ? "Closing with the memo"
    : board.hasQueuedMessage
      ? board.interactionMode === "idle"
        ? "Brief saved"
        : "Brief queued"
      : board.interactionMode === "paused"
        ? "Paused"
        : board.isDeliberating
          ? "The board is deliberating"
          : "Waiting for the Chair";

  const apiActions = [
    {
      label: "New board session",
      hint: "⌘N",
      icon: <Plus className="h-3.5 w-3.5" />,
      run: () => void board.startSession(),
    },
    {
      label: "Company context",
      icon: <Building2 className="h-3.5 w-3.5" />,
      run: () => setCompanyOpen(true),
    },
    {
      label: "Board settings",
      icon: <Users className="h-3.5 w-3.5" />,
      run: () => setBoardOpen(true),
    },
    {
      label: "Edit charter",
      icon: <FileText className="h-3.5 w-3.5" />,
      run: () => setCharterOpen(true),
    },
    {
      label: "Export transcript",
      icon: <Download className="h-3.5 w-3.5" />,
      run: exportTranscript,
    },
    {
      label: theme === "dark" ? "Switch to light" : "Switch to dark",
      icon: theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />,
      run: () => setTheme(theme === "dark" ? "light" : "dark"),
    },
  ];

  if (isLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-paper">
        <Loader2 className="h-5 w-5 animate-spin text-bronze" />
      </div>
    );
  }
  if (!user) return <Redirect to="/auth" />;

  const seats = board.experts.map((expert) => ({ role: expert.role, color: expert.avatarUrl || roleColor(expert.role) }));

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-paper text-ink">
      {!collapsed && (
        <div className="hidden w-[272px] shrink-0 border-r border-line lg:block">
          <SessionList
            conversations={board.conversations as SessionSummary[]}
            activeId={board.activeConversation}
            onSelect={(id) => {
              board.selectConversation(id);
              setSessionsOpen(false);
            }}
            onNew={() => void board.startSession()}
            onRename={board.renameSession}
            onDelete={board.deleteSession}
            isCreating={board.isCreatingSession}
            company={board.companyProfile}
            onOpenCompany={() => setCompanyOpen(true)}
            user={user}
            onSignOut={() => logoutMutation.mutate()}
            theme={theme}
            setTheme={setTheme}
            onCollapse={() => setCollapsed(true)}
            onOpenSettings={() => setCompanyOpen(true)}
          />
        </div>
      )}

      {collapsed && (
        <div className="hidden w-12 shrink-0 flex-col items-center border-r border-line pt-4 lg:flex">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-faint-ink hover:bg-slatewash hover:text-ink"
            aria-label="Expand sidebar"
          >
            <ArrowUpRight className="h-4 w-4 rotate-45" />
          </button>
          <button
            type="button"
            onClick={() => void board.startSession()}
            className="mt-2 flex h-8 w-8 items-center justify-center rounded-md text-faint-ink hover:bg-slatewash hover:text-ink"
            aria-label="New session"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      )}

      {sessionsOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={() => setSessionsOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[280px] border-r border-line shadow-lifted">
            <SessionList
              conversations={board.conversations as SessionSummary[]}
              activeId={board.activeConversation}
              onSelect={(id) => {
                board.selectConversation(id);
                setSessionsOpen(false);
              }}
              onNew={() => {
                setSessionsOpen(false);
                void board.startSession();
              }}
              onRename={board.renameSession}
              onDelete={board.deleteSession}
              isCreating={board.isCreatingSession}
              company={board.companyProfile}
              onOpenCompany={() => {
                setSessionsOpen(false);
                setCompanyOpen(true);
              }}
              user={user}
              onSignOut={() => logoutMutation.mutate()}
              theme={theme}
              setTheme={setTheme}
              onOpenSettings={() => {
                setSessionsOpen(false);
                setCompanyOpen(true);
              }}
            />
          </div>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        {board.activeConversation && (
          <TopBar
            title={active?.title || "Board session"}
            experts={board.experts}
            statusText={statusText}
            isDeliberating={board.isDeliberating}
            isPaused={board.interactionMode === "paused"}
            isBusy={board.isBusy}
            queued={board.hasQueuedMessage}
            onPause={board.pause}
            onResume={board.resume}
            onOpenBoard={() => setBoardOpen(true)}
            onToggleRecord={() => setRecordOpen((open) => !open)}
            recordOpen={recordOpen}
            onOpenSessions={() => setSessionsOpen(true)}
            socketStatus={board.socketStatus}
            canConclude={board.messages.some((message) => message.role !== "user")}
            onConclude={() => setConcludeOpen(true)}
            isConcluding={board.isConcludingSession || board.isConcluding}
          />
        )}

        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
              {!board.activeConversation ? (
                <EmptyBoard onConvene={convene} isCreating={convening || board.isCreatingSession} />
              ) : (
                <div className="mx-auto w-full max-w-[780px] px-5 sm:px-8">
                  <SessionIntro
                    title={active?.title || "Board session"}
                    charter={active?.charter ?? null}
                    createdAt={active?.createdAt}
                    seats={seats}
                    onEditCharter={() => setCharterOpen(true)}
                    onOpenBoard={() => setBoardOpen(true)}
                  />

                  <Minutes
                    messages={board.messages}
                    experts={board.experts}
                    streamingMessages={board.streamingMessages}
                    typingExpertIds={board.typingExpertIds}
                    isLoading={board.messagesLoading}
                    empty={
                      <div className="py-12">
                        <p className="text-center font-display text-[22px] text-ink-soft">
                          {board.experts.length === 0 ? "The table is empty." : "The board is seated."}
                        </p>
                        <p className="mx-auto mt-2 max-w-[420px] text-center text-[12.5px] leading-relaxed text-muted-ink">
                          {board.experts.length === 0
                            ? "Seat at least one director before putting the motion. A board of three argues; a board of one agrees."
                            : "Put the decision to the table below. Directors answer in rounds, take positions, and leave a record."}
                        </p>
                        {board.experts.length === 0 && (
                          <div className="mt-5 flex justify-center">
                            <Btn variant="outline" size="sm" onClick={() => setBoardOpen(true)}>
                              <Users className="h-3.5 w-3.5" /> Seat the board
                            </Btn>
                          </div>
                        )}
                      </div>
                    }
                  />

                  <div className="h-10" />
                </div>
              )}
            </div>

            {board.activeConversation && (
              <Composer
                experts={board.experts}
                onSend={(content) => board.send(content)}
                onUpload={board.uploadFile}
                isUploading={board.isUploading}
                isDeliberating={board.isDeliberating || board.hasQueuedMessage}
                queued={board.hasQueuedMessage}
                disabled={board.experts.length === 0}
              />
            )}
          </section>

          {recordOpen && board.activeConversation && (
            <RecordRail
              className="hidden w-[340px] shrink-0 xl:flex"
              conversation={active}
              experts={board.experts}
              messages={board.messages}
              openQuestions={board.openQuestions}
              insights={board.insights}
              files={board.files}
              onAnswer={(questionId, answer) => board.send(answer, questionId)}
              onEditCharter={() => setCharterOpen(true)}
              onRefreshInsights={board.refreshInsights}
              isRefreshingInsights={board.isRefreshingInsights}
              onExport={exportTranscript}
              onOpenBoard={() => setBoardOpen(true)}
              onDownloadFile={downloadFile}
            />
          )}
        </div>
      </main>

      <BoardModal
        open={boardOpen}
        onOpenChange={setBoardOpen}
        experts={board.experts}
        tier={user.tier ?? "free"}
        onApply={applyBoard}
        onUpdateSeat={board.updateSeat}
      />

      <CompanyModal open={companyOpen} onOpenChange={setCompanyOpen} profile={board.companyProfile} />

      <CharterModal
        open={charterOpen}
        onOpenChange={setCharterOpen}
        conversationId={board.activeConversation}
        charter={active?.charter ?? null}
        turnBudget={active?.turnBudget ?? 25}
      />

      <Modal
        open={concludeOpen}
        onOpenChange={setConcludeOpen}
        title="Call the question?"
        description="The board stops deliberating and writes the decision memo from what is on the record."
        footer={
          <>
            <Btn variant="ghost" size="sm" onClick={() => setConcludeOpen(false)}>
              Keep deliberating
            </Btn>
            <Btn
              variant="bronze"
              size="sm"
              onClick={() => {
                setConcludeOpen(false);
                board.conclude();
              }}
            >
              Close with a memo
            </Btn>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-muted-ink">
          The memo will name the decision, the rationale, every recorded dissent, the risks, and the
          next actions with owners. Directors will not speak again in this session unless you send a
          new brief after the memo.
        </p>
      </Modal>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        conversations={board.conversations as SessionSummary[]}
        onSelect={(id) => board.selectConversation(id)}
        actions={apiActions}
      />

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="fixed bottom-4 right-4 z-30 hidden items-center gap-1.5 rounded-full border border-line bg-surface/90 px-2.5 py-1.5 text-[10px] text-faint-ink shadow-quiet backdrop-blur transition-colors hover:text-ink sm:flex"
        aria-label="Open command menu"
      >
        <Command className="h-3 w-3" /> <Kbd>K</Kbd>
      </button>
    </div>
  );
}
