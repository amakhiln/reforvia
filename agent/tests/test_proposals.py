import json

import httpx

from coach.cards import proposal_for
from coach.config import Settings
from coach.main import create_app
from coach.proposals import create_proposal
from coach.supa import UserSupabase
from tests.fakes import FakeSupabase, ScriptedModel

SETTINGS = Settings(supabase_url="https://x.supabase.co", supabase_key="pub")
PID = "6f1c1a0e-5d8b-4c6e-9d57-0b1f4f7a9a10"


def app_for(routes):
    fake = FakeSupabase(routes)
    return create_app(SETTINGS, model=ScriptedModel(script=["x"]), http=fake.client()), fake


async def post(app, path, token="good-token"):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://coach") as c:
        return await c.post(path, headers={"authorization": f"Bearer {token}"} if token else {})


async def test_approve_returns_how_it_ended_and_runs_as_the_user():
    app, fake = app_for({"rpc/approve_proposal": {"id": PID, "status": "applied", "decided_at": "2026-11-22T10:00:00Z", "payload": {"secret": 1}}})
    r = await post(app, f"/proposals/{PID}/approve")
    assert r.status_code == 200 and r.json() == {"id": PID, "status": "applied", "decided_at": "2026-11-22T10:00:00Z"}  # no payload leaks back
    assert fake.rpc_calls == [("approve_proposal", {"p_id": PID})]


async def test_reject_and_repeat_taps_report_the_current_status():
    app, fake = app_for({"rpc/reject_proposal": {"id": PID, "status": "applied", "decided_at": None}})
    r = await post(app, f"/proposals/{PID}/reject")
    assert r.status_code == 200 and r.json()["status"] == "applied"  # already decided: shown as it is, not changed
    assert fake.rpc_calls[0][0] == "reject_proposal"


async def test_unknown_or_foreign_proposal_is_404():
    app, _ = app_for({"rpc/approve_proposal": None})
    assert (await post(app, f"/proposals/{PID}/approve")).status_code == 404


async def test_needs_a_signed_in_user_and_a_real_id():
    app, fake = app_for({})
    assert (await post(app, f"/proposals/{PID}/approve", token="bad")).status_code == 401
    assert (await post(app, f"/proposals/{PID}/approve", token=None)).status_code == 401
    assert (await post(app, "/proposals/not-a-uuid/approve")).status_code == 422
    assert not fake.rpc_calls


async def test_database_failure_is_a_clear_502():
    class Down(FakeSupabase):
        def handler(self, request):
            if "/rpc/" in request.url.path:
                return httpx.Response(500, json={"message": "db down"})
            return super().handler(request)

    fake = Down({})
    app = create_app(SETTINGS, model=ScriptedModel(script=["x"]), http=fake.client())
    r = await post(app, f"/proposals/{PID}/approve")
    assert r.status_code == 502 and "db down" not in r.text


async def test_create_proposal_stores_a_pending_row_for_the_user_and_trims_the_preview():
    fake = FakeSupabase({})
    sb = UserSupabase("https://x.supabase.co", "pub", "good-token", fake.client())
    card = await create_proposal(sb, "user-1", "plan_change", {"op": "add"}, "Add hip thrust", ["+ Hip thrust 3 x 8-12", "  ", "x" * 500] + ["l"] * 20)
    (table, row), = fake.inserted
    assert table == "agent_proposals" and row["user_id"] == "user-1" and row["kind"] == "plan_change" and row["payload"] == {"op": "add"}
    assert "status" not in row  # the database sets pending
    assert len(row["preview"]) == 8 and len(row["preview"][1]) == 200
    assert card["id"] == row["id"] and set(card) == {"id", "kind", "summary", "preview", "expires_at"}


async def test_unknown_kind_is_refused():
    sb = UserSupabase("https://x.supabase.co", "pub", "t", FakeSupabase({}).client())
    try:
        await create_proposal(sb, "u", "delete_everything", {}, "x", [])
    except ValueError:
        return
    raise AssertionError("accepted an unknown kind")


def test_proposal_for_reads_only_complete_proposals():
    ok = {"proposal": {"id": PID, "kind": "memory", "summary": "Remember", "preview": ["a"], "expires_at": "2026-11-22T10:30:00Z", "payload": {"x": 1}}}
    assert proposal_for(json.dumps(ok)) == {k: ok["proposal"].get(k) for k in ("id", "kind", "summary", "preview", "expires_at")}
    assert proposal_for(json.dumps({"proposal": {"id": PID}})) is None
    assert proposal_for(json.dumps({"weeks": []})) is None and proposal_for("nope") is None


async def test_a_tool_that_stores_a_proposal_reaches_the_stream_as_a_proposal_event(monkeypatch):
    from langchain_core.tools import tool

    from coach import graph as graph_module

    @tool
    async def propose_thing() -> str:
        """Pretend tool that stored a proposal."""
        return json.dumps({"proposal": {"id": PID, "kind": "memory", "summary": "Remember it", "preview": ["+ a note"], "expires_at": "2026-11-22T10:30:00Z"}})

    monkeypatch.setattr(graph_module, "TOOLS", [propose_thing])
    fake = FakeSupabase({"coach_messages": [], "rpc/agent_register_message": [{"allowed": True, "used": 1}], "rpc/agent_add_tokens": None})
    app = create_app(SETTINGS, model=ScriptedModel(script=[("tool", "propose_thing", {}), "I have suggested that. Approve it on the card."]), http=fake.client())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://coach") as c:
        r = await c.post("/chat", json={"message": "remember this"}, headers={"authorization": "Bearer good-token"})
    events = [json.loads(line[6:]) for line in r.text.split("\n\n") if line.startswith("data: ")]
    (event,) = [e for e in events if e["type"] == "CUSTOM" and e["name"] == "proposal"]
    assert event["value"]["id"] == PID and event["value"]["preview"] == ["+ a note"]
