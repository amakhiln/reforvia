"""The one plan change that is waiting for the user's answer. The Coach is shown it, so the user can adjust it by chatting;
a newer proposal replaces it, so there is never more than one plan change to approve and never a stale one beside it."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from .proposals import decide
from .supa import SupabaseError, UserSupabase

log = logging.getLogger("coach.pending")


def _pending_query(select: str) -> dict[str, str]:
    now = datetime.now(timezone.utc).isoformat()
    return {"select": select, "kind": "eq.plan_change", "status": "eq.pending", "expires_at": f"gt.{now}", "order": "created_at.desc"}


async def load_pending(sb: UserSupabase) -> dict[str, Any] | None:
    """The newest unanswered plan change, or None. A database problem means none, never a failed chat."""
    try:
        rows = await sb.select("agent_proposals", {**_pending_query("id,payload,preview"), "limit": "1"})
    except SupabaseError as exc:
        log.warning("could not load the pending plan change: %s", exc)
        return None
    return rows[0] if rows else None


def pending_block(pending: dict[str, Any] | None) -> str:
    if not pending:
        return ""
    lines = "\n".join(f"  {line}" for line in pending.get("preview") or [])
    request = json.dumps((pending.get("payload") or {}).get("request") or [], ensure_ascii=False)
    return (
        "\n\nA plan change is waiting for the user's approval (nothing in the plan has changed yet)\n"
        f"{lines}\n"
        f"The changes as requested: {request}\n"
        "If the user asks to adjust it, call propose_plan_change once with every change that should remain, with the adjustment applied: the new card replaces this one. "
        "Leave out only what they asked to drop. If they want to drop all of it, tell them to tap Reject. If they say it looks good, tell them to tap Approve: you cannot approve it."
    )


async def supersede(sb: UserSupabase, keep_id: str) -> list[str]:
    """Rejects every other unanswered plan change, so only the newest card can be approved. Returns the ids it retired."""
    retired: list[str] = []
    try:
        rows = await sb.select("agent_proposals", {**_pending_query("id"), "id": f"neq.{keep_id}", "limit": "10"})
        for row in rows:
            if row["id"] == keep_id:
                continue
            result = await decide(sb, row["id"], False)
            if result and result.get("status") == "rejected":
                retired.append(row["id"])
    except SupabaseError as exc:
        log.warning("could not retire an older plan change: %s", exc)
    return retired
