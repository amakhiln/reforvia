import test from "node:test";
import assert from "node:assert/strict";
import { hasRecord, insertedAfter, moved, planSlot, resequence, swapSource, type PlanRow } from "./workoutEdit.ts";

const row = (id: string, session_id: string, exercise_id: string, extra: Partial<PlanRow> = {}): PlanRow => ({
  id, session_id, exercise_id, planned_sets: 3, rep_target: "8–12", rep_min: 8, rep_max: 12, per_side: false, is_timed: false, ...extra,
});
const current = row("slot", "mon", "pulldown");

test("a swap takes sets and reps from the new exercise's own plan entry, this session first", () => {
  const rows = [row("thu-row", "thu", "dbrow"), row("mon-row", "mon", "dbrow")];
  assert.equal(swapSource({ id: "dbrow", is_timed: false }, rows, current, "mon")?.id, "mon-row");
  assert.equal(swapSource({ id: "dbrow", is_timed: false }, rows.slice(0, 1), current, "mon")?.id, "thu-row");
});

test("otherwise it keeps the replaced exercise's targets, unless timed and rep-based differ", () => {
  assert.equal(swapSource({ id: "pullup", is_timed: false }, [], current, "mon")?.id, "slot");
  assert.equal(swapSource({ id: "plank", is_timed: true }, [], current, "mon"), null);
  assert.equal(swapSource({ id: "pullup", is_timed: false }, [], null, "mon"), null);
});

test("only a plan row of this session is a slot that can be changed", () => {
  assert.equal(planSlot(current, "mon")?.id, "slot");
  assert.equal(planSlot(current, "thu"), null);
  assert.equal(planSlot(current, null), null);
  assert.equal(planSlot(null, "mon"), null);
});

test("anything the user recorded keeps the old exercise", () => {
  const clean = { set_logs: [], notes: null, rir_last_set: null };
  assert.equal(hasRecord(clean), false);
  assert.equal(hasRecord({ ...clean, set_logs: [{}] }), true);
  assert.equal(hasRecord({ ...clean, notes: "seat 4" }), true);
  assert.equal(hasRecord({ ...clean, rir_last_set: 0 }), true);
});

const list = [{ id: "a", sort_order: 0 }, { id: "b", sort_order: 1 }, { id: "c", sort_order: 2 }];

test("moving swaps neighbours and renumbers only what changed", () => {
  assert.deepEqual(resequence(moved(list, "c", -1)!), [{ id: "c", sort_order: 1 }, { id: "b", sort_order: 2 }]);
  assert.equal(moved(list, "a", -1), null);
  assert.equal(moved(list, "c", 1), null);
});

test("moving still works when two rows share a number", () => {
  const tied = [{ id: "a", sort_order: 0 }, { id: "b", sort_order: 0 }];
  assert.deepEqual(resequence(moved(tied, "b", -1)!), [{ id: "a", sort_order: 1 }]);
});

test("a new exercise goes right after the one it replaces", () => {
  const out = insertedAfter(list, "a", { id: "n", sort_order: 1 });
  assert.deepEqual(out.map((r) => r.id), ["a", "n", "b", "c"]);
  assert.deepEqual(resequence(out), [{ id: "b", sort_order: 2 }, { id: "c", sort_order: 3 }]);
});
