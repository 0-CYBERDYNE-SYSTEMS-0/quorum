import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type Variant = "primary" | "bronze" | "ghost" | "outline" | "quiet" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-ink text-paper hover:bg-ink/90 shadow-[0_1px_0_hsl(0_0%_100%/0.08)_inset]",
  bronze:
    "bg-bronze text-white hover:bg-bronze-ink dark:text-[hsl(216_16%_8%)] dark:hover:bg-bronze/90",
  outline:
    "border border-line-strong bg-transparent text-ink hover:bg-slatewash",
  ghost: "text-ink-soft hover:bg-slatewash hover:text-ink",
  quiet: "bg-slatewash text-ink-soft hover:text-ink",
  danger: "bg-oxblood text-white hover:bg-oxblood/90",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-md",
  md: "h-10 px-4 text-sm gap-2 rounded-md",
  lg: "h-12 px-6 text-[15px] gap-2 rounded-lg",
  icon: "h-9 w-9 rounded-md justify-center",
};

export const Btn = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
>(function Btn({ className, variant = "outline", size = "md", ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-colors duration-150",
        "disabled:pointer-events-none disabled:opacity-45",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export const fieldClass =
  "w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-sm text-ink placeholder:text-faint-ink " +
  "transition-shadow focus:border-bronze/60 focus:outline-none focus:ring-2 focus:ring-bronze/15";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(fieldClass, "h-10", className)} {...props} />;
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(fieldClass, "min-h-[88px] resize-y leading-relaxed", className)} {...props} />;
  },
);

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted-ink">{label}</span>
        {hint && <span className="text-[11px] text-faint-ink">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Badges / chips                                                      */
/* ------------------------------------------------------------------ */

type Tone = "neutral" | "bronze" | "emerald" | "oxblood" | "ink";

const tones: Record<Tone, string> = {
  neutral: "border-line-strong/70 bg-surface text-muted-ink",
  bronze: "border-bronze/25 bg-bronze-wash text-bronze-ink",
  emerald: "border-emerald/20 bg-emerald-wash text-emerald",
  oxblood: "border-oxblood/20 bg-oxblood-wash text-oxblood",
  ink: "border-transparent bg-ink text-paper",
};

export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "bronze", pulse }: { tone?: Tone; pulse?: boolean }) {
  const color =
    tone === "emerald" ? "bg-emerald" : tone === "oxblood" ? "bg-oxblood" : tone === "ink" ? "bg-ink" : "bg-bronze";
  return <span className={cn("inline-block h-1.5 w-1.5 rounded-full", color, pulse && "animate-pulse")} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface px-1 font-mono text-[10px] font-medium text-muted-ink">
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------------ */
/* Avatars                                                             */
/* ------------------------------------------------------------------ */

export function Monogram({
  name,
  color,
  size = 32,
  className,
}: {
  name: string;
  color?: string | null;
  size?: number;
  className?: string;
}) {
  const initials = name
    .replace(/^(Dr\.?|Mr\.?|Ms\.?|Mrs\.?)\s+/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-black/10 font-medium text-white",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: color || "hsl(var(--bronze))",
        fontSize: Math.max(10, Math.round(size * 0.36)),
        letterSpacing: "0.02em",
      }}
      aria-hidden
    >
      {initials || "Q"}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[hsl(220_24%_8%/0.42)] backdrop-blur-[2px] data-[state=open]:animate-fade" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
            "rounded-xl border border-line bg-surface shadow-lifted outline-none data-[state=open]:animate-fade-up",
            wide ? "max-w-4xl" : "max-w-lg",
          )}
        >
          <div className="flex items-start justify-between gap-6 border-b border-line px-6 py-5">
            <div>
              <DialogPrimitive.Title className="font-display text-2xl leading-tight text-ink">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-muted-ink">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              className="mt-0.5 rounded-md p-1.5 text-faint-ink transition-colors hover:bg-slatewash hover:text-ink"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-line bg-surface px-6 py-4">{footer}</div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ------------------------------------------------------------------ */
/* Section label                                                       */
/* ------------------------------------------------------------------ */

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="eyebrow">{children}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
