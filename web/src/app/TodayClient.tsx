"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@yusufceng1z/ding-react";
import { AppShell, ErrorNotice, InlineSpinner, SetupNotice, Spinner } from "@/components/AppShell";
import { Dial } from "@/components/Dial";
import { ResetWeek } from "@/components/ResetWeek";
import { ChevronIcon } from "@/components/icons";
import { DAY_NAMES, formatLongDate, isoWeekday, localISO, startOfWeekISO } from "@/lib/dates";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSupabase } from "@/lib/supabase/client";
import { startWorkout } from "@/lib/workouts";
import type { ProgramSession, Workout } from "@/lib/types";

export function TodayClient() {
  const router = useRouter();
  const [sessions, setSessions] = useState<ProgramSession[] | null>(null);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const today = isoWeekday();

  const load = useCallback(async () => {
    try {
      const sb = getSupabase();
      const { data: programId, error: pErr } = await sb.rpc("ensure_my_program");
      if (pErr) throw pErr;
      if (!programId) throw new Error("No default program found. Run the seed migration (0002) in Supabase first.");

      const [{ data: s, error: sErr }, { data: w, error: wErr }] = await Promise.all([
        sb
          .from("program_sessions")
          .select("id,name,day_of_week,kind,is_optional,sort_order,planned_exercises(count)")
          .eq("program_id", programId)
          .order("day_of_week")
          .order("sort_order"),
        sb.from("workouts").select("*").gte("performed_on", startOfWeekISO()).order("started_at", { ascending: false }),
      ]);
      if (sErr) throw sErr;
      if (wErr) throw wErr;
      setSessions((s ?? []) as ProgramSession[]);
      setWorkouts((w ?? []) as Workout[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : (e as { message?: string })?.message ?? "Failed to load");
    }
  }, []);

  const retry = useCallback(() => {
    setError(null);
    void load();
  }, [load]);

  useEffect(() => {
    // Fetch on mount; state is only set after the awaited requests resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isSupabaseConfigured) void load();
  }, [load]);

  const workoutFor = useMemo(() => {
    const map = new Map<string, Workout>();
    for (const w of workouts) if (w.session_id && !map.has(w.session_id)) map.set(w.session_id, w);
    return map;
  }, [workouts]);

  async function open(session: ProgramSession) {
    if (pendingId !== null) return; // click events re-render synchronously, so a second tap sees this
    setPendingId(session.id);
    try {
      const existing = workoutFor.get(session.id);
      const id = existing ? existing.id : await startWorkout(session.id, session.name);
      // Stay "busy" until the next screen has rendered; this view unmounts when it does.
      startTransition(() => router.push(`/workout/${id}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : ((e as { message?: string })?.message ?? "Could not start workout"));
      setPendingId(null);
    }
  }

  async function signOut() {
    await getSupabase().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const plannedCount = sessions?.filter((s) => !s.is_optional).length ?? 0;
  const doneCount = new Set(workouts.filter((w) => w.finished_at && w.session_id).map((w) => w.session_id)).size;
  const todays = sessions?.filter((s) => s.day_of_week === today && !s.is_optional) ?? [];
  const todaysOptional = sessions?.filter((s) => s.day_of_week === today && s.is_optional) ?? [];

  return (
    <AppShell
      title="Today"
      subtitle={formatLongDate(localISO())}
      action={
        <button onClick={signOut} className="rounded-lg px-2 py-1.5 text-sm text-muted">
          Sign out
        </button>
      }
    >
      {!isSupabaseConfigured && <SetupNotice />}
      {error && <ErrorNotice message={error} onRetry={retry} />}
      {isSupabaseConfigured && !error && !sessions && <Spinner />}

      {sessions && (
        <div className="space-y-8">
          <section aria-label="Week progress" className="rounded-3xl border border-line bg-surface py-6">
            <Dial done={doneCount} total={plannedCount} label="Sessions this week" />
          </section>

          <section aria-label="Today’s session" className="space-y-3">
            {[...todays, ...todaysOptional].length === 0 ? (
              <div className="rounded-2xl border border-line bg-surface p-6">
                <p className="text-lg font-semibold">Rest day</p>
                <p className="mt-1 text-sm text-muted">Nothing planned. Recovery is part of the program.</p>
              </div>
            ) : (
              [...todays, ...todaysOptional].map((s) => (
                <SessionHero
                  key={s.id}
                  session={s}
                  workout={workoutFor.get(s.id)}
                  busy={pendingId === s.id}
                  locked={pendingId !== null}
                  onOpen={() => open(s)}
                />
              ))
            )}
          </section>

          <section aria-label="This week">
            <h2 className="tag mb-3 text-muted">This week</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {sessions.map((s) => {
                const w = workoutFor.get(s.id);
                const status = w?.finished_at ? "Done" : w ? "In progress" : s.day_of_week === today ? "Today" : "";
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => open(s)}
                      disabled={pendingId !== null}
                      className="flex w-full items-center gap-4 px-4 py-3.5 text-left active:bg-surface-2"
                    >
                      <span className="tag chip w-12 text-center text-muted">
                        {DAY_NAMES[s.day_of_week - 1].slice(0, 3)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{s.name}</span>
                        <span className="block text-xs text-muted">
                          {plural(s.planned_exercises[0]?.count ?? 0)}{s.is_optional ? " · optional" : ""}
                        </span>
                      </span>
                      {status && (
                        <span
                          className={`tag rounded-md px-2 py-1 ${
                            status === "Done" ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"
                          }`}
                        >
                          {status}
                        </span>
                      )}
                      {pendingId === s.id ? <InlineSpinner className="text-muted" /> : <ChevronIcon className="-rotate-90 text-muted" />}
                    </button>
                  </li>
                );
              })}
              <li className="flex items-center gap-4 px-4 py-3.5 text-muted">
                <span className="tag chip w-12 text-center">Sun</span>
                <span className="font-medium">Rest</span>
              </li>
            </ul>
          </section>

          <ResetWeek onDone={() => void load()} />

          <p className="text-center text-xs text-muted">
            Want to see past sessions? <Link href="/history" className="text-accent underline">Open history</Link>
          </p>
        </div>
      )}
    </AppShell>
  );
}

const plural = (n: number) => `${n} ${n === 1 ? "exercise" : "exercises"}`;

export function SessionHero({
  session,
  workout,
  busy,
  locked,
  onOpen,
}: {
  session: ProgramSession;
  workout?: Workout;
  busy: boolean;
  locked: boolean;
  onOpen: () => void;
}) {
  const done = Boolean(workout?.finished_at);
  const label = done ? "View workout" : workout ? "Resume workout" : session.kind === "cardio" ? "Start cardio" : "Start workout";
  return (
    <div className={`rounded-3xl p-5 ${done ? "border border-line bg-surface" : "bg-accent text-accent-ink"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`tag ${done ? "text-muted" : "opacity-75"}`}>
            {session.is_optional ? "Optional session" : "Scheduled session"}
          </p>
          <p className="mt-3 text-3xl font-semibold uppercase leading-none tracking-tight">{session.name}</p>
          <p className={`tag mt-3 ${done ? "text-muted" : "opacity-75"}`}>{plural(session.planned_exercises[0]?.count ?? 0)}</p>
        </div>
        {done && <span className="tag rounded-md bg-accent-soft px-2 py-1 text-accent">Done</span>}
      </div>
      <button
        onClick={onOpen}
        disabled={locked}
        className={`tag mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 text-sm disabled:opacity-60 ${
          done ? "border-line text-ink" : "border-accent-ink text-accent-ink"
        }`}
      >
        {busy ? (
          <>
            <InlineSpinner /> {workout ? "Opening…" : "Starting…"}
          </>
        ) : (
          label
        )}
      </button>
    </div>
  );
}
