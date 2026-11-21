import pytest

from coach.config import Settings
from coach.llm import build_model


def settings(**kw):
    return Settings(supabase_url="https://x.supabase.co", supabase_key="pub", openrouter_key="sk-or-test", **kw)


def test_model_is_built_for_openrouter_with_the_configured_id():
    m = build_model(settings(model="google/gemini-test", max_output_tokens=321), streaming=True)
    assert m.model_name == "google/gemini-test"
    assert str(m.openai_api_base) == "https://openrouter.ai/api/v1"
    assert m.max_tokens == 321 and m.streaming and m.stream_usage


def test_base_url_and_model_can_be_overridden():
    m = build_model(settings(openrouter_url="https://proxy.example/v1", model="deepseek/x"), streaming=False)
    assert m.openai_api_base == "https://proxy.example/v1" and m.model_name == "deepseek/x" and not m.streaming


def test_missing_key_is_refused_before_any_request():
    with pytest.raises(RuntimeError, match="OPENROUTER_API_KEY"):
        build_model(Settings(supabase_url="https://x", supabase_key="p", openrouter_key=""), streaming=True)
