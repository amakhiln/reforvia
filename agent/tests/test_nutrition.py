from datetime import date

import pytest

from coach.nutrition import activity_factor, sessions_per_week, targets

TODAY = date(2026, 11, 22)
WEEKS = [{"sessions": 4}, {"sessions": 4}, {"sessions": 4}, {"sessions": 4}, {"sessions": 1}]  # the last is the unfinished week
MAN = {"birth_year": 1996, "sex": "male", "height_cm": 178, "weight_kg": 80, "goal": "maintain", "see_professional": False}
WOMAN = {"birth_year": 1996, "sex": "female", "height_cm": 165, "weight_kg": 60, "goal": "maintain", "see_professional": False}


def test_maintenance_matches_the_published_formula():
    t = targets(MAN, WEEKS, TODAY)
    # Mifflin-St Jeor: 10*80 + 6.25*178 - 5*30 + 5 = 1767.5; four sessions a week is 1.55
    assert t["ok"] and t["method"]["bmr_kcal"] == 1768 and t["method"]["activity_factor"] == 1.55
    assert t["method"]["maintenance_kcal"] == 2740 and t["calories"] == 2740 and t["expected_change_kg_per_week"] == 0.0
    assert t["protein_g"] == 128  # 1.6 g per kg


def test_losing_is_gentle_and_capped():
    t = targets({**MAN, "goal": "lose"}, WEEKS, TODAY)
    assert t["calories"] < 2740 and t["calories"] >= 2740 * 0.8 - 5
    assert -0.5 * 80 / 100 - 0.01 <= t["expected_change_kg_per_week"] < 0  # no faster than half a percent of body weight a week
    assert t["protein_g"] == 144  # 1.8 g per kg while losing


def test_gaining_is_a_small_surplus():
    t = targets({**MAN, "goal": "gain"}, WEEKS, TODAY)
    assert 2740 < t["calories"] <= 2740 * 1.1 + 5 and 0 < t["expected_change_kg_per_week"] <= 0.25 * 80 / 100 + 0.01


def test_the_calorie_floor_stops_a_deficit_going_too_low():
    small = {"birth_year": 1966, "sex": "female", "height_cm": 150, "weight_kg": 45, "goal": "lose", "see_professional": False}
    t = targets(small, [{"sessions": 0}, {"sessions": 0}, {"sessions": 0}], TODAY)
    assert t["ok"] and t["calories"] >= 1200 and t["calories"] >= t["method"]["bmr_kcal"] - 5
    assert "no training" in t["method"]["note"].lower()


@pytest.mark.parametrize("sex", ["female", "male"])
@pytest.mark.parametrize("goal", ["lose", "maintain", "gain"])
@pytest.mark.parametrize("weight", [40, 65, 95, 140])
@pytest.mark.parametrize("sessions", [0, 2, 4, 6])
def test_macros_are_always_sane(sex, goal, weight, sessions):
    p = {"birth_year": 1990, "sex": sex, "height_cm": 170, "weight_kg": weight, "goal": goal, "see_professional": False}
    t = targets(p, [{"sessions": sessions}] * 5, TODAY)
    assert t["ok"] and t["carbs_g"] >= 0 and t["protein_g"] > 0 and t["fat_g"] > 0
    assert abs(4 * t["protein_g"] + 9 * t["fat_g"] + 4 * t["carbs_g"] - t["calories"]) <= 25  # the macros add up to the calories
    if goal == "lose":
        assert t["calories"] >= max(1200 if sex == "female" else 1500, t["method"]["bmr_kcal"] - 5)


@pytest.mark.parametrize(
    "profile, reason",
    [(None, "no_profile"), ({**MAN, "birth_year": 2012}, "under_18"), ({**MAN, "see_professional": True}, "see_professional")],
)
def test_no_numbers_for_missing_profiles_minors_or_people_who_should_see_a_professional(profile, reason):
    t = targets(profile, WEEKS, TODAY)
    assert t["ok"] is False and t["reason"] == reason and "calories" not in t


def test_activity_comes_from_logged_sessions_and_ignores_the_unfinished_week():
    assert sessions_per_week(WEEKS) == 4 and sessions_per_week([{"sessions": 3}]) == 0.0 and sessions_per_week([]) == 0.0
    assert [activity_factor(x) for x in (0, 1, 2.9, 3, 4.9, 5, 7)] == [1.2, 1.375, 1.375, 1.55, 1.55, 1.725, 1.725]
