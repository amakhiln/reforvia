import asyncio
import json

import httpx

from coach.agents import AGENTS, COACH, NUTRITION
from coach.cards import card_for
from coach.config import Settings
from coach.main import create_app
from coach.prompts import build_nutrition_prompt
from coach.supa import UserSupabase
from coach.tools import get_nutrition_targets, portion_nutrition, search_foods
from tests.fakes import FakeSupabase, ScriptedModel

SETTINGS = Settings(supabase_url="https://x.supabase.co", supabase_key="pub")
PROFILE = {"birth_year": 1996, "sex": "male", "height_cm": 178, "weight_kg": 80, "goal": "maintain", "diet": "vegetarian", "see_professional": False}
WEEKS = [{"week_start": f"2026-10-{d}", "sessions": 4, "sets": 40, "volume": 5000} for d in ("05", "12", "19", "26")] + [{"week_start": "2026-11-02", "sessions": 1, "sets": 10, "volume": 900}]
ATTA = {"id": "i1", "code": "A019", "name": "Wheat flour, atta", "food_group": "Cereals and Millets", "energy_kcal": 320.3, "energy_derived": False,
        "protein_g": 10.57, "fat_g": 1.53, "carbs_g": 64.17, "fibre_g": 11.36, "sugars_g": 1.8, "sat_fat_g": 0.21, "calcium_mg": 30.94, "iron_mg": 4.1,
        "sodium_mg": 2.04, "potassium_mg": 311.0, "vitamin_c_mg": 0.0}


def cfg(routes):
    fake = FakeSupabase(routes)
    sb = UserSupabase("https://x.supabase.co", "pub", "good-token", fake.client())
    return {"configurable": {"sb": sb, "tz": "UTC", "user_id": "user-1"}}, fake


def test_the_two_agents_have_their_own_tools_and_prompts():
    nutrition_only = {"get_nutrition_targets", "search_foods", "portion_nutrition"}
    assert nutrition_only <= {t.name for t in NUTRITION.tools} and not nutrition_only & {t.name for t in COACH.tools}
    assert "propose_plan_change" in {t.name for t in COACH.tools} and "propose_plan_change" not in {t.name for t in NUTRITION.tools}
    assert "get_weekly_volume" in {t.name for t in NUTRITION.tools}  # training load is shared
    assert set(AGENTS) == {"coach", "nutrition"} and NUTRITION.summary is False and COACH.summary is True


def test_the_nutrition_prompt_carries_the_safety_rails():
    from datetime import date

    p = build_nutrition_prompt(date(2026, 11, 22), "UTC")
    for must in ("not a doctor", "under 18", "pregnant", "disordered eating", "calorie floor", "supplement or medication doses", "raw ingredients", "crash diets"):
        assert must in p
    assert "propose_memory" in p and "Never work out a target yourself" in p


async def test_targets_tool_uses_the_profile_and_logged_training():
    c, fake = cfg({"nutrition_profile": [PROFILE], "rpc/weekly_summary": WEEKS})
    out = json.loads(await get_nutrition_targets.ainvoke({}, config=c))
    assert out["ok"] and out["calories"] == 2740 and out["method"]["sessions_per_week_logged"] == 4.0 and out["diet"] == "vegetarian"
    assert ("weekly_summary", {"p_weeks": 5, "p_today": out_today(fake)}) in fake.rpc_calls


def out_today(fake):
    return fake.rpc_calls[0][1]["p_today"]


async def test_targets_tool_gives_no_numbers_without_a_profile_or_for_a_minor_or_a_flagged_profile():
    for profile, reason in (([], "no_profile"), ([{**PROFILE, "birth_year": 2012}], "under_18"), ([{**PROFILE, "see_professional": True}], "see_professional")):
        c, _ = cfg({"nutrition_profile": profile, "rpc/weekly_summary": WEEKS})
        out = json.loads(await get_nutrition_targets.ainvoke({}, config=c))
        assert out["ok"] is False and out["reason"] == reason and "calories" not in out


async def test_food_search_trims_fields_and_handles_no_match():
    c, fake = cfg({"rpc/search_foods": [{**ATTA, "scientific_name": "x", "local_names": "long list", "tags": ["veg"], "source_note": "n"}]})
    out = json.loads(await search_foods.ainvoke({"query": "atta", "limit": 50}, config=c))
    assert out["foods"][0]["code"] == "A019" and "local_names" not in out["foods"][0] and "100 g" in out["per"]
    assert fake.rpc_calls == [("search_foods", {"q": "atta", "lim": 8})]  # limit is clamped
    c, _ = cfg({"rpc/search_foods": []})
    assert "No match" in json.loads(await search_foods.ainvoke({"query": "zzz"}, config=c))["message"]


async def test_portion_nutrition_scales_exactly_and_rejects_bad_input():
    c, fake = cfg({"foods": [ATTA]})
    out = json.loads(await portion_nutrition.ainvoke({"code": "A019", "grams": 60}, config=c))
    assert out["food"] == "Wheat flour, atta" and out["energy_kcal"] == 192.2 and out["protein_g"] == 6.3 and out["carbs_g"] == 38.5
    assert "code=eq.A019" in str(fake.requests[-1].url)
    assert "between 1 and 2000" in json.loads(await portion_nutrition.ainvoke({"code": "A019", "grams": 0}, config=c))["error"]
    assert "between 1 and 2000" in json.loads(await portion_nutrition.ainvoke({"code": "A019", "grams": 5000}, config=c))["error"]
    none, _ = cfg({"foods": []})
    assert "No food with code" in json.loads(await portion_nutrition.ainvoke({"code": "ZZZ9", "grams": 50}, config=none))["error"]
    c2, fake2 = cfg({"foods": [ATTA]})
    await portion_nutrition.ainvoke({"code": "A019&select=*;drop", "grams": 50}, config=c2)
    assert "code=eq.A019sel" in str(fake2.requests[-1].url) and "drop" not in str(fake2.requests[-1].url)  # a code cannot add query parameters


def test_cards_for_targets_and_portions_carry_only_tool_numbers():
    t = {"ok": True, "calories": 2740, "protein_g": 128, "fat_g": 76, "carbs_g": 340, "goal": "maintain", "expected_change_kg_per_week": 0.0,
         "floor_applied": False, "method": {"maintenance_kcal": 2740}}
    assert card_for("get_nutrition_targets", json.dumps(t))["calories"] == 2740
    assert card_for("get_nutrition_targets", json.dumps({"ok": False, "reason": "no_profile"})) is None
    p = {"food": "Atta", "code": "A019", "grams": 60, "energy_kcal": 192.2, "protein_g": 6.3, "fat_g": 0.9, "carbs_g": 38.5, "fibre_g": 6.8, "energy_derived": False}
    assert card_for("portion_nutrition", json.dumps(p))["kind"] == "food" and card_for("portion_nutrition", json.dumps({"error": "x"})) is None


def build(agent_script, routes=None, small=None):
    base = {"coach_messages": [], "rpc/agent_register_message": [{"allowed": True, "used": 1}], "rpc/agent_add_tokens": None,
            "agent_chat_summary": [], **(routes or {})}
    fake = FakeSupabase(base)
    model = ScriptedModel(script=agent_script, seen=[])
    return create_app(SETTINGS, model=model, http=fake.client(), suggest_model=small), fake, model


async def chat(app, payload):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://coach") as c:
        return await c.post("/chat", json=payload, headers={"authorization": "Bearer good-token"})


async def test_a_nutrition_chat_has_its_own_history_prompt_and_saved_rows():
    app, fake, model = build(["Your target is on the card."])
    r = await chat(app, {"message": "What are my targets?", "agent": "nutrition"})
    assert r.status_code == 200
    history = [str(q.url) for q in fake.requests if "coach_messages" in str(q.url) and q.method == "GET"][0]
    assert "agent=eq.nutrition" in history
    assert [(t, row["agent"], row["role"]) for t, row in fake.inserted if t == "coach_messages"] == [("coach_messages", "nutrition", "user"), ("coach_messages", "nutrition", "assistant")]
    assert "nutrition guide" in model.seen[0][0].content and "training coach" not in model.seen[0][0].content


async def test_the_coach_is_still_the_default_and_saves_as_coach():
    app, fake, model = build(["Fine."])
    await chat(app, {"message": "hi"})
    assert {row["agent"] for t, row in fake.inserted if t == "coach_messages"} == {"coach"}
    assert "agent=eq.coach" in [str(q.url) for q in fake.requests if "coach_messages" in str(q.url) and q.method == "GET"][0]
    assert "training coach" in model.seen[0][0].content


async def test_an_unknown_agent_is_refused():
    app, _, _ = build(["x"])
    assert (await chat(app, {"message": "hi", "agent": "chef"})).status_code == 422


async def test_nutrition_chips_use_the_nutrition_scope_and_no_summary_is_kept():
    small = ScriptedModel(script=['["How are these worked out?"]'], seen=[])
    older = [{"role": "user", "content": f"m{i}", "created_at": f"2026-11-01T10:{i:02d}:00+00:00"} for i in range(9, 0, -1)]
    app, fake, _ = build(["Done."], routes={"coach_messages": lambda r: older if "offset" in r.url.params else []}, small=small)
    r = await chat(app, {"message": "hi", "agent": "nutrition"})
    await asyncio.sleep(0.2)
    assert "daily targets" in small.seen[0][0].content and "training" not in small.seen[0][0].content.split("Only suggest")[1].split("\n")[0]
    assert not [1 for t, _ in fake.inserted if t == "agent_chat_summary"]
    assert any(json.loads(line[6:]).get("name") == "suggestions" for line in r.text.split("\n\n") if line.startswith("data: "))
