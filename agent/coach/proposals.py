"""Proposals: how the Coach asks for a change without being able to make one.

A tool validates a request, stores it with create_proposal, and the app shows an approval card. Only the user's tap
(approve_proposal in SQL, run as them) applies it. Nothing in this module changes plan or log data."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from .supa import UserSupabase

KINDS = ("plan_change", "memory")
TTL = timedelta(minutes=30)
MAX_PREVIEW_LINES = 8
MAX_LINE = 200


async def create_proposal(
    sb: UserSupabase, user_id: str, kind: str, payload: dict[str, Any], summary: str, preview: list[str]
) -> dict[str, Any]:
    """Stores a pending proposal and returns what the approval card needs. Raises SupabaseError if it cannot be stored."""
    if kind not in KINDS:
        raise ValueError(f"unknown proposal kind: {kind}")
    row = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "kind": kind,
        "payload": payload,
        "summary": summary.strip()[:300] or "Proposed change",
        # shown to the user as the real diff, so it is built by code from the validated payload, never by the model
        "preview": [line.strip()[:MAX_LINE] for line in preview if line.strip()][:MAX_PREVIEW_LINES],
        "expires_at": (datetime.now(timezone.utc) + TTL).isoformat(),
    }
    await sb.insert("agent_proposals", row)
    card = {k: row[k] for k in ("id", "kind", "summary", "preview", "expires_at")}
    if payload.get("view"):
        card["view"] = payload["view"]
    return card


async def decide(sb: UserSupabase, proposal_id: str, approve: bool) -> dict[str, Any] | None:
    """Runs approve_proposal / reject_proposal as the user. Returns the row as it now stands, or None if not visible."""
    row = await sb.rpc("approve_proposal" if approve else "reject_proposal", {"p_id": proposal_id})
    return row if isinstance(row, dict) else None

