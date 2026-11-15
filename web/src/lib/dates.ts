/** Local calendar date as yyyy-mm-dd (not UTC, so late-night workouts land on the right day). */
export function localISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 1 = Monday … 7 = Sunday */
export function isoWeekday(d = new Date()): number {
  return ((d.getDay() + 6) % 7) + 1;
}

export function startOfWeekISO(d = new Date()): string {
  const copy = new Date(d);
  copy.setDate(d.getDate() - (isoWeekday(d) - 1));
  return localISO(copy);
}

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}
