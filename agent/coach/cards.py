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
    if tool == "get_nutrition_targets" and data.get("ok"):
        keys = ("calories", "protein_g", "fat_g", "carbs_g", "goal", "expected_change_kg_per_week")
        return {"kind": "targets", **{k: data[k] for k in keys}, "maintenance_kcal": data["method"]["maintenance_kcal"], "floor_applied": data["floor_applied"]}
    if tool == "portion_nutrition" and "food" in data:
        keys = ("food", "grams", "energy_kcal", "protein_g", "fat_g", "carbs_g", "fibre_g", "energy_derived")
        return {"kind": "food", **{k: data[k] for k in keys}}
    if tool == "get_personal_bests":
        rows = data.get("bests", [])[:6]
        return {"kind": "bests", "rows": rows} if rows else None
    return None


def proposal_for(result: str) -> dict[str, Any] | None:
    """A tool that stored a proposal puts it under "proposal" in its result; this is what the approval card shows."""
    data = _load(result)
    prop = (data or {}).get("proposal")
    if isinstance(prop, dict) and prop.get("id") and prop.get("kind") and prop.get("summary"):
        return {k: prop.get(k) for k in ("id", "kind", "summary", "preview", "expires_at")}
    return None
