import assert from "node:assert/strict";
import test from "node:test";
import { dateInWeek, reasonLabel, skipFor, type Skip } from "./skips.ts";

test("a weekday maps to its date in the week, across a month end", () => {
  assert.equal(dateInWeek("2026-11-23", 1), "2026-11-23");
  assert.equal(dateInWeek("2026-11-23", 5), "2026-11-27");
  assert.equal(dateInWeek("2026-11-30", 7), "2026-12-06");
});

test("a skip is found by session, or by name once the link is gone, and never for another session", () => {
  const skip = (session_id: string | null, session_name: string): Skip => ({ id: "1", session_id, session_name, skipped_on: "2026-11-27", reason: "sick" });
  const cardio = { id: "s5", name: "Cardio" };
  assert.ok(skipFor([skip("s5", "Old name")], cardio));
  assert.ok(skipFor([skip(null, "Cardio")], cardio));
  assert.equal(skipFor([skip("s1", "Cardio")], cardio), undefined); // linked to a different session
  assert.equal(skipFor([], cardio), undefined);
});

test("reasons have labels and no reason has none", () => {
  assert.equal(reasonLabel("injury"), "Injury");
  assert.equal(reasonLabel(null), null);
});
