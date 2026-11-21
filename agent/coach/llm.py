"""Builds the chat model. Everything goes through OpenRouter's OpenAI-compatible API, so switching provider or model
is just a different COACH_MODEL id (for example anthropic/claude-sonnet-5.5, google/gemini-..., deepseek/...)."""
from __future__ import annotations

from langchain_core.language_models import BaseChatModel

from .config import Settings


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
        stream_usage=True,  # token counts for the daily usage record arrive on the last streamed chunk
        use_responses_api=False,  # OpenRouter's stable surface is Chat Completions
        default_headers={"X-Title": "Reforvia"},
    )
