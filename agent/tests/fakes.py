"""Test doubles: a scripted chat model and a fake Supabase (httpx MockTransport)."""
from __future__ import annotations

import json
from typing import Any, AsyncIterator, Iterator

import httpx
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult


class ScriptedModel(BaseChatModel):
    """Plays back a list of steps. A step is either text, or ("tool", name, args) to request a tool call."""

    script: list[Any]
    cursor: int = 0
    seen: list[list[BaseMessage]] = []

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools, **kwargs):  # tools are ignored; the script decides
        return self

    def _next(self, messages):
        self.seen.append(list(messages))
        step = self.script[min(self.cursor, len(self.script) - 1)]
        self.cursor += 1
        return step

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        step = self._next(messages)
        if isinstance(step, tuple):
            msg = AIMessage(content="", tool_calls=[{"name": step[1], "args": step[2], "id": f"call_{self.cursor}"}])
        else:
            msg = AIMessage(content=step)
        return ChatResult(generations=[ChatGeneration(message=msg)])

    async def _astream(self, messages, stop=None, run_manager=None, **kwargs) -> AsyncIterator[ChatGenerationChunk]:
        step = self._next(messages)
        if isinstance(step, tuple):
            yield ChatGenerationChunk(
                message=AIMessageChunk(
                    content="",
                    tool_call_chunks=[{"name": step[1], "args": json.dumps(step[2]), "id": f"call_{self.cursor}", "index": 0}],
                )
            )
        else:
            words = step.split(" ")
            for i, w in enumerate(words):
                yield ChatGenerationChunk(message=AIMessageChunk(content=w + (" " if i < len(words) - 1 else "")))
            yield ChatGenerationChunk(
                message=AIMessageChunk(content="", usage_metadata={"input_tokens": 100, "output_tokens": 20, "total_tokens": 120})
            )


class FakeSupabase:
    """Records requests and answers from canned data keyed by path."""

    def __init__(self, routes: dict[str, Any] | None = None, user_id: str = "user-1", valid_token: str = "good-token"):
        self.routes = routes or {}
        self.user_id = user_id
        self.valid_token = valid_token
        self.requests: list[httpx.Request] = []
        self.inserted: list[tuple[str, dict]] = []
        self.rpc_calls: list[tuple[str, dict]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        auth = request.headers.get("authorization", "")
        if path == "/auth/v1/user":
            if auth == f"Bearer {self.valid_token}":
                return httpx.Response(200, json={"id": self.user_id})
            return httpx.Response(401, json={"msg": "bad"})
        if auth != f"Bearer {self.valid_token}":
            return httpx.Response(401, json={"message": "JWT invalid"})
        if request.method == "POST" and path.startswith("/rest/v1/rpc/"):
            name = path.rsplit("/", 1)[1]
            body = json.loads(request.content or b"{}")
            self.rpc_calls.append((name, body))
            data = self.routes.get(f"rpc/{name}", None)
            return httpx.Response(200, json=data(body) if callable(data) else data)
        if request.method == "POST":
            table = path.rsplit("/", 1)[1]
            self.inserted.append((table, json.loads(request.content)))
            return httpx.Response(201)
        table = path.rsplit("/", 1)[1]
        data = self.routes.get(table, [])
        return httpx.Response(200, json=data(request) if callable(data) else data)

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handler))
