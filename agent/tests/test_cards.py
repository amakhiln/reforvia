import json

from coach.cards import card_for

VOLUME = {"weeks_oldest_first": [{"week_of": "2026-11-02", "sessions": 3, "sets": 40, "volume_kg": 5000},
                                 {"week_of": "2026-11-09", "sessions": 4, "sets": 50, "volume_kg": None}]}
PROGRESS = {"exercise": "Lat pulldown", "next_session_suggestion": {"next_load_kg": 62.5},
            "sessions_newest_last": [{"date": "2026-11-02", "top_set": "60kg x 10", "est_1rm_kg": 80.0},
                                     {"date": "2026-11-09", "top_set": "60kg x 12", "est_1rm_kg": 84.0}]}


def test_volume_card_keeps_the_tools_numbers():
    card = card_for("get_weekly_volume", json.dumps(VOLUME))
    assert card["kind"] == "volume" and [w["volume_kg"] for w in card["weeks"]] == [5000, 0]


def test_progress_card_and_next_load():
    card = card_for("get_exercise_progress", json.dumps(PROGRESS))
    assert card["kind"] == "progress" and card["next_load_kg"] == 62.5 and len(card["points"]) == 2


def test_no_card_for_thin_or_failed_results():
    assert card_for("get_weekly_volume", json.dumps({"weeks_oldest_first": VOLUME["weeks_oldest_first"][:1]})) is None
    assert card_for("get_exercise_progress", json.dumps({"error": "No exercise matching 'x'."})) is None
    assert card_for("get_exercise_progress", json.dumps({"ambiguous": True})) is None
    assert card_for("get_my_plan", json.dumps({"plan": []})) is None
    assert card_for("get_weekly_volume", "not json") is None


def test_bests_card_is_capped():
    rows = [{"exercise": f"e{i}", "set": "1kg x 1", "est_1rm_kg": 1, "date": "2026-11-01"} for i in range(9)]
    assert len(card_for("get_personal_bests", json.dumps({"bests": rows}))["rows"]) == 6
