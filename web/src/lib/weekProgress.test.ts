import assert from "node:assert/strict";
import test from "node:test";
import { weekProgress } from "./weekProgress.ts";

const sessions = [
  { id: "pull", is_optional: false },
  { id: "push", is_optional: false },
  { id: "arms", is_optional: true },
];
const w = (session_id: string | null, finished = true) => ({ session_id, finished_at: finished ? "2026-11-28T10:00:00Z" : null });

test("an optional session never counts toward the week's plan", () => {
  assert.deepEqual(weekProgress(sessions, [w("pull"), w("arms")]), { done: 1, total: 2 });
  assert.deepEqual(weekProgress(sessions, [w("pull"), w("push"), w("arms")]), { done: 2, total: 2 }); // never 3 of 2
});

test("repeats count once, and unfinished or unlinked workouts do not count", () => {
  assert.deepEqual(weekProgress(sessions, [w("pull"), w("pull"), w("push", false), w(null)]), { done: 1, total: 2 });
  assert.deepEqual(weekProgress([], []), { done: 0, total: 0 });
});
