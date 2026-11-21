"use client";

import { BarChart, ChartCard, LineChart } from "@/components/charts";
import { formatCompact } from "@/lib/chartMath";
import type { CoachCard } from "@/lib/coach";
import { formatShortDate } from "@/lib/dates";

const toMs = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
};

const kg = (n: number) => formatCompact(Math.round(n * 10) / 10);

/** Charts and tiles under a Coach reply. They draw the tool's own numbers, with the same look as the Progress tab. */
export function CoachCardView({ card }: { card: CoachCard }) {
  if (card.kind === "volume") {
    const bars = card.weeks.map((w) => ({
      key: w.week_of,
      axisLabel: formatShortDate(w.week_of),
      value: w.volume_kg,
      title: `Week of ${formatShortDate(w.week_of)}`,
      detail: `${w.sessions} ${w.sessions === 1 ? "session" : "sessions"} · ${w.sets} sets`,
    }));
    const last = card.weeks[card.weeks.length - 1];
    return (
      <ChartCard
        title="Weekly volume"
        subtitle="Total kg lifted each week (weight × reps)"
        columns={["Week of", "Sessions", "Sets", "Volume (kg)"]}
        rows={[...card.weeks].reverse().map((w) => [formatShortDate(w.week_of), String(w.sessions), String(w.sets), formatCompact(Math.round(w.volume_kg))])}
      >
        <BarChart bars={bars} unit="kg" ariaLabel={`Weekly training volume for ${bars.length} weeks. Latest week: ${formatCompact(Math.round(last.volume_kg))} kilograms.`} />
      </ChartCard>
    );
  }

  if (card.kind === "progress") {
    const points = card.points.map((p) => ({ x: toMs(p.date), date: p.date, y: p.est_1rm_kg, detail: `Top set ${p.top_set}` }));
    return (
      <ChartCard
        title={card.exercise}
        subtitle={card.next_load_kg != null ? `Estimated 1RM · next session ${kg(card.next_load_kg)} kg` : "Estimated 1RM"}
        columns={["Date", "Est. 1RM (kg)", "Top set"]}
        rows={[...card.points].reverse().map((p) => [formatShortDate(p.date), kg(p.est_1rm_kg), p.top_set])}
      >
        <LineChart
          points={points}
          format={kg}
          unit="kg"
          ariaLabel={`Estimated one-rep max for ${card.exercise} across ${points.length} sessions. Latest: ${kg(points[points.length - 1].y)} kilograms.`}
        />
      </ChartCard>
    );
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-4" aria-label="Personal bests">
      <h2 className="tag text-ink">Personal bests</h2>
      <ul className="mt-3 divide-y divide-line">
        {card.rows.map((r) => (
          <li key={r.exercise} className="flex items-baseline justify-between gap-3 py-2 text-sm">
            <span className="min-w-0 truncate font-medium">{r.exercise}</span>
            <span className="shrink-0 font-mono tabular-nums text-muted">
              {r.set}
              {r.est_1rm_kg != null && <span className="ml-2 text-ink">{kg(r.est_1rm_kg)} 1RM</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
