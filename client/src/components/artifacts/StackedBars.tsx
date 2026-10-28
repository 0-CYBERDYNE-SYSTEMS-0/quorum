import { useState } from "react";
import type { StackedModel } from "@shared/chart-model";
import { HoverCard, mix, onColor, toneColor, useReady, useWidth, type Palette } from "./chart-kit";

/** Horizontal stacked bars: a 100% split per category, labelled in the segments, with a legend that doubles as a filter. */
export default function StackedBars({ model, palette, title }: { model: StackedModel; palette: Palette; title: string }) {
  const [box, width] = useWidth();
  const ready = useReady();
  const [hover, setHover] = useState<{ row: number; seg: number } | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const { categories, series, normalized } = model;
  const scaleMax = Math.max(...categories.map(item => item.total));
  const cell = hover ? categories[hover.row].cells[hover.seg] : null;

  return (
    <div ref={box} role="figure" aria-label={title} className="relative select-none py-2" style={{ ["--lab" as string]: "clamp(6rem, 24%, 12rem)" }} onMouseLeave={() => setHover(null)}>
      <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-1.5 pl-[calc(var(--lab)+1rem)]">
        {series.map((item, index) => (
          <li key={item.name} className="flex items-center gap-2 text-[12px] text-muted-ink" style={{ opacity: hover === null || hover.seg === index ? 1 : 0.45, transition: "opacity 160ms" }}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: toneColor(item.tone, palette) }} />{item.name}
          </li>
        ))}
      </ul>
      <div className="space-y-3">
        {categories.map((category, row) => (
          <div key={category.name} className="grid grid-cols-[var(--lab)_1fr] items-center gap-x-4">
            <span className="line-clamp-2 text-[13px] leading-tight text-ink-soft">{category.name}</span>
            <div className="flex h-11 w-full overflow-hidden" style={{ width: normalized ? "100%" : `${(category.total / scaleMax) * 100}%`, clipPath: ready ? "inset(0 0 0 0 round 10px)" : "inset(0 100% 0 0 round 10px)", transition: `clip-path 900ms cubic-bezier(.2,.7,.2,1) ${row * 120}ms` }}>
              {category.cells.map((item, seg) => {
                const color = toneColor(series[seg].tone, palette);
                const pct = (normalized ? item.share : item.value / category.total) * 100;
                if (item.value <= 0) return null;
                return (
                  <div
                    key={seg}
                    className="flex items-center justify-center text-[12.5px] font-semibold tabular-nums"
                    style={{ flexGrow: (item.value / category.total) * 100, flexBasis: 0, background: `linear-gradient(180deg, ${mix(color, "#ffffff", 0.18)}, ${color})`, marginLeft: seg === 0 ? 0 : 2, color: onColor(color), opacity: hover === null || (hover.row === row && hover.seg === seg) ? 1 : 0.4, transition: "opacity 160ms", textShadow: onColor(color) === "#ffffff" ? "0 1px 1px rgba(0,0,0,.18)" : undefined }}
                    onMouseEnter={() => setHover({ row, seg })}
                    onMouseMove={event => { const rect = box.current?.getBoundingClientRect(); if (rect) setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top }); }}
                  >
                    {pct >= 9 ? (normalized ? `${Math.round(pct)}%` : item.label) : ""}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-center text-[11px] text-faint-ink">{[model.axisTitle, normalized ? "share of each row" : ""].filter(Boolean).join(" · ")}</p>
      {hover && cell && (
        <HoverCard x={pointer.x} y={pointer.y} width={width} title={categories[hover.row].name} color={toneColor(series[hover.seg].tone, palette)}
          lines={[{ name: series[hover.seg].name, value: cell.label }, { name: "Share of row", value: `${(cell.share * 100).toFixed(1)}%` }]} />
      )}
    </div>
  );
}
