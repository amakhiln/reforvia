"""Works out the "next week" loads for a weekly review, from the same double progression the app and the Coach use."""
from __future__ import annotations

from typing import Any

from .progression import suggest_next

MAX_TARGETS = 6


def add_targets(stats: dict[str, Any]) -> dict[str, Any]:
    """Adds stats["targets"] and drops the raw last_sets / plan that were only needed to compute them."""
    targets: list[dict[str, Any]] = []
    for lift in stats.get("lifts", []):
        plan, last_sets = lift.pop("plan", None), lift.pop("last_sets", None)
        if not plan or not last_sets:
            continue
        if not any((x.get("load_kg") or 0) > 0 for x in last_sets):  # bodyweight or timed work has no load to progress
            continue
        step = suggest_next(plan["planned_sets"], plan.get("rep_min"), plan.get("rep_max"), last_sets)
        if step.get("next_load_kg") is None:  # nothing to say without a load (first time, or bodyweight)
            continue
        targets.append(
            {
                "exercise": lift["exercise"],
                "kind": step["kind"],  # "increase" = earned a heavier load, "hold" = stay and add reps
                "next_load_kg": step["next_load_kg"],
                "target_reps": step["target_reps"],
                "plan": f"{plan['planned_sets']} × {plan['rep_target']}",
            }
        )
    targets.sort(key=lambda t: t["kind"] != "increase")  # earned increases first; the sort is stable
    stats["targets"] = targets[:MAX_TARGETS]
    return stats
