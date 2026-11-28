"""Next-step chips: after a reply, a cheap model proposes 2 or 3 follow-up questions the user might tap.

Nothing here can change data or reach the user unchecked: chips are plain strings, trimmed, de-duplicated, kept short,
and dropped if they carry a figure that is in neither the question nor the reply."""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from .grounding import ungrounded

log = logging.getLogger("coach.suggest")

COACH_SCOPE = "the user's plan, logged workouts, exercise progress and form cues, weekly volume, personal bests, and general training advice"
MAX_CHIPS = 3
MAX_LEN = 48

PROMPT = """You write the follow-up chips under a reply in a chat of Reforvia, a workout tracker. Given the user's question, the assistant's reply and the tools it used, return 2 or 3 short things the user might tap next.

Rules
- Reply with a JSON array of strings and nothing else, for example ["Show my lat pulldown trend", "Review my last workout"].
- Write each as the user would ask it, in at most 40 characters, with no trailing punctuation except "?".
- Only suggest things this assistant can answer: {scope}.
- Never suggest logging, changing the plan, or anything off-topic. No medical, supplement, crash-diet or weight-loss suggestions.
- Do not repeat the question the user just asked. Do not put numbers or dates in a chip unless they appear in the question or reply.
- If the reply declined to help, asked the user to clarify, or touched on pain, a medical condition or disordered eating, return []."""

# Used when the model call fails or returns nothing usable: a sensible next question per tool.
FALLBACK: dict[str, list[str]] = {
    "get_exercise_progress": ["Show my weekly volume", "What are my personal bests?"],
    "get_weekly_volume": ["How did my last workout go?", "What are my personal bests?"],
    "get_recent_workouts": ["Show my weekly volume", "What should I lift next session?"],
    "get_personal_bests": ["Review my last two weeks of training", "Am I doing enough weekly volume?"],
    "get_my_plan": ["What should I lift next session?", "How should I warm up?"],
    "get_exercise_guide": ["How has this lift progressed?", "What should I lift next session?"],
    "get_weekly_review": ["What should I change in my plan?", "What should I lift next session?"],
    "get_nutrition_targets": ["How are these worked out?", "Which foods are high in protein?"],
    "search_foods": ["How much protein is in a portion?", "Which foods are high in protein?"],
    "portion_nutrition": ["Which foods are high in protein?", "What are my daily targets?"],
}


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def clean(raw: str, question: str, answer: str) -> list[str]:
    """Parses the model's output into safe chips. Anything unexpected gives an empty list."""
    text = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.M).strip()
    try:
        items = json.loads(text)
    except ValueError:
        return []
    if not isinstance(items, list):
        return []
    out: list[str] = []
    seen = {question.strip().lower()}
    for item in items:
        if not isinstance(item, str):
            continue
        chip = " ".join(item.split())
        key = chip.lower()
        if not chip or len(chip) > MAX_LEN or key in seen or ungrounded(chip, [answer], question):
            continue
        seen.add(key)
        out.append(chip)
    return out[:MAX_CHIPS]


def fallback(tools: list[str], question: str) -> list[str]:
    for name in reversed(tools):
        if name in FALLBACK:
            return [c for c in FALLBACK[name] if c.lower() != question.strip().lower()][:MAX_CHIPS]
    return []


async def suggest(llm: BaseChatModel, question: str, answer: str, tools: list[str], scope: str = COACH_SCOPE) -> list[str]:
    """Never raises: a failing suggestion call must not affect the reply that was already delivered."""
    try:
        result = await llm.ainvoke(
            [
                SystemMessage(content=PROMPT.format(scope=scope)),
                HumanMessage(content=f"Question: {question}\n\nReply: {answer}\n\nTools used: {', '.join(tools) or 'none'}"),
            ]
        )
        chips = clean(_text(result.content), question, answer)
    except Exception:
        log.warning("suggestion call failed", exc_info=True)
        chips = []
    return chips or fallback(tools, question)
