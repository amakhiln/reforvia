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
    model: str = field(default_factory=lambda: os.environ.get("COACH_MODEL", "anthropic/claude-sonnet-5.5"))
    max_output_tokens: int = field(default_factory=lambda: _int("COACH_MAX_OUTPUT_TOKENS", 1024))
    daily_message_limit: int = field(default_factory=lambda: _int("DAILY_MESSAGE_LIMIT", 30))
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
