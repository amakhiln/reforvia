/** How far through the week's plan you are: planned sessions finished, out of planned sessions.
 *  Optional sessions are extras and count toward neither, as in the weekly review. */
export function weekProgress(
  sessions: { id: string; is_optional: boolean }[],
  workouts: { session_id: string | null; finished_at: string | null }[],
): { done: number; total: number } {
  const planned = new Set(sessions.filter((s) => !s.is_optional).map((s) => s.id));
  const done = new Set(workouts.filter((w) => w.finished_at && w.session_id && planned.has(w.session_id)).map((w) => w.session_id));
  return { done: done.size, total: planned.size };
}
