"""Verifies the Supabase access token by asking Supabase itself (no JWT secrets live in this service)."""
from __future__ import annotations

import hashlib
import time

import httpx

_CACHE: dict[str, tuple[str, float]] = {}
_TTL = 60.0


class AuthError(Exception):
    pass


async def authenticate(authorization: str | None, supabase_url: str, api_key: str, http: httpx.AsyncClient) -> tuple[str, str]:
    """Returns (user_id, token) or raises AuthError."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AuthError("Missing bearer token")
    token = authorization[7:].strip()
    if not token:
        raise AuthError("Missing bearer token")

    key = hashlib.sha256(token.encode()).hexdigest()
    hit = _CACHE.get(key)
    now = time.monotonic()
    if hit and hit[1] > now:
        return hit[0], token

    try:
        resp = await http.get(
            f"{supabase_url}/auth/v1/user", headers={"apikey": api_key, "Authorization": f"Bearer {token}"}, timeout=10
        )
    except httpx.HTTPError as exc:
        raise AuthError("Could not verify your session") from exc
    if resp.status_code != 200:
        raise AuthError("Invalid or expired session")
    user_id = resp.json().get("id")
    if not user_id:
        raise AuthError("Invalid session")

    if len(_CACHE) > 1000:
        _CACHE.clear()
    _CACHE[key] = (user_id, now + _TTL)
    return user_id, token
