/** Pure helpers for the charts (kept free of React so they are unit-tested). */

/** Round a maximum up to a clean axis top and return evenly spaced ticks from 0. */
export function niceTicks(maxValue: number, count = 4): number[] {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return [0, 1];
  const rough = maxValue / count;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / pow;
  const step = (frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10) * pow;
  const ticks: number[] = [];
  for (let v = 0; v <= maxValue + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** Ticks for a line chart whose axis need not start at zero. */
export function niceRange(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.1);
    return niceRange(min - pad, max + pad, count);
  }
  const rough = (max - min) / count;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / pow;
  const step = (frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10) * pow;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** 12.4k style for large numbers, full numbers under 10,000. */
export function formatCompact(n: number): string {
  if (Math.abs(n) < 10000) return Number.isInteger(n) ? n.toLocaleString("en-US") : String(Math.round(n * 10) / 10);
  const k = n / 1000;
  return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`;
}

/** Epley estimate, valid for 1–12 reps; null otherwise. */
export function estimateOneRepMax(loadKg: number | null, reps: number | null): number | null {
  if (loadKg == null || reps == null || loadKg <= 0 || reps < 1 || reps > 12) return null;
  return Math.round(loadKg * (1 + reps / 30) * 10) / 10;
}

/** Index of the point whose x is closest to the pointer (points sorted by x). */
export function nearestIndex(xs: number[], target: number): number {
  let best = 0;
  let bestDist = Infinity;
  xs.forEach((x, i) => {
    const d = Math.abs(x - target);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

/** SVG path for a bar: square at the baseline, rounded data-end (top). */
export function barPath(x: number, y: number, w: number, h: number, radius = 4): string {
  if (h <= 0) return "";
  const r = Math.min(radius, h, w / 2);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
