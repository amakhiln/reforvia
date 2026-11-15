"use client";

import { useEffect, useId, useRef, useState } from "react";
import { barPath, formatCompact, nearestIndex, niceRange, niceTicks } from "@/lib/chartMath";

/* Colour: single-series charts use the app accent (--accent). It clears 3:1 on both surfaces
   (#c2410c on #fff ≈ 5.2:1, #ee6124 on #262626 ≈ 4.6:1). Text always uses text tokens, never the series colour. */

function useWidth(initial = 340) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const shortDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

type Tip = { x: number; title: string; value: string; detail?: string };

function Tooltip({ tip, width }: { tip: Tip; width: number }) {
  const flip = tip.x > width * 0.6;
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-1 z-10 min-w-28 rounded-xl border border-line bg-surface px-3 py-2 shadow-lg shadow-black/10"
      style={flip ? { right: Math.max(0, width - tip.x + 12) } : { left: tip.x + 12 }}
    >
      <p className="text-xs text-muted">{tip.title}</p>
      <p className="mt-0.5 flex items-center gap-2 text-base font-semibold tabular-nums">
        <span className="h-0.5 w-3 rounded-full bg-accent" aria-hidden />
        {tip.value}
      </p>
      {tip.detail && <p className="mt-0.5 text-xs text-muted">{tip.detail}</p>}
    </div>
  );
}

/* ----------------------------------------------------------------------------------------- */

export type LinePoint = { x: number; date: string; y: number; detail?: string };

export function LineChart({
  points,
  format,
  unit,
  ariaLabel,
}: {
  points: LinePoint[];
  format: (n: number) => string;
  unit: string;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const uid = useId();
  const H = 200;
  const m = { t: 14, r: 46, b: 28, l: 38 };
  const plotW = width - m.l - m.r;
  const plotH = H - m.t - m.b;

  const ys = points.map((p) => p.y);
  const ticks = niceRange(Math.min(...ys), Math.max(...ys));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const x0 = points[0].x;
  const x1 = points[points.length - 1].x;
  const px = (x: number) => (points.length === 1 || x1 === x0 ? m.l + plotW / 2 : m.l + ((x - x0) / (x1 - x0)) * plotW);
  const py = (y: number) => m.t + plotH - ((y - yMin) / (yMax - yMin)) * plotH;
  const xs = points.map((p) => px(p.x));

  const line = points.map((p, i) => `${i ? "L" : "M"}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ");
  const area = `${line} L${xs[xs.length - 1].toFixed(1)},${m.t + plotH} L${xs[0].toFixed(1)},${m.t + plotH} Z`;
  const last = points[points.length - 1];

  const xLabels: { i: number; anchor: "start" | "middle" | "end" }[] = [{ i: 0, anchor: "start" }];
  if (points.length > 2) xLabels.push({ i: Math.floor((points.length - 1) / 2), anchor: "middle" });
  if (points.length > 1) xLabels.push({ i: points.length - 1, anchor: "end" });

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setActive(nearestIndex(xs, e.clientX - rect.left));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setActive((cur) => {
      const i = cur ?? points.length - 1;
      return Math.min(points.length - 1, Math.max(0, i + (e.key === "ArrowRight" ? 1 : -1)));
    });
  };

  const a = active != null ? points[active] : null;

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onFocus={() => setActive((c) => c ?? points.length - 1)}
        onBlur={() => setActive(null)}
        className="touch-pan-y rounded-lg outline-offset-4"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={m.l + plotW} y1={py(t)} y2={py(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={m.l - 8} y={py(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--muted)">
              {format(t)}
            </text>
          </g>
        ))}
        {xLabels.map(({ i, anchor }) => (
          <text key={i} x={xs[i]} y={H - 8} textAnchor={anchor} fontSize={11} fill="var(--muted)">
            {shortDate(points[i].date)}
          </text>
        ))}

        {points.length > 1 && (
          <>
            <defs>
              <clipPath id={uid}>
                <rect x={m.l} y={m.t} width={plotW} height={plotH} />
              </clipPath>
            </defs>
            <path d={area} fill="var(--accent)" opacity={0.1} clipPath={`url(#${uid})`} />
            <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </>
        )}

        {a && (
          <line x1={xs[active!]} x2={xs[active!]} y1={m.t} y2={m.t + plotH} stroke="var(--muted)" strokeWidth={1} opacity={0.6} />
        )}

        {/* end dot with a 2px surface ring */}
        {(active == null || active === points.length - 1 || points.length === 1) && (
          <>
            <circle cx={xs[xs.length - 1]} cy={py(last.y)} r={6} fill="var(--surface)" />
            <circle cx={xs[xs.length - 1]} cy={py(last.y)} r={4} fill="var(--accent)" />
          </>
        )}
        {a && active !== points.length - 1 && (
          <>
            <circle cx={xs[active!]} cy={py(a.y)} r={6} fill="var(--surface)" />
            <circle cx={xs[active!]} cy={py(a.y)} r={4} fill="var(--accent)" />
          </>
        )}
        {active == null && (
          <text x={xs[xs.length - 1] + 10} y={py(last.y)} dominantBaseline="middle" fontSize={12} fontWeight={600} fill="var(--text)">
            {format(last.y)}
          </text>
        )}
      </svg>

      {a && <Tooltip tip={{ x: xs[active!], title: shortDate(a.date), value: `${format(a.y)} ${unit}`, detail: a.detail }} width={width} />}
    </div>
  );
}

/* ----------------------------------------------------------------------------------------- */

export type Bar = { key: string; axisLabel: string; value: number; title: string; detail?: string };

export function BarChart({
  bars,
  unit,
  ariaLabel,
}: {
  bars: Bar[];
  unit: string;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const H = 190;
  const m = { t: 22, r: 8, b: 26, l: 40 };
  const plotW = width - m.l - m.r;
  const plotH = H - m.t - m.b;
  const ticks = niceTicks(Math.max(...bars.map((b) => b.value), 1));
  const yMax = ticks[ticks.length - 1];
  const band = plotW / bars.length;
  const barW = Math.min(24, band * 0.62);
  const py = (v: number) => m.t + plotH - (v / yMax) * plotH;
  const cx = (i: number) => m.l + band * i + band / 2;

  const labelEvery = Math.max(1, Math.ceil(46 / band));
  const lastIdx = bars.length - 1;
  const maxIdx = bars.reduce((best, b, i) => (b.value > bars[best].value ? i : best), 0);
  const labelled = new Set<number>();
  if (bars[lastIdx].value > 0) labelled.add(lastIdx);
  if (bars[maxIdx].value > 0 && Math.abs(maxIdx - lastIdx) >= 2) labelled.add(maxIdx);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setActive((cur) => Math.min(lastIdx, Math.max(0, (cur ?? lastIdx) + (e.key === "ArrowRight" ? 1 : -1))));
  };

  const a = active != null ? bars[active] : null;

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={onKey}
        onFocus={() => setActive((c) => c ?? lastIdx)}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        className="rounded-lg outline-offset-4"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={m.l + plotW} y1={py(t)} y2={py(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={m.l - 8} y={py(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--muted)">
              {formatCompact(t)}
            </text>
          </g>
        ))}

        {bars.map((b, i) => {
          const h = (b.value / yMax) * plotH;
          const dim = active != null && active !== i;
          return (
            <g key={b.key}>
              <path d={barPath(cx(i) - barW / 2, py(b.value), barW, h)} fill="var(--accent)" opacity={dim ? 0.45 : 1} />
              {i % labelEvery === (lastIdx % labelEvery) && (
                <text x={cx(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
                  {b.axisLabel}
                </text>
              )}
              {labelled.has(i) && active == null && (
                <text x={cx(i)} y={py(b.value) - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--text)">
                  {formatCompact(b.value)}
                </text>
              )}
              {/* hit target: the whole band, full plot height */}
              <rect
                x={m.l + band * i}
                y={m.t}
                width={band}
                height={plotH}
                fill="transparent"
                onPointerEnter={() => setActive(i)}
                onPointerDown={() => setActive(i)}
              />
            </g>
          );
        })}
        <line x1={m.l} x2={m.l + plotW} y1={m.t + plotH} y2={m.t + plotH} stroke="var(--border)" strokeWidth={1} />
      </svg>

      {a && active != null && (
        <Tooltip
          tip={{ x: cx(active), title: a.title, value: `${formatCompact(a.value)} ${unit}`, detail: a.detail }}
          width={width}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------------------- */

/** Card with a title, the chart, and an always-available table view of the same numbers. */
export function ChartCard({
  title,
  subtitle,
  columns,
  rows,
  children,
  controls,
}: {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: string[][];
  children: React.ReactNode;
  controls?: React.ReactNode;
}) {
  const [table, setTable] = useState(false);
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="tag text-ink">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-muted">{subtitle}</p>}
        </div>
        <button onClick={() => setTable((t) => !t)} aria-pressed={table} className="tag rounded-lg border border-line px-2.5 py-1.5 aria-pressed:border-accent aria-pressed:text-accent">
          {table ? "Chart" : "Table"}
        </button>
      </div>
      {controls && <div className="mb-3">{controls}</div>}
      {table ? (
        <div className="max-h-72 overflow-auto rounded-lg border border-line">
          <table className="w-full text-sm tabular-nums">
            <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted">
              <tr>
                {columns.map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {r.map((cell, j) => (
                    <td key={j} className="px-3 py-2">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}
