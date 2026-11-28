import json

import httpx

from coach.analyst import ANALYST_PROMPT
from coach.supa import UserSupabase
from coach.tools import get_recent_workouts, get_weekly_review
from tests.fakes import FakeSupabase

SKIP = {"skipped_on": "2026-11-20", "session_name": "Cardio / recovery", "reason": "sick"}
WORKOUT = {"session_name": "Pull A", "performed_on": "2026-11-16", "finished_at": None, "workout_exercises": []}


def cfg(routes, cls=FakeSupabase):
    fake = cls(routes)
    return {"configurable": {"sb": UserSupabase("https://x.supabase.co", "pub", "good-token", fake.client()), "user_id": "u"}}


async def test_recent_workouts_include_days_marked_skipped():
    out = json.loads(await get_recent_workouts.ainvoke({}, config=cfg({"workouts": [WORKOUT], "session_skips": [SKIP]})))
    assert out["days_marked_skipped"] == [{"date": "2026-11-20", "session": "Cardio / recovery", "reason": "sick"}] and len(out["workouts"]) == 1
    none = json.loads(await get_recent_workouts.ainvoke({}, config=cfg({"workouts": [WORKOUT], "session_skips": []})))
    assert "days_marked_skipped" not in none
    only = json.loads(await get_recent_workouts.ainvoke({}, config=cfg({"workouts": [], "session_skips": [SKIP]})))
    assert only["workouts"] == [] and only["days_marked_skipped"][0]["reason"] == "sick"


async def test_recent_workouts_still_work_before_the_skips_table_exists():
    class NoTable(FakeSupabase):
        def handler(self, request):
            if request.url.path.endswith("/session_skips"):
                return httpx.Response(404, json={"message": "relation does not exist"})
            return super().handler(request)

    out = json.loads(await get_recent_workouts.ainvoke({}, config=cfg({"workouts": [WORKOUT]}, NoTable)))
    assert len(out["workouts"]) == 1 and "days_marked_skipped" not in out


async def test_review_tool_passes_on_marked_skips():
    review = {"week_start": "2026-11-16", "content": "x", "stats": {"skipped_sessions": [{"session": "Cardio / recovery", "reason": "sick"}], "missed_days": []}}
    out = json.loads(await get_weekly_review.ainvoke({}, config=cfg({"weekly_summaries": [review]})))
    assert out["sessions_marked_skipped"] == [{"session": "Cardio / recovery", "reason": "sick"}] and out["planned_days_skipped"] == []


def test_the_analyst_is_told_not_to_scold_a_marked_skip():
    assert "skipped_sessions" in ANALYST_PROMPT and "do not scold" in ANALYST_PROMPT
