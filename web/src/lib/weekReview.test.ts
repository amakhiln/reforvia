import assert from "node:assert/strict";
import test from "node:test";
import { weekCells, wins } from "./weekReview.ts";

test("week cells tell trained, extra, missed and rest days apart", () => {
  const states = weekCells([1, 2, 6], [1, 2, 4]).map((c) => c.state);
  assert.deepEqual(states, ["trained", "trained", "rest", "missed", "rest", "extra", "rest"]);
});

test("a session moved to another day does not mark its usual day as skipped", () => {
  // planned Mon, Tue, Thu; Tuesday's session was done on Monday, Thursday was really skipped
  const states = weekCells([1, 3], [1, 2, 4], [4]).map((c) => c.state);
  assert.deepEqual(states, ["trained", "rest", "extra", "missed", "rest", "rest", "rest"]);
  assert.equal(weekCells([1], [1, 2], [])[1].state, "rest"); // nothing missed at all
});

test("wins list new bests first, then heavier loads, without repeating a lift", () => {
  const lift = (exercise: string, o: object) => ({ exercise, top_load_kg: 50, best_e1rm_kg: null, prior_best_e1rm_kg: null, last_week_top_load_kg: null, new_best: false, ...o });
  const out = wins([
    lift("Row", { top_load_kg: 60, last_week_top_load_kg: 55 }),
    lift("Lat pulldown", { new_best: true, best_e1rm_kg: 84, prior_best_e1rm_kg: 80, top_load_kg: 62, last_week_top_load_kg: 60 }),
    lift("Curl", { top_load_kg: 10, last_week_top_load_kg: 10 }),
  ]);
  assert.deepEqual(out.map((w) => [w.exercise, w.from, w.to]), [["Lat pulldown", 80, 84], ["Row", 55, 60]]);
});

test("old reviews with no lifts have no wins", () => {
  assert.deepEqual(wins(undefined), []);
});
