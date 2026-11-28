/** Rules for editing a workout while logging it: which targets a swap takes, and how rows are reordered. No imports, so it is unit-testable. */

export type PlanRow = {
  id: string;
  session_id: string;
  exercise_id: string;
  planned_sets: number;
  rep_target: string;
  rep_min: number | null;
  rep_max: number | null;
  per_side: boolean;
  is_timed: boolean;
};

/**
 * The plan row a swapped-in exercise takes its sets and reps from: its own entry in the plan (this session first),
 * otherwise the replaced exercise's. Null means default targets.
 */
export function swapSource<T extends PlanRow>(next: { id: string; is_timed: boolean }, nextRows: T[], current: T | null, sessionId: string | null): T | null {
  const own = nextRows.find((r) => r.session_id === sessionId) ?? nextRows[0];
  if (own) return own;
  return current && current.is_timed === next.is_timed ? current : null;
}

/** The row of this session's plan that today's exercise stands in, if any: the only row an edit here may change. */
export function planSlot<T extends { session_id: string }>(planned: T | null, sessionId: string | null): T | null {
  return planned && planned.session_id === sessionId ? planned : null;
}

/** Whether the user recorded anything on this exercise, which a swap must not move onto another one. */
export function hasRecord(item: { set_logs: unknown[]; notes: string | null; rir_last_set: number | null }): boolean {
  return item.set_logs.length > 0 || Boolean(item.notes) || item.rir_last_set != null;
}

type Ordered = { id: string; sort_order: number };

/** The list with one row moved up (-1) or down (1), or null if it is already at that end. */
export function moved<T extends Ordered>(list: T[], id: string, dir: -1 | 1): T[] | null {
  const from = list.findIndex((r) => r.id === id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= list.length) return null;
  const out = [...list];
  [out[from], out[to]] = [out[to], out[from]];
  return out;
}

export function insertedAfter<T extends Ordered>(list: T[], afterId: string, row: T): T[] {
  const at = list.findIndex((r) => r.id === afterId) + 1;
  return [...list.slice(0, at), row, ...list.slice(at)];
}

/** Number the rows in the order given; returns only the ones whose number has to change. */
export function resequence(ordered: Ordered[]): Ordered[] {
  return ordered.flatMap((r, i) => (r.sort_order === i ? [] : [{ id: r.id, sort_order: i }]));
}
