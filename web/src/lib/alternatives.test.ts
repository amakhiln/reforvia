import test from "node:test";
import assert from "node:assert/strict";
import { muscleGroups, suggestAlternatives, type Ex } from "./alternatives.ts";

const ex = (id: string, name: string, main_muscles: string, extra: Partial<Ex> = {}): Ex => ({ id, name, main_muscles, is_timed: false, ...extra });

test("anatomical and broad muscle names map to the same groups, primary first", () => {
  assert.deepEqual(muscleGroups("Latissimus dorsi; biceps; upper-back stabilisers"), ["lats", "biceps", "back"]);
  assert.deepEqual(muscleGroups("Lats, Biceps"), ["lats", "biceps"]);
  assert.deepEqual(muscleGroups("Rhomboids, mid traps, lats; rear delts; biceps"), ["back", "lats", "shoulders", "biceps"]);
  assert.deepEqual(muscleGroups(null), []);
});

const lat = ex("1", "Lat pulldown", "Latissimus dorsi; biceps; upper-back stabilisers", { source: "curated" });
const pool: Ex[] = [
  lat,
  ex("2", "Medium-wide overhand lat pulldown", "Lats; teres major; biceps", { source: "curated" }),
  ex("3", "Close-grip Lat Pull Down", "Lats, Biceps", { source: "wger", media_count: 2, equipment: "Cable machine" }),
  ex("4", "Seated Cable Row", "Lats, Trapezius", { source: "wger", media_count: 2, equipment: "Cable machine" }),
  ex("5", "Hammer Curls", "Biceps", { source: "wger", media_count: 2 }),
  ex("6", "Barbell Squat", "Quads, Glutes", { source: "wger", media_count: 1 }),
];

test("same movement and muscle rank first; the exercise itself and taken ones are skipped", () => {
  const out = suggestAlternatives(lat, pool, ["4"]);
  assert.deepEqual(out.slice(0, 2).map((e) => e.id).sort(), ["2", "3"]);
  assert.ok(!out.some((e) => e.id === "1" || e.id === "4"));
});

test("returns at least three whenever the pool has them, even if the match is weak", () => {
  assert.equal(suggestAlternatives(lat, pool).length, 4);
  assert.equal(suggestAlternatives(ex("9", "Moderate cardio", "Cardiorespiratory system", { is_timed: true }), pool, [], 3).length, 3);
});

test("a candidate's main muscle beats one that only touches it, and rear/pec deck match reverse fly", () => {
  const rev = ex("1", "Reverse pec deck", "Rear deltoids; mid traps; rhomboids", { source: "curated" });
  const out = suggestAlternatives(rev, [
    rev,
    ex("2", "Machine chest press", "Pectoralis major; anterior deltoids", { source: "curated" }),
    ex("3", "Cable Rear Delt Fly", "Shoulders", { source: "wger", media_count: 1 }),
  ]);
  assert.equal(out[0].id, "3");
});

test("when equipment is missing, other equipment for the same muscle comes first", () => {
  const out = suggestAlternatives(
    lat, // no equipment listed: "pulldown" implies cable
    [lat, ex("c", "Close-grip cable lat pulldown", "Lats, Biceps"), ex("p", "Pull-up", "Lats, Biceps"), ex("d", "Dumbbell curl", "Biceps")],
    [],
    4,
    true,
  );
  assert.deepEqual(out.map((e) => e.id), ["p", "c", "d"]);
});
