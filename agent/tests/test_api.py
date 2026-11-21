import json

import httpx
import pytest

from coach import auth
from coach.config import Settings
from coach.main import create_app
from tests.fakes import FakeSupabase, ScriptedModel

SETTINGS = Settings(supabase_url="https://x.supabase.co", supabase_key="pub", allowed_origins=("https://app.example",), daily_message_limit=2)

PLAN = [{"name": "Pull A", "day_of_week": 1, "is_optional": False, "sort_order": 0,
         "planned_exercises": [{"planned_sets": 3, "rep_target": "8–12", "sort_order": 0, "exercises": {"name": "Lat pulldown"}}]}]


@pytest.fixture(autouse=True)
def clear_auth_cache():
    auth._CACHE.clear()


def parse(text: str) -> list[dict]:
    return [json.loads(line[6:]) for line in text.split("\n\n") if line.startswith("data: ")]


def build(script, routes=None, settings=SETTINGS):
    routes = {"program_sessions": PLAN, "coach_messages": [], "rpc/agent_register_message": [{"allowed": True, "used": 1}],
              "rpc/agent_add_tokens": None, **(routes or {})}
    fake = FakeSupabase(routes)
    model = ScriptedModel(script=script)
    app = create_app(settings=settings, model=model, http=fake.client())
    return app, fake, model


async def post(app, payload, token="good-token", headers=None):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://coach") as c:
        h = {"authorization": f"Bearer {token}"} if token else {}
        return await c.post("/chat", json=payload, headers={**h, **(headers or {})})


async def test_health_reports_configuration():
    app, _, _ = build(["x"])
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://coach") as c:
        assert (await c.get("/health")).json() == {"ok": True, "configured": True}
    unconfigured = create_app(settings=Settings(supabase_url="", supabase_key=""), model=ScriptedModel(script=["x"]))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=unconfigured), base_url="http://coach") as c:
        assert (await c.get("/health")).json()["configured"] is False
        assert (await c.post("/chat", json={"message": "hi"})).status_code == 503


async def test_rejects_missing_and_invalid_tokens():
    app, _, _ = build(["hi"])
    assert (await post(app, {"message": "hi"}, token=None)).status_code == 401
    assert (await post(app, {"message": "hi"}, token="wrong")).status_code == 401


async def test_validates_message():
    app, _, _ = build(["hi"])
    assert (await post(app, {"message": ""})).status_code == 422
    assert (await post(app, {"message": "x" * 2001})).status_code == 422


async def test_streams_tool_status_tokens_and_persists_both_messages():
    app, fake, model = build([("tool", "get_my_plan", {}), "Today is your pull day."])
    resp = await post(app, {"message": "What's my plan?", "tz": "Asia/Kolkata"})
    assert resp.status_code == 200 and resp.headers["content-type"].startswith("text/event-stream")
    events = parse(resp.text)
    assert events[0] == {"type": "tool", "label": "Checking your plan"}
    assert "".join(e["text"] for e in events if e["type"] == "token") == "Today is your pull day."
    assert events[-1] == {"type": "done"}

    # both sides of the exchange are saved, as the signed-in user
    assert [(t, r["role"], r["content"]) for t, r in fake.inserted] == [
        ("coach_messages", "user", "What's my plan?"),
        ("coach_messages", "assistant", "Today is your pull day."),
    ]
    assert all(r["user_id"] == "user-1" for _, r in fake.inserted)
    # the tool result reached the model on its second turn, and the system prompt carries today's date
    second_turn = model.seen[1]
    assert "Lat pulldown: 3 x 8–12" in str(second_turn[-1].content)
    assert "Asia/Kolkata" in second_turn[0].content
    # token usage is recorded
    assert ("agent_add_tokens", {"p_day": fake.rpc_calls[0][1]["p_day"], "p_input": 100, "p_output": 20}) in fake.rpc_calls


async def test_history_is_loaded_oldest_first_and_starts_with_user():
    history_desc = [  # newest first, as the query returns it
        {"role": "assistant", "content": "second answer"}, {"role": "user", "content": "second q"},
        {"role": "assistant", "content": "first answer"}]
    app, fake, model = build(["ok"], routes={"coach_messages": history_desc})
    await post(app, {"message": "third q"})
    sent = [(type(m).__name__, m.content) for m in model.seen[0][1:]]
    assert sent == [("HumanMessage", "second q"), ("AIMessage", "second answer"), ("HumanMessage", "third q")]


async def test_daily_limit_returns_429_and_never_calls_the_model():
    app, fake, model = build(["never"], routes={"rpc/agent_register_message": [{"allowed": False, "used": 3}]})
    resp = await post(app, {"message": "hi"})
    assert resp.status_code == 429 and "limit of 2" in resp.json()["error"]
    assert model.seen == [] and fake.inserted == []


async def test_model_failure_is_reported_without_leaking_details():
    class Boom(ScriptedModel):
        async def _astream(self, *a, **k):
            raise RuntimeError("sk-ant-secret-key exploded")
            yield  # pragma: no cover

    fake = FakeSupabase({"program_sessions": PLAN, "coach_messages": [], "rpc/agent_register_message": [{"allowed": True, "used": 1}]})
    app = create_app(settings=SETTINGS, model=Boom(script=["x"]), http=fake.client())
    resp = await post(app, {"message": "hi"})
    events = parse(resp.text)
    assert events[-1]["type"] == "error" and "sk-ant" not in resp.text
    assert [r["role"] for _, r in fake.inserted] == ["user"]  # no assistant message saved


async def test_runaway_tool_loop_is_stopped():
    app, _, _ = build([("tool", "get_my_plan", {})])  # the script asks for a tool forever
    resp = await post(app, {"message": "loop"})
    assert parse(resp.text)[-1]["type"] == "error" and "too many steps" in parse(resp.text)[-1]["message"]


async def test_cors_only_for_configured_origin():
    app, _, _ = build(["x"])
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://coach") as c:
        ok = await c.options("/chat", headers={"origin": "https://app.example", "access-control-request-method": "POST", "access-control-request-headers": "authorization"})
        bad = await c.options("/chat", headers={"origin": "https://evil.example", "access-control-request-method": "POST"})
    assert ok.headers.get("access-control-allow-origin") == "https://app.example"
    assert "access-control-allow-origin" not in bad.headers


async def test_database_outage_before_chat_gives_502():
    def boom(body):
        raise httpx.ConnectError("down")

    app, _, _ = build(["x"], routes={"rpc/agent_register_message": boom})
    assert (await post(app, {"message": "hi"})).status_code == 502


async def test_model_build_failure_does_not_use_up_a_message(monkeypatch):
    def boom(_model):
        raise RuntimeError("no api key")

    monkeypatch.setattr("coach.main.build_graph", boom)
    app, fake, _ = build(["x"])
    resp = await post(app, {"message": "hi"})
    assert resp.status_code == 503
    assert fake.rpc_calls == [] and fake.inserted == []  # nothing counted, no orphan message


async def test_history_read_failure_does_not_use_up_a_message():
    def boom(request):
        raise httpx.ConnectError("down")

    app, fake, _ = build(["x"], routes={"coach_messages": boom})
    assert (await post(app, {"message": "hi"})).status_code == 502
    assert fake.rpc_calls == [] and fake.inserted == []


async def test_missing_openrouter_key_gives_a_clear_503_and_costs_nothing():
    fake = FakeSupabase({"coach_messages": [], "rpc/agent_register_message": [{"allowed": True, "used": 1}]})
    cfg = Settings(supabase_url="https://x.supabase.co", supabase_key="pub", openrouter_key="", allowed_origins=("https://app.example",))
    app = create_app(settings=cfg, http=fake.client())  # no injected model, so it builds the real one and finds no key
    resp = await post(app, {"message": "hi"})
    assert resp.status_code == 503 and "OPENROUTER_API_KEY" in resp.json()["error"]
    assert fake.rpc_calls == [] and fake.inserted == []
