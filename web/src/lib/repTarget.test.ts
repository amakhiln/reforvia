import test from "node:test";
import assert from "node:assert/strict";
import { parseRepTarget, replacementPatch, parseSetsReps } from "./repTarget.ts";

test("parses ranges, single numbers, per-side and timed targets", () => {
  assert.deepEqual(parseRepTarget("8–12"), { rep_min: 8, rep_max: 12, per_side: false, is_timed: false });
  assert.deepEqual(parseRepTarget("8-12"), { rep_min: 8, rep_max: 12, per_side: false, is_timed: false });
  assert.deepEqual(parseRepTarget("10"), { rep_min: 10, rep_max: 10, per_side: false, is_timed: false });
  assert.deepEqual(parseRepTarget("10–15 / side"), { rep_min: 10, rep_max: 15, per_side: true, is_timed: false });
  assert.deepEqual(parseRepTarget("30–45 sec / side"), { rep_min: 30, rep_max: 45, per_side: true, is_timed: true });
  assert.deepEqual(parseRepTarget("25–35 min"), { rep_min: 25, rep_max: 35, per_side: false, is_timed: true });
});

test("rejects targets with no number or a backwards range", () => {
  assert.equal(parseRepTarget(""), null);
  assert.equal(parseRepTarget("max"), null);
  assert.equal(parseRepTarget("12–8"), null);
});

test("swapping like for like keeps sets and reps; timed and untimed resets the target", () => {
  assert.deepEqual(replacementPatch({ is_timed: false }, { id: "x", is_timed: false }), { exercise_id: "x" });
  assert.deepEqual(replacementPatch({ is_timed: true }, { id: "x", is_timed: false }), {
    exercise_id: "x", is_timed: false, per_side: false, rep_target: "8–12", rep_min: 8, rep_max: 12,
  });
  assert.deepEqual(replacementPatch({ is_timed: false }, { id: "y", is_timed: true }), {
    exercise_id: "y", is_timed: true, per_side: false, rep_target: "30–45 sec", rep_min: 30, rep_max: 45,
  });
});

test("a sets and reps edit is accepted only with 1 to 10 sets and a number of reps", () => {
  assert.deepEqual(parseSetsReps("4", " 6–10 / side "), { planned_sets: 4, rep_target: "6–10 / side", rep_min: 6, rep_max: 10, per_side: true, is_timed: false });
  assert.equal(parseSetsReps("0", "8"), null);
  assert.equal(parseSetsReps("11", "8"), null);
  assert.equal(parseSetsReps("2.5", "8"), null);
  assert.equal(parseSetsReps("3", "lots"), null);
});
