import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Tone } from "@shared/chart-model";

export interface Palette { accent: string; alert: string; muted: string; series: readonly string[] }

export const toneColor = (tone: Tone, palette: Palette) => (typeof tone === "number" ? palette.series[tone % palette.series.length] : palette[tone]);

/** Blend a #rrggbb color toward another by t (0..1). */
export const mix = (hex: string, toward: string, t: number) => {
  const channel = (value: string, at: number) => parseInt(value.slice(1 + at * 2, 3 + at * 2), 16);
  return `#${[0, 1, 2].map(at => Math.round(channel(hex, at) + (channel(toward, at) - channel(hex, at)) * t).toString(16).padStart(2, "0")).join("")}`;
};

/** Dark ink on light fills, white on dark ones, by relative luminance. */
export const onColor = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.62 ? "#151A21" : "#ffffff";
};

/** True one frame after mount, so entrance transitions have a starting state to animate from. */
export function useReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // A timer, not requestAnimationFrame: frames are paused in background tabs and the chart would never appear.
    const timer = setTimeout(() => setReady(true), 40);
    return () => clearTimeout(timer);
  }, []);
  return ready;
}

export function useWidth(initial = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function HoverCard({ x, y, width, title, color, lines }: { x: number; y: number; width: number; title: string; color?: string; lines: { name: string; value: ReactNode; color?: string }[] }) {
  return (
    <div className="pointer-events-none absolute z-10 min-w-[11rem] rounded-lg border border-line bg-surface-raised px-3 py-2 shadow-lg" style={{ left: Math.max(0, Math.min(x + 16, width - 250)), top: Math.max(0, y - 76) }}>
      <p className="mb-1 flex items-center gap-2 text-[12.5px] font-semibold text-ink">{color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}{title}</p>
      {lines.map(line => (
        <p key={line.name} className="flex items-center justify-between gap-4 text-[12px] text-muted-ink">
          <span className="flex items-center gap-1.5">{line.color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: line.color }} />}{line.name}</span>
          <span className="font-medium tabular-nums text-ink">{line.value}</span>
        </p>
      ))}
    </div>
  );
}

/** A rect path with independent top and bottom corner radii. */
export function roundedBar(x: number, y: number, w: number, h: number, top: number, bottom: number) {
  const t = Math.min(top, w / 2, h / 2), b = Math.min(bottom, w / 2, h / 2);
  return `M${x},${y + t}Q${x},${y} ${x + t},${y}H${x + w - t}Q${x + w},${y} ${x + w},${y + t}V${y + h - b}Q${x + w},${y + h} ${x + w - b},${y + h}H${x + b}Q${x},${y + h} ${x},${y + h - b}Z`;
}
