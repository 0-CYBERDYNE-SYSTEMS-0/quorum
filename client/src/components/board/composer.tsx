import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, AtSign, Loader2, Paperclip, Square } from "lucide-react";
import type { Expert } from "@shared/schema";
import { Kbd } from "@/components/design";
import { cn } from "@/lib/utils";

export function Composer({
  experts,
  onSend,
  onUpload,
  isUploading,
  isDeliberating,
  queued,
  disabled,
}: {
  experts: Expert[];
  onSend: (content: string) => void;
  onUpload: (file: File) => void;
  isUploading: boolean;
  isDeliberating: boolean;
  queued: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(220, element.scrollHeight)}px`;
  }, [value]);

  const suggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.toLowerCase();
    return experts.filter((expert) => expert.role.toLowerCase().includes(query)).slice(0, 6);
  }, [experts, mentionQuery]);

  const handleChange = (next: string) => {
    setValue(next);
    const caret = textarea.current?.selectionStart ?? next.length;
    const before = next.slice(0, caret);
    const match = /(^|\s)@([\w &-]{0,32})$/.exec(before);
    setMentionQuery(match ? match[2] : null);
    setHighlight(0);
  };

  const insertMention = (expert: Expert) => {
    const element = textarea.current;
    const caret = element?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@([\w &-]{0,32})$/, `@[${expert.role}] `);
    const next = before + value.slice(caret);
    setValue(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const field = textarea.current;
      if (!field) return;
      field.focus();
      field.selectionStart = field.selectionEnd = before.length;
    });
  };

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
    setMentionQuery(null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlight((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((index) => (index - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        insertMention(suggestions[highlight]);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="relative px-4 pb-4 pt-2 sm:px-8 sm:pb-6">
      <div className="pointer-events-none absolute inset-x-0 -top-7 h-7 bg-gradient-to-t from-paper to-transparent" />
      {suggestions.length > 0 && (
        <div className="absolute bottom-[calc(100%-4px)] left-4 z-30 w-72 overflow-hidden rounded-lg border border-line bg-surface shadow-lifted sm:left-8">
          <p className="border-b border-line px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-faint-ink">
            Direct a seat
          </p>
          {suggestions.map((expert, index) => (
            <button
              key={expert.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertMention(expert)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px]",
                index === highlight ? "bg-bronze-wash text-bronze-ink" : "text-ink-soft hover:bg-slatewash",
              )}
            >
              <AtSign className="h-3 w-3 text-faint-ink" />
              {expert.role}
            </button>
          ))}
        </div>
      )}

      <div className="relative rounded-xl border border-line-strong bg-surface-raised shadow-[0_1px_0_hsl(0_0%_100%/0.6)_inset,0_10px_30px_-24px_hsl(220_20%_10%/0.35)] focus-within:border-bronze/50">
        <label htmlFor="chair-brief" className="sr-only">
          Address the board
        </label>
        <textarea
          id="chair-brief"
          ref={textarea}
          value={value}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={disabled ? "Seat a director to begin…" : "Put the decision to the board…"}
          disabled={disabled}
          className="composer-textarea max-h-[220px] min-h-[52px] px-4 pb-2 pt-3.5"
        />
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
          <div className="flex items-center gap-0.5">
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept=".pdf,.md,.txt,.csv,.json,.docx,.xlsx,.png,.jpg,.jpeg"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUpload(file);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={isUploading || disabled}
              className="flex h-8 w-8 items-center justify-center rounded-md text-faint-ink transition-colors hover:bg-slatewash hover:text-ink disabled:opacity-40"
              title="Attach a document"
              aria-label="Attach a document"
            >
              {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => {
                handleChange(`${value}${value.endsWith(" ") || value === "" ? "" : " "}@`);
                textarea.current?.focus();
              }}
              disabled={disabled}
              className="flex h-8 items-center gap-1 rounded-md px-2 text-[11px] text-faint-ink transition-colors hover:bg-slatewash hover:text-ink disabled:opacity-40"
              title="Direct a specific director"
            >
              <AtSign className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Direct</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 text-[10.5px] text-faint-ink sm:flex">
              {isDeliberating || queued ? (
                <>The board will pick this up next</>
              ) : (
                <>
                  <Kbd>↵</Kbd> to send <span className="text-line-strong">·</span> <Kbd>⇧↵</Kbd> new line
                </>
              )}
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={!value.trim() || disabled}
              className={cn(
                "flex h-8 h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors",
                value.trim() && !disabled
                  ? "bg-ink text-paper hover:bg-ink/90"
                  : "bg-slatewash text-faint-ink",
              )}
              aria-label="Send the brief"
            >
              {isDeliberating ? <Square className="h-3 w-3" /> : <ArrowUp className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
      <p className="mt-2 px-1 text-[10.5px] leading-relaxed text-faint-ink">
        Directors answer from the charter and company context. Cite nothing you cannot verify; the
        record keeps stance and confidence for every seat.
      </p>
    </div>
  );
}
