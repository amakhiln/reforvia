from coach.progression import load_increment, suggest_next


def sets(load, reps_list):
    return [{"load_kg": load, "reps": r} for r in reps_list]


def test_first_time():
    assert suggest_next(3, 8, 12, [])["kind"] == "first"


def test_increase_at_top_of_range_on_all_sets():
    s = suggest_next(3, 8, 12, sets(40, [12, 12, 12]))
    assert s["kind"] == "increase" and s["next_load_kg"] == 42.5 and s["target_reps"] == 8


def test_hold_when_one_set_short():
    s = suggest_next(3, 8, 12, sets(40, [12, 12, 10]))
    assert s["kind"] == "hold" and s["next_load_kg"] == 40 and s["target_reps"] == 11


def test_fewer_sets_than_planned_never_increases():
    assert suggest_next(3, 8, 12, sets(40, [12, 12]))["kind"] == "hold"


def test_only_sets_at_top_load_count():
    prev = sets(30, [12]) + sets(40, [12, 12])
    assert suggest_next(3, 8, 12, prev)["kind"] == "hold"


def test_increments():
    assert load_increment(5) == 1 and load_increment(20) == 2.5 and load_increment(100) == 5
