import { useId, useState } from "react";
import { niceScale, type BarModel } from "@shared/chart-model";
import { HoverCard, mix, roundedBar, toneColor, useReady, useWidth, type Palette } from "./chart-kit";

const HEIGHT = 340;
const M = { top: 34, right: 20, bottom: 54, left: 58 };

/** Wrap a category label onto at most two lines for a given pixel budget. */
function wrap(text: string, chars: number): string[] {
  if (text.length <= chars) return [text];
  const words = text.split(" ");
  const first: string[] = [];
  while (words.length > 1 && (first.join(" ") + " " + words[0]).length <= chars) first.push(words.shift()!);
  if (!first.length) first.push(words.shift()!);
  const rest = words.join(" ");
  return [first.join(" "), rest.length > chars ? `${rest.slice(0, chars - 1)}…` : rest];
}

/** Vertical columns; with ranges (y/y2) the same chart becomes a waterfall with connectors and signed steps. */
export default function ColumnChart({ model, palette, title }: { model: BarModel; palette: Palette; title: string }) {
  const [box, width] = useWidth();
  const ready = useReady();
  const uid = useId().replace(/:/g, "");
  const [active, setActive] = useState<number | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const { rows, ranged } = model;
  const waterfall = ranged;

  const ends = rows.flatMap(row => [row.value, row.high ?? row.value]);
  // scale.zero:false (non-waterfall): the axis starts just under the smallest value instead of at zero.
  const cut = model.truncated && !waterfall;
  const lo = cut ? Math.min(...ends) : Math.min(0, ...ends);
  const hi = Math.max(...ends);
  const { step } = niceScale(cut ? Math.max(hi - lo, 1e-9) * 1.1 : Math.max(hi, -lo) * 1.1);
  const bottomValue = cut ? Math.floor((lo - step * 0.15) / step) * step : lo < 0 ? -Math.ceil(-lo / step) * step : 0;
  const topEdge = hi > bottomValue ? Math.ceil((cut ? hi + step * 0.15 : hi * 1.1) / step) * step : bottomValue + step;
  const top = Math.max(topEdge, bottomValue + step);
  const ticks = Array.from({ length: Math.round((top - bottomValue) / step) + 1 }, (_, index) => bottomValue + index * step);
  const w = Math.max(320, width);
  const plotW = w - M.left - M.right;
  const plotH = HEIGHT - M.top - M.bottom;
  const yOf = (value: number) => M.top + plotH - ((value - bottomValue) / (top - bottomValue)) * plotH;
  const band = plotW / rows.length;
  const barW = Math.min(76, band * 0.58);
  const chars = Math.max(8, Math.floor(band / 7));

  // Running level for waterfall connectors: where each step ends.
  const level = (row: (typeof rows)[number]) => row.high ?? row.value;
  // Un-highlighted waterfall steps (muted) are drawn green up and red down; totals and called-out rows keep their tone.
  const colorFor = (row: (typeof rows)[number]) => (waterfall && row.value !== 0 && row.tone === "muted" ? (level(row) >= row.value ? palette.series[2] : palette.alert) : toneColor(row.tone, palette));
  const hovered = active === null ? null : rows[active];

  return (
    <div ref={box} role="figure" aria-label={title} className="relative select-none" onMouseLeave={() => setActive(null)}>
      <svg width={w} height={HEIGHT} role="presentation" className="block overflow-visible">
        <defs>
          {rows.map((row, index) => {
            const color = colorFor(row);
            return (
              <linearGradient key={index} id={`${uid}-g${index}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={mix(color, "#ffffff", 0.22)} />
                <stop offset="1" stopColor={color} />
              </linearGradient>
            );
          })}
        </defs>
        {ticks.map(value => (
          <g key={value}>
            <line x1={M.left} x2={w - M.right} y1={yOf(value)} y2={yOf(value)} stroke="hsl(var(--line))" strokeWidth={value === 0 ? 1.5 : 1} strokeDasharray={value === 0 ? undefined : "2 4"} />
            <text x={M.left - 12} y={yOf(value)} dy="0.32em" textAnchor="end" className="fill-faint-ink text-[11px] tabular-nums">{model.tick(value)}</text>
          </g>
        ))}
        {waterfall && rows.slice(0, -1).map((row, index) => (
          <line key={`c${index}`} x1={M.left + band * index + band / 2 + barW / 2} x2={M.left + band * (index + 1) + band / 2 - barW / 2} y1={yOf(level(row))} y2={yOf(level(row))} stroke="hsl(var(--faint-ink))" strokeOpacity={0.55} strokeDasharray="3 3" />
        ))}
        {rows.map((row, index) => {
          const x = M.left + band * index + (band - barW) / 2;
          const a = waterfall ? yOf(row.value) : yOf(cut ? bottomValue : 0);
          const b = yOf(level(row));
          const y = Math.min(a, b);
          const h = Math.max(3, Math.abs(a - b));
          const below = !waterfall && row.value < 0;
          const labelY = below ? y + h + 16 : y - 8;
          const down = below || (waterfall && level(row) < row.value);
          return (
            <g key={row.name} style={{ opacity: active === null || active === index ? 1 : 0.4, transition: "opacity 160ms" }}
              onMouseEnter={() => setActive(index)} onMouseMove={event => { const rect = box.current?.getBoundingClientRect(); if (rect) setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top }); }}>
              <rect x={M.left + band * index} y={M.top} width={band} height={plotH} fill="transparent" />
              <path
                d={roundedBar(x, y, barW, h, waterfall ? 5 : 8, waterfall ? 5 : 0)}
                fill={`url(#${uid}-g${index})`}
                style={{ transformBox: "fill-box", transformOrigin: down ? "top" : "bottom", transform: ready ? "scaleY(1)" : "scaleY(0)", transition: `transform 750ms cubic-bezier(.2,.7,.2,1) ${index * 80}ms` }}
              />
              <text x={x + barW / 2} y={labelY} textAnchor="middle" className="fill-ink text-[12.5px] font-medium tabular-nums" style={{ opacity: ready ? 1 : 0, transition: `opacity 400ms ${index * 80 + 400}ms` }}>{row.label}</text>
              {wrap(row.name, chars).map((line, lineIndex) => (
                <text key={lineIndex} x={x + barW / 2} y={HEIGHT - M.bottom + 20 + lineIndex * 14} textAnchor="middle" className={`text-[12px] ${row.flagged ? "fill-ink font-medium" : "fill-muted-ink"}`}>{line}</text>
              ))}
            </g>
          );
        })}
      </svg>
      {model.axisTitle && <p className="mt-1 text-center text-[11px] text-faint-ink">{model.axisTitle}</p>}
      {hovered && <HoverCard x={pointer.x} y={pointer.y} width={w} title={hovered.name} color={colorFor(hovered)} lines={hovered.details} />}
    </div>
  );
}
