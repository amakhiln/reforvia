"use client";

import { useState } from "react";
import { toast } from "@yusufceng1z/ding-react";
import { InlineSpinner } from "./AppShell";
import { ChevronIcon, CloseIcon, SwapIcon } from "./icons";
import { ExercisePicker, type Found } from "./ExercisePicker";
import { parseSetsReps, SETS_REPS_HELP } from "@/lib/repTarget";
import type { WorkoutExercise } from "@/lib/types";
import { planSlot } from "@/lib/workoutEdit";

/** What the workout screen provides so one exercise can be edited. Each action resolves true when it was saved. */
export type ExerciseEdits = {
  sessionId: string | null;
  first: boolean;
  last: boolean;
  takenIds: string[];
  onSwap: (ex: Found, alsoPlan: boolean) => Promise<boolean>;
  onMove: (dir: -1 | 1) => Promise<boolean>;
  onRemove: (alsoPlan: boolean) => Promise<boolean>;
  onTargets: (patch: NonNullable<ReturnType<typeof parseSetsReps>>) => Promise<boolean>;
};

const action = "tag flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-surface-2 disabled:opacity-40";
const field = "h-11 min-w-0 rounded-lg bg-surface-2 px-2 text-center font-mono text-base";

export function ExerciseEditor({ item, onClose, ...edits }: ExerciseEdits & { item: WorkoutExercise; onClose: () => void }) {
  const ex = item.exercises;
  const planned = item.planned_exercises;
  const slot = planSlot(planned, edits.sessionId);
  // Sets, reps and removal change the plan only when this day's plan row is for this very exercise.
  const ownRow = slot && slot.exercise_id === item.exercise_id ? slot : null;

  const [panel, setPanel] = useState<"swap" | "targets" | "remove" | null>(null);
  const [alsoPlan, setAlsoPlan] = useState(false);
  const [sets, setSets] = useState(String(ownRow?.planned_sets ?? ""));
  const [reps, setReps] = useState(ownRow?.rep_target ?? "");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<boolean>, closeAfter = true) {
    if (busy) return;
    setBusy(true);
    const ok = await fn();
    setBusy(false);
    if (ok && closeAfter) onClose();
  }

  function saveTargets() {
    const patch = parseSetsReps(sets, reps);
    if (!patch) return void toast.error(SETS_REPS_HELP);
    // Logged reps would read as seconds (or the other way round), so the kind cannot change under them.
    if (item.set_logs.length && ownRow && patch.is_timed !== ownRow.is_timed) {
      return void toast.error("You’ve already logged sets, so keep the same kind of target (reps or time).");
    }
    void run(() => edits.onTargets(patch));
  }

  const toggle = (p: "swap" | "targets" | "remove") => setPanel((cur) => (cur === p ? null : p));
  const logged = item.set_logs.length;

  return (
    <div role="group" aria-label={`Edit ${ex.name}`} className="space-y-2 border-t border-line px-4 py-4">
      <button onClick={() => toggle("swap")} aria-expanded={panel === "swap"} disabled={busy} className={action}>
        <SwapIcon className="size-4 text-accent" /> Swap exercise
      </button>
      {panel === "swap" && (
        <ExercisePicker
          suggestFor={{ id: item.exercise_id, name: ex.name, main_muscles: ex.main_muscles, equipment: ex.equipment, is_timed: planned?.is_timed ?? ex.is_timed }}
          exclude={edits.takenIds}
          otherKit
          onPick={(next) => run(() => edits.onSwap(next, alsoPlan))}
          onCancel={() => setPanel(null)}
        />
      )}

      <button onClick={() => toggle("targets")} aria-expanded={panel === "targets"} disabled={busy || !ownRow} className={action}>
        Change sets and reps <span className="text-muted">(your plan)</span>
      </button>
      {!ownRow && <p className="text-xs text-muted">This exercise isn’t in this day’s plan, so there are no plan targets to change.</p>}
      {panel === "targets" && ownRow && (
        <div className="flex items-end gap-2">
          <label className="w-16">
            <span className="tag mb-1 block text-muted">Sets</span>
            <input inputMode="numeric" value={sets} onChange={(e) => setSets(e.target.value)} className={`${field} w-full`} />
          </label>
          <label className="min-w-0 flex-1">
            <span className="tag mb-1 block text-muted">Reps</span>
            <input value={reps} onChange={(e) => setReps(e.target.value)} className={`${field} w-full`} />
          </label>
          <button onClick={saveTargets} disabled={busy} className="tag inline-flex h-11 items-center rounded-xl bg-accent px-4 text-accent-ink disabled:opacity-50">
            {busy ? <InlineSpinner /> : "Save"}
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={() => void run(() => edits.onMove(-1), false)} disabled={busy || edits.first} className={action}>
          <ChevronIcon className="size-4 rotate-180 text-accent" /> Move up
        </button>
        <button onClick={() => void run(() => edits.onMove(1), false)} disabled={busy || edits.last} className={action}>
          <ChevronIcon className="size-4 text-accent" /> Move down
        </button>
      </div>

      {panel === "remove" ? (
        <div role="alertdialog" aria-label={`Remove ${ex.name}`} className="rounded-xl bg-bg p-3">
          <p className="text-sm">
            Remove {ex.name} from this workout?
            {logged > 0 && ` Its ${logged} logged ${logged === 1 ? "set" : "sets"} will be deleted.`}
            {alsoPlan && ownRow ? " It is also removed from your plan." : " Your plan stays as it is."}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => void run(() => edits.onRemove(alsoPlan && Boolean(ownRow)))}
              disabled={busy}
              className="tag inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-danger text-bg disabled:opacity-50"
            >
              {busy ? <InlineSpinner /> : "Remove"}
            </button>
            <button onClick={() => setPanel(null)} disabled={busy} className="tag h-11 rounded-xl border-2 border-line px-4">
              Keep
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => toggle("remove")} disabled={busy} className={`${action} text-danger`}>
          <CloseIcon className="size-4" /> Remove
        </button>
      )}

      {slot && (
        <label className="flex items-center gap-2 px-1 pt-1 text-sm">
          <input type="checkbox" checked={alsoPlan} onChange={(e) => setAlsoPlan(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          Also change my plan <span className="text-muted">(swap and remove)</span>
        </label>
      )}
    </div>
  );
}
