"""The general-purpose tool-calling agent, as a LangGraph state machine.

Structure: reason -> (tools -> reason)* -> end. Kept as an explicit graph
rather than a prebuilt executor so the iteration ceiling, the streamed step
descriptions and the tool-error handling are all visible and adjustable.
"""
from __future__ import annotations

import logging
from typing import Annotated, Any, Sequence, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, SystemMessage, ToolMessage
from langchain_core.tools import StructuredTool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from ..core.config import settings

log = logging.getLogger("saint.agent")


class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    iterations: int


def build_agent_graph(llm, tools: Sequence[StructuredTool], system_prompt: str):
    """Compile an agent graph bound to this request's tool surface."""
    tools_by_name = {t.name: t for t in tools}
    model = llm.bind_tools(list(tools)) if tools else llm

    async def reason(state: AgentState) -> dict[str, Any]:
        messages = state["messages"]
        # Prepend the system prompt once, on the first pass.
        if not messages or not isinstance(messages[0], SystemMessage):
            messages = [SystemMessage(content=system_prompt), *messages]

        if state["iterations"] >= settings.max_iterations:
            return {
                "messages": [
                    AIMessage(
                        content=(
                            "I reached the maximum number of reasoning steps for this question. "
                            "Here is what I established so far — ask a narrower question to go further."
                        )
                    )
                ],
                "iterations": state["iterations"] + 1,
            }

        response = await model.ainvoke(messages)
        return {"messages": [response], "iterations": state["iterations"] + 1}

    async def run_tools(state: AgentState) -> dict[str, Any]:
        last = state["messages"][-1]
        outputs: list[ToolMessage] = []

        for call in getattr(last, "tool_calls", []) or []:
            tool = tools_by_name.get(call["name"])
            if tool is None:
                outputs.append(
                    ToolMessage(
                        content=f'{{"error": "No such tool: {call["name"]}"}}',
                        tool_call_id=call["id"],
                        name=call["name"],
                    )
                )
                continue
            try:
                result = await tool.ainvoke(call["args"])
            except Exception as exc:  # noqa: BLE001 - the agent must see the failure, not die on it
                log.warning("tool %s raised: %s", call["name"], exc)
                result = f'{{"error": "{exc}"}}'
            outputs.append(
                ToolMessage(content=str(result), tool_call_id=call["id"], name=call["name"])
            )

        return {"messages": outputs}

    def should_continue(state: AgentState) -> str:
        last = state["messages"][-1]
        if getattr(last, "tool_calls", None) and state["iterations"] < settings.max_iterations:
            return "tools"
        return "end"

    workflow = StateGraph(AgentState)
    workflow.add_node("reason", reason)
    workflow.add_node("tools", run_tools)
    workflow.add_edge(START, "reason")
    workflow.add_conditional_edges("reason", should_continue, {"tools": "tools", "end": END})
    workflow.add_edge("tools", "reason")

    return workflow.compile()
