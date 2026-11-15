"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell, ErrorNotice, Spinner } from "@/components/AppShell";
import { ChartCard, LineChart } from "@/components/charts";
import { ExerciseMedia } from "@/components/ExerciseMedia";
import { BookIcon, ChevronIcon } from "@/components/icons";
import { formatCompact } from "@/lib/chartMath";
import { formatShortDate } from "@/lib/dates";
import { formatKg } from "@/lib/progression";
import { getSupabase } from "@/lib/supabase/client";
import type { Exercise, ExerciseHistoryRow } from "@/lib/types";

type Metric = "top" | "e1rm" | "volume";
const METRICS: { id: Metric; label: string; unit: string; blurb: string }[] = [
  { id: "top", label: "Top set", unit: "kg", blurb: "Heaviest load each session" },
  { id: "e1rm", label: "Est. 1RM", unit: "kg", blurb: "Estimated one-rep max (Epley), sets of 1–12 reps" },
  { id: "volume", label: "Volume", unit: "kg", blurb: "Load × reps per session" },
];

const toMs = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
};

export function ExerciseClient() {
  const { id } = useParams<{ id: string }>();
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [history, setHistory] = useState<ExerciseHistoryRow[] | null>(null);
  const [metric, setMetric] = useState<Metric>("top");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const sb = getSupabase();
      const [ex, h] = await Promise.all([
        sb.from("exercises").select("*, exercise_media(*)").eq("id", id).single(),
        sb.rpc("exercise_history", { p_exercise_id: id }),
      ]);
      if (ex.error) throw ex.error;
      if (h.error) throw h.error;
      setExercise(ex.data as Exercise);
      setHistory(
        ((h.data ?? []) as ExerciseHistoryRow[]).map((r) => ({
          ...r,
          top_load: r.top_load == null ? null : Number(r.top_load),
          best_e1rm: r.best_e1rm == null ? null : Number(r.best_e1rm),
          volume: Number(r.volume),
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : ((e as { message?: string })?.message ?? "Failed to load"));
    }
  }, [id]);

  const retry = useCallback(() => {
    setError(null);
    void load();
  }, [load]);

  useEffect(() => {
    // Fetch on mount; state is only set after the awaited requests resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const series = useMemo(() => {
    const rows = history ?? [];
    return rows
      .map((r) => {
        const y = metric === "top" ? r.top_load : metric === "e1rm" ? r.best_e1rm : r.volume;
        return y == null || y <= 0
          ? null
          : {
              x: toMs(r.performed_on),
              date: r.performed_on,
              y,
              sets: r.sets,
              detail: `${r.sets} sets · top ${formatKg(r.top_load ?? 0)} kg × ${r.top_reps ?? 0}`,
            };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }, [history, metric]);

  const stats = useMemo(() => {
    const rows = history ?? [];
    const e1rms = rows.map((r) => r.best_e1rm).filter((v): v is number => v != null);
    const loads = rows.map((r) => r.top_load).filter((v): v is number => v != null && v > 0);
    const first = loads[0];
    const lastLoad = loads[loads.length - 1];
    return {
      sessions: rows.length,
      bestE1rm: e1rms.length ? Math.max(...e1rms) : null,
      heaviest: loads.length ? Math.max(...loads) : null,
      change: first != null && lastLoad != null && loads.length > 1 ? lastLoad - first : null,
    };
  }, [history]);

  const activeMetric = METRICS.find((m) => m.id === metric)!;
  const weighted = (history ?? []).some((r) => (r.top_load ?? 0) > 0);

  return (
    <AppShell title={exercise?.name ?? "Exercise"} subtitle="Progress" backHref="/progress">
      {error && <ErrorNotice message={error} onRetry={retry} />}
      {!error && !history && <Spinner />}

      {exercise && (exercise.exercise_media?.length || exercise.source === "wger") && (
        <details className="group mb-5 rounded-2xl bg-surface">
          <summary className="tag flex list-none items-center gap-2 p-4">
            <BookIcon className="size-4 text-accent" /> Demo
            <ChevronIcon className="ml-auto size-4 text-muted transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-line p-4">
            <ExerciseMedia exercise={exercise} />
          </div>
        </details>
      )}

      {history && history.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface p-6 text-sm">
          <p className="font-semibold">No sets logged yet</p>
          <p className="mt-1 text-muted">
            Log this exercise in a workout and its trend will show up here. Timed exercises such as planks and cardio
            aren’t charted yet.
          </p>
        </div>
      )}

      {history && history.length > 0 && !weighted && (
        <div className="rounded-2xl border border-line bg-surface p-6 text-sm">
          <p className="font-semibold">Bodyweight exercise</p>
          <p className="mt-1 text-muted">Add a load to your sets to see strength trends. {stats.sessions} sessions logged so far.</p>
        </div>
      )}

      {history && history.length > 0 && weighted && (
        <div className="space-y-5">
          <section aria-label="Best lift" className="rounded-3xl bg-accent p-5 text-accent-ink">
            <p className="tag opacity-75">Best estimated 1RM</p>
            <p className="mt-3 font-mono text-6xl font-semibold leading-none tabular-nums tracking-tight">
              {stats.bestE1rm != null ? formatKg(stats.bestE1rm) : "–"}
              <span className="ml-1.5 text-2xl">kg</span>
            </p>
            <dl className="mt-5 grid grid-cols-3 gap-3 border-t-2 border-accent-ink/25 pt-4">
              <div>
                <dt className="tag opacity-75">Heaviest</dt>
                <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums">{stats.heaviest != null ? formatKg(stats.heaviest) : "–"}</dd>
              </div>
              <div>
                <dt className="tag opacity-75">Top-set change</dt>
                <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                  {stats.change == null ? "–" : `${stats.change >= 0 ? "+" : "−"}${formatKg(Math.abs(stats.change))}`}
                </dd>
              </div>
              <div>
                <dt className="tag opacity-75">Sessions</dt>
                <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums">{stats.sessions}</dd>
              </div>
            </dl>
          </section>

          <ChartCard
            title={activeMetric.label}
            subtitle={activeMetric.blurb}
            columns={["Date", activeMetric.label + " (kg)", "Sets"]}
            rows={[...series].reverse().map((p) => [formatShortDate(p.date), formatCompact(p.y), String(p.sets)])}
            controls={
              <div role="group" aria-label="Chart metric" className="flex rounded-xl bg-surface-2 p-1">
                {METRICS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMetric(m.id)}
                    aria-pressed={metric === m.id}
                    className={`tag h-9 flex-1 rounded-lg ${metric === m.id ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            }
          >
            {series.length > 0 ? (
              <LineChart
                points={series}
                format={(n) => formatCompact(Math.round(n * 10) / 10)}
                unit={activeMetric.unit}
                ariaLabel={`${activeMetric.label} for ${exercise?.name ?? "this exercise"} across ${series.length} sessions. Latest: ${formatCompact(series[series.length - 1].y)} kilograms.`}
              />
            ) : (
              <p className="py-8 text-center text-sm text-muted">No data for this metric yet.</p>
            )}
          </ChartCard>

          <section aria-label="Sessions">
            <h2 className="tag mb-3 text-muted">Sessions</h2>
            <ul className="space-y-2">
              {[...history].reverse().map((r) => (
                <li key={r.workout_id}>
                  <Link href={`/workout/${r.workout_id}`} className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 active:bg-surface-2">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold uppercase tracking-wide">{formatShortDate(r.performed_on)}</span>
                      <span className="tag mt-1 block text-muted">{r.sets} sets · {formatCompact(Math.round(r.volume))} kg volume</span>
                    </span>
                    <span className="font-mono text-base font-semibold tabular-nums">
                      {r.top_load != null && r.top_load > 0 ? `${formatKg(r.top_load)} kg × ${r.top_reps}` : `${r.top_reps} reps`}
                    </span>
                    <ChevronIcon className="-rotate-90 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </AppShell>
  );
}
