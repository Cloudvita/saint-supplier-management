"""HTTP client for calling back into the Next.js module APIs."""
from __future__ import annotations

from typing import Any

import httpx

from .config import settings


class ModuleApiClient:
    """Calls module tool endpoints on behalf of one acting user.

    The acting user travels on every request (`X-Acting-User`), so the Next.js
    guard resolves the caller's real permissions. The agent has no standing
    authority of its own — it can only do what its user could do.
    """

    def __init__(self, actor_user_id: str) -> None:
        self._actor = actor_user_id
        self._client = httpx.AsyncClient(
            base_url=settings.app_base_url,
            timeout=settings.http_timeout_seconds,
        )

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "X-Acting-User": self._actor}
        if settings.tool_secret:
            headers["X-Agent-Secret"] = settings.tool_secret
        return headers

    async def get_manifest(self, modules: list[str] | None = None) -> dict[str, Any]:
        params = {"modules": ",".join(modules)} if modules else None
        res = await self._client.get("/api/agent/tools", params=params, headers=self._headers())
        res.raise_for_status()
        return res.json()

    async def invoke_tool(self, name: str, payload: dict[str, Any]) -> Any:
        res = await self._client.post(
            f"/api/agent/tools/{name}", json=payload, headers=self._headers()
        )
        if res.status_code >= 400:
            body = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
            raise _tool_error(name, body, res.status_code)
        return res.json().get("result")

    async def aclose(self) -> None:
        await self._client.aclose()


def _tool_error(name: str, body: dict[str, Any], status: int):
    from .errors import ToolExecutionError

    message = body.get("error", f"HTTP {status}")
    details = body.get("details")
    if details:
        message = f"{message} ({details})"
    return ToolExecutionError(name, message, status)
