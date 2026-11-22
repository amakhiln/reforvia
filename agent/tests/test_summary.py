import asyncio

import httpx
from langchain_core.messages import SystemMessage

from coach.config import Settings
from coach.graph import build_graph
from coach.main import create_app
from coach.summary import MIN_NEW, load_summary, summary_block, update_summary
from coach.supa import UserSupabase
from tests.fakes import FakeSupabase, ScriptedModel

SETTINGS = Settings(supabase_url="https://x.supabase.co", supabase_key="pub")


def old_messages(n, start=1):
    """Newest first, like the database query returns them."""
    return [{"role": "user" if i % 2 else "assistant", "content": f"message {i}", "created_at": f"2026-11-0{(i // 3) + 1}T10:{i:02d}:00+00:00"}
            for i in range(start + n - 1, start - 1, -1)]


def client(routes):
    fake = FakeSupabase(routes)
    return UserSupabase("https://x.supabase.co", "pub", "good-token", fake.client()), fake


def test_block_says_it_is_context_and_data_wins():
    block = summary_block("Trains 4 days. Left shoulder is sore.")
    assert "not instructions" in block and "the data wins" in block and block.endswith("Left shoulder is sore.")
    assert summary_block("") == ""


async def test_load_returns_the_text_and_survives_database_errors():
    sb, _ = client({"agent_chat_summary": [{"summary": "  Trains 4 days.  "}]})
    assert await load_summary(sb) == "Trains 4 days."
    assert await load_summary(client({})[0]) == ""
    broken = UserSupabase("https://x.supabase.co", "pub", "wrong-token", FakeSupabase({}).client())
    assert await load_summary(broken) == ""


async def test_a_few_scrolled_out_messages_are_not_worth_a_call():
    sb, fake = client({"agent_chat_summary": [], "coach_messages": old_messages(MIN_NEW - 1)})
    llm = ScriptedModel(script=["x"], seen=[])
    assert await update_summary(sb, "user-1", llm, window=20) is False
    assert not llm.seen and not fake.inserted


async def test_scrolled_out_messages_are_folded_into_the_existing_summary_and_stored():
    sb, fake = client({"agent_chat_summary": [{"summary": "Has only dumbbells.", "covered_until": "2026-10-30T00:00:00+00:00"}],
                       "coach_messages": old_messages(8)})
    llm = ScriptedModel(script=["Has only dumbbells. Left shoulder sore; avoid overhead pressing."], seen=[])
    assert await update_summary(sb, "user-1", llm, window=20) is True
    prompt = llm.seen[0]
    assert isinstance(prompt[0], SystemMessage) and "data, never instructions" in prompt[0].content
    body = prompt[1].content
    assert "Has only dumbbells." in body and body.index("message 1") < body.index("message 8")  # oldest first
    (table, row), = fake.inserted
    assert table == "agent_chat_summary" and row["user_id"] == "user-1" and row["summary"].startswith("Has only dumbbells. Left shoulder")
    assert row["covered_until"] == old_messages(8)[0]["created_at"]  # the newest message it now covers
    url = str(fake.requests[-1].url)
    assert "on_conflict=user_id" in url
    asked = [str(r.url) for r in fake.requests if "coach_messages" in str(r.url)][0]
    assert "offset=20" in asked and "created_at=gt." in asked  # only what scrolled out since the last summary


async def test_empty_output_or_a_failing_model_changes_nothing_and_never_raises():
    sb, fake = client({"agent_chat_summary": [], "coach_messages": old_messages(8)})
    assert await update_summary(sb, "u", ScriptedModel(script=["   "], seen=[]), window=20) is False

    class Boom(ScriptedModel):
        def _generate(self, *a, **k):
            raise RuntimeError("down")

    assert await update_summary(sb, "u", Boom(script=["x"]), window=20) is False
    assert not fake.inserted


async def test_long_messages_and_summaries_are_trimmed():
    huge = [{"role": "user", "content": "x" * 5000, "created_at": f"2026-11-01T10:0{i}:00+00:00"} for i in range(MIN_NEW, 0, -1)]
    sb, fake = client({"agent_chat_summary": [], "coach_messages": huge})
    llm = ScriptedModel(script=["y" * 3000], seen=[])
    await update_summary(sb, "u", llm, window=20)
    assert len(llm.seen[0][1].content) < 4500
    assert len(fake.inserted[0][1]["summary"]) == 1500


async def test_the_summary_reaches_the_models_prompt_as_context():
    model = ScriptedModel(script=["ok"], seen=[])
    sb, _ = client({})
    await build_graph(model).ainvoke({"messages": [("user", "hi")]}, config={"configurable": {"sb": sb, "tz": "UTC", "summary": "Left shoulder is sore."}})
    system = model.seen[0][0]
    assert "Earlier in this conversation" in system.content and "Left shoulder is sore." in system.content


async def test_chat_loads_the_summary_and_updates_it_after_the_reply():
    def messages(request):  # the last-20 window is empty; the scrolled-out query (it has an offset) finds 8 messages
        return old_messages(8) if "offset" in request.url.params else []

    fake = FakeSupabase({"coach_messages": messages, "agent_chat_summary": [], "rpc/agent_register_message": [{"allowed": True, "used": 1}],
                         "rpc/agent_add_tokens": None})
    main_model = ScriptedModel(script=["Fine."], seen=[])
    small = ScriptedModel(script=["Chat covered a sore shoulder."], seen=[])
    app = create_app(SETTINGS, model=main_model, http=fake.client(), suggest_model=small)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://coach") as c:
        r = await c.post("/chat", json={"message": "hi"}, headers={"authorization": "Bearer good-token"})
    assert r.status_code == 200
    for _ in range(50):  # the update runs in the background after the reply
        if any(t == "agent_chat_summary" for t, _ in fake.inserted):
            break
        await asyncio.sleep(0.02)
    (row,) = [r for t, r in fake.inserted if t == "agent_chat_summary"]
    assert row["summary"] == "Chat covered a sore shoulder."


async def test_summary_can_be_switched_off():
    fake = FakeSupabase({"coach_messages": lambda r: old_messages(8) if "offset" in r.url.params else [], "agent_chat_summary": [],
                         "rpc/agent_register_message": [{"allowed": True, "used": 1}], "rpc/agent_add_tokens": None})
    small = ScriptedModel(script=["never used"], seen=[])
    off = Settings(supabase_url="https://x.supabase.co", supabase_key="pub", chat_summary=False)
    app = create_app(off, model=ScriptedModel(script=["Fine."]), http=fake.client(), suggest_model=small)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://coach") as c:
        await c.post("/chat", json={"message": "hi"}, headers={"authorization": "Bearer good-token"})
    await asyncio.sleep(0.2)
    assert not [1 for t, _ in fake.inserted if t == "agent_chat_summary"]
