from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from datetime import date, datetime
from typing import Any, AsyncIterator
from zoneinfo import ZoneInfo

import httpx
import hmac

from fastapi import BackgroundTasks, FastAPI, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.errors import GraphRecursionError
from pydantic import BaseModel, Field

from .analyst import PushSend, build_analyst_graph, last_completed_week, make_web_push, run_weekly, service_client, summarise_user
from .auth import AuthError, authenticate
from .config import Settings
from .graph import build_graph
from .llm import build_model
from .supa import SupabaseError, UserSupabase
from .tools import TOOL_LABELS

log = logging.getLogger("coach")


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    tz: str | None = Field(default=None, max_length=64)


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _local_today(tz: str | None) -> tuple[date, str]:
    name = tz or "UTC"
    try:
        return datetime.now(ZoneInfo(name)).date(), name
    except Exception:
        return datetime.utcnow().date(), "UTC"


def create_app(
    settings: Settings | None = None, model: Any = None, http: httpx.AsyncClient | None = None, push: PushSend | None = None
) -> FastAPI:
    settings = settings or Settings()
    state: dict[str, Any] = {"http": http, "graph": None, "analyst": None, "push": push, "push_built": push is not None}

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if state["http"] is None:
            state["http"] = httpx.AsyncClient()
            owned = True
        else:
            owned = False
        if not settings.allowed_origins:
            log.warning("ALLOWED_ORIGINS is empty: browsers on other origins will be blocked by CORS.")
        yield
        if owned:
            await state["http"].aclose()

    app = FastAPI(title="Workout coach", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["authorization", "content-type"],
        max_age=600,
    )

    def get_llm(streaming: bool):
        if model is not None:
            return model
        return build_model(settings, streaming)

    def get_graph():
        if state["graph"] is None:
            state["graph"] = build_graph(get_llm(streaming=True))
        return state["graph"]

    def get_analyst():
        if state["analyst"] is None:
            state["analyst"] = build_analyst_graph(get_llm(streaming=False))
        return state["analyst"]

    def get_push() -> PushSend | None:
        if not state["push_built"]:
            state["push"], state["push_built"] = make_web_push(settings), True
        return state["push"]

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "configured": not settings.missing()}

    @app.post("/chat")
    async def chat(body: ChatIn, authorization: str | None = Header(default=None)):
        if settings.missing():
            return JSONResponse({"error": "The coach service is not configured."}, status_code=503)
        client: httpx.AsyncClient = state["http"]

        try:
            user_id, token = await authenticate(authorization, settings.supabase_url, settings.supabase_key, client)
        except AuthError as exc:
            return JSONResponse({"error": str(exc)}, status_code=401)

        # Do everything that can fail cheaply before the message is counted against the daily cap,
        # so a misconfigured model or a database hiccup never costs the user a message.
        try:
            graph = get_graph()
        except Exception:
            log.exception("could not build the model")
            return JSONResponse({"error": "The coach model isn't configured (is OPENROUTER_API_KEY set?)."}, status_code=503)

        sb = UserSupabase(settings.supabase_url, settings.supabase_key, token, client)
        today, tz = _local_today(body.tz)

        try:
            rows = await sb.select(
                "coach_messages", {"select": "role,content", "order": "created_at.desc", "limit": str(settings.history_messages)}
            )
            reg = await sb.rpc("agent_register_message", {"p_day": today.isoformat(), "p_limit": settings.daily_message_limit})
            row = reg[0] if isinstance(reg, list) and reg else reg
            if not row or not row.get("allowed"):
                return JSONResponse(
                    {"error": f"You've reached today's limit of {settings.daily_message_limit} coach messages. It resets tomorrow."},
                    status_code=429,
                )
            await sb.insert("coach_messages", {"user_id": user_id, "role": "user", "content": body.message})
        except SupabaseError as exc:
            log.warning("database error before chat: %s", exc)
            return JSONResponse({"error": "The coach couldn't reach your data. Try again in a moment."}, status_code=502)

        history = [
            (HumanMessage if r["role"] == "user" else AIMessage)(content=r["content"]) for r in reversed(rows)
        ]
        while history and isinstance(history[0], AIMessage):  # providers expect the conversation to start with the user
            history.pop(0)
        messages = [*history, HumanMessage(content=body.message)]

        cfg = {"configurable": {"sb": sb, "tz": tz}, "recursion_limit": 14}

        async def events() -> AsyncIterator[str]:
            buf: list[str] = []
            announced: set[str] = set()
            last_step: int | None = None
            tokens_in = tokens_out = 0
            try:
                async for chunk, meta in graph.astream({"messages": messages}, config=cfg, stream_mode="messages"):
                    if meta.get("langgraph_node") != "agent":
                        continue
                    for tc in getattr(chunk, "tool_call_chunks", None) or []:
                        name, tc_id = tc.get("name"), tc.get("id")
                        if name and tc_id and tc_id not in announced:
                            announced.add(tc_id)
                            yield _sse({"type": "tool", "label": TOOL_LABELS.get(name, "Working")})
                    text = _text(chunk.content)
                    if text:
                        step = meta.get("langgraph_step")
                        if buf and last_step is not None and step != last_step:
                            buf.append("\n\n")
                            yield _sse({"type": "token", "text": "\n\n"})
                        last_step = step
                        buf.append(text)
                        yield _sse({"type": "token", "text": text})
                    usage = getattr(chunk, "usage_metadata", None)
                    if usage:
                        tokens_in += int(usage.get("input_tokens", 0) or 0)
                        tokens_out += int(usage.get("output_tokens", 0) or 0)
            except GraphRecursionError:
                yield _sse({"type": "error", "message": "That took too many steps. Try a more specific question."})
                return
            except Exception:
                log.exception("coach run failed")
                yield _sse({"type": "error", "message": "The coach hit a problem. Please try again."})
                return

            answer = "".join(buf).strip() or "I couldn't put an answer together. Please try again."
            try:
                await sb.insert("coach_messages", {"user_id": user_id, "role": "assistant", "content": answer})
                if tokens_in or tokens_out:
                    await sb.rpc("agent_add_tokens", {"p_day": today.isoformat(), "p_input": tokens_in, "p_output": tokens_out})
            except SupabaseError as exc:
                log.warning("could not save coach reply: %s", exc)
            yield _sse({"type": "done"})

        return StreamingResponse(
            events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
        )

    @app.post("/internal/weekly-run", status_code=202)
    async def weekly_run(
        background: BackgroundTasks,
        wait: bool = False,
        x_cron_secret: str | None = Header(default=None),
    ):
        """Called by the scheduler (pg_cron). Writes last week's summary for every user who trained and has none yet.
        Safe to call repeatedly: users who already have a summary for the week are skipped."""
        if not settings.cron_secret or not settings.analyst_ready():
            return JSONResponse({"error": "Scheduled summaries are not configured."}, status_code=503)
        if not x_cron_secret or not hmac.compare_digest(x_cron_secret.encode(), settings.cron_secret.encode()):
            return JSONResponse({"error": "Forbidden"}, status_code=403)
        try:
            analyst = get_analyst()
        except Exception:
            log.exception("could not build the analyst model")
            return JSONResponse({"error": "The model isn't configured (is OPENROUTER_API_KEY set?)."}, status_code=503)
        week = last_completed_week(settings.analyst_tz)

        async def job() -> dict[str, int]:
            return await run_weekly(settings, state["http"], analyst, week, get_push())

        if wait:
            return {"week_start": week.isoformat(), **await job()}
        background.add_task(job)
        return {"started": True, "week_start": week.isoformat()}

    @app.post("/summaries/generate")
    async def generate_mine(authorization: str | None = Header(default=None)):
        """Lets a signed-in user create last week's summary now. One per week, so it cannot be spammed for cost."""
        if settings.missing() or not settings.analyst_ready():
            return JSONResponse({"error": "Weekly summaries are not configured."}, status_code=503)
        client: httpx.AsyncClient = state["http"]
        try:
            user_id, _ = await authenticate(authorization, settings.supabase_url, settings.supabase_key, client)
        except AuthError as exc:
            return JSONResponse({"error": str(exc)}, status_code=401)
        try:
            analyst = get_analyst()
        except Exception:
            log.exception("could not build the analyst model")
            return JSONResponse({"error": "The model isn't configured (is OPENROUTER_API_KEY set?)."}, status_code=503)
        week = last_completed_week(settings.analyst_tz)
        try:
            status = await summarise_user(service_client(settings, client), analyst, user_id, week, get_push())
        except SupabaseError as exc:
            log.warning("on-demand summary failed: %s", exc)
            return JSONResponse({"error": "Couldn't create the summary. Try again in a moment."}, status_code=502)
        except Exception:
            log.exception("on-demand summary failed")
            return JSONResponse({"error": "Couldn't create the summary. Try again in a moment."}, status_code=500)
        return {"status": status, "week_start": week.isoformat()}

    return app


app = create_app()
