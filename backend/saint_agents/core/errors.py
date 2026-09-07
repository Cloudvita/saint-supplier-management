"""Error types shared across the agent service."""
from __future__ import annotations


class AgentError(Exception):
    """Base class for failures the service can explain to a caller."""


class ToolRegistryError(AgentError):
    """The tool manifest could not be fetched or was malformed."""


class ToolExecutionError(AgentError):
    """A module rejected or failed a tool call.

    Carries the module's message so the agent can relay a policy refusal
    ("blocked: delegation of authority") back to the user verbatim rather than
    inventing a reason.
    """

    def __init__(self, tool: str, message: str, status: int = 0) -> None:
        super().__init__(f"{tool}: {message}")
        self.tool = tool
        self.message = message
        self.status = status
