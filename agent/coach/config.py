import os
from dataclasses import dataclass, field


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    supabase_url: str = field(default_factory=lambda: os.environ.get("SUPABASE_URL", "").rstrip("/"))
    supabase_key: str = field(default_factory=lambda: os.environ.get("SUPABASE_PUBLISHABLE_KEY", ""))
    service_key: str = field(default_factory=lambda: os.environ.get("SUPABASE_SECRET_KEY", ""))
    cron_secret: str = field(default_factory=lambda: os.environ.get("CRON_SECRET", ""))
    vapid_private_key: str = field(default_factory=lambda: os.environ.get("VAPID_PRIVATE_KEY", ""))
    vapid_subject: str = field(default_factory=lambda: os.environ.get("VAPID_SUBJECT", ""))
    analyst_tz: str = field(default_factory=lambda: os.environ.get("ANALYST_TZ", "UTC"))
    analyst_max_users: int = field(default_factory=lambda: _int("ANALYST_MAX_USERS", 200))
    # Models are reached through OpenRouter, so COACH_MODEL is any OpenRouter model id that supports tool calling.
    openrouter_key: str = field(default_factory=lambda: os.environ.get("OPENROUTER_API_KEY", ""))
    openrouter_url: str = field(default_factory=lambda: os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/"))
    # Optional OpenRouter provider routing: "latency" prefers the provider that starts answering fastest. Off unless set.
    # Reasoning effort sent to OpenRouter: none | minimal | low | medium | high | default ("default" sends nothing).
    # Hidden reasoning counts against the output limit, and some models (Claude Sonnet 5.5) always reason, so the safe
    # default is "low". Models that can switch reasoning off (Claude Haiku 5.5) answer fastest with COACH_REASONING=none.
    reasoning: str = field(default_factory=lambda: os.environ.get("COACH_REASONING", "low").strip().lower())
    provider_sort: str = field(default_factory=lambda: os.environ.get("OPENROUTER_PROVIDER_SORT", ""))
    model: str = field(default_factory=lambda: os.environ.get("COACH_MODEL", "anthropic/claude-sonnet-5.5"))
    max_output_tokens: int = field(default_factory=lambda: _int("COACH_MAX_OUTPUT_TOKENS", 4096))
    # Next-step chips under each reply come from a second, cheap model call. COACH_SUGGESTIONS=off turns them off.
    suggestions: bool = field(default_factory=lambda: os.environ.get("COACH_SUGGESTIONS", "on").strip().lower() not in ("off", "0", "false", "no"))
    suggest_model: str = field(default_factory=lambda: os.environ.get("COACH_SUGGEST_MODEL", "anthropic/claude-haiku-5.5"))
    daily_message_limit: int = field(default_factory=lambda: _int("DAILY_MESSAGE_LIMIT", 30))
    rate_per_minute: int = field(default_factory=lambda: _int("COACH_RATE_PER_MINUTE", 6))  # messages per user per minute; 0 turns it off
    history_messages: int = field(default_factory=lambda: _int("COACH_HISTORY_MESSAGES", 20))
    allowed_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip())
    )

    def missing(self) -> list[str]:
        out = []
        if not self.supabase_url:
            out.append("SUPABASE_URL")
        if not self.supabase_key:
            out.append("SUPABASE_PUBLISHABLE_KEY")
        return out

    def analyst_ready(self) -> bool:
        return bool(self.supabase_url and self.service_key)

    def push_ready(self) -> bool:
        return bool(self.vapid_private_key and self.vapid_subject)
