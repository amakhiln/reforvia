import test from "node:test";
import assert from "node:assert/strict";
import { barPath, estimateOneRepMax, formatCompact, nearestIndex, niceRange, niceTicks } from "./chartMath.ts";

test("niceTicks start at zero and cover the max", () => {
  const t = niceTicks(1147.5);
  assert.equal(t[0], 0);
  assert.ok(t[t.length - 1] >= 1147.5);
  assert.deepEqual(niceTicks(0), [0, 1]);
});

test("niceTicks uses clean steps", () => {
  assert.deepEqual(niceTicks(100, 4), [0, 25, 50, 75, 100]);
  assert.deepEqual(niceTicks(9, 3), [0, 5, 10]); // steps are 1, 2, 2.5, 5 or 10 x a power of ten
});

test("niceRange handles flat data and brackets the range", () => {
  const flat = niceRange(40, 40);
  assert.ok(flat[0] < 40 && flat[flat.length - 1] > 40);
  const r = niceRange(35, 42.5);
  assert.ok(r[0] <= 35 && r[r.length - 1] >= 42.5);
});

test("formatCompact", () => {
  assert.equal(formatCompact(945), "945");
  assert.equal(formatCompact(9999), "9,999");
  assert.equal(formatCompact(12400), "12.4k");
  assert.equal(formatCompact(120000), "120k");
});

test("estimateOneRepMax follows Epley and ignores high reps", () => {
  assert.equal(estimateOneRepMax(40, 10), 53.3);
  assert.equal(estimateOneRepMax(100, 1), 103.3);
  assert.equal(estimateOneRepMax(40, 15), null);
  assert.equal(estimateOneRepMax(null, 10), null);
  assert.equal(estimateOneRepMax(0, 10), null);
});

test("nearestIndex snaps to the closest x", () => {
  assert.equal(nearestIndex([0, 10, 50], 12), 1);
  assert.equal(nearestIndex([0, 10, 50], 40), 2);
});

test("barPath is empty for zero height and closed otherwise", () => {
  assert.equal(barPath(0, 0, 10, 0), "");
  assert.ok(barPath(0, 0, 10, 20).endsWith("Z"));
});
