import { useRef, useState } from "react";
import { niceScale, type BarModel } from "@shared/chart-model";
import { mix, onColor, toneColor, useReady, useWidth, type Palette } from "./chart-kit";

export default function BarChart({ model, palette, title }: { model: BarModel; palette: Palette; title: string }) {
  const [box, width] = useWidth();
  const ready = useReady();
  const [active, setActive] = useState<number | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0, width: 600 });

  const { rows } = model;
  const ranged = model.ranged || model.dots;
  const hiValue = Math.max(...rows.map(row => row.high ?? row.value));
  const loValue = Math.min(...rows.map(row => row.value));
  // A truncated axis (scale.zero false) frames the data instead of starting at zero.
  const span = Math.max(hiValue - loValue, hiValue * 0.02);
  const { step, top: niceTop } = niceScale(model.truncated ? span * 1.7 : hiValue * (ranged ? 1.2 : 1));
  const lo = model.truncated ? Math.floor((loValue - span * 0.35) / step) * step : 0;
  const top = model.truncated ? Math.ceil((hiValue + span * 0.35) / step) * step : niceTop;
  const ticks = Array.from({ length: Math.round((top - lo) / step) + 1 }, (_, index) => lo + index * step);
  const at = (n: number) => `${((n - lo) / (top - lo)) * 100}%`;
  const len = (n: number) => `${(n / (top - lo)) * 100}%`;
  const guide = rows.find(row => row.flagged && row.tone === "alert");
  const track = (row: (typeof rows)[number]) => toneColor(row.tone, palette);
  const point = (event: React.MouseEvent) => {
    const rect = box.current?.getBoundingClientRect();
    if (rect) setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width });
  };
  const hovered = active === null ? null : rows[active];

  return (
    <div ref={box} role="figure" aria-label={title} className="relative select-none pb-2 pt-6" style={{ ["--lab" as string]: "clamp(7rem, 26%, 13rem)" }} onMouseLeave={() => setActive(null)}>
      <div className="relative">
        <div className="pointer-events-none absolute bottom-0 right-0 top-0 left-[calc(var(--lab)+1rem)]" aria-hidden>
          {ticks.map(value => (
            <div key={value} className="absolute bottom-0 top-0 border-l border-line" style={{ left: at(value) }}>
              <span className="absolute top-full mt-2 -translate-x-1/2 whitespace-nowrap text-[11px] tabular-nums text-faint-ink">{model.tick(value)}</span>
            </div>
          ))}
          {guide && (
            <div className="absolute -top-2 bottom-0 border-l-[1.5px] border-dashed" style={{ left: at(guide.value), borderColor: track(guide) }}>
              <span className="absolute -top-4 left-1.5 whitespace-nowrap text-[11px] font-medium" style={{ color: track(guide) }}>{guide.name} · {model.format(guide.value)}</span>
            </div>
          )}
        </div>
        <div className="relative">
        {rows.map((row, index) => {
          const color = track(row);
          const end = row.high ?? row.value;
          // Labels sit past the bar end; when the plot has no room left for the text they move inside the bar.
          const plot = width - Math.min(Math.max(width * 0.26, 112), 208) - 16;
          const inside = !ranged && (1 - (end - lo) / (top - lo)) * plot < row.label.length * 7.6 + 24;
          const shown = ready ? 1 : 0;
          const delay = `${index * 70}ms`;
          return (
            <div
              key={row.name}
              tabIndex={0}
              className="grid h-12 grid-cols-[var(--lab)_1fr] items-center gap-x-4 outline-none"
              style={{ opacity: active === null || active === index ? 1 : 0.42, transition: "opacity 160ms" }}
              onMouseEnter={() => setActive(index)}
              onMouseMove={point}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
            >
              <span className={`line-clamp-2 text-[13px] leading-tight ${row.flagged ? "font-medium text-ink" : "text-ink-soft"}`}>{row.name}</span>
              <div className="relative h-full">
                {ranged ? (
                  <>
                    <div className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full" style={{ width: ready ? at(row.value) : 0, background: mix(color, "#ffffff", 0.55), transition: `width 700ms cubic-bezier(.2,.7,.2,1) ${delay}` }} />
                    {row.high === null ? (
                      <div className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[3px] ring-surface-raised" style={{ left: ready ? at(row.value) : 0, background: color, transition: `left 700ms cubic-bezier(.2,.7,.2,1) ${delay}` }} />
                    ) : (
                      <div className="absolute top-1/2 h-4 -translate-y-1/2 rounded-full ring-[3px] ring-surface-raised" style={{ left: at(row.value), width: ready ? len(row.high - row.value) : 0, minWidth: ready ? 16 : 0, background: `linear-gradient(90deg, ${mix(color, "#ffffff", 0.3)}, ${color})`, transition: `width 700ms cubic-bezier(.2,.7,.2,1) ${delay}` }} />
                    )}
                  </>
                ) : (
                  <div className="absolute left-0 top-1/2 h-6 -translate-y-1/2 rounded-l-[3px] rounded-r-lg" style={{ width: ready ? at(row.value) : 0, background: `linear-gradient(90deg, ${mix(color, "#ffffff", 0.3)}, ${color})`, boxShadow: "inset 0 1px 0 rgba(255,255,255,.22)", transition: `width 700ms cubic-bezier(.2,.7,.2,1) ${delay}` }} />
                )}
                <span
                  className={`absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[12.5px] font-medium tabular-nums ${inside ? "" : "text-ink"}`}
                  style={{ ...(inside ? { color: onColor(color), right: `calc(100% - ${at(end)} + 10px)` } : { left: `calc(${at(end)} + ${row.high === null ? 12 : 22}px)` }), opacity: shown, transition: `opacity 400ms ${index * 70 + 350}ms` }}
                >
                  {row.label}
                </span>
              </div>
            </div>
          );
        })}
        </div>
      </div>
      {model.axisTitle && <p className="mt-10 text-center text-[11px] text-faint-ink">{model.axisTitle}</p>}
      {hovered && (
        <div className="pointer-events-none absolute z-10 min-w-[11rem] rounded-lg border border-line bg-surface-raised px-3 py-2 shadow-lg" style={{ left: Math.max(0, Math.min(pointer.x + 16, pointer.width - 240)), top: Math.max(0, pointer.y - 70) }}>
          <p className="mb-1 flex items-center gap-2 text-[12.5px] font-semibold text-ink"><span className="h-2 w-2 rounded-full" style={{ background: track(hovered) }} />{hovered.name}</p>
          {hovered.details.map(item => (
            <p key={item.name} className="flex justify-between gap-4 text-[12px] text-muted-ink"><span>{item.name}</span><span className="font-medium tabular-nums text-ink">{item.value}</span></p>
          ))}
        </div>
      )}
    </div>
  );
}
