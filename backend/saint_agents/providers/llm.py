"""LLM provider factory.

The agent graph depends on this function, not on a specific vendor, so the
model can be swapped with an environment variable and no graph change.
"""
from __future__ import annotations

from langchain_core.language_models import BaseChatModel

from ..core.config import settings
from ..core.errors import AgentError


def get_llm() -> BaseChatModel:
    provider = settings.llm_provider.lower()

    if provider == "ollama":
        from langchain_ollama import ChatOllama

        return ChatOllama(model=settings.llm_model, temperature=settings.llm_temperature)

    if provider == "openai":
        from langchain_openai import ChatOpenAI

        if not settings.openai_api_key:
            raise AgentError("LLM_PROVIDER=openai but OPENAI_API_KEY is not set")
        return ChatOpenAI(
            model=settings.llm_model,
            temperature=settings.llm_temperature,
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
        )

    raise AgentError(f"Unknown LLM_PROVIDER '{settings.llm_provider}'. Use 'ollama' or 'openai'.")
