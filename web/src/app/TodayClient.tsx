"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "@yusufceng1z/ding-react";
import { AppShell, ErrorNotice, InlineSpinner, SetupNotice, Spinner } from "@/components/AppShell";
import { Dial } from "@/components/Dial";
import { ResetWeek } from "@/components/ResetWeek";
import { SkipControl } from "@/components/SkipControl";
import { dateInWeek, skipFor, type Skip } from "@/lib/skips";
import { ChevronIcon } from "@/components/icons";
import { DAY_NAMES, formatLongDate, isoWeekday, localISO, startOfWeekISO } from "@/lib/dates";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSupabase } from "@/lib/supabase/client";
import { weekProgress } from "@/lib/weekProgress";
import { startWorkout } from "@/lib/workouts";
import { prefetchBundle, primeBundle } from "@/lib/workoutBundle";
import type { ProgramSession, Workout } from "@/lib/types";

export function TodayClient() {
  const router = useRouter();
  const pathname = usePathname();
  const [sessions, setSessions] = useState<ProgramSession[] | null>(null);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [skips, setSkips] = useState<Skip[] | null>(null); // null until loaded, or if the database has no skip table yet
  const [error, setError] = useState<string | null>(null);
  // Next keeps this view alive when you open a workout, so "busy" must come from live state that ends by itself:
  // `starting` while the workout is created, `navigating` until the next screen has rendered.
  const [starting, setStarting] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [navigating, startTransition] = useTransition();
  const busyId = starting ?? (navigating ? target : null);

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
      // Separate from the main load on purpose: without migration 0026 the screen still works, just with no skip control.
      const marks = await sb.from("session_skips").select("id,session_id,session_name,skipped_on,reason").gte("skipped_on", startOfWeekISO());
      setSkips(marks.error ? null : ((marks.data ?? []) as Skip[]));

      // Warm up today's workouts so tapping one opens instantly.
      const todayIds = new Set(((s ?? []) as ProgramSession[]).filter((x) => x.day_of_week === today).map((x) => x.id));
      for (const wk of (w ?? []) as Workout[]) {
        if (wk.session_id && todayIds.has(wk.session_id)) {
          prefetchBundle(wk.id);
          router.prefetch(`/workout/${wk.id}`);
        }
      }
      router.prefetch("/workout/new"); // loads the workout screen's code before a new workout is started
    } catch (e) {
      setError(e instanceof Error ? e.message : (e as { message?: string })?.message ?? "Failed to load");
    }
  }, [router, today]);

  const retry = useCallback(() => {
    setError(null);
    void load();
  }, [load]);

  useEffect(() => {
    // Fetch on mount, and again whenever we come back to "/": this view is kept alive, so it can be stale after a
    // workout was started or reset. State is only set after the awaited requests resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isSupabaseConfigured && pathname === "/") void load();
  }, [load, pathname]);

  const workoutFor = useMemo(() => {
    const map = new Map<string, Workout>();
    for (const w of workouts) if (w.session_id && !map.has(w.session_id)) map.set(w.session_id, w);
    return map;
  }, [workouts]);

  async function open(session: ProgramSession) {
    if (busyId !== null) return; // click events re-render synchronously, so a second tap sees this
    setTarget(session.id);
    setStarting(session.id);
    try {
      const existing = workoutFor.get(session.id);
      let id: string;
      if (existing) id = existing.id;
      else {
        const bundle = await startWorkout(session.id);
        primeBundle(bundle); // the workout screen renders from this, with no second fetch
        id = bundle.workout.id;
      }
      startTransition(() => router.push(`/workout/${id}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : ((e as { message?: string })?.message ?? "Could not start workout"));
    } finally {
      setStarting(null);
    }
  }

  async function signOut() {
    await getSupabase().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const progress = weekProgress(sessions ?? [], workouts);
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
            <Dial done={progress.done} total={progress.total} label="Sessions this week" />
          </section>

          <section aria-label="Today’s session" className="space-y-3">
            {[...todays, ...todaysOptional].length === 0 ? (
              <div className="rounded-2xl border border-line bg-surface p-6">
                <p className="text-lg font-semibold">Rest day</p>
                <p className="mt-1 text-sm text-muted">Nothing planned. Recovery is part of the program.</p>
              </div>
            ) : (
              [...todays, ...todaysOptional].map((s) => {
                const skip = skips ? skipFor(skips, s) : undefined;
                const done = Boolean(workoutFor.get(s.id)?.finished_at);
                return (
                  <div key={s.id} className="space-y-2">
                    <SessionHero
                      session={s}
                      workout={workoutFor.get(s.id)}
                      skipped={Boolean(skip) && !done}
                      busy={busyId === s.id}
                      locked={busyId !== null}
                      onOpen={() => open(s)}
                    />
                    {skips && !done && (
                      <div className="px-1">
                        <SkipControl session={s} date={dateInWeek(startOfWeekISO(), s.day_of_week)} skip={skip} onChanged={load} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </section>

          <section aria-label="This week">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="tag text-muted">This week</h2>
              <Link href="/plan" className="tag text-accent">
                Edit plan
              </Link>
            </div>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {sessions.map((s) => {
                const w = workoutFor.get(s.id);
                const skip = skips && !w?.finished_at ? skipFor(skips, s) : undefined;
                const status = w?.finished_at ? "Done" : skip ? "Skipped" : w ? "In progress" : s.day_of_week === today ? "Today" : "";
                // today's sessions have the control under their card above; here it is for earlier days of this week
                const skippable = skips !== null && !w?.finished_at && s.day_of_week < today;
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => open(s)}
                      disabled={busyId !== null}
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
                      {busyId === s.id ? <InlineSpinner className="text-muted" /> : <ChevronIcon className="-rotate-90 text-muted" />}
                    </button>
                    {skippable && (
                      <div className="pb-3 pl-20 pr-4">
                        <SkipControl session={s} date={dateInWeek(startOfWeekISO(), s.day_of_week)} skip={skip} onChanged={load} />
                      </div>
                    )}
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
  skipped = false,
  busy,
  locked,
  onOpen,
}: {
  session: ProgramSession;
  workout?: Workout;
  skipped?: boolean;
  busy: boolean;
  locked: boolean;
  onOpen: () => void;
}) {
  const done = Boolean(workout?.finished_at);
  const quiet = done || skipped; // nothing left to push for: the card steps back
  const label = done ? "View workout" : workout ? "Resume workout" : skipped ? "Train anyway" : session.kind === "cardio" ? "Start cardio" : "Start workout";
  return (
    <div className={`rounded-3xl p-5 ${quiet ? "border border-line bg-surface" : "bg-accent text-accent-ink"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`tag ${quiet ? "text-muted" : "opacity-75"}`}>
            {session.is_optional ? "Optional session" : "Scheduled session"}
          </p>
          <p className="mt-3 text-3xl font-semibold uppercase leading-none tracking-tight">{session.name}</p>
          <p className={`tag mt-3 ${quiet ? "text-muted" : "opacity-75"}`}>{plural(session.planned_exercises[0]?.count ?? 0)}</p>
        </div>
        {done && <span className="tag rounded-md bg-accent-soft px-2 py-1 text-accent">Done</span>}
        {skipped && <span className="tag rounded-md bg-surface-2 px-2 py-1 text-muted">Skipped</span>}
      </div>
      <button
        onClick={onOpen}
        disabled={locked}
        className={`tag mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 text-sm disabled:opacity-60 ${
          quiet ? "border-line text-ink" : "border-accent-ink text-accent-ink"
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
