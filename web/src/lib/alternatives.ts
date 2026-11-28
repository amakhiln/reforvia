/** Ranks library exercises as alternatives to one exercise: same muscle, same movement, same equipment. No imports, so it is unit-testable. */

export type Ex = {
  id: string;
  name: string;
  main_muscles: string | null;
  equipment?: string | null;
  is_timed: boolean;
  source?: string;
  media_count?: number;
};

// Your original exercises name muscles anatomically ("Latissimus dorsi"); wger uses broad groups ("Lats"). Both map to one group.
const GROUPS: { group: string; match: RegExp; terms: string[] }[] = [
  { group: "lats", match: /\blats?\b|latissimus|teres/i, terms: ["lats", "latissimus", "teres"] },
  { group: "chest", match: /chest|pector/i, terms: ["chest", "pector"] },
  { group: "shoulders", match: /shoulder|delt/i, terms: ["shoulder", "delt"] },
  { group: "biceps", match: /bicep|brachialis|brachioradialis/i, terms: ["bicep", "brachialis"] },
  { group: "triceps", match: /tricep/i, terms: ["tricep"] },
  { group: "quads", match: /quad/i, terms: ["quad"] },
  { group: "hamstrings", match: /hamstring/i, terms: ["hamstring"] },
  { group: "glutes", match: /glute/i, terms: ["glute"] },
  { group: "calves", match: /calves|calf|gastrocnemius|soleus/i, terms: ["calves", "calf", "gastrocnemius", "soleus"] },
  { group: "abs", match: /\babs\b|abdominis|oblique/i, terms: ["abs", "abdominis", "oblique"] },
  { group: "back", match: /trapez|\btraps?\b|rhomboid|erector|spinal|\bback\b/i, terms: ["trapez", "rhomboid", "erector"] },
  { group: "cardio", match: /cardio/i, terms: ["cardio"] },
];

const MOVES = ["curl", "pulldown", "pullup", "raise", "press", "row", "extension", "pushdown", "crunch", "fly", "deadlift", "squat", "lunge", "plank", "calf", "shrug", "kickback", "dip", "thrust", "bridge", "twist", "pullover", "face", "hammer", "incline", "decline", "overhead", "lateral", "reverse", "romanian", "sumo"];

const EQUIPMENT: [string, RegExp][] = [
  ["cable", /cable/i],
  ["dumbbell", /dumbbell/i],
  ["barbell", /barbell|ez.?bar/i],
  ["machine", /machine|smith|pec deck|hammerstrength|leg press|leg curl/i],
  ["band", /\bband/i],
  ["kettlebell", /kettlebell/i],
  ["bodyweight", /bodyweight|body weight|none \(/i],
];

/** Muscle groups in the order the text mentions them; the first is the primary one. */
export function muscleGroups(text: string | null): string[] {
  if (!text) return [];
  return GROUPS.map((g) => ({ g: g.group, at: text.search(g.match) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.g);
}

/** Search terms for the database filter that find every exercise of a muscle group. */
export const groupTerms = (group: string) => GROUPS.find((g) => g.group === group)?.terms ?? [];

const kinds = (ex: Ex) => {
  const text = `${ex.name} ${ex.equipment ?? ""}`;
  const found = EQUIPMENT.filter(([, re]) => re.test(text)).map(([k]) => k);
  // "Lat pulldown" and "Rope triceps pushdown" name no equipment, but need a cable.
  return found.length === 0 && /pull[\s-]?down|push[\s-]?down/i.test(text) ? ["cable"] : found;
};

const moves = (name: string) => {
  const t = name.toLowerCase().replace(/pull[\s-]?down/g, "pulldown").replace(/push[\s-]?down/g, "pushdown").replace(/pull[\s-]?up/g, "pullup").replace(/pec[\s-]?deck/g, "fly").replace(/\brear\b/g, "reverse");
  return MOVES.filter((m) => new RegExp(`\\b${m}`).test(t));
};

// Other distinctive words in the name ("shoulder", "triceps", "romanian"); equipment and filler words are scored elsewhere.
const FILLER = new Set(["seated", "standing", "single", "alternating", "medium", "wide", "grip", "close", "neutral", "using", "with", "machine", "cable", "dumbbell", "dumbbells", "barbell", "bench", "custom", "exercise"]);
const words = (name: string) => [...new Set(name.toLowerCase().match(/[a-z]{5,}/g) ?? [])].filter((w) => !FILLER.has(w));

const shared = (a: string[], b: string[]) => a.filter((x) => b.includes(x)).length;

export function score(cur: Ex, c: Ex): number {
  const cg = muscleGroups(cur.main_muscles);
  const kg = muscleGroups(c.main_muscles);
  let s = 0;
  if (cg[0] && cg[0] === kg[0]) s += 5; // same main muscle
  else if (cg[0] && kg.includes(cg[0])) s += 2; // trains it as a secondary
  s += Math.min(2, shared(cg.slice(1), kg));
  s += Math.min(2, shared(moves(cur.name), moves(c.name))) * 3;
  s += Math.min(2, shared(words(cur.name), words(c.name))) * 2;
  if (shared(kinds(cur), kinds(c)) > 0) s += 2;
  if (cur.is_timed === c.is_timed) s += 1;
  if ((c.media_count ?? 0) > 0) s += 1;
  if (c.source !== "wger") s += 1; // your own exercises first
  return s;
}

/**
 * Best alternatives first; never the exercise itself or ones already in the session. Always returns up to `n` when the pool has them.
 * `otherKit` is for missing equipment: among exercises for the same main muscle, ones needing something else come first.
 */
export function suggestAlternatives(cur: Ex, pool: Ex[], taken: string[] = [], n = 4, otherKit = false): Ex[] {
  const skip = new Set([cur.id, ...taken]);
  const main = muscleGroups(cur.main_muscles)[0];
  const tier = (c: Ex) => {
    if (!otherKit) return 0;
    if (muscleGroups(c.main_muscles)[0] !== main) return 0;
    return shared(kinds(cur), kinds(c)) > 0 ? 1 : 2;
  };
  return pool
    .filter((c) => !skip.has(c.id))
    .map((c) => ({ c, t: tier(c), s: score(cur, c) }))
    .sort((a, b) => b.t - a.t || b.s - a.s || a.c.name.localeCompare(b.c.name))
    .slice(0, n)
    .map((x) => x.c);
}
