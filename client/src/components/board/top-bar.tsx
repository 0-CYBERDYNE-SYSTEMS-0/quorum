import { AvatarStack } from "@/components/board/avatar-stack";
import { Btn, Chip, Dot } from "@/components/design";
import type { Expert } from "@shared/schema";
import { Gavel, PanelRight, Pause, Play, Settings2, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export function TopBar({
  title,
  experts,
  statusText,
  isDeliberating,
  isPaused,
  isBusy,
  queued,
  onPause,
  onResume,
  onOpenBoard,
  onToggleRecord,
  recordOpen,
  onOpenSessions,
  socketStatus,
  canConclude,
  onConclude,
  isConcluding,
}: {
  title: string;
  experts: Expert[];
  statusText: string;
  isDeliberating: boolean;
  isPaused: boolean;
  isBusy: boolean;
  queued: boolean;
  onPause: () => void;
  onResume: () => void;
  onOpenBoard: () => void;
  onToggleRecord: () => void;
  recordOpen: boolean;
  onOpenSessions: () => void;
  socketStatus: "connecting" | "connected" | "reconnecting" | "disconnected";
  canConclude?: boolean;
  onConclude?: () => void;
  isConcluding?: boolean;
}) {
  return (
    <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line bg-paper/80 px-3 backdrop-blur-md sm:px-5">
      <button
        type="button"
        onClick={onOpenSessions}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-ink hover:bg-slatewash lg:hidden"
        aria-label="Open sessions"
      >
        <Users className="h-4 w-4" />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 truncate text-[13px] font-medium text-ink">{title}</h2>
          <span className="hidden items-center gap-1.5 text-[10.5px] text-faint-ink sm:flex">
            <Dot tone={isDeliberating ? "bronze" : isPaused ? "neutral" : "emerald"} pulse={isDeliberating} />
            {statusText}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-faint-ink">
          <span className="truncate">
            {experts.length} {experts.length === 1 ? "seat" : "seats"}
            {queued ? " · brief queued" : ""}
          </span>
          {socketStatus !== "connected" && (
            <span className="text-bronze">· reconnecting the room</span>
          )}
        </div>
      </div>

      <div className="hidden sm:block">
        <AvatarStack experts={experts} max={5} onClick={onOpenBoard} />
      </div>

      <div className="flex items-center gap-1.5">
        {isDeliberating ? (
          <Btn variant="outline" size="sm" onClick={onPause} className="gap-1.5">
            <Pause className="h-3.5 w-3.5" /> Pause
          </Btn>
        ) : isPaused ? (
          <Btn variant="outline" size="sm" onClick={onResume} className="gap-1.5 border-emerald/30 text-emerald">
            <Play className="h-3.5 w-3.5" /> Resume
          </Btn>
        ) : null}

        {canConclude && onConclude && (
          <Btn
            variant="outline"
            size="sm"
            onClick={onConclude}
            disabled={isConcluding}
            className="hidden gap-1.5 sm:inline-flex"
            title="Close the deliberation and write the decision memo"
          >
            <Gavel className="h-3.5 w-3.5" /> {isConcluding ? "Writing memo…" : "Call the question"}
          </Btn>
        )}

        <Btn variant="ghost" size="icon" onClick={onOpenBoard} title="Board settings" aria-label="Board settings">
          <Settings2 className="h-4 w-4" />
        </Btn>

        <Btn
          variant={recordOpen ? "quiet" : "ghost"}
          size="icon"
          onClick={onToggleRecord}
          title="Decision record"
          aria-label="Toggle the decision record"
          className={cn(recordOpen && "text-ink")}
        >
          <PanelRight className="h-4 w-4" />
        </Btn>
      </div>
    </header>
  );
}
