"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell, ErrorNotice, Spinner } from "@/components/AppShell";
import { ChevronIcon } from "@/components/icons";
import { formatKg } from "@/lib/progression";
import { formatLongDate } from "@/lib/dates";
import { getSupabase } from "@/lib/supabase/client";

type Row = {
  id: string;
  session_name: string;
  performed_on: string;
  finished_at: string | null;
  workout_exercises: { completed: boolean; set_logs: { load_kg: number | null; reps: number | null }[] }[];
};

export default function HistoryPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from("workouts")
      .select("id,session_name,performed_on,finished_at,workout_exercises(completed,set_logs(load_kg,reps))")
      .order("performed_on", { ascending: false })
      .order("started_at", { ascending: false })
      .limit(100);
    if (error) setError(error.message);
    else setRows((data ?? []) as unknown as Row[]);
  }, []);

  const retry = useCallback(() => {
    setError(null);
    void load();
  }, [load]);

  useEffect(() => {
    // Fetch on mount; state is only set after the awaited request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <AppShell title="History" subtitle="Past sessions">
      {error && <ErrorNotice message={error} onRetry={retry} />}
      {!error && !rows && <Spinner />}
      {rows && rows.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface p-6 text-sm">
          <p className="font-semibold">No workouts yet</p>
          <p className="mt-1 text-muted">Finish your first session and it will show up here.</p>
        </div>
      )}
      {rows && rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((w) => {
            const sets = w.workout_exercises.flatMap((e) => e.set_logs);
            const volume = sets.reduce((n, s) => n + (Number(s.load_kg) || 0) * (s.reps ?? 0), 0);
            const done = w.workout_exercises.filter((e) => e.completed).length;
            return (
              <li key={w.id}>
                <Link
                  href={`/workout/${w.id}`}
                  className="flex items-center gap-3 rounded-2xl bg-surface p-4 active:bg-surface-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold uppercase tracking-wide">{w.session_name}</p>
                    <p className="tag mt-1 text-muted">{formatLongDate(w.performed_on)}</p>
                    <p className="tag mt-2 text-muted">
                      {done}/{w.workout_exercises.length} exercises · {sets.length} sets
                      {volume > 0 ? ` · ${formatKg(Math.round(volume))} kg volume` : ""}
                    </p>
                  </div>
                  <span
                    className={`tag rounded-md px-2 py-1 ${
                      w.finished_at ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"
                    }`}
                  >
                    {w.finished_at ? "Done" : "In progress"}
                  </span>
                  <ChevronIcon className="-rotate-90 text-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
