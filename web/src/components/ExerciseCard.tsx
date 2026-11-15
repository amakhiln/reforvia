"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BookIcon, CheckIcon, ChevronIcon, ExternalIcon, PlusIcon } from "./icons";
import { SetRow, type SetValues } from "./SetRow";
import { formatShortDate } from "@/lib/dates";
import { formatKg, placeholderForSet, suggestNext } from "@/lib/progression";
import type { PreviousSet, WorkoutExercise } from "@/lib/types";

type Props = {
  item: WorkoutExercise;
  previous: PreviousSet[];
  open: boolean;
  onToggleOpen: () => void;
  onLogSet: (setNumber: number, v: SetValues) => Promise<void>;
  onEditSet: (setNumber: number, v: SetValues) => Promise<void>;
  onUnlogSet: (setNumber: number) => Promise<void>;
  onRir: (rir: number | null) => Promise<void>;
  onToggleDone: () => Promise<void>;
  onNotes: (notes: string) => Promise<void>;
};

export function ExerciseCard(props: Props) {
  const { item, previous, open } = props;
  const planned = item.planned_exercises;
  const ex = item.exercises;
  const timed = planned?.is_timed ?? ex.is_timed;
  const timedUnit: "sec" | "min" = planned?.rep_target.toLowerCase().includes("min") ? "min" : "sec";
  const plannedSets = planned?.planned_sets ?? 3;

  const logsByNumber = useMemo(() => new Map(item.set_logs.map((s) => [s.set_number, s])), [item.set_logs]);
  const maxLogged = item.set_logs.reduce((m, s) => Math.max(m, s.set_number), 0);
  const [extra, setExtra] = useState(0);
  const rows = Math.max(plannedSets, maxLogged) + extra;
  const loggedCount = item.set_logs.length;

  const suggestion = useMemo(
    () =>
      suggestNext({
        plannedSets,
        repMin: planned?.rep_min ?? null,
        repMax: planned?.rep_max ?? null,
        previous: previous.map((p) => ({ load_kg: p.load_kg, reps: p.reps })),
      }),
    [plannedSets, planned?.rep_min, planned?.rep_max, previous],
  );

  const lastSummary = useMemo(() => {
    if (previous.length === 0) return null;
    const parts = previous.map((p) =>
      timed
        ? `${p.duration_sec ?? 0}s`
        : p.load_kg != null && p.load_kg > 0
          ? `${formatKg(Number(p.load_kg))}×${p.reps ?? 0}`
          : `${p.reps ?? 0} reps`,
    );
    return `${parts.join(" · ")} (${formatShortDate(previous[0].performed_on)})`;
  }, [previous, timed]);

  const done = item.completed;
  const targetLabel = planned ? `${planned.planned_sets} × ${planned.rep_target}` : "";

  return (
    <section
      className={`overflow-hidden rounded-2xl border bg-surface ${done ? "border-accent/40" : "border-line"}`}
      aria-label={ex.name}
    >
      <button
        onClick={props.onToggleOpen}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-4 text-left"
      >
        <span
          className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
            done ? "bg-accent text-accent-ink" : "border border-line text-transparent"
          }`}
        >
          <CheckIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold uppercase tracking-wide">{ex.name}</span>
          <span className="tag mt-1 block text-muted">
            {targetLabel}
            {planned?.per_side ? "" : ""} · {loggedCount}/{plannedSets} sets
          </span>
        </span>
        <ChevronIcon className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-line px-4 pb-4 pt-4">
          {(lastSummary || suggestion.kind !== "first") && (
            <div className="rounded-xl bg-accent-soft px-3.5 py-3 text-sm">
              {lastSummary && (
                <p className="text-muted">
                  <span className="font-medium text-ink">Last time:</span> {lastSummary}
                </p>
              )}
              {!timed && suggestion.kind !== "first" && (
                <p className={`${lastSummary ? "mt-1.5" : ""} font-medium text-accent`}>{suggestion.message}</p>
              )}
            </div>
          )}
          {!lastSummary && !timed && (
            <p className="text-sm text-muted">{suggestion.kind === "first" ? suggestion.message : ""}</p>
          )}

          <div>
            <div className="mb-2 flex items-center gap-2 pl-11 pr-14 tag text-muted">
              {timed ? (
                <span className="flex-1 text-center">{timedUnit === "min" ? "Minutes" : "Seconds"}{planned?.per_side ? " / side" : ""}</span>
              ) : (
                <>
                  <span className="flex-1 text-center">Kg</span>
                  <span className="flex-1 text-center">Reps{planned?.per_side ? " / side" : ""}</span>
                </>
              )}
            </div>
            <div className="space-y-2">
              {Array.from({ length: rows }, (_, i) => i + 1).map((n) => {
                const ph = timed
                  ? { load: null, reps: planned?.rep_min ?? null }
                  : placeholderForSet(
                      n,
                      suggestion,
                      previous.map((p) => ({ load_kg: p.load_kg, reps: p.reps })),
                    );
                return (
                  <SetRow
                    key={n}
                    setNumber={n}
                    log={logsByNumber.get(n)}
                    timed={timed}
                    timedUnit={timedUnit}
                    placeholder={ph}
                    onLog={(v) => props.onLogSet(n, v)}
                    onEditLogged={(v) => props.onEditSet(n, v)}
                    onUnlog={() => props.onUnlogSet(n)}
                  />
                );
              })}
            </div>
            {rows < 8 && (
              <button
                onClick={() => setExtra((e) => e + 1)}
                className="mt-3 flex items-center gap-1.5 text-sm font-medium text-accent"
              >
                <PlusIcon className="size-4" /> Add set
              </button>
            )}
          </div>

          {!timed && (
            <div>
              <p className="mb-2 tag text-muted">
                Reps in reserve (last set)
              </p>
              <div className="flex gap-2" role="group" aria-label="Reps in reserve">
                {[0, 1, 2, 3, 4].map((r) => (
                  <button
                    key={r}
                    onClick={() => props.onRir(item.rir_last_set === r ? null : r)}
                    aria-pressed={item.rir_last_set === r}
                    className={`h-10 flex-1 rounded-lg font-mono text-sm font-semibold ${
                      item.rir_last_set === r ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted"
                    }`}
                  >
                    {r === 4 ? "4+" : r}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted">Most sets should finish with 1–3 left in the tank.</p>
            </div>
          )}

          <NotesField initial={item.notes ?? ""} onSave={props.onNotes} />

          <details className="group rounded-xl border border-line">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-sm font-medium">
              <BookIcon className="size-4 text-accent" /> Form guide
              <ChevronIcon className="ml-auto size-4 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-3 border-t border-line px-3.5 py-3 text-sm">
              <GuideRow label="Main muscles" value={ex.main_muscles} />
              <GuideRow label="Purpose" value={ex.purpose} />
              <GuideRow label="How to" value={ex.form_instructions} />
              <GuideRow label="Avoid" value={ex.common_mistakes} />
              <GuideRow label="No equipment? Try" value={ex.alternatives} />
              {ex.video_url && (
                <a
                  href={ex.video_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-medium text-accent"
                >
                  Watch a demo <ExternalIcon className="size-4" />
                </a>
              )}
            </div>
          </details>

          <Link href={`/exercises/${ex.id}`} className="flex items-center justify-between rounded-xl border border-line px-3.5 py-3 text-sm font-medium">
            View progress
            <ChevronIcon className="-rotate-90 size-4 text-muted" />
          </Link>

          <button
            onClick={props.onToggleDone}
            className={`tag h-11 w-full rounded-xl ${
              done ? "bg-surface-2 text-ink" : "bg-accent text-accent-ink"
            }`}
          >
            {done ? "Mark as not done" : "Mark exercise done"}
          </button>
        </div>
      )}
    </section>
  );
}

function GuideRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="tag text-muted">{label}</p>
      <p className="mt-0.5 leading-relaxed">{value}</p>
    </div>
  );
}

function NotesField({ initial, onSave }: { initial: string; onSave: (v: string) => Promise<void> }) {
  const [value, setValue] = useState(initial);
  return (
    <label className="block">
      <span className="mb-1.5 block tag text-muted">Notes</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value !== initial && void onSave(value)}
        placeholder="Seat position, how it felt…"
        className="h-11 w-full rounded-xl border border-transparent bg-surface-2 px-3.5 text-base placeholder:text-muted/70"
      />
    </label>
  );
}
