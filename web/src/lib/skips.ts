export type SkipReason = "rest" | "sick" | "injury" | "busy" | "travel";
export type Skip = { id: string; session_id: string | null; session_name: string; skipped_on: string; reason: SkipReason | null };

export const SKIP_REASONS: { id: SkipReason; label: string }[] = [
  { id: "rest", label: "Rest" },
  { id: "busy", label: "Busy" },
  { id: "sick", label: "Sick" },
  { id: "injury", label: "Injury" },
  { id: "travel", label: "Travel" },
];

export const reasonLabel = (r: SkipReason | null | undefined) => SKIP_REASONS.find((x) => x.id === r)?.label ?? null;

/** The date (yyyy-mm-dd) of an ISO weekday (1 = Monday) in the week that starts on `monday`. */
export function dateInWeek(monday: string, dayOfWeek: number): string {
  const [y, m, d] = monday.split("-").map(Number);
  const date = new Date(y, m - 1, d + dayOfWeek - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** This week's skip mark for a session. A mark that lost its link (the plan was reset) is matched by name. */
export function skipFor(skips: Skip[], session: { id: string; name: string }): Skip | undefined {
  return skips.find((s) => s.session_id === session.id || (s.session_id === null && s.session_name === session.name));
}
