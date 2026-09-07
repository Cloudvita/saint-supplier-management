"""Configuration for the SAINT agent service.

Every setting has a working default so the service starts for local
development with no environment file at all.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Settings:
    # Where the Next.js application serves the tool manifest and tool endpoints.
    app_base_url: str = field(default_factory=lambda: os.getenv("APP_BASE_URL", "http://127.0.0.1:3000"))
    # Shared secret presented to the module tool endpoints. Must match
    # AGENT_TOOL_SECRET on the Next.js side.
    tool_secret: str | None = field(default_factory=lambda: os.getenv("AGENT_TOOL_SECRET") or None)

    # LLM provider: "ollama" (local, default) or "openai".
    llm_provider: str = field(default_factory=lambda: os.getenv("LLM_PROVIDER", "ollama"))
    llm_model: str = field(default_factory=lambda: os.getenv("LLM_MODEL", "mistral"))
    llm_temperature: float = field(default_factory=lambda: float(os.getenv("LLM_TEMPERATURE", "0")))
    openai_api_key: str | None = field(default_factory=lambda: os.getenv("OPENAI_API_KEY") or None)
    openai_base_url: str | None = field(default_factory=lambda: os.getenv("OPENAI_BASE_URL") or None)

    http_timeout_seconds: float = field(default_factory=lambda: float(os.getenv("AGENT_HTTP_TIMEOUT", "30")))
    # Hard ceiling on tool-calling turns, so a confused agent cannot loop forever.
    max_iterations: int = field(default_factory=lambda: int(os.getenv("AGENT_MAX_ITERATIONS", "8")))


settings = Settings()
