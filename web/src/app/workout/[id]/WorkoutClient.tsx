"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AppShell, ErrorNotice, Spinner } from "@/components/AppShell";
import { ExerciseCard } from "@/components/ExerciseCard";
import { RestTimer } from "@/components/RestTimer";
import type { SetValues } from "@/components/SetRow";
import { formatLongDate } from "@/lib/dates";
import { defaultRestSeconds } from "@/lib/progression";
import { getSupabase } from "@/lib/supabase/client";
import type { PreviousSet, SetLog, Workout, WorkoutExercise } from "@/lib/types";

const msg = (e: unknown) => (e instanceof Error ? e.message : ((e as { message?: string })?.message ?? "Unknown error"));

export function WorkoutClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [items, setItems] = useState<WorkoutExercise[] | null>(null);
  const [previous, setPrevious] = useState<Record<string, PreviousSet[]>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [rest, setRest] = useState<{ endsAt: number; total: number } | null>(null);
  const userId = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const sb = getSupabase();
      const { data: auth } = await sb.auth.getSession();
      userId.current = auth.session?.user.id ?? null;

      const [{ data: w, error: wErr }, { data: list, error: lErr }] = await Promise.all([
        sb.from("workouts").select("*").eq("id", id).single(),
        sb
          .from("workout_exercises")
          .select("*, exercises(*), planned_exercises(*), set_logs(*)")
          .eq("workout_id", id)
          .order("sort_order"),
      ]);
      if (wErr) throw wErr;
      if (lErr) throw lErr;
      const rows = ((list ?? []) as WorkoutExercise[]).map((r) => ({
        ...r,
        set_logs: [...(r.set_logs ?? [])].sort((a, b) => a.set_number - b.set_number),
      }));

      const { data: prev, error: pErr } = await sb.rpc("previous_sets", {
        p_exercise_ids: rows.map((r) => r.exercise_id),
        p_exclude_workout: id,
      });
      if (pErr) throw pErr;
      const grouped: Record<string, PreviousSet[]> = {};
      for (const p of (prev ?? []) as PreviousSet[]) (grouped[p.exercise_id] ??= []).push(p);

      setWorkout(w as Workout);
      setItems(rows);
      setPrevious(grouped);
      setOpenId((cur) => cur ?? rows.find((r) => !r.completed)?.id ?? null);
    } catch (e) {
      setError(msg(e));
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

  // Keep the screen awake while training.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        /* not supported or denied */
      }
    };
    void acquire();
    const onVisible = () => document.visibilityState === "visible" && void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, []);

  const flash = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const patchItem = useCallback((itemId: string, fn: (it: WorkoutExercise) => WorkoutExercise) => {
    setItems((cur) => cur?.map((it) => (it.id === itemId ? fn(it) : it)) ?? cur);
  }, []);

  async function syncCompleted(item: WorkoutExercise, logs: SetLog[]) {
    const planned = item.planned_exercises?.planned_sets ?? 3;
    const shouldBeDone = logs.length >= planned;
    if (shouldBeDone === item.completed) return shouldBeDone;
    const { error } = await getSupabase().from("workout_exercises").update({ completed: shouldBeDone }).eq("id", item.id);
    if (error) throw error;
    patchItem(item.id, (it) => ({ ...it, completed: shouldBeDone }));
    return shouldBeDone;
  }

  function advanceFrom(itemId: string) {
    const list = items ?? [];
    const idx = list.findIndex((i) => i.id === itemId);
    const next = list.slice(idx + 1).find((i) => !i.completed);
    setOpenId(next?.id ?? null);
  }

  async function upsertSet(item: WorkoutExercise, setNumber: number, v: SetValues): Promise<SetLog[]> {
    if (!userId.current) throw new Error("You’re signed out. Please sign in again.");
    const { data, error } = await getSupabase()
      .from("set_logs")
      .upsert(
        {
          workout_exercise_id: item.id,
          user_id: userId.current,
          set_number: setNumber,
          load_kg: v.load,
          reps: v.reps,
          duration_sec: v.duration,
        },
        { onConflict: "workout_exercise_id,set_number" },
      )
      .select()
      .single();
    if (error) throw error;
    const saved = data as SetLog;
    const logs = [...item.set_logs.filter((s) => s.set_number !== setNumber), saved].sort((a, b) => a.set_number - b.set_number);
    patchItem(item.id, (it) => ({ ...it, set_logs: logs }));
    return logs;
  }

  const logSet = (item: WorkoutExercise) => async (setNumber: number, v: SetValues) => {
    try {
      const logs = await upsertSet(item, setNumber, v);
      const p = item.planned_exercises;
      const secs = defaultRestSeconds(p?.rep_min ?? null, p?.rep_max ?? null, p?.is_timed ?? false);
      setRest({ endsAt: Date.now() + secs * 1000, total: secs });
      const done = await syncCompleted(item, logs);
      if (done) {
        flash(`${item.exercises.name} complete`);
        advanceFrom(item.id);
      }
    } catch (e) {
      flash(`Couldn’t save set: ${msg(e)}`);
    }
  };

  const editSet = (item: WorkoutExercise) => async (setNumber: number, v: SetValues) => {
    try {
      await upsertSet(item, setNumber, v);
    } catch (e) {
      flash(`Couldn’t save change: ${msg(e)}`);
    }
  };

  const unlogSet = (item: WorkoutExercise) => async (setNumber: number) => {
    try {
      const { error } = await getSupabase()
        .from("set_logs")
        .delete()
        .eq("workout_exercise_id", item.id)
        .eq("set_number", setNumber);
      if (error) throw error;
      const logs = item.set_logs.filter((s) => s.set_number !== setNumber);
      patchItem(item.id, (it) => ({ ...it, set_logs: logs }));
      await syncCompleted(item, logs);
    } catch (e) {
      flash(`Couldn’t undo set: ${msg(e)}`);
    }
  };

  const setRir = (item: WorkoutExercise) => async (rir: number | null) => {
    patchItem(item.id, (it) => ({ ...it, rir_last_set: rir }));
    const { error } = await getSupabase().from("workout_exercises").update({ rir_last_set: rir }).eq("id", item.id);
    if (error) {
      patchItem(item.id, (it) => ({ ...it, rir_last_set: item.rir_last_set }));
      flash(`Couldn’t save RIR: ${msg(error)}`);
    }
  };

  const toggleDone = (item: WorkoutExercise) => async () => {
    const next = !item.completed;
    patchItem(item.id, (it) => ({ ...it, completed: next }));
    const { error } = await getSupabase().from("workout_exercises").update({ completed: next }).eq("id", item.id);
    if (error) {
      patchItem(item.id, (it) => ({ ...it, completed: item.completed }));
      flash(`Couldn’t update: ${msg(error)}`);
    } else if (next) advanceFrom(item.id);
  };

  const saveNotes = (item: WorkoutExercise) => async (notes: string) => {
    const { error } = await getSupabase().from("workout_exercises").update({ notes: notes || null }).eq("id", item.id);
    if (error) flash(`Couldn’t save note: ${msg(error)}`);
    else patchItem(item.id, (it) => ({ ...it, notes: notes || null }));
  };

  async function setFinished(finished: boolean) {
    const { error } = await getSupabase()
      .from("workouts")
      .update({ finished_at: finished ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) return flash(`Couldn’t update workout: ${msg(error)}`);
    if (finished) router.push("/");
    else setWorkout((w) => (w ? { ...w, finished_at: null } : w));
  }

  const summary = useMemo(() => {
    const all = items ?? [];
    return {
      done: all.filter((i) => i.completed).length,
      total: all.length,
      sets: all.reduce((n, i) => n + i.set_logs.length, 0),
    };
  }, [items]);

  return (
    <AppShell
      title={workout?.session_name ?? "Workout"}
      subtitle={workout ? formatLongDate(workout.performed_on) : undefined}
      backHref="/"
      hideNav
    >
      {error && <ErrorNotice message={error} onRetry={retry} />}
      {!error && !items && <Spinner />}

      {items && workout && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface px-4 py-3.5 text-sm">
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Progress</p>
              <p className="mt-0.5 font-semibold">
                {summary.done}/{summary.total} exercises · {summary.sets} sets
              </p>
            </div>
            <div className="h-2 w-28 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div
                className="h-full bg-accent transition-[width] duration-300"
                style={{ width: `${summary.total ? (summary.done / summary.total) * 100 : 0}%` }}
              />
            </div>
          </div>

          {items.map((item) => (
            <ExerciseCard
              key={item.id}
              item={item}
              previous={previous[item.exercise_id] ?? []}
              open={openId === item.id}
              onToggleOpen={() => setOpenId(openId === item.id ? null : item.id)}
              onLogSet={logSet(item)}
              onEditSet={editSet(item)}
              onUnlogSet={unlogSet(item)}
              onRir={setRir(item)}
              onToggleDone={toggleDone(item)}
              onNotes={saveNotes(item)}
            />
          ))}

          <button
            onClick={() => setFinished(!workout.finished_at)}
            className={`h-13 w-full rounded-xl py-3.5 text-base font-semibold ${
              workout.finished_at ? "bg-surface-2 text-ink" : "bg-accent text-accent-ink"
            }`}
          >
            {workout.finished_at ? "Reopen workout" : "Finish workout"}
          </button>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed inset-x-4 top-[max(env(safe-area-inset-top),1rem)] z-40 mx-auto max-w-xl rounded-xl bg-ink px-4 py-3 text-sm font-medium text-bg shadow-lg"
        >
          {toast}
        </div>
      )}

      {rest && (
        <RestTimer
          endsAt={rest.endsAt}
          total={rest.total}
          onAdjust={(d) => setRest((r) => (r ? { endsAt: r.endsAt + d * 1000, total: Math.max(15, r.total + d) } : r))}
          onDismiss={() => setRest(null)}
        />
      )}
    </AppShell>
  );
}
