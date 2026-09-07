"""Dynamic LangChain tool registration.

This module is the reason `/ai-agents` stays decoupled from the business
domains: it contains no knowledge of suppliers, contracts or spend. It fetches
whatever tools the modules published, turns each one into a LangChain
StructuredTool, and hands them to the agent. A new capability in a business
module reaches every agent with no change to any file here.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.tools import StructuredTool

from ..core.errors import ToolExecutionError, ToolRegistryError
from ..core.http import ModuleApiClient
from .schema_builder import build_model

log = logging.getLogger("saint.tools")


async def load_tools(client: ModuleApiClient, modules: list[str] | None = None) -> list[StructuredTool]:
    """Fetch the manifest and materialise it as LangChain tools."""
    try:
        manifest = await client.get_manifest(modules)
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller as a clean error
        raise ToolRegistryError(
            f"Could not load the tool manifest from the SAINT application: {exc}"
        ) from exc

    entries = manifest.get("tools", [])
    tools = [_build_tool(client, entry) for entry in entries]
    log.info("registered %d tools from modules: %s", len(tools), sorted({e["module"] for e in entries}))
    return tools


def _build_tool(client: ModuleApiClient, entry: dict[str, Any]) -> StructuredTool:
    name: str = entry["name"]
    args_model = build_model(f"{name}_input", entry.get("inputSchema", {}))

    description = entry.get("description", "")
    if entry.get("mutates"):
        # Say so in the description: the model sees this, and it is the cue to
        # confirm with the user before a state-changing call.
        description += " This tool CHANGES DATA — confirm with the user before calling it."

    async def _call(**kwargs: Any) -> str:
        # Drop keys the model left as null so module-side Zod defaults apply.
        payload = {k: v for k, v in kwargs.items() if v is not None}
        try:
            result = await client.invoke_tool(name, payload)
        except ToolExecutionError as exc:
            # Returned rather than raised: a policy refusal is a legitimate
            # answer the agent should relay, not a crash.
            return json.dumps({"error": exc.message, "tool": name})
        return json.dumps(result, default=str)

    return StructuredTool.from_function(
        coroutine=_call,
        name=name,
        description=description,
        args_schema=args_model,
    )
