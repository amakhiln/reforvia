"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "@yusufceng1z/ding-react";
import { AppShell, ErrorNotice, Spinner } from "@/components/AppShell";
import { PlusIcon } from "@/components/icons";
import { ExerciseCard } from "@/components/ExerciseCard";
import { ExercisePicker, type Found } from "@/components/ExercisePicker";
import { RestTimer } from "@/components/RestTimer";
import type { SetValues } from "@/components/SetRow";
import { formatLongDate } from "@/lib/dates";
import { defaultRep } from "@/lib/repTarget";
import { defaultRestSeconds } from "@/lib/progression";
import { getSupabase } from "@/lib/supabase/client";
import { fetchBundle, takeBundle, type WorkoutBundle } from "@/lib/workoutBundle";
import type { PreviousSet, SetLog, Workout, WorkoutExercise } from "@/lib/types";

const msg = (e: unknown) => (e instanceof Error ? e.message : ((e as { message?: string })?.message ?? "Unknown error"));

export function WorkoutClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [items, setItems] = useState<WorkoutExercise[] | null>(null);
  const [previous, setPrevious] = useState<Record<string, PreviousSet[]>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [alsoPlan, setAlsoPlan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rest, setRest] = useState<{ endsAt: number; total: number } | null>(null);
  const userId = useRef<string | null>(null);

  const apply = useCallback((bundle: WorkoutBundle) => {
    const rows = bundle.items.map((r) => ({
      ...r,
      set_logs: [...(r.set_logs ?? [])].sort((a, b) => a.set_number - b.set_number),
    }));
    const grouped: Record<string, PreviousSet[]> = {};
    for (const p of bundle.previous) (grouped[p.exercise_id] ??= []).push(p);
    setWorkout(bundle.workout);
    setItems(rows);
    setPrevious(grouped);
    setOpenId((cur) => cur ?? rows.find((r) => !r.completed)?.id ?? null);
  }, []);

  const load = useCallback(async () => {
    try {
      const sb = getSupabase();
      const { data: auth } = await sb.auth.getSession();
      userId.current = auth.session?.user.id ?? null;
      apply(takeBundle(id) ?? (await fetchBundle(id)));
    } catch (e) {
      setError(msg(e));
    }
  }, [id, apply]);

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

  const flash = useCallback((text: string, kind: "error" | "success" = "error") => {
    toast[kind](text);
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
        flash(`${item.exercises.name} complete`, "success");
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
    if (finished) {
      toast.success("Workout finished");
      router.push("/");
    }
    else setWorkout((w) => (w ? { ...w, finished_at: null } : w));
  }

  async function addExercise(ex: Found, alsoPlan: boolean) {
    if (!userId.current || !workout || !items) return;
    if (items.some((i) => i.exercise_id === ex.id)) {
      toast.info("That exercise is already in this workout.");
      return;
    }
    try {
      const sb = getSupabase();
      const { data: we, error } = await sb
        .from("workout_exercises")
        .insert({
          workout_id: id,
          user_id: userId.current,
          exercise_id: ex.id,
          sort_order: items.reduce((m, i) => Math.max(m, i.sort_order), -1) + 1,
        })
        .select("id")
        .single();
      if (error) throw error;

      let note = `${ex.name} added`;
      if (alsoPlan && workout.session_id) {
        // Best effort: the exercise is already in today's workout even if the plan update fails.
        const { data: last } = await sb
          .from("planned_exercises")
          .select("sort_order")
          .eq("session_id", workout.session_id)
          .order("sort_order", { ascending: false })
          .limit(1);
        const { data: pe, error: pErr } = await sb
          .from("planned_exercises")
          .insert({
            session_id: workout.session_id,
            user_id: userId.current,
            exercise_id: ex.id,
            sort_order: (last?.[0]?.sort_order ?? -1) + 1,
            planned_sets: 3,
            per_side: false,
            is_timed: ex.is_timed,
            ...defaultRep(ex.is_timed),
          })
          .select("id")
          .single();
        if (pErr || !pe) note += ", but it couldn’t be added to your plan";
        else {
          await sb.from("workout_exercises").update({ planned_exercise_id: pe.id }).eq("id", we.id);
          note += " and added to your plan";
        }
      }
      apply(await fetchBundle(id));
      setOpenId(we.id);
      setAdding(false);
      flash(note, "success");
    } catch (e) {
      flash(`Couldn’t add exercise: ${msg(e)}`);
    }
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

          {adding ? (
            <div className="space-y-2 rounded-2xl bg-surface p-3">
              <ExercisePicker onPick={(ex) => addExercise(ex, alsoPlan)} onCancel={() => setAdding(false)} />
              {workout.session_id && (
                <label className="flex items-center gap-2 px-1 text-sm">
                  <input type="checkbox" checked={alsoPlan} onChange={(e) => setAlsoPlan(e.target.checked)} className="size-4 accent-[var(--accent)]" />
                  Also add it to my plan
                </label>
              )}
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="tag flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-line">
              <PlusIcon className="size-4 text-accent" /> Add exercise
            </button>
          )}

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
