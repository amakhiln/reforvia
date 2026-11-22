"""The agents the chat service can host. Each has its own prompt and tools; memory, approval cards and the number
check are shared. The Coach also keeps the rolling chat summary; other agents do not yet."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Callable

from langchain_core.tools import BaseTool

from .prompts import build_nutrition_prompt, build_system_prompt
from .tools import TOOLS, get_nutrition_targets, get_weekly_volume, portion_nutrition, propose_memory, search_foods


@dataclass(frozen=True)
class AgentSpec:
    name: str
    tools: list[BaseTool]
    prompt: Callable[[date, str, str], str]  # (today, time zone, memory and summary text) -> system prompt
    chip_scope: str                           # what next-step chips may suggest for this agent
    summary: bool                             # keeps a rolling summary of older chat


COACH = AgentSpec(
    "coach", TOOLS, build_system_prompt,
    "the user's plan, logged workouts, exercise progress and form cues, weekly volume, personal bests, and general training advice",
    True,
)
NUTRITION = AgentSpec(
    "nutrition", [get_nutrition_targets, search_foods, portion_nutrition, get_weekly_volume, propose_memory], build_nutrition_prompt,
    "the user's daily targets, food values from the food tables (for example the protein in a food, or a portion), and how to reach a protein or calorie target",
    False,
)
AGENTS = {a.name: a for a in (COACH, NUTRITION)}
