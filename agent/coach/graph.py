"""The coach graph: agent <-> tools loop. Built as a LangGraph StateGraph so more agents (analyst, nutrition…)
can be added later as extra nodes behind a supervisor without changing the API."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from .memory import memory_block
from .pending import pending_block
from .agents import COACH, AgentSpec
from .summary import summary_block


def build_graph(model: BaseChatModel, spec: AgentSpec = COACH):
    llm = model.bind_tools(spec.tools)

    async def agent(state: MessagesState, config: RunnableConfig):
        tz = (config.get("configurable") or {}).get("tz") or "UTC"
        try:
            today = datetime.now(ZoneInfo(tz)).date()
        except Exception:
            tz, today = "UTC", datetime.utcnow().date()
        cfg = config.get("configurable") or {}
        notes = memory_block(cfg.get("memories") or []) + summary_block(cfg.get("summary") or "") + pending_block(cfg.get("pending"))
        messages = [SystemMessage(content=spec.prompt(today, tz, notes)), *state["messages"]]
        return {"messages": [await llm.ainvoke(messages, config)]}

    graph = StateGraph(MessagesState)
    graph.add_node("agent", agent)
    graph.add_node("tools", ToolNode(spec.tools, handle_tool_errors=True))
    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", tools_condition, {"tools": "tools", END: END})
    graph.add_edge("tools", "agent")
    return graph.compile()
