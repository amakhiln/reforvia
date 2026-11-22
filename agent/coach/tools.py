"""Tools the coach can call. Each one acts as the signed-in user, so RLS limits what is visible. All of them only read,
except propose_memory, which stores a proposal the user must approve before anything is saved."""
from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from .memory import KINDS, resolve
from .planchange import PlanChange, build_plan_change
from .progression import suggest_next
from .proposals import create_proposal
from .supa import SupabaseError, UserSupabase

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
ZERO_UUID = "00000000-0000-0000-0000-000000000000"


def _sb(config: RunnableConfig) -> UserSupabase:
    return config["configurable"]["sb"]


def _today(config: RunnableConfig):
    tz = config["configurable"].get("tz") or "UTC"
    try:
        return datetime.now(ZoneInfo(tz)).date()
    except Exception:
        return datetime.utcnow().date()


def _clean(text: str) -> str:
    """Strip characters that have meaning inside PostgREST filter values."""
    return re.sub(r"[*,()\\%_\"']", " ", text).strip()[:60]


def _num(v: Any) -> float | None:
    return None if v is None else float(v)


def _fmt_kg(v: float | None) -> str:
    if v is None:
        return "bodyweight"
    return f"{v:g}"


def _fmt_set(s: dict[str, Any]) -> str:
    if s.get("duration_sec") is not None:
        return f"{s['duration_sec']}s"
    load = _num(s.get("load_kg"))
    reps = s.get("reps")
    return f"{load:g}kg x {reps}" if load else f"{reps} reps"


def _json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"), default=str)


async def _resolve_exercise(sb: UserSupabase, name: str) -> dict[str, Any] | list[dict[str, Any]] | None:
    """One exercise dict if the name is clear, a candidate list if ambiguous, None if nothing matches."""
    q = _clean(name)
    if not q:
        return None
    fields = "id,name,main_muscles,purpose,form_instructions,common_mistakes,alternatives,video_url"
    exact = await sb.select("exercises", {"select": fields, "name": f"ilike.{q}", "limit": "1"})
    if exact:
        return exact[0]
    rows = await sb.select("exercises", {"select": fields, "name": f"ilike.*{q}*", "order": "name.asc", "limit": "6"})
    if len(rows) == 1:
        return rows[0]
    return rows or None


def _ambiguous(rows: list[dict[str, Any]]) -> str:
    return _json({"ambiguous": True, "message": "Several exercises match. Ask the user which one.", "options": [r["name"] for r in rows]})


@tool
async def get_my_plan(config: RunnableConfig) -> str:
    """The user's weekly training plan: each day's session with its exercises, sets and rep ranges."""
    sb = _sb(config)
    rows = await sb.select(
        "program_sessions",
        {
            "select": "name,day_of_week,is_optional,sort_order,planned_exercises(planned_sets,rep_target,sort_order,exercises(name))",
            "user_id": "not.is.null",
            "order": "day_of_week.asc,sort_order.asc",
        },
    )
    out = []
    for s in rows:
        ex = sorted(s.get("planned_exercises") or [], key=lambda e: e.get("sort_order", 0))
        out.append(
            {
                "day": DAY_NAMES[s["day_of_week"] - 1],
                "session": s["name"],
                "optional": s["is_optional"],
                "exercises": [f"{e['exercises']['name']}: {e['planned_sets']} x {e['rep_target']}" for e in ex],
            }
        )
    return _json({"today": DAY_NAMES[_today(config).weekday()], "plan": out})


@tool
async def get_recent_workouts(limit: int = 5, config: RunnableConfig = None) -> str:  # type: ignore[assignment]
    """The user's most recent logged workouts with every set (load x reps), reps-in-reserve and notes. limit is 1-10."""
    sb = _sb(config)
    n = max(1, min(int(limit), 10))
    rows = await sb.select(
        "workouts",
        {
            "select": "session_name,performed_on,finished_at,workout_exercises(sort_order,completed,rir_last_set,notes,exercises(name),set_logs(set_number,load_kg,reps,duration_sec))",
            "order": "performed_on.desc,started_at.desc",
            "limit": str(n),
        },
    )
    out = []
    for w in rows:
        exs = []
        for we in sorted(w.get("workout_exercises") or [], key=lambda e: e.get("sort_order", 0)):
            sets = sorted(we.get("set_logs") or [], key=lambda s: s["set_number"])
            if not sets:
                continue
            item: dict[str, Any] = {"exercise": we["exercises"]["name"], "sets": [_fmt_set(s) for s in sets]}
            if we.get("rir_last_set") is not None:
                item["rir_last_set"] = we["rir_last_set"]
            if we.get("notes"):
                item["note"] = we["notes"]
            exs.append(item)
        out.append({"date": w["performed_on"], "session": w["session_name"], "finished": bool(w.get("finished_at")), "exercises": exs})
    return _json({"workouts": out}) if out else _json({"workouts": [], "message": "No workouts logged yet."})


@tool
async def find_exercise(query: str, config: RunnableConfig = None) -> str:  # type: ignore[assignment]
    """Search the exercise library by name. Returns up to 8 matches with main muscles."""
    sb = _sb(config)
    q = _clean(query)
    if not q:
        return _json({"matches": []})
    rows = await sb.select("exercises", {"select": "name,main_muscles,purpose", "name": f"ilike.*{q}*", "order": "name.asc", "limit": "8"})
    return _json({"matches": rows})


@tool
async def get_exercise_guide(exercise: str, config: RunnableConfig = None) -> str:  # type: ignore[assignment]
    """Form cues, common mistakes and equipment alternatives for one exercise (by name)."""
    sb = _sb(config)
    found = await _resolve_exercise(sb, exercise)
    if found is None:
        return _json({"error": f"No exercise matching '{exercise}'."})
    if isinstance(found, list):
        return _ambiguous(found)
    keep = ("name", "main_muscles", "purpose", "form_instructions", "common_mistakes", "alternatives")
    return _json({k: found.get(k) for k in keep})


@tool
async def get_exercise_progress(exercise: str, config: RunnableConfig = None) -> str:  # type: ignore[assignment]
    """Session-by-session history for one exercise (top set, estimated 1RM, volume) plus the next-load suggestion from double progression."""
    sb = _sb(config)
    found = await _resolve_exercise(sb, exercise)
    if found is None:
        return _json({"error": f"No exercise matching '{exercise}'."})
    if isinstance(found, list):
        return _ambiguous(found)

    ex_id = found["id"]
    history = await sb.rpc("exercise_history", {"p_exercise_id": ex_id}) or []
    if not history:
        return _json({"exercise": found["name"], "message": "No sets logged for this exercise yet."})

    recent = history[-12:]
    sessions = [
        {
            "date": h["performed_on"],
            "top_set": f"{_fmt_kg(_num(h['top_load']))}kg x {h['top_reps']}" if h.get("top_load") else f"{h['top_reps']} reps",
            "est_1rm_kg": _num(h.get("best_e1rm")),
            "volume_kg": _num(h.get("volume")),
            "sets": h["sets"],
        }
        for h in recent
    ]

    plan = await sb.select(
        "planned_exercises",
        {"select": "planned_sets,rep_min,rep_max,rep_target", "exercise_id": f"eq.{ex_id}", "user_id": "not.is.null", "limit": "1"},
    )
    last_sets = await sb.rpc("previous_sets", {"p_exercise_ids": [ex_id], "p_exclude_workout": ZERO_UUID}) or []
    suggestion = None
    if plan:
        p = plan[0]
        suggestion = suggest_next(
            p["planned_sets"], p.get("rep_min"), p.get("rep_max"), [{"load_kg": _num(s.get("load_kg")), "reps": s.get("reps")} for s in last_sets]
        )
        suggestion["plan"] = f"{p['planned_sets']} x {p['rep_target']}"

    loads = [_num(h["top_load"]) for h in history if h.get("top_load")]
    trend = None
    if len(loads) > 1:
        trend = {"first_top_load_kg": loads[0], "latest_top_load_kg": loads[-1], "change_kg": round(loads[-1] - loads[0], 2), "sessions": len(history)}

    return _json({"exercise": found["name"], "sessions_newest_last": sessions, "trend": trend, "next_session_suggestion": suggestion})


@tool
async def get_weekly_volume(weeks: int = 8, config: RunnableConfig = None) -> str:  # type: ignore[assignment]
    """Training volume (kg lifted = load x reps), sessions and sets per week, including empty weeks. weeks is 1-26."""
    sb = _sb(config)
    n = max(1, min(int(weeks), 26))
    rows = await sb.rpc("weekly_summary", {"p_weeks": n, "p_today": _today(config).isoformat()}) or []
    return _json({"weeks_oldest_first": [{"week_of": r["week_start"], "sessions": r["sessions"], "sets": r["sets"], "volume_kg": _num(r["volume"])} for r in rows]})


@tool
async def get_personal_bests(config: RunnableConfig = None) -> str:  # type: ignore[assignment]
    """Best estimated one-rep max per exercise, with the set that produced it."""
    sb = _sb(config)
    rows = await sb.rpc("personal_records", {}) or []
    rows = sorted(rows, key=lambda r: r["performed_on"], reverse=True)
    return _json({"bests": [{"exercise": r["name"], "set": f"{_num(r['load_kg']):g}kg x {r['reps']}", "est_1rm_kg": _num(r["e1rm"]), "date": r["performed_on"]} for r in rows]})


@tool
async def propose_memory(text: str, kind: str = "fact", replaces: str = "", config: RunnableConfig = None) -> str:  # type: ignore[assignment]
    """Offer to save one lasting note about the user (an injury or limit, training days, equipment, a goal or preference). kind is fact, preference, constraint or goal. replaces is the label (M1, M2...) of an existing note this corrects. This only shows the user a Save button; nothing is saved until they approve it."""
    cfg = config["configurable"]
    note = " ".join((text or "").split())
    if not 3 <= len(note) <= 200:
        return _json({"error": "A note must be one short sentence (3 to 200 characters)."})
    if kind not in KINDS:
        return _json({"error": f"kind must be one of: {', '.join(KINDS)}."})
    held = cfg.get("memories") or []
    old = resolve(held, replaces) if replaces else None
    if replaces and old is None:
        return _json({"error": f"No note is labelled '{replaces}'. Use a label from the list, or leave replaces empty."})
    if any(m["text"].strip().lower() == note.lower() for m in held):
        return _json({"message": "That note is already saved. Do not offer it again."})
    # shortcut: no cap on pending proposals here; the per-minute and daily message limits bound how many a user can cause
    payload = {"text": note, "kind": kind, "supersedes_id": old["id"] if old else None}
    preview = [f"+ {note}"] + ([f"- {old['text']}"] if old else [])
    card = await create_proposal(
        _sb(config), cfg["user_id"], "memory", payload, f"{'Update' if old else 'Remember'}: {note}", preview
    )
    return _json({"proposal": card, "message": "Shown to the user as a card. It is NOT saved until they tap Save, so tell them it is waiting for their approval."})


@tool
async def propose_plan_change(changes: list[PlanChange], config: RunnableConfig = None) -> str:  # type: ignore[assignment]
    """Offer a change to the user's weekly plan: add an exercise to a session, replace one exercise with another, or edit the sets or rep range of one. Up to 5 changes, applied together. This only shows the user an Approve button; the plan is not changed until they approve it. It cannot remove or reorder exercises, create days or sessions, or set weights."""
    built = await build_plan_change(_sb(config), changes)
    if isinstance(built, str):
        return _json({"error": built})
    payload, summary, preview = built
    card = await create_proposal(_sb(config), config["configurable"]["user_id"], "plan_change", payload, summary, preview)
    return _json({"proposal": card, "message": "Shown to the user as a card. The plan is NOT changed until they tap Approve, so tell them it is waiting for their approval."})


TOOLS = [propose_plan_change, propose_memory, get_my_plan, get_recent_workouts, find_exercise, get_exercise_guide, get_exercise_progress, get_weekly_volume, get_personal_bests]

TOOL_LABELS = {
    "get_my_plan": "Checking your plan",
    "get_recent_workouts": "Reading your recent workouts",
    "find_exercise": "Searching exercises",
    "get_exercise_guide": "Looking up form cues",
    "get_exercise_progress": "Analysing your progress",
    "get_weekly_volume": "Checking your weekly volume",
    "get_personal_bests": "Checking your personal bests",
    "propose_memory": "Preparing a note to save",
    "propose_plan_change": "Preparing a plan change",
}
