import json

import httpx
import pytest

from coach.config import Settings
from coach.main import create_app
from coach.planchange import PlanChange, build_plan_change, rep_target
from coach.supa import UserSupabase
from coach.tools import propose_plan_change
from tests.fakes import FakeSupabase, ScriptedModel

PULL, LEGS = "s-pull", "s-legs"
LIBRARY = {
    "Hip thrust": {"id": "ex-hip", "name": "Hip thrust", "is_timed": False},
    "Lat pulldown": {"id": "ex-lat", "name": "Lat pulldown", "is_timed": False},
    "Seated cable row": {"id": "ex-row", "name": "Seated cable row", "is_timed": False},
    "Squat": {"id": "ex-squat", "name": "Squat", "is_timed": False},
    "Lunge": {"id": "ex-lunge", "name": "Lunge", "is_timed": False},
    "Plank": {"id": "ex-plank", "name": "Plank", "is_timed": True},
    "Dead hang": {"id": "ex-hang", "name": "Dead hang", "is_timed": True},
    "Dumbbell row": {"id": "ex-db", "name": "Dumbbell row", "is_timed": False},
    "Barbell row": {"id": "ex-bb", "name": "Barbell row", "is_timed": False},
}


def item(i, ex_id, name, sets=3, target="8–12", lo=8, hi=12, timed=False, per_side=False):
    return {"id": i, "exercise_id": ex_id, "planned_sets": sets, "rep_target": target, "rep_min": lo, "rep_max": hi, "per_side": per_side,
            "is_timed": timed, "sort_order": 0, "exercises": {"name": name}}


PLAN = [
    {"id": PULL, "name": "Pull A", "day_of_week": 2, "is_optional": False, "sort_order": 0,
     "planned_exercises": [item("p-lat", "ex-lat", "Lat pulldown"), item("p-row", "ex-row", "Seated cable row", target="10–15 / side", lo=10, hi=15, per_side=True)]},
    {"id": LEGS, "name": "Legs", "day_of_week": 4, "is_optional": False, "sort_order": 0,
     "planned_exercises": [item("p-squat", "ex-squat", "Squat", sets=4, target="6–10", lo=6, hi=10), item("p-plank", "ex-plank", "Plank", target="30–45 sec", lo=30, hi=45, timed=True)]},
]


def exercises(request):
    pattern = request.url.params["name"].removeprefix("ilike.").strip("*").lower()
    exact = not request.url.params["name"].startswith("ilike.*")
    return [v for k, v in LIBRARY.items() if (k.lower() == pattern if exact else pattern in k.lower())]


def sb_with_plan():
    fake = FakeSupabase({"program_sessions": PLAN, "exercises": exercises})
    return UserSupabase("https://x.supabase.co", "pub", "good-token", fake.client()), fake


async def build(*changes):
    sb, _ = sb_with_plan()
    return await build_plan_change(sb, [PlanChange(**c) for c in changes])


def test_rep_target_wording_matches_the_plan_screen():
    assert rep_target(8, 12) == "8–12" and rep_target(10, 10) == "10" and rep_target(10, 15, True) == "10–15 / side"


async def test_add_uses_the_plan_screens_defaults_and_shows_the_diff():
    payload, summary, preview = await build({"op": "add", "session": "Thursday", "exercise": "hip thrust"})
    assert payload["request"] == [{"op": "add", "session": "Thursday", "exercise": "hip thrust"}]
    assert {"changes": payload["changes"]} == {"changes": [{"op": "add", "session_id": LEGS, "exercise_id": "ex-hip", "planned_sets": 3, "rep_target": "8–12",
                                    "rep_min": 8, "rep_max": 12, "is_timed": False}]}
    assert summary == "Add Hip thrust to Thursday" and preview == ["+ Thu · Legs: Hip thrust 3 × 8–12"]


async def test_add_with_custom_sets_and_reps_and_timed_exercises():
    payload, _, preview = await build({"op": "add", "session": "legs", "exercise": "Hip thrust", "sets": 4, "rep_min": 6, "rep_max": 10})
    assert payload["changes"][0]["rep_target"] == "6–10" and preview[0].endswith("4 × 6–10")
    timed = await build({"op": "add", "session": "Tuesday", "exercise": "Plank"})
    assert timed[0]["changes"][0]["rep_target"] == "30–45 sec" and timed[0]["changes"][0]["is_timed"] is True
    assert "timed" in await build({"op": "add", "session": "Tuesday", "exercise": "Plank", "rep_min": 8, "rep_max": 12})


async def test_replace_keeps_sets_and_reps_unless_timed_flips():
    payload, summary, preview = await build({"op": "replace", "session": "Thursday", "replaces": "squat", "exercise": "Lunge"})
    ch = payload["changes"][0]
    assert (ch["planned_id"], ch["expected_exercise_id"], ch["exercise_id"], ch["rep_target"], ch["is_timed"]) == ("p-squat", "ex-squat", "ex-lunge", "6–10", False)
    assert summary == "Swap Squat for Lunge on Thursday" and preview == ["~ Thu · Legs: Squat → Lunge"]
    flip, _, _ = await build({"op": "replace", "session": "Thursday", "replaces": "Squat", "exercise": "Dead hang"})
    assert flip["changes"][0]["is_timed"] is True and flip["changes"][0]["rep_target"] == "30–45 sec" and flip["changes"][0]["per_side"] is False
    assert "only swaps" in await build({"op": "replace", "session": "Thursday", "replaces": "Squat", "exercise": "Lunge", "sets": 5})


async def test_edit_changes_sets_and_or_reps_and_keeps_the_per_side_wording():
    payload, _, preview = await build({"op": "edit", "session": "Tuesday", "exercise": "Seated cable row", "sets": 4, "rep_min": 8, "rep_max": 12})
    ch = payload["changes"][0]
    assert (ch["planned_sets"], ch["rep_target"], ch["rep_min"], ch["rep_max"]) == (4, "8–12 / side", 8, 12)
    assert preview == ["~ Tue · Pull A: Seated cable row 3 × 10–15 / side → 4 × 8–12 / side"]
    sets_only, _, _ = await build({"op": "edit", "session": "Tuesday", "exercise": "Lat pulldown", "sets": 5})
    assert sets_only["changes"][0]["rep_target"] == "8–12" and sets_only["changes"][0]["planned_sets"] == 5
    assert "timed" in await build({"op": "edit", "session": "Thursday", "exercise": "Plank", "rep_min": 5, "rep_max": 8})
    assert "needs new sets" in await build({"op": "edit", "session": "Tuesday", "exercise": "Lat pulldown"})


@pytest.mark.parametrize(
    "change, fragment",
    [
        ({"op": "add", "session": "Sunday", "exercise": "Hip thrust"}, "no session"),
        ({"op": "add", "session": "Thursday", "exercise": "Nonexistent lift"}, "No exercise in the library"),
        ({"op": "add", "session": "Thursday", "exercise": "row"}, "Several exercises match"),
        ({"op": "add", "session": "Thursday", "exercise": "Squat"}, "already in"),
        ({"op": "add", "session": "Thursday", "exercise": "Hip thrust", "sets": 11}, "between 1 and 10"),
        ({"op": "add", "session": "Thursday", "exercise": "Hip thrust", "rep_min": 12, "rep_max": 8}, "rep_min no higher"),
        ({"op": "add", "session": "Thursday", "exercise": "Hip thrust", "rep_min": 8}, "both rep_min and rep_max"),
        ({"op": "edit", "session": "Thursday", "exercise": "Lat pulldown", "sets": 4}, "is not in"),
        ({"op": "replace", "session": "Thursday", "replaces": "Squat", "exercise": "Squat"}, "already in that slot"),
    ],
)
async def test_bad_requests_get_a_plain_sentence_not_a_proposal(change, fragment):
    out = await build(change)
    assert isinstance(out, str) and fragment in out


async def test_limits_on_how_many_changes_and_touching_one_row_twice():
    assert "1 to 5" in await build()
    many = [{"op": "edit", "session": "Tuesday", "exercise": "Lat pulldown", "sets": 4}] * 6
    assert "1 to 5" in await build(*many)
    twice = await build({"op": "edit", "session": "Tuesday", "exercise": "Lat pulldown", "sets": 4}, {"op": "edit", "session": "Tuesday", "exercise": "Lat pulldown", "sets": 5})
    assert "two changes" in twice
    assert isinstance(await build({"op": "add", "session": "Thursday", "exercise": "Hip thrust"}, {"op": "add", "session": "Thursday", "exercise": "Hip thrust"}), str)


async def test_tool_stores_a_pending_proposal_and_says_the_plan_is_unchanged():
    sb, fake = sb_with_plan()
    cfg = {"configurable": {"sb": sb, "user_id": "user-1"}}
    out = json.loads(await propose_plan_change.ainvoke({"changes": [{"op": "add", "session": "Thursday", "exercise": "Hip thrust"}]}, config=cfg))
    (table, row), = fake.inserted
    assert table == "agent_proposals" and row["kind"] == "plan_change" and row["user_id"] == "user-1"
    assert row["payload"]["changes"][0]["exercise_id"] == "ex-hip" and row["preview"] == ["+ Thu · Legs: Hip thrust 3 × 8–12"]
    assert out["proposal"]["id"] == row["id"] and "NOT changed" in out["message"]
    bad = json.loads(await propose_plan_change.ainvoke({"changes": [{"op": "add", "session": "Sunday", "exercise": "Hip thrust"}]}, config=cfg))
    assert "error" in bad and len(fake.inserted) == 1  # a bad request stores nothing


async def test_chat_streams_a_plan_change_as_a_proposal_event():
    fake = FakeSupabase({"program_sessions": PLAN, "exercises": exercises, "coach_messages": [],
                         "rpc/agent_register_message": [{"allowed": True, "used": 1}], "rpc/agent_add_tokens": None})
    script = [("tool", "propose_plan_change", {"changes": [{"op": "add", "session": "Thursday", "exercise": "Hip thrust"}]}),
              "I've put that on a card. It's waiting for your approval."]
    app = create_app(Settings(supabase_url="https://x.supabase.co", supabase_key="pub"), model=ScriptedModel(script=script), http=fake.client())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://coach") as c:
        r = await c.post("/chat", json={"message": "add hip thrust to Thursday"}, headers={"authorization": "Bearer good-token"})
    events = [json.loads(line[6:]) for line in r.text.split("\n\n") if line.startswith("data: ")]
    (event,) = [e for e in events if e["type"] == "CUSTOM" and e["name"] == "proposal"]
    assert event["value"]["kind"] == "plan_change" and event["value"]["summary"] == "Add Hip thrust to Thursday"
