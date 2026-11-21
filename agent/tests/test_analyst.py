import json
from datetime import date, datetime
from zoneinfo import ZoneInfo

import httpx
import pytest

from coach import auth
from coach.analyst import last_completed_week, split_summary
from coach.config import Settings
from coach.main import create_app
from tests.fakes import FakeSupabase, ScriptedModel

SETTINGS = Settings(
    supabase_url="https://x.supabase.co", supabase_key="pub", service_key="service-token", cron_secret="s3cret",
    vapid_private_key="", vapid_subject="", analyst_tz="Asia/Kolkata",
)
STATS = {"sessions": 3, "sets": 40, "volume_kg": 5000, "prev_sessions": 2, "prev_volume_kg": 4000, "planned_sessions": 5,
         "lifts": [{"exercise": "Lat pulldown", "new_best": True}]}
SUMMARY = "Three sessions, volume up 25%\n\n- **3 of 5** planned sessions\n- Lat pulldown hit a new best"


@pytest.fixture(autouse=True)
def clear_auth_cache():
    auth._CACHE.clear()


def build(routes=None, model_script=None, push=None):
    base = {"rpc/analyst_users": [{"user_id": "user-1"}], "rpc/analyst_week_stats": STATS, "push_subscriptions": []}
    fake = FakeSupabase({**base, **(routes or {})}, valid_token="service-token")
    model = ScriptedModel(script=model_script or [SUMMARY], seen=[])
    app = create_app(SETTINGS, model=model, http=fake.client(), push=push)
    fake.model = model
    return app, fake


async def call(app, path="/internal/weekly-run?wait=true", headers=None):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://coach") as c:
        return await c.post(path, headers=headers or {})


def test_last_completed_week_is_the_previous_monday():
    sun = datetime(2026, 11, 15, 10, 0, tzinfo=ZoneInfo("Asia/Kolkata"))
    assert last_completed_week("Asia/Kolkata", sun) == date(2026, 11, 2)  # week of Nov 9 is still running
    mon = datetime(2026, 11, 16, 0, 5, tzinfo=ZoneInfo("Asia/Kolkata"))
    assert last_completed_week("Asia/Kolkata", mon) == date(2026, 11, 9)


def test_split_summary_strips_markdown_from_headline():
    assert split_summary("**Big week**\n\n- a") == ("Big week", "- a")
    assert split_summary("")[0] == "Your week in review"


async def test_cron_requires_secret():
    app, fake = build()
    assert (await call(app)).status_code == 403
    assert (await call(app, headers={"x-cron-secret": "wrong"})).status_code == 403
    assert not fake.rpc_calls  # nothing ran


async def test_cron_not_configured():
    app = create_app(Settings(supabase_url="https://x", supabase_key="p"), model=ScriptedModel(script=["x"]))
    assert (await call(app, headers={"x-cron-secret": "anything"})).status_code == 503


async def test_weekly_run_writes_summary_and_pushes():
    sent = []

    async def push(sub, payload):
        sent.append((sub["endpoint"], payload))
        return "ok"

    subs = [{"id": "s1", "endpoint": "https://push/1", "p256dh": "k", "auth": "a"}]
    app, fake = build({"push_subscriptions": subs}, push=push)
    r = await call(app, headers={"x-cron-secret": "s3cret"})
    assert r.status_code == 202
    assert r.json()["created"] == 1 and r.json()["failed"] == 0
    (table, row), = [i for i in fake.inserted if i[0] == "weekly_summaries"]
    assert row["user_id"] == "user-1" and row["content"] == SUMMARY and row["stats"] == {**STATS, "targets": []}
    assert row["week_start"] == last_completed_week("Asia/Kolkata").isoformat()
    assert sent and sent[0][1]["body"] == "Three sessions, volume up 25%" and sent[0][1]["url"] == "/summaries"
    # the model was given exactly the numbers from the database
    prompt = fake.model.seen[0]
    assert json.dumps({**STATS, "targets": []}, ensure_ascii=False) in prompt[-1].content and "Never invent" in prompt[0].content


async def test_idle_users_are_skipped_without_calling_the_model():
    app, fake = build({"rpc/analyst_week_stats": {**STATS, "sessions": 0}})
    r = await call(app, headers={"x-cron-secret": "s3cret"})
    assert r.json()["idle"] == 1 and r.json()["created"] == 0
    assert not [i for i in fake.inserted if i[0] == "weekly_summaries"]


async def test_dead_push_subscription_is_removed_and_failures_are_isolated():
    async def push(sub, payload):
        return "gone"

    subs = [{"id": "s1", "endpoint": "https://push/1", "p256dh": "k", "auth": "a"}]
    app, fake = build({"push_subscriptions": subs, "rpc/analyst_users": [{"user_id": "u1"}, {"user_id": "u2"}]}, push=push)
    r = await call(app, headers={"x-cron-secret": "s3cret"})
    assert r.json()["created"] == 2
    deletes = [q for q in fake.requests if q.method == "DELETE"]
    assert len(deletes) == 2 and "id=eq.s1" in str(deletes[0].url)


async def test_one_users_failure_does_not_stop_the_run():
    class FlakyModel(ScriptedModel):
        def _next(self, messages):
            step = super()._next(messages)
            if self.cursor == 1:
                raise RuntimeError("model down")
            return step

    fake = FakeSupabase({"rpc/analyst_users": [{"user_id": "u1"}, {"user_id": "u2"}], "rpc/analyst_week_stats": STATS,
                         "push_subscriptions": []}, valid_token="service-token")
    app = create_app(SETTINGS, model=FlakyModel(script=[SUMMARY], seen=[]), http=fake.client())
    r = await call(app, headers={"x-cron-secret": "s3cret"})
    assert r.json()["failed"] == 1 and r.json()["created"] == 1
    assert [row["user_id"] for t, row in fake.inserted if t == "weekly_summaries"] == ["u2"]


async def test_generate_twice_does_not_call_the_model_again():
    have = lambda request: [{"id": "s1"}] if "weekly_summaries" in request.url.path else []
    fake = FakeSupabase({"weekly_summaries": have, "rpc/analyst_week_stats": STATS, "push_subscriptions": []},
                        user_id="user-9", valid_token="service-token")
    model = ScriptedModel(script=[SUMMARY], seen=[])
    app = create_app(SETTINGS, model=model, http=fake.client())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://coach") as c:
        r = await c.post("/summaries/generate", headers={"authorization": "Bearer service-token"})
    assert r.status_code == 200 and r.json()["status"] == "exists"
    assert not model.seen and not fake.rpc_calls and not fake.inserted


async def test_generate_for_signed_in_user():
    fake = FakeSupabase({"rpc/analyst_week_stats": STATS, "push_subscriptions": []}, user_id="user-9", valid_token="service-token")
    app = create_app(SETTINGS, model=ScriptedModel(script=[SUMMARY]), http=fake.client())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://coach") as c:
        assert (await c.post("/summaries/generate")).status_code == 401
        r = await c.post("/summaries/generate", headers={"authorization": "Bearer service-token"})
    assert r.status_code == 200 and r.json()["status"] == "created"
    assert fake.rpc_calls[0] == ("analyst_week_stats", {"p_user": "user-9", "p_week_start": r.json()["week_start"]})
