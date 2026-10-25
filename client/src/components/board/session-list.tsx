import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Building2,
  Check,
  ChevronLeft,
  LogOut,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings2,
  Sun,
  Trash2,
} from "lucide-react";
import type { Conversation, User } from "@shared/schema";
import { QuorumLogo } from "@/components/brand";
import { Btn, Chip, Input, Kbd, Modal } from "@/components/design";
import { dayLabel, excerpt } from "@/lib/board";
import type { CompanyProfileView } from "@/hooks/use-board-room";
import { cn } from "@/lib/utils";

export type SessionSummary = Conversation & { updatedAt?: string | Date | null };

function SessionRow({
  conversation,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  conversation: SessionSummary;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title ?? "Untitled session");
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== conversation.title) onRename(next);
    else setDraft(conversation.title ?? "Untitled session");
  };

  return (
    <li className="group relative">
      {editing ? (
        <div className="px-2 py-1.5">
          <Input
            ref={inputRef}
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
              if (event.key === "Escape") {
                setDraft(conversation.title ?? "Untitled session");
                setEditing(false);
              }
            }}
            className="h-8 text-[12.5px]"
            aria-label="Session title"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
            active ? "bg-surface-raised shadow-[inset_0_0_0_1px_hsl(var(--line))]" : "hover:bg-surface/70",
          )}
        >
          <span
            className={cn(
              "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
              active ? "bg-bronze" : "bg-line-strong group-hover:bg-faint-ink",
            )}
          />
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-[12.5px] leading-5", active ? "font-medium text-ink" : "text-ink-soft")}>
              {conversation.title || "Untitled session"}
            </span>
            <span className="mt-0.5 block truncate text-[10.5px] text-faint-ink">
              {dayLabel(conversation.updatedAt ?? conversation.createdAt)} · {excerpt(conversation.charter ?? "No charter yet", 46)}
            </span>
          </span>
        </button>
      )}

      {!editing && (
        <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setMenu((open) => !open);
            }}
            className="rounded p-1 text-faint-ink hover:bg-slatewash hover:text-ink"
            aria-label="Session actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {menu && (
            <>
              <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Close menu" onClick={() => setMenu(false)} />
              <div className="absolute right-0 top-7 z-20 w-36 overflow-hidden rounded-md border border-line bg-surface py-1 shadow-lifted">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-ink-soft hover:bg-slatewash"
                  onClick={() => {
                    setMenu(false);
                    setEditing(true);
                  }}
                >
                  <Pencil className="h-3 w-3" /> Rename
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-oxblood hover:bg-oxblood-wash"
                  onClick={() => {
                    setMenu(false);
                    onDelete();
                  }}
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function SessionList({
  conversations,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  isCreating,
  company,
  onOpenCompany,
  user,
  onSignOut,
  theme,
  setTheme,
  onCollapse,
  onOpenSettings,
}: {
  conversations: SessionSummary[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  onRename: (id: number, title: string) => void;
  onDelete: (id: number) => void;
  isCreating: boolean;
  company: CompanyProfileView | null;
  onOpenCompany: () => void;
  user: User | null;
  onSignOut: () => void;
  theme: "light" | "dark" | "system";
  setTheme: (theme: "light" | "dark" | "system") => void;
  onCollapse?: () => void;
  onOpenSettings: () => void;
}) {
  const [query, setQuery] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter(
      (conversation) =>
        (conversation.title ?? "").toLowerCase().includes(needle) ||
        (conversation.charter ?? "").toLowerCase().includes(needle),
    );
  }, [conversations, query]);

  const groups = useMemo(() => {
    const buckets = new Map<string, SessionSummary[]>();
    for (const conversation of filtered) {
      const label = dayLabel(conversation.updatedAt ?? conversation.createdAt);
      buckets.set(label, [...(buckets.get(label) ?? []), conversation]);
    }
    return Array.from(buckets.entries());
  }, [filtered]);

  return (
    <aside className="flex h-full flex-col bg-[hsl(40_26%_94%)] dark:bg-[hsl(216_16%_6%)]">
      <div className="flex h-16 items-center justify-between px-4">
        <Link href="/" aria-label="Quorum home">
          <QuorumLogo compact />
        </Link>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className="rounded p-1.5 text-faint-ink hover:bg-surface hover:text-ink"
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="px-3">
        <Btn variant="bronze" className="h-9 w-full justify-between px-3 text-[12.5px]" onClick={onNew} disabled={isCreating}>
          <span className="flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" /> New board session
          </span>
          <span className="hidden items-center gap-1 opacity-70 sm:flex">
            <Kbd>⌘</Kbd><Kbd>N</Kbd>
          </span>
        </Btn>
      </div>

      <div className="px-3 pb-2 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint-ink" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sessions"
            className="h-8 border-transparent bg-surface/60 pl-8 text-[12px] focus:bg-surface"
            aria-label="Search board sessions"
          />
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-label="Board sessions">
        {conversations.length === 0 ? (
          <div className="mx-2 mt-6 rounded-lg border border-dashed border-line-strong px-3 py-5 text-center">
            <p className="text-[12px] font-medium text-ink-soft">No sessions yet</p>
            <p className="mt-1 text-[11px] leading-relaxed text-faint-ink">
              State your first decision and seat a board.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11.5px] text-faint-ink">Nothing matches “{query}”.</p>
        ) : (
          groups.map(([label, items]) => (
            <div key={label} className="mb-3">
              <p className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-faint-ink">
                {label}
              </p>
              <ul className="space-y-0.5">
                {items.map((conversation) => (
                  <SessionRow
                    key={conversation.id}
                    conversation={conversation}
                    active={conversation.id === activeId}
                    onSelect={() => onSelect(conversation.id)}
                    onRename={(title) => onRename(conversation.id, title)}
                    onDelete={() => setPendingDelete(conversation)}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </nav>

      <div className="border-t border-line/70 px-3 py-3">
        <button
          type="button"
          onClick={onOpenCompany}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface/70"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-faint-ink">
            <Building2 className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-ink">
              {company?.companyName || "Company context"}
            </span>
            <span className="block truncate text-[10.5px] text-faint-ink">
              {[company?.stage, company?.industry].filter(Boolean).join(" · ") || "Add context for better advice"}
            </span>
          </span>
          {company ? <Check className="h-3 w-3 text-emerald" /> : <Plus className="h-3 w-3 text-faint-ink" />}
        </button>

        <div className="relative mt-1">
          <button
            type="button"
            onClick={() => setAccountOpen((open) => !open)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface/70"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-[10px] font-semibold uppercase text-paper">
              {(user?.username ?? "ch").slice(0, 2)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium capitalize text-ink">{user?.username}</span>
              <span className="block truncate text-[10.5px] text-faint-ink">Chair · {user?.tier ?? "free"}</span>
            </span>
            <MoreHorizontal className="h-3.5 w-3.5 text-faint-ink" />
          </button>

          {accountOpen && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-10 cursor-default"
                aria-label="Close account menu"
                onClick={() => setAccountOpen(false)}
              />
              <div className="absolute bottom-[calc(100%+6px)] left-0 z-20 w-full overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lifted">
                <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
                  {(
                    [
                      ["light", Sun, "Light"],
                      ["dark", Moon, "Dark"],
                      ["system", Settings2, "Auto"],
                    ] as const
                  ).map(([value, Icon, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setTheme(value)}
                      title={label}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1 rounded px-1.5 py-1 text-[10.5px]",
                        theme === value ? "bg-slatewash text-ink" : "text-muted-ink hover:bg-slatewash",
                      )}
                    >
                      <Icon className="h-3 w-3" /> {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-ink-soft hover:bg-slatewash"
                  onClick={() => {
                    setAccountOpen(false);
                    onOpenSettings();
                  }}
                >
                  <Settings2 className="h-3 w-3" /> Workspace settings
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-ink-soft hover:bg-slatewash"
                  onClick={onSignOut}
                >
                  <LogOut className="h-3 w-3" /> Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <Modal
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete this session?"
        description="The transcript, deliverables, and decision record are removed permanently."
        footer={
          <>
            <Btn variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>
              Keep it
            </Btn>
            <Btn
              variant="danger"
              size="sm"
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              Delete session
            </Btn>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-muted-ink">
          <span className="font-medium text-ink">{pendingDelete?.title}</span>
          {pendingDelete?.charter ? ` — ${excerpt(pendingDelete.charter, 120)}` : ""}
        </p>
      </Modal>
    </aside>
  );
}
