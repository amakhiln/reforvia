"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "@yusufceng1z/ding-react";
import { AppShell, ErrorNotice, InlineSpinner, Spinner } from "@/components/AppShell";
import { ExercisePicker as Picker, type Found } from "@/components/ExercisePicker";
import { ChevronIcon, CloseIcon, PlusIcon, SwapIcon } from "@/components/icons";
import { DAY_NAMES } from "@/lib/dates";
import { defaultRep, parseRepTarget, replacementPatch } from "@/lib/repTarget";
import { getSupabase } from "@/lib/supabase/client";

type Item = {
  id: string;
  exercise_id: string;
  sort_order: number;
  planned_sets: number;
  rep_target: string;
  is_timed: boolean;
  exercises: { name: string; main_muscles: string | null; equipment: string | null };
};
type Session = { id: string; name: string; day_of_week: number; is_optional: boolean; planned_exercises: Item[] };

const msg = (e: unknown) => (e instanceof Error ? e.message : ((e as { message?: string })?.message ?? "Something went wrong"));
const saved = () => toast.success("Plan saved", { id: "plan-saved", duration: 1500 });

export default function PlanPage() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const sb = getSupabase();
      const { error: pErr } = await sb.rpc("ensure_my_program");
      if (pErr) throw pErr;
      const { data, error: sErr } = await sb
        .from("program_sessions")
        .select(
          "id,name,day_of_week,is_optional,sort_order,planned_exercises(id,exercise_id,sort_order,planned_sets,rep_target,is_timed,exercises(name,main_muscles,equipment))",
        )
        .not("user_id", "is", null)
        .order("day_of_week")
        .order("sort_order");
      if (sErr) throw sErr;
      setSessions(
        ((data ?? []) as unknown as Session[]).map((s) => ({
          ...s,
          planned_exercises: [...s.planned_exercises].sort((a, b) => a.sort_order - b.sort_order),
        })),
      );
    } catch (e) {
      setError(msg(e));
    }
  }, []);

  useEffect(() => {
    // Fetch on mount; state is only set after the awaited requests resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const retry = () => {
    setError(null);
    void load();
  };

  return (
    <AppShell title="Plan" subtitle="Edit your week" backHref="/">
      {error && <ErrorNotice message={error} onRetry={retry} />}
      {!error && !sessions && <Spinner />}
      {sessions && sessions.length === 0 && (
        <p className="rounded-2xl bg-surface p-5 text-sm text-muted">No plan yet. Go back and use “Restore default plan”.</p>
      )}
      {sessions && sessions.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Changes apply to future sessions. A workout you’ve already started keeps its exercises.
          </p>
          {sessions.map((s) => (
            <SessionCard key={s.id} session={s} onChanged={load} />
          ))}
          <p className="tag pt-2 text-center text-muted">
            Exercise library includes content from{" "}
            <a href="https://wger.de" target="_blank" rel="noopener noreferrer" className="text-accent underline">
              wger.de
            </a>{" "}
            (CC BY-SA)
          </p>
        </div>
      )}
    </AppShell>
  );
}

function SessionCard({ session, onChanged }: { session: Session; onChanged: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const items = session.planned_exercises;

  async function run(action: () => PromiseLike<{ error: unknown }>) {
    const { error } = await action();
    if (error) {
      toast.error(msg(error));
      return false;
    }
    await onChanged();
    saved();
    return true;
  }

  async function move(index: number, dir: -1 | 1) {
    const a = items[index];
    const b = items[index + dir];
    if (!b) return;
    const sb = getSupabase();
    const [r1, r2] = await Promise.all([
      sb.from("planned_exercises").update({ sort_order: b.sort_order }).eq("id", a.id),
      sb.from("planned_exercises").update({ sort_order: a.sort_order }).eq("id", b.id),
    ]);
    if (r1.error || r2.error) toast.error(msg(r1.error ?? r2.error));
    await onChanged();
  }

  async function add(ex: Found) {
    const { data } = await getSupabase().auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) {
      toast.error("You’re signed out. Please sign in again.");
      return;
    }
    const rep = defaultRep(ex.is_timed);
    const ok = await run(() =>
      getSupabase()
        .from("planned_exercises")
        .insert({
          session_id: session.id,
          user_id: userId,
          exercise_id: ex.id,
          sort_order: items.reduce((m, i) => Math.max(m, i.sort_order), -1) + 1,
          planned_sets: 3,
          per_side: false,
          is_timed: ex.is_timed,
          ...rep,
        }),
    );
    if (ok) setAdding(false);
  }

  return (
    <details className="group rounded-2xl bg-surface">
      <summary className="flex list-none items-center gap-3 p-4">
        <span className="tag chip w-12 text-center text-muted">{DAY_NAMES[session.day_of_week - 1].slice(0, 3)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold uppercase tracking-wide">{session.name}</span>
          <span className="tag mt-1 block text-muted">
            {items.length} {items.length === 1 ? "exercise" : "exercises"}
            {session.is_optional ? " · optional" : ""}
          </span>
        </span>
        <ChevronIcon className="text-muted transition-transform group-open:rotate-180" />
      </summary>

      <div className="space-y-2 border-t border-line p-4">
        {items.map((it, i) => (
          <Row
            key={`${it.id}:${it.planned_sets}:${it.rep_target}`}
            item={it}
            first={i === 0}
            last={i === items.length - 1}
            onMove={(d) => move(i, d)}
            onSave={(patch) => run(() => getSupabase().from("planned_exercises").update(patch).eq("id", it.id))}
            takenIds={items.map((i) => i.exercise_id)}
            onReplace={(ex) =>
              ex.id === it.exercise_id
                ? Promise.resolve(toast.info("That’s already the exercise in this slot.")).then(() => false)
                : run(() => getSupabase().from("planned_exercises").update(replacementPatch(it, ex)).eq("id", it.id))
            }
            onRemove={() => run(() => getSupabase().from("planned_exercises").delete().eq("id", it.id))}
          />
        ))}
        {items.length === 0 && <p className="text-sm text-muted">No exercises yet.</p>}

        {adding ? (
          <Picker onPick={add} onCancel={() => setAdding(false)} />
        ) : (
          <button onClick={() => setAdding(true)} className="tag flex items-center gap-1.5 py-2 text-accent">
            <PlusIcon className="size-4" /> Add exercise
          </button>
        )}
      </div>
    </details>
  );
}

function Row({
  item,
  first,
  last,
  onMove,
  onSave,
  onReplace,
  takenIds,
  onRemove,
}: {
  item: Item;
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => Promise<void>;
  onSave: (patch: Record<string, unknown>) => Promise<boolean>;
  onReplace: (ex: Found) => Promise<boolean>;
  takenIds: string[];
  onRemove: () => Promise<boolean>;
}) {
  const [sets, setSets] = useState(String(item.planned_sets));
  const [reps, setReps] = useState(item.rep_target);
  const [confirm, setConfirm] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function commit() {
    const n = Number(sets);
    const parsed = parseRepTarget(reps);
    if (!Number.isInteger(n) || n < 1 || n > 10 || !parsed) {
      toast.error("Sets must be 1–10 and reps need a number, like 8–12.");
      setSets(String(item.planned_sets));
      setReps(item.rep_target);
      return;
    }
    if (n === item.planned_sets && reps.trim() === item.rep_target) return;
    await onSave({ planned_sets: n, rep_target: reps.trim(), ...parsed });
  }

  async function guarded(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  const field = "h-10 min-w-0 rounded-lg bg-surface-2 px-2 text-center font-mono text-base";
  return (
    <div className="rounded-xl bg-bg p-3">
      <p className="truncate text-sm font-semibold uppercase tracking-wide">{item.exercises.name}</p>
      <div className="mt-2 flex items-center gap-2">
        <label className="flex items-center gap-1.5">
          <span className="tag text-muted">Sets</span>
          <input
            inputMode="numeric"
            aria-label={`${item.exercises.name} sets`}
            value={sets}
            onChange={(e) => setSets(e.target.value)}
            onBlur={() => void guarded(commit)}
            className={`${field} w-12`}
          />
        </label>
        <label className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="tag text-muted">Reps</span>
          <input
            aria-label={`${item.exercises.name} reps`}
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            onBlur={() => void guarded(commit)}
            className={`${field} w-full`}
          />
        </label>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1">
        <button
          onClick={() => void guarded(() => onMove(-1))}
          disabled={first || busy}
          aria-label={`Move ${item.exercises.name} up`}
          className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-muted disabled:opacity-30"
        >
          <ChevronIcon className="rotate-180" />
        </button>
        <button
          onClick={() => void guarded(() => onMove(1))}
          disabled={last || busy}
          aria-label={`Move ${item.exercises.name} down`}
          className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-muted disabled:opacity-30"
        >
          <ChevronIcon />
        </button>
        <button
          onClick={() => setReplacing((r) => !r)}
          aria-pressed={replacing}
          aria-label={`Replace ${item.exercises.name}`}
          className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-muted aria-pressed:text-accent"
        >
          <SwapIcon className="size-4" />
        </button>
        {confirm ? (
          <>
            <button
              onClick={() => void guarded(onRemove)}
              disabled={busy}
              className="tag inline-flex h-9 items-center gap-1.5 rounded-lg bg-danger px-3 text-white"
            >
              {busy ? <InlineSpinner /> : "Remove"}
            </button>
            <button onClick={() => setConfirm(false)} className="tag h-9 rounded-lg px-2 text-muted">
              Keep
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirm(true)}
            aria-label={`Remove ${item.exercises.name}`}
            className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-muted"
          >
            <CloseIcon className="size-4" />
          </button>
        )}
      </div>
      {replacing && (
        <div className="mt-2">
          <Picker
            suggestFor={{ id: item.exercise_id, name: item.exercises.name, main_muscles: item.exercises.main_muscles, equipment: item.exercises.equipment, is_timed: item.is_timed }}
            exclude={takenIds}
            onPick={async (ex) => {
              if (await onReplace(ex)) setReplacing(false);
            }}
            onCancel={() => setReplacing(false)}
          />
        </div>
      )}
    </div>
  );
}
