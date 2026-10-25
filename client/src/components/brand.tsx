import { cn } from "@/lib/utils";

/**
 * Quorum mark: five seats around a table, one seat open, with the chair's rule
 * crossing the ring. Drawn as strokes so it inherits currentColor.
 */
export function QuorumMark({ size = 28, className }: { size?: number; className?: string }) {
  const seats = [0, 72, 144, 216, 288].map((deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: 16 + Math.cos(rad) * 10.4, y: 16 + Math.sin(rad) * 10.4, deg };
  });
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="11.2" stroke="currentColor" strokeOpacity="0.32" strokeWidth="1" />
      <circle cx="16" cy="16" r="4.2" stroke="currentColor" strokeWidth="1" strokeOpacity="0.7" />
      {seats.map((seat, index) => (
        <circle
          key={seat.deg}
          cx={seat.x}
          cy={seat.y}
          r={index === 0 ? 2.1 : 1.5}
          fill={index === 0 ? "currentColor" : "hsl(var(--paper))"}
          stroke="currentColor"
          strokeWidth="1"
        />
      ))}
      <path d="M22.2 22.2 L27.5 27.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function QuorumLogo({
  className,
  compact = false,
  onDark = false,
}: {
  className?: string;
  compact?: boolean;
  onDark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <QuorumMark size={compact ? 22 : 26} className={onDark ? "text-[hsl(38_46%_66%)]" : "text-bronze"} />
      <span
        className={cn(
          "font-display leading-none tracking-[-0.02em]",
          compact ? "text-[20px]" : "text-[24px]",
          onDark ? "text-[hsl(40_25%_94%)]" : "text-ink",
        )}
      >
        Quorum
      </span>
    </span>
  );
}
