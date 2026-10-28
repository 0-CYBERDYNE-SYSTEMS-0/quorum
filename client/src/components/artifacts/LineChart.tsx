import { useId, useState } from "react";
import { niceScale, type LineModel } from "@shared/chart-model";
import { HoverCard, useReady, useWidth, type Palette } from "./chart-kit";

const HEIGHT = 340;

/** Monotone cubic through the points: smooth, but never overshoots the data. */
function smooth(points: [number, number][]): string {
  const n = points.length;
  if (n < 3) return points.map(([x, y], index) => `${index ? "L" : "M"}${x},${y}`).join("");
  const dx = points.slice(1).map((p, i) => p[0] - points[i][0]);
  const slope = points.slice(1).map((p, i) => (p[1] - points[i][1]) / dx[i]);
  const tangent = [slope[0]];
  for (let i = 1; i < n - 1; i++) tangent.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  tangent.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { tangent[i] = 0; tangent[i + 1] = 0; continue; }
    const a = tangent[i] / slope[i], b = tangent[i + 1] / slope[i], r = a * a + b * b;
    if (r > 9) { const k = 3 / Math.sqrt(r); tangent[i] = k * a * slope[i]; tangent[i + 1] = k * b * slope[i]; }
  }
  let path = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    path += `C${points[i][0] + h},${points[i][1] + tangent[i] * h} ${points[i + 1][0] - h},${points[i + 1][1] - tangent[i + 1] * h} ${points[i + 1][0]},${points[i + 1][1]}`;
  }
  return path;
}

/** Smooth lines (or areas) with a soft fill, direct end labels, and a crosshair that reads every series at once. */
export default function LineChart({ model, palette, title }: { model: LineModel; palette: Palette; title: string }) {
  const [box, width] = useWidth();
  const ready = useReady();
  const uid = useId().replace(/:/g, "");
  const [active, setActive] = useState<number | null>(null);
  const { xs, series, zero } = model;
  const multi = series.length > 1;
  const M = { top: 30, right: multi ? 118 : 74, bottom: 40, left: 62 };
  const w = Math.max(340, width);
  const plotW = w - M.left - M.right;
  const plotH = HEIGHT - M.top - M.bottom;

  const values = series.flatMap(item => item.points).filter((value): value is number => value !== null);
  const min = Math.min(...values), max = Math.max(...values);
  const { step } = niceScale(Math.max(model.domain ? model.domain[1] - model.domain[0] : zero ? max : max - min, 1e-9) * 1.05);
  const lo = model.domain ? model.domain[0] : zero ? 0 : Math.floor((min - step * 0.15) / step) * step;
  const hi = model.domain ? model.domain[1] : Math.max(Math.ceil((max + step * 0.15) / step) * step, lo + step);
  const first = Math.ceil(lo / step - 1e-9) * step;
  const ticks = Array.from({ length: Math.floor((hi - first) / step + 1e-9) + 1 }, (_, index) => first + index * step);
  const x0 = xs[0].num, x1 = xs[xs.length - 1].num;
  const xOf = (index: number) => M.left + ((model.continuous ? xs[index].num - x0 : index) / (model.continuous ? x1 - x0 : xs.length - 1)) * plotW;
  const yOf = (value: number) => M.top + plotH - ((value - lo) / (hi - lo)) * plotH;
  const every = Math.max(1, Math.ceil(xs.length / Math.max(2, Math.floor(plotW / 78))));
  const labelled = xs.map((_, index) => index).filter(index => index % every === 0 || index === xs.length - 1).filter((index, at, all) => index === xs.length - 1 ? true : !(all[at + 1] === xs.length - 1 && xs.length - 1 - index < every * 0.7));

  const paths = series.map(item => {
    const pts = item.points.flatMap((value, index) => (value === null ? [] : [[xOf(index), yOf(value)] as [number, number]]));
    return { item, pts, d: smooth(pts) };
  });
  // End labels keep a minimum gap so neighbouring series names never collide.
  const ends = paths.map(({ pts }, index) => ({ index, y: pts[pts.length - 1][1] })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 16);
  const endY = new Map(ends.map(item => [item.index, item.y]));

  const move = (event: React.MouseEvent<SVGRectElement>) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const px = event.clientX - rect.left;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xOf(i) - px) < Math.abs(xOf(best) - px)) best = i;
    setActive(best);
  };
  const at = active === null ? null : active;

  return (
    <div ref={box} role="figure" aria-label={title} className="relative select-none" onMouseLeave={() => setActive(null)}>
      <svg width={w} height={HEIGHT} role="presentation" className="block overflow-visible">
        <defs>
          {paths.map(({ item }, index) => (
            <linearGradient key={item.name} id={`${uid}-a${index}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={palette.series[index]} stopOpacity={model.area ? 0.34 : 0.16} />
              <stop offset="1" stopColor={palette.series[index]} stopOpacity={0} />
            </linearGradient>
          ))}
          <clipPath id={`${uid}-reveal`}><rect x={0} y={0} height={HEIGHT} width={ready ? w : 0} style={{ transition: "width 1100ms cubic-bezier(.2,.7,.2,1)" }} /></clipPath>
        </defs>
        {ticks.map(value => (
          <g key={value}>
            <line x1={M.left} x2={M.left + plotW} y1={yOf(value)} y2={yOf(value)} stroke="hsl(var(--line))" strokeWidth={zero && value === 0 ? 1.5 : 1} strokeDasharray={zero && value === 0 ? undefined : "2 4"} />
            <text x={M.left - 12} y={yOf(value)} dy="0.32em" textAnchor="end" className="fill-faint-ink text-[11px] tabular-nums">{model.tick(value)}</text>
          </g>
        ))}
        {labelled.map(index => (
          <text key={index} x={xOf(index)} y={HEIGHT - M.bottom + 24} textAnchor={index === 0 ? "start" : index === xs.length - 1 ? "end" : "middle"} className="fill-faint-ink text-[11px]">{xs[index].label}</text>
        ))}
        <g clipPath={`url(#${uid}-reveal)`}>
          {paths.map(({ item, pts, d }, index) => {
            const color = palette.series[index];
            return (
              <g key={item.name} style={{ opacity: at === null ? 1 : 0.95 }}>
                {(model.area || !multi) && <path d={`${d}L${pts[pts.length - 1][0]},${yOf(lo)}L${pts[0][0]},${yOf(lo)}Z`} fill={`url(#${uid}-a${index})`} />}
                <path d={d} fill="none" stroke={color} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
                {xs.length <= 14 && pts.map(([px, py], i) => <circle key={i} cx={px} cy={py} r={3} fill="hsl(var(--surface-raised))" stroke={color} strokeWidth={2} />)}
              </g>
            );
          })}
        </g>
        {paths.map(({ item, pts }, index) => {
          const last = pts[pts.length - 1];
          const lastValue = item.points[item.points.length - 1];
          return (
            <g key={`e${item.name}`} style={{ opacity: ready ? 1 : 0, transition: "opacity 500ms 900ms" }}>
              <circle cx={last[0]} cy={last[1]} r={5} fill={palette.series[index]} stroke="hsl(var(--surface-raised))" strokeWidth={2.5} />
              <text x={last[0] + 12} y={endY.get(index) ?? last[1]} dy="0.32em" className="text-[12px] font-semibold" fill={palette.series[index]}>
                {multi ? item.name : lastValue !== null ? model.format(lastValue) : ""}
              </text>
              {multi && lastValue !== null && <text x={last[0] + 12} y={(endY.get(index) ?? last[1]) + 12} dy="0.32em" className="fill-muted-ink text-[11px] tabular-nums">{model.format(lastValue)}</text>}
            </g>
          );
        })}
        {!multi && paths[0].pts.length > 0 && series[0].points[0] !== null && (
          <text x={paths[0].pts[0][0]} y={paths[0].pts[0][1] - 14} className="fill-muted-ink text-[12px] font-semibold tabular-nums">{model.format(series[0].points[0]!)}</text>
        )}
        {at !== null && (
          <g pointerEvents="none">
            <line x1={xOf(at)} x2={xOf(at)} y1={M.top} y2={M.top + plotH} stroke="hsl(var(--ink))" strokeOpacity={0.35} strokeWidth={1} />
            {series.map((item, index) => item.points[at] === null ? null : (
              <circle key={item.name} cx={xOf(at)} cy={yOf(item.points[at]!)} r={5.5} fill={palette.series[index]} stroke="hsl(var(--surface-raised))" strokeWidth={2.5} />
            ))}
          </g>
        )}
        <rect x={M.left} y={M.top} width={plotW} height={plotH} fill="transparent" onMouseMove={move} />
      </svg>
      {model.yTitle && <p className="text-center text-[11px] text-faint-ink">{model.yTitle}</p>}
      {at !== null && (
        <HoverCard x={xOf(at)} y={M.top + 30} width={w} title={xs[at].label}
          lines={series.flatMap((item, index) => (item.points[at] === null ? [] : [{ name: item.name, value: model.format(item.points[at]!), color: palette.series[index] }]))} />
      )}
    </div>
  );
}
