import test from "node:test";
import assert from "node:assert/strict";
import { parseRepTarget } from "./repTarget.ts";

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
