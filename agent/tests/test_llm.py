import pytest

from coach.config import Settings
from coach.llm import build_model


def settings(**kw):
    return Settings(supabase_url="https://x.supabase.co", supabase_key="pub", openrouter_key="sk-or-test", **kw)


def test_model_is_built_for_openrouter_with_the_configured_id():
    m = build_model(settings(model="google/gemini-test", max_output_tokens=321), streaming=True)
    assert m.model_name == "google/gemini-test"
    assert str(m.openai_api_base) == "https://openrouter.ai/api/v1"
    assert m.max_tokens == 321 and m.streaming and m.stream_usage and m.max_retries == 5
    assert m.extra_body == {"reasoning": {"effort": "low"}}  # safe on models that cannot switch reasoning off


def test_base_url_and_model_can_be_overridden():
    m = build_model(settings(openrouter_url="https://proxy.example/v1", model="deepseek/x"), streaming=False)
    assert m.openai_api_base == "https://proxy.example/v1" and m.model_name == "deepseek/x" and not m.streaming


def test_provider_routing_can_be_turned_on():
    m = build_model(settings(provider_sort="latency"), streaming=True)
    assert m.extra_body == {"provider": {"sort": "latency"}, "reasoning": {"effort": "low"}}


def test_reasoning_can_be_switched_off_or_left_to_the_model():
    assert build_model(settings(reasoning="none"), streaming=True).extra_body == {"reasoning": {"effort": "none"}}
    assert build_model(settings(reasoning="default"), streaming=True).extra_body is None


def test_output_limit_leaves_room_after_reasoning():
    assert Settings(supabase_url="https://x", supabase_key="p").max_output_tokens >= 4096


def test_missing_key_is_refused_before_any_request():
    with pytest.raises(RuntimeError, match="OPENROUTER_API_KEY"):
        build_model(Settings(supabase_url="https://x", supabase_key="p", openrouter_key=""), streaming=True)
