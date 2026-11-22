"""SAINT agent service — FastAPI + LangGraph.

Owns agent loops, prompts, LLM providers and orchestration. It owns no domain
logic: everything it can *do* arrives at runtime as a tool manifest published
by the business modules.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from .core.config import settings
from .core.errors import AgentError, ToolRegistryError
from .core.http import ModuleApiClient
from .graphs.agent_graph import build_agent_graph
from .graphs.ontology_kg import answer_question, extract_triples
from .graphs.risk_audit import STEP_DESCRIPTIONS, build_risk_audit_graph
from .prompts.modes import MODE_PROMPTS, build_system_prompt
from .providers.llm import get_llm
from .tools.registry import load_tools

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("saint.main")

app = FastAPI(title="SAINT Agent Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

AgentMode = Literal["SOURCING_ADVISOR", "BUYER_COPILOT", "ANALYTICS_ENGINE", "CONTRACT_AUDITOR"]


class Actor(BaseModel):
    user_id: str
    display_name: str = "User"
    role: str = "UNKNOWN"
    permissions: list[str] = Field(default_factory=list)


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AgentRequest(BaseModel):
    prompt: str
    mode: AgentMode = "ANALYTICS_ENGINE"
    history: list[Turn] = Field(default_factory=list)
    modules: list[str] = Field(default_factory=list)
    actor: Actor


def _to_messages(request: AgentRequest):
    messages = [
        HumanMessage(content=t.content) if t.role == "user" else AIMessage(content=t.content)
        for t in request.history
    ]
    messages.append(HumanMessage(content=request.prompt))
    return messages


async def _prepare(request: AgentRequest):
    """Wire up this turn: client, tools bound to the mode, prompt, compiled graph."""
    client = ModuleApiClient(request.actor.user_id)
    tools = await load_tools(client, request.modules or None)
    system_prompt = build_system_prompt(
        request.mode, request.actor.display_name, request.actor.role
    )
    graph = build_agent_graph(get_llm(), tools, system_prompt)
    return client, graph, tools


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "saint-agents",
        "llm": {"provider": settings.llm_provider, "model": settings.llm_model},
        "app_base_url": settings.app_base_url,
        "modes": list(MODE_PROMPTS.keys()),
    }


@app.get("/tools")
async def list_tools(user_id: str = "system") -> dict[str, Any]:
    """Introspection: what this service can currently do, and for whom."""
    client = ModuleApiClient(user_id)
    try:
        tools = await load_tools(client)
        return {
            "count": len(tools),
            "tools": [{"name": t.name, "description": t.description} for t in tools],
        }
    finally:
        await client.aclose()


@app.post("/agent/run")
async def run_agent(request: AgentRequest) -> dict[str, Any]:
    """Non-streaming turn — used by scheduled jobs and tests."""
    client, graph, tools = await _prepare(request)
    try:
        final = await graph.ainvoke({"messages": _to_messages(request), "iterations": 0})
        messages = final["messages"]
        answer = next(
            (m.content for m in reversed(messages) if isinstance(m, AIMessage) and m.content),
            "",
        )
        tool_calls = [
            {"name": c["name"], "args": c["args"]}
            for m in messages
            if isinstance(m, AIMessage)
            for c in (getattr(m, "tool_calls", None) or [])
        ]
        return {
            "mode": request.mode,
            "answer": answer,
            "toolCalls": tool_calls,
            "toolsAvailable": len(tools),
        }
    finally:
        await client.aclose()


@app.post("/agent/stream")
async def stream_agent(request: AgentRequest, http_request: Request):
    """Streaming turn — emits one SSE event per graph step."""

    async def event_generator():
        client = None
        try:
            client, graph, tools = await _prepare(request)
            yield {
                "event": "start",
                "data": json.dumps({"mode": request.mode, "toolsAvailable": len(tools)}),
            }

            async for chunk in graph.astream(
                {"messages": _to_messages(request), "iterations": 0}, stream_mode="updates"
            ):
                if await http_request.is_disconnected():
                    break

                for node_name, update in chunk.items():
                    for message in update.get("messages", []) or []:
                        calls = getattr(message, "tool_calls", None) or []
                        if calls:
                            yield {
                                "event": "tool_call",
                                "data": json.dumps(
                                    {"node": node_name, "calls": [c["name"] for c in calls]}
                                ),
                            }
                        elif getattr(message, "name", None):
                            yield {
                                "event": "tool_result",
                                "data": json.dumps(
                                    {"tool": message.name, "content": str(message.content)[:4000]}
                                ),
                            }
                        elif getattr(message, "content", None):
                            yield {
                                "event": "message",
                                "data": json.dumps({"content": str(message.content)}),
                            }

            yield {"event": "done", "data": json.dumps({"status": "COMPLETE"})}

        except ToolRegistryError as exc:
            yield {"event": "error", "data": json.dumps({"error": str(exc)})}
        except AgentError as exc:
            yield {"event": "error", "data": json.dumps({"error": str(exc)})}
        except Exception as exc:  # noqa: BLE001
            log.exception("agent stream failed")
            yield {"event": "error", "data": json.dumps({"error": str(exc)})}
        finally:
            if client is not None:
                await client.aclose()

    return EventSourceResponse(event_generator())


def _require_secret(request: Request) -> None:
    """When AGENT_TOOL_SECRET is set, only SAINT (which presents it) may call."""
    if settings.tool_secret and request.headers.get("x-agent-secret") != settings.tool_secret:
        raise HTTPException(status_code=401, detail="Missing or wrong X-Agent-Secret")


class ExtractRequest(BaseModel):
    text: str = Field(min_length=1)
    ontology: dict[str, Any]


class AnswerRequest(BaseModel):
    question: str = Field(min_length=1)
    graph_context: str = ""
    risk_paths: list[dict[str, Any]] = Field(default_factory=list)


@app.post("/ontology-kg/extract")
async def ontology_extract(body: ExtractRequest, request: Request) -> dict[str, Any]:
    """Document text -> candidate triples. SAINT validates and stores them."""
    _require_secret(request)
    try:
        triples = await run_in_threadpool(extract_triples, get_llm(), body.text, body.ontology)
    except AgentError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"triples": triples}


@app.post("/ontology-kg/answer")
async def ontology_answer(body: AnswerRequest, request: Request) -> dict[str, Any]:
    """Question + graph context from SAINT -> a grounded answer."""
    _require_secret(request)
    try:
        answer = await run_in_threadpool(
            answer_question, get_llm(), body.question, body.graph_context, body.risk_paths
        )
    except AgentError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"answer": answer}


@app.get("/api/stream-audit")
async def stream_audit(supplier_name: str, ticker: str, request: Request):
    """The WRI forensic audit pipeline, streamed step by step.

    Path preserved from the original service so existing clients keep working.
    """

    async def event_generator():
        engine = build_risk_audit_graph(get_llm())
        initial = {
            "supplier_name": supplier_name,
            "ticker": ticker,
            "macro_data": None,
            "wri_score": 0.0,
            "risk_tier": "UNKNOWN",
            "forensic_findings": None,
            "executive_memo": "",
        }
        try:
            async for chunk in engine.astream(initial, stream_mode="updates"):
                if await request.is_disconnected():
                    break
                for node_name, node_update in chunk.items():
                    yield {
                        "event": "node_update",
                        "data": json.dumps(
                            {
                                "node": node_name,
                                "status_text": STEP_DESCRIPTIONS.get(
                                    node_name, f"Executing {node_name}..."
                                ),
                                "data": node_update,
                            }
                        ),
                    }
            yield {"event": "done", "data": json.dumps({"status": "COMPLETE"})}
        except Exception as exc:  # noqa: BLE001
            log.exception("risk audit failed")
            yield {"event": "error", "data": json.dumps({"error": str(exc)})}

    return EventSourceResponse(event_generator())
