import json

import pytest

from coach import tools
from coach.supa import SupabaseError, UserSupabase
from tests.fakes import FakeSupabase

EX = {"id": "ex-1", "name": "Lat pulldown", "main_muscles": "Lats", "purpose": "Back width",
      "form_instructions": "Pull to chest", "common_mistakes": "Swinging", "alternatives": "Assisted pull-up"}


def make(routes):
    fake = FakeSupabase(routes)
    sb = UserSupabase("https://x.supabase.co", "pub-key", "good-token", fake.client())
    return fake, {"configurable": {"sb": sb, "tz": "Asia/Kolkata"}}


async def test_get_my_plan_sorts_and_names_days():
    fake, cfg = make({"program_sessions": [{
        "name": "Pull A", "day_of_week": 1, "is_optional": False, "sort_order": 0,
        "planned_exercises": [
            {"planned_sets": 2, "rep_target": "10–15", "sort_order": 1, "exercises": {"name": "Hammer curl"}},
            {"planned_sets": 3, "rep_target": "8–12", "sort_order": 0, "exercises": {"name": "Lat pulldown"}},
        ]}]})
    out = json.loads(await tools.get_my_plan.ainvoke({}, config=cfg))
    assert out["plan"][0]["day"] == "Monday"
    assert out["plan"][0]["exercises"] == ["Lat pulldown: 3 x 8–12", "Hammer curl: 2 x 10–15"]
    req = fake.requests[-1]
    assert req.url.params["user_id"] == "not.is.null"  # never the shared template
    assert req.headers["authorization"] == "Bearer good-token" and req.headers["apikey"] == "pub-key"


async def test_get_recent_workouts_formats_sets_and_clamps_limit():
    fake, cfg = make({"workouts": [{
        "session_name": "Pull A", "performed_on": "2026-11-15", "finished_at": "2026-11-15T10:00:00Z",
        "workout_exercises": [
            {"sort_order": 0, "completed": True, "rir_last_set": 2, "notes": "felt strong", "exercises": {"name": "Lat pulldown"},
             "set_logs": [{"set_number": 2, "load_kg": 40, "reps": 9, "duration_sec": None},
                          {"set_number": 1, "load_kg": 40.0, "reps": 10, "duration_sec": None}]},
            {"sort_order": 1, "completed": False, "rir_last_set": None, "notes": None, "exercises": {"name": "Skipped"}, "set_logs": []},
        ]}]})
    out = json.loads(await tools.get_recent_workouts.ainvoke({"limit": 99}, config=cfg))
    ex = out["workouts"][0]["exercises"]
    assert len(ex) == 1  # exercises without sets are omitted
    assert ex[0]["sets"] == ["40kg x 10", "40kg x 9"] and ex[0]["rir_last_set"] == 2 and ex[0]["note"] == "felt strong"
    assert fake.requests[-1].url.params["limit"] == "10"


async def test_find_exercise_sanitises_filter_characters():
    fake, cfg = make({"exercises": [{"name": "Lat pulldown", "main_muscles": "Lats", "purpose": "x"}]})
    await tools.find_exercise.ainvoke({"query": "lat*,or=(id.eq.1)"}, config=cfg)
    value = fake.requests[-1].url.params["name"]
    assert value.startswith("ilike.*") and not any(c in value[len("ilike."):].strip("*") for c in ",()")


async def test_exercise_progress_combines_history_plan_and_suggestion():
    def exercises(request):
        return [EX]

    fake, cfg = make({
        "exercises": exercises,
        "rpc/exercise_history": [
            {"performed_on": "2026-11-01", "top_load": 37.5, "top_reps": 10, "best_e1rm": 50.0, "volume": 1012.5, "sets": 3},
            {"performed_on": "2026-11-08", "top_load": 40, "top_reps": 12, "best_e1rm": 56.0, "volume": 1440, "sets": 3},
        ],
        "planned_exercises": [{"planned_sets": 3, "rep_min": 8, "rep_max": 12, "rep_target": "8–12"}],
        "rpc/previous_sets": [{"load_kg": 40, "reps": 12}, {"load_kg": 40, "reps": 12}, {"load_kg": 40, "reps": 12}],
    })
    out = json.loads(await tools.get_exercise_progress.ainvoke({"exercise": "lat pulldown"}, config=cfg))
    assert out["exercise"] == "Lat pulldown"
    assert out["trend"]["change_kg"] == 2.5
    assert out["next_session_suggestion"]["kind"] == "increase"
    assert out["next_session_suggestion"]["next_load_kg"] == 42.5
    assert ("exercise_history", {"p_exercise_id": "ex-1"}) in fake.rpc_calls


async def test_exercise_progress_without_history():
    _, cfg = make({"exercises": [EX], "rpc/exercise_history": []})
    out = json.loads(await tools.get_exercise_progress.ainvoke({"exercise": "Lat pulldown"}, config=cfg))
    assert "No sets logged" in out["message"]


async def test_ambiguous_and_unknown_exercises():
    def exercises(request):
        name = request.url.params["name"]
        if "nothing" in name or "*" not in name:  # an exact (wildcard-free) lookup of "curl" matches nothing
            return []
        return [
            {**EX, "id": "a", "name": "Incline dumbbell curl"}, {**EX, "id": "b", "name": "Hammer curl"}]

    _, cfg = make({"exercises": exercises})
    amb = json.loads(await tools.get_exercise_guide.ainvoke({"exercise": "curl"}, config=cfg))
    assert amb["ambiguous"] and amb["options"] == ["Incline dumbbell curl", "Hammer curl"]
    none = json.loads(await tools.get_exercise_guide.ainvoke({"exercise": "nothing"}, config=cfg))
    assert "No exercise matching" in none["error"]


async def test_weekly_volume_passes_local_date_and_clamps_weeks():
    fake, cfg = make({"rpc/weekly_summary": [{"week_start": "2026-11-09", "sessions": 2, "sets": 20, "volume": 5400.5}]})
    out = json.loads(await tools.get_weekly_volume.ainvoke({"weeks": 500}, config=cfg))
    name, body = fake.rpc_calls[-1]
    assert body["p_weeks"] == 26 and len(body["p_today"]) == 10
    assert out["weeks_oldest_first"][0]["volume_kg"] == 5400.5


async def test_personal_bests_newest_first():
    _, cfg = make({"rpc/personal_records": [
        {"name": "A", "load_kg": 40, "reps": 10, "e1rm": 53.3, "performed_on": "2026-10-01"},
        {"name": "B", "load_kg": 20, "reps": 8, "e1rm": 25.3, "performed_on": "2026-11-10"}]})
    out = json.loads(await tools.get_personal_bests.ainvoke({}, config=cfg))
    assert [b["exercise"] for b in out["bests"]] == ["B", "A"]


async def test_database_errors_do_not_leak_tokens():
    fake = FakeSupabase()
    sb = UserSupabase("https://x.supabase.co", "pub-key", "expired-token", fake.client())
    with pytest.raises(SupabaseError) as err:
        await sb.select("workouts", {})
    assert "expired-token" not in str(err.value) and "401" in str(err.value)
