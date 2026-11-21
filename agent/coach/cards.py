"""Turns a tool's JSON result into a small, typed card the app draws as a chart.

Cards carry the tool's own numbers and nothing the model wrote, so a chart can never show a figure the data does not hold.
Tools without a useful picture (plan, guides, search) return None."""
from __future__ import annotations

import json
from typing import Any


def _load(text: str) -> dict[str, Any] | None:
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def card_for(tool: str, result: str) -> dict[str, Any] | None:
    data = _load(result)
    if not data or data.get("error") or data.get("ambiguous"):
        return None
    if tool == "get_weekly_volume":
        weeks = [
            {"week_of": w["week_of"], "sessions": w["sessions"], "sets": w["sets"], "volume_kg": w["volume_kg"] or 0}
            for w in data.get("weeks_oldest_first", [])
        ]
        return {"kind": "volume", "weeks": weeks} if len(weeks) > 1 else None
    if tool == "get_exercise_progress":
        points = [
            {"date": s["date"], "est_1rm_kg": s["est_1rm_kg"], "top_set": s["top_set"]}
            for s in data.get("sessions_newest_last", [])
            if s.get("est_1rm_kg") is not None
        ]
        nxt = data.get("next_session_suggestion") or {}
        return (
            {"kind": "progress", "exercise": data["exercise"], "points": points, "next_load_kg": nxt.get("next_load_kg")}
            if len(points) > 1
            else None
        )
    if tool == "get_personal_bests":
        rows = data.get("bests", [])[:6]
        return {"kind": "bests", "rows": rows} if rows else None
    return None
