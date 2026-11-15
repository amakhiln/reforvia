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
