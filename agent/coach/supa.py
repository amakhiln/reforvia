"""Minimal PostgREST client that always acts as the signed-in user (their JWT), so row-level security applies."""
from __future__ import annotations

from typing import Any

import httpx


class SupabaseError(Exception):
    """Raised with a message that is safe to show the model/user (never contains tokens)."""


class UserSupabase:
    def __init__(self, base_url: str, api_key: str, token: str | None, http: httpx.AsyncClient):
        self._base = base_url.rstrip("/")
        self._headers = {"apikey": api_key, "Accept": "application/json"}
        if token:  # new-style secret keys (sb_secret_...) are sent as apikey only, never as a bearer token
            self._headers["Authorization"] = f"Bearer {token}"
        self._http = http

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            resp = await self._http.request(method, f"{self._base}/rest/v1/{path}", headers=self._headers, timeout=15, **kwargs)
        except httpx.HTTPError as exc:  # network problems
            raise SupabaseError(f"Could not reach the database ({type(exc).__name__}).") from exc
        if resp.status_code >= 400:
            detail = ""
            try:
                detail = str(resp.json().get("message", ""))[:200]
            except Exception:
                pass
            raise SupabaseError(f"Database request failed ({resp.status_code}). {detail}".strip())
        if resp.status_code == 204 or not resp.content:
            return None
        return resp.json()

    async def select(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        return await self._request("GET", table, params=params) or []

    async def rpc(self, name: str, body: dict[str, Any]) -> Any:
        return await self._request("POST", f"rpc/{name}", json=body)

    async def insert(self, table: str, row: dict[str, Any]) -> None:
        await self._insert(table, row)

    async def insert_once(self, table: str, row: dict[str, Any]) -> bool:
        """Inserts a row; returns False (instead of raising) if a unique constraint says it already exists."""
        return await self._insert(table, row, allow_conflict=True)

    async def delete(self, table: str, params: dict[str, str]) -> None:
        await self._request("DELETE", table, params=params)

    async def _insert(self, table: str, row: dict[str, Any], allow_conflict: bool = False) -> bool:
        try:
            resp = await self._http.post(
                f"{self._base}/rest/v1/{table}",
                headers={**self._headers, "Prefer": "return=minimal", "Content-Type": "application/json"},
                json=row,
                timeout=15,
            )
        except httpx.HTTPError as exc:
            raise SupabaseError(f"Could not reach the database ({type(exc).__name__}).") from exc
        if resp.status_code == 409 and allow_conflict:
            return False
        if resp.status_code >= 400:
            raise SupabaseError(f"Database write failed ({resp.status_code}).")
        return True
