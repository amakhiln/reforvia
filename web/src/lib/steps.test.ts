import assert from "node:assert/strict";
import test from "node:test";
import { groupSteps } from "./steps.ts";

test("repeated steps become one chip with a count, in order of first use", () => {
  const steps = [
    { id: "1", label: "Searching foods", done: true },
    { id: "2", label: "Calculating the portion", done: true },
    { id: "3", label: "Searching foods", done: true },
    { id: "4", label: "Searching foods", done: false },
  ];
  assert.deepEqual(groupSteps(steps), [
    { label: "Searching foods", count: 3, done: false }, // one is still running
    { label: "Calculating the portion", count: 1, done: true },
  ]);
});

test("no steps gives no chips", () => {
  assert.deepEqual(groupSteps([]), []);
});
