"""Builds the chat model. Everything goes through OpenRouter's OpenAI-compatible API, so switching provider or model
is just a different COACH_MODEL id (for example anthropic/claude-sonnet-5.5, google/gemini-..., deepseek/...)."""
from __future__ import annotations

from langchain_core.language_models import BaseChatModel

from .config import Settings


def _extra_body(settings: Settings) -> dict:
    body: dict = {}
    if settings.provider_sort:
        body["provider"] = {"sort": settings.provider_sort}
    if settings.reasoning not in ("", "default"):
        body["reasoning"] = {"effort": settings.reasoning}
    return body


def build_model(settings: Settings, streaming: bool) -> BaseChatModel:
    if not settings.openrouter_key:
        raise RuntimeError("OPENROUTER_API_KEY is not set")
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(
        model=settings.model,
        api_key=settings.openrouter_key,
        base_url=settings.openrouter_url,
        max_tokens=settings.max_output_tokens,
        streaming=streaming,
        max_retries=5,  # short rate-limit or network spells are retried with growing waits
        stream_usage=True,  # token counts for the daily usage record arrive on the last streamed chunk
        use_responses_api=False,  # OpenRouter's stable surface is Chat Completions
        default_headers={"X-Title": "Reforvia"},
        extra_body=_extra_body(settings) or None,
    )


def build_suggest_model(settings: Settings) -> BaseChatModel:
    """The small model for chips and the chat summary: no hidden reasoning, a short output."""
    from dataclasses import replace

    return build_model(replace(settings, model=settings.suggest_model, reasoning="none", max_output_tokens=500), streaming=False)
