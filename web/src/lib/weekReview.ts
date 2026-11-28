import type { WeeklySummary } from "@/lib/types";

type Stats = WeeklySummary["stats"];

export type DayState = "trained" | "extra" | "missed" | "rest";

/** Monday to Sunday: trained on a planned day, trained on an unplanned day, planned but skipped, or rest.
 *  `missed` is the planned days really skipped (a session moved to another day is not a miss); older reviews lack it. */
export function weekCells(trained: number[] = [], planned: number[] = [], missed: number[] = planned): { day: number; state: DayState }[] {
  return [1, 2, 3, 4, 5, 6, 7].map((day) => ({
    day,
    state: trained.includes(day) ? (planned.includes(day) ? "trained" : "extra") : missed.includes(day) ? "missed" : "rest",
  }));
}

export type Win = { exercise: string; label: string; from: number; to: number; unit: string };

/** Lifts that beat their old estimated 1RM, then lifts that went heavier than last week. */
export function wins(lifts: Stats["lifts"] = [], max = 4): Win[] {
  const out: Win[] = [];
  for (const l of lifts) {
    if (l.new_best && l.best_e1rm_kg != null && l.prior_best_e1rm_kg != null) {
      out.push({ exercise: l.exercise, label: "Estimated 1RM", from: l.prior_best_e1rm_kg, to: l.best_e1rm_kg, unit: "kg" });
    }
  }
  for (const l of lifts) {
    const already = out.some((w) => w.exercise === l.exercise);
    if (!already && l.top_load_kg != null && l.last_week_top_load_kg != null && l.top_load_kg > l.last_week_top_load_kg) {
      out.push({ exercise: l.exercise, label: "Top load", from: l.last_week_top_load_kg, to: l.top_load_kg, unit: "kg" });
    }
  }
  return out.slice(0, max);
}
