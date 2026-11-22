"""Daily calorie and macro targets, worked out by code from the user's profile and training. The Nutrition agent explains
these numbers; it never invents them. Mifflin-St Jeor energy, an activity factor from logged sessions, and a gentle,
capped change for the goal. These are estimates for healthy adults, not medical advice."""
from __future__ import annotations

from datetime import date
from typing import Any

ADULT = 18
FLOOR_KCAL = {"female": 1200, "male": 1500}
MAX_LOSS_PCT_PER_WEEK = 0.5   # of body weight
MAX_GAIN_PCT_PER_WEEK = 0.25
KCAL_PER_KG = 7700


def age_in(profile: dict[str, Any], today: date) -> int:
    return today.year - int(profile["birth_year"])


def activity_factor(sessions_per_week: float) -> float:
    if sessions_per_week < 1:
        return 1.2
    if sessions_per_week < 3:
        return 1.375
    if sessions_per_week < 5:
        return 1.55
    return 1.725


def sessions_per_week(weeks: list[dict[str, Any]]) -> float:
    """Average sessions per week over completed weeks. weeks is oldest first and ends with the current, unfinished week."""
    done = weeks[:-1]
    return sum(w["sessions"] for w in done) / len(done) if done else 0.0


def targets(profile: dict[str, Any] | None, weekly: list[dict[str, Any]], today: date) -> dict[str, Any]:
    """{"ok": True, ...numbers and the method...} or {"ok": False, "reason": ..., "message": ...} when no target should be given."""
    if not profile:
        return {"ok": False, "reason": "no_profile", "message": "The user has not set up their nutrition profile yet. Ask them to open it from the Nutrition screen."}
    age = age_in(profile, today)
    if age < ADULT:
        return {"ok": False, "reason": "under_18", "message": "Targets are for adults only. Suggest speaking to a doctor or a registered dietitian."}
    if profile.get("see_professional"):
        return {"ok": False, "reason": "see_professional", "message": "The user said a health condition, pregnancy, breastfeeding or past disordered eating applies. Give no targets; suggest a doctor or a registered dietitian."}

    w, h, sex = float(profile["weight_kg"]), float(profile["height_cm"]), profile["sex"]
    bmr = 10 * w + 6.25 * h - 5 * age + (5 if sex == "male" else -161)
    spw = sessions_per_week(weekly)
    factor = activity_factor(spw)
    tdee = bmr * factor
    goal = profile["goal"]

    if goal == "lose":
        change = -min(0.20 * tdee, MAX_LOSS_PCT_PER_WEEK / 100 * w * KCAL_PER_KG / 7)
    elif goal == "gain":
        change = min(0.10 * tdee, MAX_GAIN_PCT_PER_WEEK / 100 * w * KCAL_PER_KG / 7)
    else:
        change = 0.0
    floor = max(bmr, FLOOR_KCAL[sex])  # never below the resting need or the usual minimum for a healthy adult
    kcal = max(tdee + change, floor) if goal == "lose" else tdee + change
    floor_applied = goal == "lose" and kcal == floor and tdee + change < floor
    kcal = round(kcal / 10) * 10

    protein = min((1.8 if goal == "lose" else 1.6) * w, 0.4 * kcal / 4)
    fat = max(0.8 * w, 0.25 * kcal / 9)
    carbs = max((kcal - 4 * protein - 9 * fat) / 4, 0)
    return {
        "ok": True,
        "calories": kcal,
        "protein_g": round(protein),
        "fat_g": round(fat),
        "carbs_g": round(carbs),
        "goal": goal,
        "expected_change_kg_per_week": round((kcal - tdee) * 7 / KCAL_PER_KG, 2),
        "floor_applied": floor_applied,
        "method": {
            "bmr_kcal": round(bmr),
            "activity_factor": factor,
            "sessions_per_week_logged": round(spw, 1),
            "maintenance_kcal": round(tdee),
            "inputs": {"age": age, "sex": sex, "height_cm": h, "weight_kg": w},
            "note": "Estimate for a healthy adult (Mifflin-St Jeor with an activity factor from logged sessions). Real needs vary by 10 to 15 percent. "
            + ("No training was logged, so activity was assumed low. " if spw == 0 else "")
            + ("The calorie floor applied, so the loss is slower than the goal would otherwise give. " if floor_applied else ""),
        },
    }
