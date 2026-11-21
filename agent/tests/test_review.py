from coach.review import MAX_TARGETS, add_targets


def lift(name, sets, planned=3, rep_min=8, rep_max=12):
    return {"exercise": name, "last_sets": sets, "plan": {"planned_sets": planned, "rep_min": rep_min, "rep_max": rep_max, "rep_target": f"{rep_min}–{rep_max}"}}


def test_earned_increase_comes_first_and_uses_double_progression():
    stats = {"lifts": [
        lift("Row", [{"load_kg": 40, "reps": 10}] * 3),                      # not at the top of the range: hold
        lift("Lat pulldown", [{"load_kg": 60, "reps": 12}] * 3),             # all sets at 12: move up
    ]}
    t = add_targets(stats)["targets"]
    assert [x["exercise"] for x in t] == ["Lat pulldown", "Row"]
    assert t[0] == {"exercise": "Lat pulldown", "kind": "increase", "next_load_kg": 65.0, "target_reps": 8, "plan": "3 × 8–12"}
    assert t[1]["kind"] == "hold" and t[1]["next_load_kg"] == 40 and t[1]["target_reps"] == 11


def test_unplanned_and_bodyweight_lifts_get_no_target_and_raw_fields_are_dropped():
    stats = {"lifts": [
        {"exercise": "Curl", "last_sets": [{"load_kg": 10, "reps": 10}], "plan": None},
        lift("Plank", [{"load_kg": None, "reps": 12}] * 3),
    ]}
    out = add_targets(stats)
    assert out["targets"] == []
    assert all("plan" not in l and "last_sets" not in l for l in out["lifts"])


def test_targets_are_capped():
    stats = {"lifts": [lift(f"Lift {i}", [{"load_kg": 20, "reps": 12}] * 3) for i in range(10)]}
    assert len(add_targets(stats)["targets"]) == MAX_TARGETS
