"""Checks a requested plan change against the user's real plan and library, and turns it into a proposal payload.

Nothing here writes plan data. The result is stored as a proposal; the user's Approve tap runs apply_plan_change in SQL,
which re-checks every value against the plan as it is then. Limits mirror the Plan screen: 1 to 10 sets, library
exercises only, and a timed exercise keeps its seconds range."""
from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field

from .supa import UserSupabase

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MAX_CHANGES = 5
DEFAULT_SETS = 3
DEFAULT_REPS = (8, 12)
DEFAULT_TIMED = ("30–45 sec", 30, 45)


class PlanChange(BaseModel):
    op: Literal["add", "replace", "edit"] = Field(description="add an exercise to a session, replace one exercise with another, or edit sets or reps of one")
    session: str = Field(description="the day (e.g. Thursday) or the session name")
    exercise: str = Field(description="add: the exercise to add. replace: the NEW exercise. edit: the exercise already in the session")
    replaces: str = Field(default="", description="replace only: the exercise currently in the session that is being swapped out")
    sets: int | None = Field(default=None, description="add or edit: number of sets, 1 to 10")
    rep_min: int | None = Field(default=None, description="add or edit: lower end of the rep range (not for timed exercises)")
    rep_max: int | None = Field(default=None, description="add or edit: upper end of the rep range (not for timed exercises)")


def rep_target(lo: int, hi: int, per_side: bool = False) -> str:
    base = str(lo) if lo == hi else f"{lo}–{hi}"
    return f"{base} / side" if per_side else base


def _day(s: dict[str, Any]) -> str:
    return DAY_NAMES[s["day_of_week"] - 1]


def _find_session(sessions: list[dict[str, Any]], ref: str) -> dict[str, Any] | str:
    q = ref.strip().lower()
    hits = [s for s in sessions if q and (q == _day(s).lower() or q == _day(s)[:3].lower() or q in s["name"].lower())]
    if len(hits) == 1:
        return hits[0]
    listing = "; ".join(f"{_day(s)}: {s['name']}" for s in sessions)
    return f"'{ref}' matches {'several sessions' if hits else 'no session'}. The user's sessions are: {listing}. Ask which one."


def _find_item(session: dict[str, Any], name: str) -> dict[str, Any] | str:
    q = name.strip().lower()
    items = session.get("planned_exercises") or []
    hits = [i for i in items if i["exercises"]["name"].lower() == q] or [i for i in items if q and q in i["exercises"]["name"].lower()]
    if len(hits) == 1:
        return hits[0]
    have = ", ".join(i["exercises"]["name"] for i in items) or "nothing yet"
    return f"'{name}' {'matches several exercises' if hits else 'is not in'} {_day(session)} ({session['name']}). It has: {have}."


async def _find_exercise(sb: UserSupabase, name: str) -> dict[str, Any] | str:
    q = re.sub(r"[*,()\\%_\"']", " ", name).strip()[:60]
    if not q:
        return "Name the exercise."
    cols = {"select": "id,name,is_timed"}
    rows = await sb.select("exercises", {**cols, "name": f"ilike.{q}", "limit": "1"})
    if not rows:
        rows = await sb.select("exercises", {**cols, "name": f"ilike.*{q}*", "order": "name.asc", "limit": "6"})
    if len(rows) == 1:
        return rows[0]
    if rows:
        return "Several exercises match: " + ", ".join(r["name"] for r in rows) + ". Ask the user which one."
    return f"No exercise in the library matches '{name}'. Custom exercises are added in the app, not by the Coach."


def _reps(lo: int | None, hi: int | None) -> str | None:
    """None when fine, otherwise the problem."""
    if lo is None and hi is None:
        return None
    if lo is None or hi is None:
        return "Give both rep_min and rep_max."
    if not 1 <= lo <= hi <= 50:
        return "Reps must be between 1 and 50, with rep_min no higher than rep_max."
    return None


def _sets(n: int | None) -> str | None:
    return None if n is None or 1 <= n <= 10 else "Sets must be between 1 and 10."


async def build_plan_change(sb: UserSupabase, changes: list[PlanChange]) -> tuple[dict[str, Any], str, list[str]] | str:
    """(payload, summary, preview lines) for a valid request, or one sentence saying what is wrong. Never raises on bad input."""
    if not 1 <= len(changes) <= MAX_CHANGES:
        return f"A plan change holds 1 to {MAX_CHANGES} changes."
    sessions = await sb.select(
        "program_sessions",
        {
            "select": "id,name,day_of_week,is_optional,sort_order,planned_exercises(id,exercise_id,planned_sets,rep_target,rep_min,rep_max,per_side,is_timed,sort_order,exercises(name))",
            "user_id": "not.is.null",
            "order": "day_of_week.asc,sort_order.asc",
        },
    )
    if not sessions:
        return "The user has no plan yet. They can create it on the Plan tab."

    out: list[dict[str, Any]] = []
    preview: list[str] = []
    summaries: list[str] = []
    touched: set[str] = set()
    added: set[tuple[str, str]] = set()

    for c in changes:
        session = _find_session(sessions, c.session)
        if isinstance(session, str):
            return session
        where = f"{_day(session)[:3]} · {session['name']}"
        problem = _sets(c.sets) or _reps(c.rep_min, c.rep_max)
        if problem:
            return problem

        if c.op == "add":
            ex = await _find_exercise(sb, c.exercise)
            if isinstance(ex, str):
                return ex
            if any(i["exercise_id"] == ex["id"] for i in session.get("planned_exercises") or []) or (session["id"], ex["id"]) in added:
                return f"{ex['name']} is already in {_day(session)} ({session['name']})."
            added.add((session["id"], ex["id"]))
            if ex["is_timed"]:
                if c.rep_min is not None:
                    return f"{ex['name']} is timed, so it keeps a seconds range. Leave rep_min and rep_max empty."
                target, lo, hi = DEFAULT_TIMED
            else:
                lo, hi = (c.rep_min, c.rep_max) if c.rep_min is not None else DEFAULT_REPS
                target = rep_target(lo, hi)
            sets = c.sets or DEFAULT_SETS
            out.append({"op": "add", "session_id": session["id"], "exercise_id": ex["id"], "planned_sets": sets, "rep_target": target,
                        "rep_min": lo, "rep_max": hi, "is_timed": bool(ex["is_timed"])})
            preview.append(f"+ {where}: {ex['name']} {sets} × {target}")
            summaries.append(f"Add {ex['name']} to {_day(session)}")
            continue

        name = c.replaces if c.op == "replace" else c.exercise
        item = _find_item(session, name)
        if isinstance(item, str):
            return item
        if item["id"] in touched:
            return f"{item['exercises']['name']} appears in two changes. Combine them into one."
        touched.add(item["id"])
        old = item["exercises"]["name"]

        if c.op == "replace":
            if c.sets is not None or c.rep_min is not None:
                return "A replace only swaps the exercise. Use a separate edit change for sets or reps."
            ex = await _find_exercise(sb, c.exercise)
            if isinstance(ex, str):
                return ex
            if ex["id"] == item["exercise_id"]:
                return f"{old} is already in that slot."
            if any(i["exercise_id"] == ex["id"] for i in session.get("planned_exercises") or []):
                return f"{ex['name']} is already in {_day(session)} ({session['name']})."
            if bool(ex["is_timed"]) == bool(item["is_timed"]):  # keep sets and reps, as the Plan screen does
                keep = {"rep_target": item["rep_target"], "rep_min": item["rep_min"], "rep_max": item["rep_max"], "per_side": item["per_side"]}
            else:
                target, lo, hi = DEFAULT_TIMED if ex["is_timed"] else (rep_target(*DEFAULT_REPS), *DEFAULT_REPS)
                keep = {"rep_target": target, "rep_min": lo, "rep_max": hi, "per_side": False}
            out.append({"op": "replace", "planned_id": item["id"], "expected_exercise_id": item["exercise_id"], "exercise_id": ex["id"],
                        "is_timed": bool(ex["is_timed"]), **keep})
            preview.append(f"~ {where}: {old} → {ex['name']}")
            summaries.append(f"Swap {old} for {ex['name']} on {_day(session)}")
            continue

        # edit
        if c.sets is None and c.rep_min is None:
            return "An edit needs new sets, new reps, or both."
        if c.rep_min is not None and item["is_timed"]:
            return f"{old} is timed, so only its sets can change here."
        sets = c.sets or item["planned_sets"]
        if c.rep_min is not None:
            lo, hi = c.rep_min, c.rep_max
            target = rep_target(lo, hi, bool(item["per_side"]))
        else:
            lo, hi, target = item["rep_min"], item["rep_max"], item["rep_target"]
        out.append({"op": "edit", "planned_id": item["id"], "expected_exercise_id": item["exercise_id"], "planned_sets": sets,
                    "rep_target": target, "rep_min": lo, "rep_max": hi})
        preview.append(f"~ {where}: {old} {item['planned_sets']} × {item['rep_target']} → {sets} × {target}")
        summaries.append(f"Change {old} on {_day(session)}")

    summary = summaries[0] if len(summaries) == 1 else f"{len(summaries)} changes to your plan"
    return {"changes": out}, summary, preview
