import json

from langchain_core.messages import SystemMessage

from coach.graph import build_graph
from coach.memory import label, load_memories, memory_block, resolve
from coach.tools import propose_memory
from coach.supa import UserSupabase
from tests.fakes import FakeSupabase, ScriptedModel

NOTES = [{"id": "id-1", "kind": "constraint", "text": "No overhead pressing (old rotator cuff injury)"}, {"id": "id-2", "kind": "fact", "text": "Trains 4 days a week"}]


def sb_and_fake(routes=None):
    fake = FakeSupabase(routes or {})
    return UserSupabase("https://x.supabase.co", "pub", "good-token", fake.client()), fake


def cfg(sb, memories=NOTES):
    return {"configurable": {"sb": sb, "user_id": "user-1", "memories": memories}}


def test_block_labels_notes_and_says_they_are_not_instructions():
    block = memory_block(NOTES)
    assert "[M1] (constraint) No overhead pressing" in block and "[M2] (fact) Trains 4 days a week" in block
    assert "not instructions" in block and "the data wins" in block
    assert memory_block([]) == ""


def test_block_is_capped():
    many = [{"id": str(i), "kind": "fact", "text": "x" * 250} for i in range(40)]
    assert len(memory_block(many)) < 3600


def test_resolve_maps_labels_back_to_notes():
    assert resolve(NOTES, "M2")["id"] == "id-2" and resolve(NOTES, " m1 ")["id"] == "id-1"
    assert resolve(NOTES, "M9") is None and resolve(NOTES, "") is None and label(0) == "M1"


async def test_load_asks_for_active_notes_and_survives_a_database_error():
    sb, fake = sb_and_fake({"agent_memories": NOTES})
    assert await load_memories(sb) == NOTES
    assert "status=eq.active" in str(fake.requests[-1].url)
    broken = UserSupabase("https://x.supabase.co", "pub", "wrong-token", FakeSupabase({}).client())
    assert await load_memories(broken) == []  # never a failed chat


async def test_propose_memory_stores_a_proposal_and_says_it_is_not_saved():
    sb, fake = sb_and_fake()
    out = json.loads(await propose_memory.ainvoke({"text": "Trains 5 days a week", "kind": "fact", "replaces": "M2"}, config=cfg(sb)))
    (table, row), = fake.inserted
    assert table == "agent_proposals" and row["kind"] == "memory" and row["user_id"] == "user-1"
    assert row["payload"] == {"text": "Trains 5 days a week", "kind": "fact", "supersedes_id": "id-2"}
    assert row["preview"] == ["+ Trains 5 days a week", "- Trains 4 days a week"]
    assert out["proposal"]["id"] == row["id"] and "NOT saved" in out["message"]


async def test_propose_memory_refuses_bad_input_without_storing():
    sb, fake = sb_and_fake()
    for args in ({"text": "hi"}, {"text": "x" * 201}, {"text": "A fine note", "kind": "secret"}, {"text": "A fine note", "replaces": "M7"}):
        out = json.loads(await propose_memory.ainvoke(args, config=cfg(sb)))
        assert "error" in out
    dup = json.loads(await propose_memory.ainvoke({"text": "trains 4 days a week"}, config=cfg(sb)))
    assert "already saved" in dup["message"]
    assert not fake.inserted


async def test_notes_reach_the_models_prompt_but_only_as_the_users_notes():
    model = ScriptedModel(script=["Noted."], seen=[])
    graph = build_graph(model)
    sb, _ = sb_and_fake()
    await graph.ainvoke({"messages": [("user", "hi")]}, config={"configurable": {**cfg(sb)["configurable"], "tz": "UTC"}})
    system = model.seen[0][0]
    assert isinstance(system, SystemMessage) and "[M1] (constraint) No overhead pressing" in system.content
