/**
 * Double progression, exactly as the workbook describes it:
 * keep the same load until every planned set reaches the top of the rep range,
 * then increase the load by the smallest practical step and start again at the bottom of the range.
 */

export type PrevSet = { load_kg: number | null; reps: number | null };

export type Suggestion =
  | { kind: "first"; message: string; range: [number, number] | null }
  | { kind: "increase"; loadKg: number; reps: number; message: string }
  | { kind: "hold"; loadKg: number | null; reps: number; message: string };

/** Smallest practical jump for typical gym equipment. Tune per user later. */
export function loadIncrement(loadKg: number): number {
  if (loadKg < 10) return 1;
  if (loadKg < 50) return 2.5;
  return 5;
}

export function formatKg(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function suggestNext(args: {
  plannedSets: number;
  repMin: number | null;
  repMax: number | null;
  previous: PrevSet[];
}): Suggestion {
  const { plannedSets, repMin, repMax } = args;
  const prev = args.previous.filter((s) => s.reps != null);

  if (prev.length === 0 || repMax == null || repMin == null) {
    const range: [number, number] | null = repMin == null || repMax == null ? null : [repMin, repMax];
    return { kind: "first", range, message: "No history yet. Pick a load you can control for the lower end of the range; later sets follow what you log." };
  }

  const topLoad = Math.max(...prev.map((s) => s.load_kg ?? 0));
  const working = prev.filter((s) => (s.load_kg ?? 0) === topLoad);
  const hitTopOnAllSets = working.length >= plannedSets && working.every((s) => (s.reps ?? 0) >= repMax);

  if (hitTopOnAllSets) {
    const next = Math.round((topLoad + loadIncrement(topLoad)) * 100) / 100;
    return {
      kind: "increase",
      loadKg: next,
      reps: repMin,
      message: `You hit ${repMax} reps on every set at ${formatKg(topLoad)} kg. Go up to ${formatKg(next)} kg and aim for ${repMin}+.`,
    };
  }

  const lowest = Math.min(...working.map((s) => s.reps ?? 0));
  const target = Math.max(repMin, Math.min(repMax, lowest + 1)); // history can come from another rep range
  const below = lowest + 1 < repMin;
  return {
    kind: "hold",
    loadKg: topLoad > 0 ? topLoad : null,
    reps: target,
    message: below
      ? `Last time was ${lowest} reps${topLoad > 0 ? ` at ${formatKg(topLoad)} kg` : ""}. Aim for ${repMin} to ${repMax}${topLoad > 0 ? `, and go lighter if you can’t reach ${repMin}` : ""}.`
      : topLoad > 0
        ? `Stay at ${formatKg(topLoad)} kg and aim for ${target} reps on every set. Reach ${repMax} on all sets to move up.`
        : `Aim for ${target} reps on every set. Reach ${repMax} on all sets to add load.`,
  };
}

/** With no history: what the next set should look like, judged from one just logged against the rep range. */
function nextFromSet(last: PrevSet, repMin: number, repMax: number): { load: number | null; reps: number } {
  const reps = last.reps ?? repMin;
  const load = Number(last.load_kg ?? 0);
  if (load <= 0) return { load: null, reps: Math.max(repMin, Math.min(repMax, reps)) };
  if (reps > repMax) return { load: load + loadIncrement(load), reps: repMin };
  if (reps >= repMin) return { load, reps };
  const lighter = load - loadIncrement(load);
  return { load: lighter > 0 ? lighter : load, reps: repMin };
}

/** What to pre-show (as placeholder) in a set row before the user types anything. */
export function placeholderForSet(
  setNumber: number,
  suggestion: Suggestion,
  previous: PrevSet[],
  today: (PrevSet & { set_number: number })[] = [],
): { load: number | null; reps: number | null } {
  if (suggestion.kind === "first") {
    const last = today.filter((s) => s.set_number < setNumber && s.reps != null).at(-1);
    return last && suggestion.range ? nextFromSet(last, ...suggestion.range) : { load: null, reps: null };
  }
  if (suggestion.kind === "increase") return { load: suggestion.loadKg, reps: suggestion.reps };
  const same = previous[setNumber - 1] ?? previous[previous.length - 1];
  return { load: same?.load_kg ?? suggestion.loadKg, reps: suggestion.reps };
}

/** Rest defaults from the workbook: heavier/lower-rep work rests longer. */
export function defaultRestSeconds(repMin: number | null, repMax: number | null, isTimed: boolean): number {
  if (isTimed) return 45;
  if (repMax == null) return 75;
  if (repMax <= 10) return 120;
  if (repMax <= 12) return 90;
  return 60;
}
