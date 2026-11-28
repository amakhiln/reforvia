import json

import httpx

from coach.cards import proposal_for
from coach.config import Settings
from coach.main import create_app
from coach.pending import load_pending, pending_block, supersede
from coach.planchange import PlanChange, build_plan_change
from coach.supa import UserSupabase
from coach.tools import get_weekly_review, propose_plan_change
from tests.fakes import FakeSupabase, ScriptedModel
from tests.test_planchange import PLAN, exercises

SETTINGS = Settings(supabase_url="https://x.supabase.co", supabase_key="pub")
REVIEW = {"week_start": "2026-11-16", "content": "Solid week\n\nAdd back work.", "stats": {
    "sessions": 4, "planned_sessions": 5, "volume_kg": 20000, "prev_volume_kg": 18000, "trained_days": [1, 2, 4], "plan_days": [1, 2, 4, 5],
    "lifts": [{"exercise": "Lat pulldown", "sets": 3, "new_best": True, "best_e1rm_kg": 70, "prior_best_e1rm_kg": 66},
              {"exercise": "Squat", "sets": 4, "new_best": False}],
    "targets": [{"exercise": "Lat pulldown", "kind": "increase", "next_load_kg": 55, "target_reps": 8, "plan": "3 × 8–12"}]}}
PENDING = {"id": "old-1", "preview": ["+ Thu · Legs: Hip thrust 3 × 8–12"], "payload": {"request": [{"op": "add", "session": "Thursday", "exercise": "Hip thrust"}]}}


def sb_for(routes):
    fake = FakeSupabase(routes)
    return UserSupabase("https://x.supabase.co", "pub", "good-token", fake.client()), fake


def cfg(sb):
    return {"configurable": {"sb": sb, "user_id": "user-1"}}


async def test_review_tool_reports_the_numbers_and_skipped_days():
    sb, fake = sb_for({"weekly_summaries": [REVIEW]})
    out = json.loads(await get_weekly_review.ainvoke({}, config=cfg(sb)))
    assert out["week_of"] == "2026-11-16" and out["sessions"] == 4 and out["planned_sessions"] == 5
    assert out["days_trained"] == ["Monday", "Tuesday", "Thursday"] and out["planned_days_skipped"] == ["Friday"]
    assert out["new_bests"] == [{"exercise": "Lat pulldown", "est_1rm_kg_before": 66, "est_1rm_kg_now": 70}]
    assert out["next_week_loads"][0]["next_load_kg"] == 55
    assert all(r.method == "GET" for r in fake.requests)  # reading only


async def test_review_tool_says_when_there_is_none_and_copes_with_an_old_review():
    sb, _ = sb_for({"weekly_summaries": []})
    assert json.loads(await get_weekly_review.ainvoke({}, config=cfg(sb)))["review"] is None
    sb, _ = sb_for({"weekly_summaries": [{"week_start": "2026-11-02", "content": "old", "stats": {"sessions": 2}}]})
    out = json.loads(await get_weekly_review.ainvoke({}, config=cfg(sb)))
    assert out["sessions"] == 2 and out["new_bests"] == [] and out["planned_days_skipped"] == []


async def test_the_preview_shows_the_whole_day_with_each_change_marked():
    sb, _ = sb_for({"program_sessions": PLAN, "exercises": exercises})
    payload, _, _ = await build_plan_change(sb, [
        PlanChange(op="replace", session="Thursday", replaces="Squat", exercise="Lunge"),
        PlanChange(op="add", session="Thursday", exercise="Hip thrust"),
        PlanChange(op="edit", session="Tuesday", exercise="Lat pulldown", sets=4),
    ])
    tue, thu = payload["view"]  # in weekday order
    assert tue["session"] == "Tuesday · Pull A" and [r["status"] for r in tue["rows"]] == ["changed", "same"]
    assert tue["rows"][0] == {"name": "Lat pulldown", "detail": "4 × 8–12", "status": "changed", "was": "3 × 8–12"}
    assert [(r["name"], r["status"]) for r in thu["rows"]] == [("Lunge", "replaced"), ("Plank", "same"), ("Hip thrust", "added")]
    assert thu["rows"][0]["was"] == "Squat · 4 × 6–10" and all("id" not in r for v in payload["view"] for r in v["rows"])
    assert [c["op"] for c in payload["request"]] == ["replace", "add", "edit"]


def test_pending_block_tells_the_coach_how_to_adjust():
    block = pending_block(PENDING)
    assert "+ Thu · Legs: Hip thrust 3 × 8–12" in block and '"exercise": "Hip thrust"' in block
    assert "new card replaces this one" in block and "you cannot approve it" in block and "nothing in the plan has changed" in block
    assert pending_block(None) == ""


async def test_load_pending_asks_only_for_unexpired_unanswered_plan_changes():
    sb, fake = sb_for({"agent_proposals": [PENDING]})
    assert await load_pending(sb) == PENDING
    url = str(fake.requests[-1].url)
    assert "kind=eq.plan_change" in url and "status=eq.pending" in url and "expires_at=gt." in url and "limit=1" in url
    broken = UserSupabase("https://x.supabase.co", "pub", "wrong", FakeSupabase({}).client())
    assert await load_pending(broken) is None


async def test_a_new_proposal_retires_the_one_waiting_but_never_itself():
    sb, fake = sb_for({"program_sessions": PLAN, "exercises": exercises, "agent_proposals": [{"id": "old-1"}, {"id": "old-2"}],
                       "rpc/reject_proposal": lambda body: {"id": body["p_id"], "status": "rejected" if body["p_id"] == "old-1" else "applied"}})
    out = json.loads(await propose_plan_change.ainvoke({"changes": [{"op": "add", "session": "Thursday", "exercise": "Hip thrust", "sets": 4}]}, config=cfg(sb)))
    new_id = out["proposal"]["id"]
    assert out["proposal"]["replaces"] == ["old-1"]  # old-2 had already been applied, so it is not claimed as replaced
    assert [c[1]["p_id"] for c in fake.rpc_calls] == ["old-1", "old-2"] and new_id not in [c[1]["p_id"] for c in fake.rpc_calls]
    assert out["proposal"]["view"][0]["rows"][-1]["status"] == "added" and "adjust it first" in out["message"]
    assert "status" not in fake.inserted[0][1]  # the database makes it pending
    assert not [c for c in fake.rpc_calls if c[0] == "approve_proposal"]  # nothing is ever approved by the coach


async def test_a_refused_change_leaves_the_waiting_one_alone():
    sb, fake = sb_for({"program_sessions": PLAN, "exercises": exercises, "agent_proposals": [{"id": "old-1"}]})
    out = json.loads(await propose_plan_change.ainvoke({"changes": [{"op": "add", "session": "Sunday", "exercise": "Hip thrust"}]}, config=cfg(sb)))
    assert "error" in out and not fake.rpc_calls and not fake.inserted


async def test_retire_survives_a_database_error():
    broken = UserSupabase("https://x.supabase.co", "pub", "wrong", FakeSupabase({}).client())
    assert await supersede(broken, "new") == []


def test_the_card_event_carries_the_preview_and_what_it_replaces():
    prop = {"proposal": {"id": "a", "kind": "plan_change", "summary": "s", "preview": ["x"], "expires_at": "t",
                         "view": [{"session": "Thu", "rows": []}], "replaces": ["old-1"], "payload": {"secret": 1}}}
    card = proposal_for(json.dumps(prop))
    assert card["view"] == [{"session": "Thu", "rows": []}] and card["replaces"] == ["old-1"] and "payload" not in card


async def test_the_chat_shows_the_coach_the_waiting_change_and_the_nutrition_agent_never_sees_it():
    for agent, expected in (("coach", True), ("nutrition", False)):
        fake = FakeSupabase({"coach_messages": [], "agent_proposals": [PENDING], "agent_chat_summary": [],
                             "rpc/agent_register_message": [{"allowed": True, "used": 1}], "rpc/agent_add_tokens": None})
        model = ScriptedModel(script=["ok"], seen=[])
        app = create_app(SETTINGS, model=model, http=fake.client())
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://coach") as c:
            await c.post("/chat", json={"message": "make it 4 sets", "agent": agent}, headers={"authorization": "Bearer good-token"})
        assert ("A plan change is waiting" in model.seen[0][0].content) is expected


async def test_review_tool_uses_the_corrected_counts_when_a_review_has_them():
    stats = {**REVIEW["stats"], "sessions": 5, "planned_done": 4, "extra_sessions": 1, "missed_sessions": ["Cardio"], "trained_days": [1, 3], "missed_days": [5]}
    sb, _ = sb_for({"weekly_summaries": [{**REVIEW, "stats": stats}]})
    out = json.loads(await get_weekly_review.ainvoke({}, config=cfg(sb)))
    assert (out["planned_sessions_done"], out["extra_sessions"], out["missed_sessions"]) == (4, 1, ["Cardio"])
    assert out["planned_days_skipped"] == ["Friday"]  # Tuesday and Thursday had no workout, but their sessions were done


def test_the_analyst_is_told_to_judge_by_planned_sessions_done():
    from coach.analyst import ANALYST_PROMPT

    assert "planned_done" in ANALYST_PROMPT and "missed_sessions" in ANALYST_PROMPT and "never by the total" in ANALYST_PROMPT
