/** Parses a rep target the way scripts/generate_seed.py does: '8–12', '10–15 / side', '30–45 sec'. */
export function parseRepTarget(text: string) {
  const nums = (text.match(/\d+/g) ?? []).map(Number);
  if (nums.length === 0) return null;
  const rep_min = nums[0];
  const rep_max = nums[1] ?? nums[0];
  if (rep_max < rep_min || rep_max > 999) return null;
  const lower = text.toLowerCase();
  return { rep_min, rep_max, per_side: lower.includes("side"), is_timed: /sec|min/.test(lower) };
}

export const defaultRep = (timed: boolean) =>
  timed ? { rep_target: "30–45 sec", rep_min: 30, rep_max: 45 } : { rep_target: "8–12", rep_min: 8, rep_max: 12 };

/** What to save when swapping a plan row's exercise: keep sets and reps, unless timed and untimed are being swapped. */
export function replacementPatch(current: { is_timed: boolean }, next: { id: string; is_timed: boolean }) {
  if (next.is_timed === current.is_timed) return { exercise_id: next.id };
  return { exercise_id: next.id, is_timed: next.is_timed, per_side: false, ...defaultRep(next.is_timed) };
}
