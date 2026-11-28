"""Double progression, identical to web/src/lib/progression.ts so the app and the coach never disagree."""
from __future__ import annotations

from typing import Any


def load_increment(load_kg: float) -> float:
    if load_kg < 10:
        return 1.0
    if load_kg < 50:
        return 2.5
    return 5.0


def _fmt(n: float) -> str:
    return str(int(n)) if float(n).is_integer() else f"{n:.2f}".rstrip("0").rstrip(".")


def suggest_next(planned_sets: int, rep_min: int | None, rep_max: int | None, previous: list[dict[str, Any]]) -> dict[str, Any]:
    """previous: sets from the last session, each {"load_kg": float|None, "reps": int|None}."""
    prev = [s for s in previous if s.get("reps") is not None]
    if not prev or rep_min is None or rep_max is None:
        return {"kind": "first", "message": "No history yet. Start with a load you can control at the lower end of the rep range."}

    top_load = max(float(s.get("load_kg") or 0) for s in prev)
    working = [s for s in prev if float(s.get("load_kg") or 0) == top_load]
    hit_top = len(working) >= planned_sets and all((s["reps"] or 0) >= rep_max for s in working)

    if hit_top:
        nxt = round(top_load + load_increment(top_load), 2)
        return {
            "kind": "increase",
            "next_load_kg": nxt,
            "target_reps": rep_min,
            "message": f"Hit {rep_max} reps on every set at {_fmt(top_load)} kg. Move to {_fmt(nxt)} kg and aim for {rep_min}+.",
        }

    lowest = min(s["reps"] or 0 for s in working)
    target = max(rep_min, min(rep_max, lowest + 1))  # history can come from another rep range
    if lowest + 1 < rep_min:
        at = f" at {_fmt(top_load)} kg" if top_load > 0 else ""
        lighter = f", and go lighter if you can't reach {rep_min}" if top_load > 0 else ""
        message = f"Last time was {lowest} reps{at}. Aim for {rep_min} to {rep_max}{lighter}."
    elif top_load > 0:
        message = f"Stay at {_fmt(top_load)} kg and aim for {target} reps on every set. Reach {rep_max} on all sets to move up."
    else:
        message = f"Aim for {target} reps on every set. Reach {rep_max} on all sets to add load."
    return {
        "kind": "hold",
        "next_load_kg": top_load if top_load > 0 else None,
        "target_reps": target,
        "message": message,
    }
