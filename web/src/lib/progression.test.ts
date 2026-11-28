import test from "node:test";
import assert from "node:assert/strict";
import { defaultRestSeconds, loadIncrement, placeholderForSet, suggestNext } from "./progression.ts";

test("no history gives a first-time suggestion", () => {
  const s = suggestNext({ plannedSets: 3, repMin: 8, repMax: 12, previous: [] });
  assert.equal(s.kind, "first");
});

test("top of range on all planned sets increases load and resets reps", () => {
  const previous = [40, 40, 40].map((l) => ({ load_kg: l, reps: 12 }));
  const s = suggestNext({ plannedSets: 3, repMin: 8, repMax: 12, previous });
  assert.equal(s.kind, "increase");
  if (s.kind === "increase") {
    assert.equal(s.loadKg, 42.5);
    assert.equal(s.reps, 8);
  }
});

test("one set short of the top keeps the load", () => {
  const previous = [
    { load_kg: 40, reps: 12 },
    { load_kg: 40, reps: 12 },
    { load_kg: 40, reps: 10 },
  ];
  const s = suggestNext({ plannedSets: 3, repMin: 8, repMax: 12, previous });
  assert.equal(s.kind, "hold");
  if (s.kind === "hold") {
    assert.equal(s.loadKg, 40);
    assert.equal(s.reps, 11);
  }
});

test("fewer sets logged than planned never triggers an increase", () => {
  const previous = [
    { load_kg: 40, reps: 12 },
    { load_kg: 40, reps: 12 },
  ];
  assert.equal(suggestNext({ plannedSets: 3, repMin: 8, repMax: 12, previous }).kind, "hold");
});

test("only sets at the top load count towards progression", () => {
  const previous = [
    { load_kg: 30, reps: 12 },
    { load_kg: 40, reps: 12 },
    { load_kg: 40, reps: 12 },
  ];
  // only two sets at 40 kg for a 3-set plan -> hold
  assert.equal(suggestNext({ plannedSets: 3, repMin: 8, repMax: 12, previous }).kind, "hold");
});

test("increments scale with load", () => {
  assert.equal(loadIncrement(5), 1);
  assert.equal(loadIncrement(20), 2.5);
  assert.equal(loadIncrement(100), 5);
});

test("placeholder for an increase uses new load at bottom of range", () => {
  const previous = [{ load_kg: 40, reps: 12 }];
  const s = suggestNext({ plannedSets: 1, repMin: 8, repMax: 12, previous });
  assert.deepEqual(placeholderForSet(1, s, previous), { load: 42.5, reps: 8 });
});

test("rest defaults follow rep range", () => {
  assert.equal(defaultRestSeconds(6, 10, false), 120);
  assert.equal(defaultRestSeconds(8, 12, false), 90);
  assert.equal(defaultRestSeconds(12, 20, false), 60);
  assert.equal(defaultRestSeconds(30, 45, true), 45);
});

test("after a session below the range, the target is the bottom of the range, with advice to go lighter", () => {
  const s = suggestNext({ plannedSets: 3, repMin: 10, repMax: 15, previous: [{ load_kg: 20, reps: 6 }] });
  assert.equal(s.kind, "hold");
  if (s.kind === "hold") {
    assert.equal(s.reps, 10);
    assert.match(s.message, /lighter/);
  }
});

test("with no history, the next set follows the set just logged", () => {
  const first = suggestNext({ plannedSets: 3, repMin: 8, repMax: 12, previous: [] });
  const next = (load_kg: number | null, reps: number) => placeholderForSet(2, first, [], [{ set_number: 1, load_kg, reps }]);
  assert.deepEqual(next(20, 15), { load: 22.5, reps: 8 }); // above the range: one step up
  assert.deepEqual(next(20, 5), { load: 17.5, reps: 8 }); // below: one step down
  assert.deepEqual(next(20, 10), { load: 20, reps: 10 });
  assert.deepEqual(next(1, 3), { load: 1, reps: 8 }); // never down to nothing
  assert.deepEqual(next(null, 15), { load: null, reps: 12 }); // bodyweight
});

test("with no history, the first set has no suggested weight", () => {
  const first = suggestNext({ plannedSets: 3, repMin: 8, repMax: 12, previous: [] });
  assert.deepEqual(placeholderForSet(1, first, [], [{ set_number: 2, load_kg: 20, reps: 10 }]), { load: null, reps: null });
});
