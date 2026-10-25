import { Fragment, useMemo } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, Sparkles } from "lucide-react";
import type { Expert, Message } from "@shared/schema";
import ArtifactDisplay from "@/components/artifacts/ArtifactDisplay";
import { Chip, Monogram } from "@/components/design";
import { clockLabel, initialsFor, roleColor, stanceLabel, stanceOf, stanceTone } from "@/lib/board";
import type { StreamView } from "@/hooks/use-board-room";
import { cn } from "@/lib/utils";

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in (node as { props?: { children?: ReactNode } })) {
    return extractText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function markdownComponents(roles: string[]) {
  const known = new Set(roles.map((role) => role.toLowerCase()));
  return {
    code({ children, className, ...props }: { children?: ReactNode; className?: string }) {
      const raw = extractText(children).trim();
      const match = /^@\[([^\]]+)\]$/.exec(raw);
      if (match) {
        const role = match[1];
        const isKnown = known.has(role.toLowerCase());
        return (
          <span className={cn("mention-chip", !isKnown && "opacity-70")} title={isKnown ? role : "Not seated"}>
            {role}
          </span>
        );
      }
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
    a({ href, children }: { href?: string; children?: ReactNode }) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
  };
}

function ChairEntry({ message }: { message: Message }) {
  return (
    <article className="group relative grid grid-cols-[44px_1fr] gap-4 py-6 sm:grid-cols-[56px_1fr]">
      <div className="flex flex-col items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-bronze/30 bg-bronze-wash text-[10px] font-semibold uppercase tracking-wider text-bronze-ink">
          You
        </span>
        <span className="hidden h-full w-px bg-line sm:block" aria-hidden />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-bronze-ink">Chair</h3>
          <span className="text-[11px] text-faint-ink">{clockLabel(message.timestamp)}</span>
        </div>
        <p className="mt-2 whitespace-pre-wrap font-display text-[19px] leading-[1.5] text-ink">
          {message.content}
        </p>
      </div>
    </article>
  );
}

function DirectorEntry({
  message,
  expert,
}: {
  message: Message;
  expert?: Expert;
}) {
  const stance = stanceOf(message);
  const color = roleColor(message.expertRole ?? expert?.role, message.expertId ?? 0);
  const role = message.expertRole ?? expert?.role ?? "Director";
  const name = message.expertName ?? expert?.name ?? "";
  const components = useMemo(() => markdownComponents([]), []);

  return (
    <article className="grid grid-cols-[44px_1fr] gap-4 py-7 sm:grid-cols-[56px_1fr]">
      <div className="flex flex-col items-start">
        <Monogram name={role} color={color} size={36} />
      </div>
      <div className="min-w-0">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3 className="text-[13.5px] font-semibold text-ink">{role}</h3>
          {name && name.toLowerCase() !== role.toLowerCase() && (
            <span className="text-[11.5px] text-faint-ink">{name}</span>
          )}
          <span className="text-[11px] text-faint-ink">{clockLabel(message.timestamp)}</span>
          {stance && (
            <Chip tone={stanceTone[stance.stance]} className="ml-auto">
              {stanceLabel[stance.stance]} · {stance.confidence}/5
            </Chip>
          )}
        </header>
        {stance?.position && (
          <p className="mt-2 border-l-2 border-line-strong pl-3 text-[12.5px] italic leading-relaxed text-muted-ink">
            {stance.position}
          </p>
        )}
        <div className="minutes-prose mt-3">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as never}>
            {message.content}
          </ReactMarkdown>
        </div>
        {!!message.artifacts?.length && (
          <div className="mt-5 space-y-3">
            {message.artifacts.map((artifact, index) => (
              <div key={`${message.id}-${index}`} className="overflow-hidden rounded-lg border border-line bg-surface">
                <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                  <Sparkles className="h-3.5 w-3.5 text-bronze" />
                  <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-ink">Artifact</span>
                </div>
                <div className="bg-surface p-3">
                  <ArtifactDisplay artifact={artifact} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function SynthesisEntry({ message }: { message: Message }) {
  const components = useMemo(() => markdownComponents([]), []);
  return (
    <article className="my-8 overflow-hidden rounded-xl border border-line bg-surface shadow-quiet">
      <header className="flex items-center justify-between gap-4 border-b border-line bg-paper/70 px-5 py-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-bronze" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-bronze-ink">Decision memo</span>
        </div>
        <span className="text-[11px] text-faint-ink">
          Closing synthesis · {clockLabel(message.timestamp)}
        </span>
      </header>
      <div className="px-5 py-5 sm:px-7">
        <div className="minutes-prose minutes-prose--memo">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as never}>
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
      <footer className="flex items-center justify-between border-t border-line px-5 py-2.5 text-[10.5px] text-faint-ink">
        <span>Circulate with care. This memo records advice, not verified fact.</span>
        <span className="font-mono">#{message.id}</span>
      </footer>
    </article>
  );
}

function TypingEntry({ view }: { view: StreamView }) {
  const color = roleColor(view.expertRole, 1);
  return (
    <article className="grid grid-cols-[44px_1fr] gap-4 py-7 sm:grid-cols-[56px_1fr]">
      <Monogram name={view.expertRole} color={color} size={36} />
      <div className="min-w-0">
        <header className="flex items-center gap-3">
          <h3 className="text-[13.5px] font-semibold text-ink">{view.expertRole}</h3>
          <span className="flex items-center gap-1.5 text-[11px] text-bronze">
            <span className="h-1.5 w-1.5 rounded-full bg-bronze animate-pulse" />
            deliberating
          </span>
        </header>
        {view.content ? (
          <div className="minutes-prose mt-3">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents([]) as never}>
              {view.content}
            </ReactMarkdown>
            <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 bg-bronze animate-blink" />
          </div>
        ) : (
          <div className="mt-4 space-y-2" aria-label={`${view.expertRole} is composing`}>
            <div className="h-2.5 w-[62%] animate-pulse rounded bg-line" />
            <div className="h-2.5 w-[86%] animate-pulse rounded bg-line" />
            <div className="h-2.5 w-[48%] animate-pulse rounded bg-line" />
          </div>
        )}
      </div>
    </article>
  );
}

export function Minutes({
  messages,
  experts,
  streamingMessages,
  typingExpertIds,
  isLoading,
  empty,
}: {
  messages: Message[];
  experts: Expert[];
  streamingMessages: Map<number | null, StreamView>;
  typingExpertIds: Set<number | null>;
  isLoading?: boolean;
  empty?: ReactNode;
}) {
  const expertById = useMemo(() => new Map(experts.map((expert) => [expert.id, expert])), [experts]);
  const streaming = Array.from(streamingMessages.entries()).filter(([, view]) => !!view.expertRole);

  if (isLoading && messages.length === 0) {
    return (
      <div className="space-y-6 px-6 py-10" aria-busy>
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex gap-4">
            <div className="h-9 w-9 animate-pulse rounded-full bg-line" />
            <div className="flex-1 space-y-2.5 pt-1">
              <div className="h-2.5 w-32 animate-pulse rounded bg-line" />
              <div className="h-2.5 w-[78%] animate-pulse rounded bg-line" />
              <div className="h-2.5 w-[64%] animate-pulse rounded bg-line" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (messages.length === 0 && streaming.length === 0) return <>{empty}</>;

  return (
    <div className="divide-y divide-line/70">
      {messages.map((message) => {
        if (message.isSynthesis) return <SynthesisEntry key={message.id} message={message} />;
        if (message.role === "user") return <ChairEntry key={message.id} message={message} />;
        return (
          <DirectorEntry
            key={message.id}
            message={message}
            expert={message.expertId ? expertById.get(message.expertId) : undefined}
          />
        );
      })}
      {streaming.map(([expertId, view]) => (
        <Fragment key={`stream-${expertId ?? "unknown"}`}>
          <TypingEntry view={view} />
        </Fragment>
      ))}
      {streaming.length === 0 &&
        typingExpertIds.size > 0 &&
        Array.from(typingExpertIds).map((expertId) => {
          const expert = expertId ? expertById.get(expertId) : undefined;
          return (
            <TypingEntry
              key={`typing-${expertId ?? "unknown"}`}
              view={{ content: "", expertName: expert?.name ?? "", expertRole: expert?.role ?? "Director" }}
            />
          );
        })}
    </div>
  );
}
