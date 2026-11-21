"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, ErrorNotice, Spinner } from "@/components/AppShell";
import { BarChart, ChartCard } from "@/components/charts";
import { ChevronIcon } from "@/components/icons";
import { SummaryLink } from "@/components/SummaryLink";
import { formatCompact } from "@/lib/chartMath";
import { formatShortDate, localISO } from "@/lib/dates";
import { formatKg } from "@/lib/progression";
import { getSupabase } from "@/lib/supabase/client";
import type { PersonalRecord, WeekRow } from "@/lib/types";

const WEEKS = 12;

export default function ProgressPage() {
  const [weeks, setWeeks] = useState<WeekRow[] | null>(null);
  const [records, setRecords] = useState<PersonalRecord[]>([]);
  const [recentSince, setRecentSince] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const sb = getSupabase();
      const today = new Date();
      const since = new Date(today);
      since.setDate(today.getDate() - 14);
      const [w, r] = await Promise.all([
        sb.rpc("weekly_summary", { p_weeks: WEEKS, p_today: localISO(today) }),
        sb.rpc("personal_records"),
      ]);
      if (w.error) throw w.error;
      if (r.error) throw r.error;
      setRecentSince(localISO(since));
      setWeeks(w.data as WeekRow[]);
      setRecords(((r.data ?? []) as PersonalRecord[]).sort((a, b) => b.performed_on.localeCompare(a.performed_on)));
    } catch (e) {
      setError(e instanceof Error ? e.message : ((e as { message?: string })?.message ?? "Failed to load"));
    }
  }, []);

  const retry = useCallback(() => {
    setError(null);
    void load();
  }, [load]);

  useEffect(() => {
    // Fetch on mount; state is only set after the awaited requests resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const bars = useMemo(
    () =>
      (weeks ?? []).map((w) => ({
        key: w.week_start,
        axisLabel: formatShortDate(w.week_start),
        value: Number(w.volume),
        title: `Week of ${formatShortDate(w.week_start)}`,
        detail: `${w.sessions} ${w.sessions === 1 ? "session" : "sessions"} · ${w.sets} sets`,
      })),
    [weeks],
  );

  const current = weeks?.[weeks.length - 1];
  const previous = weeks && weeks.length > 1 ? weeks[weeks.length - 2] : undefined;
  const hasData = (weeks ?? []).some((w) => w.sets > 0);
  const delta = current && previous && previous.volume > 0 ? ((current.volume - previous.volume) / previous.volume) * 100 : null;

  return (
    <AppShell title="Progress" subtitle="Last 12 weeks">
      <SummaryLink />
      {error && <ErrorNotice message={error} onRetry={retry} />}
      {!error && !weeks && <Spinner />}

      {weeks && !hasData && (
        <div className="rounded-2xl border border-line bg-surface p-6 text-sm">
          <p className="font-semibold">Nothing to chart yet</p>
          <p className="mt-1 text-muted">Log your first session and your volume and personal bests will appear here.</p>
        </div>
      )}

      {weeks && hasData && current && (
        <div className="space-y-5">
          <section aria-label="This week" className="rounded-3xl bg-accent p-5 text-accent-ink">
            <p className="tag opacity-75">Volume this week</p>
            <p className="mt-3 font-mono text-6xl font-semibold leading-none tabular-nums tracking-tight">
              {formatCompact(Math.round(current.volume))}
              <span className="ml-1.5 text-2xl">kg</span>
            </p>
            <p className="tag mt-3 opacity-75">
              {delta == null ? "No earlier week to compare" : `${delta >= 0 ? "+" : "−"}${Math.abs(Math.round(delta))}% vs last week`}
            </p>
            <p className="mt-3 text-sm opacity-80">Total weight you lifted this week: weight × reps, added up for every set.</p>
            <details className="mt-2 text-sm">
              <summary className="tag w-fit underline opacity-75">How is this counted?</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 opacity-90">
                <li>Each set counts weight × reps. 60 kg × 8 reps = 480 kg.</li>
                <li>Sets with no weight (bodyweight, planks, timed work) add 0 kg but still count as sets.</li>
                <li>The week runs Monday to Sunday. The % compares with last week.</li>
              </ul>
            </details>
            <dl className="mt-5 grid grid-cols-2 gap-3 border-t-2 border-accent-ink/25 pt-4">
              <div>
                <dt className="tag opacity-75">Sessions</dt>
                <dd className="mt-1 font-mono text-3xl font-semibold tabular-nums">{current.sessions}</dd>
              </div>
              <div>
                <dt className="tag opacity-75">Sets</dt>
                <dd className="mt-1 font-mono text-3xl font-semibold tabular-nums">{current.sets}</dd>
              </div>
            </dl>
          </section>

          <ChartCard
            title="Weekly volume"
            subtitle="Total kg lifted each week (weight × reps, all sets)"
            columns={["Week of", "Sessions", "Sets", "Volume (kg)"]}
            rows={[...(weeks ?? [])].reverse().map((w) => [formatShortDate(w.week_start), String(w.sessions), String(w.sets), formatCompact(Math.round(w.volume))])}
          >
            <BarChart bars={bars} unit="kg" ariaLabel={`Weekly training volume for the last ${WEEKS} weeks. This week: ${formatCompact(Math.round(current.volume))} kilograms.`} />
          </ChartCard>

          <section aria-label="Personal bests">
            <h2 className="tag mb-3 text-muted">Personal bests</h2>
            {records.length === 0 ? (
              <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
                Bests appear once you log weighted sets of 1–12 reps.
              </p>
            ) : (
              <ul className="space-y-2">
                {records.map((r) => (
                  <li key={r.exercise_id}>
                    <Link href={`/exercises/${r.exercise_id}`} className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 active:bg-surface-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold uppercase tracking-wide">{r.name}</span>
                        <span className="tag mt-1 flex items-center gap-2 text-muted">
                          {formatKg(Number(r.load_kg))} kg × {r.reps} · {formatShortDate(r.performed_on)}
                          {r.performed_on >= recentSince && <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-accent">Recent</span>}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block font-mono text-xl font-semibold tabular-nums">{formatKg(Number(r.e1rm))}<span className="ml-0.5 text-sm text-muted">kg</span></span>
                        <span className="tag block text-muted">Est. 1RM</span>
                      </span>
                      <ChevronIcon className="-rotate-90 text-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
