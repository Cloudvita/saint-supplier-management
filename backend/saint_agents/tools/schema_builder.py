"""Build Pydantic models from the JSON Schema a module publishes.

The TypeScript module's Zod schema is the single source of truth for a tool's
contract. It arrives here as JSON Schema and becomes a Pydantic model, which
LangChain uses to validate what the LLM produces *before* the call leaves this
process. A malformed tool call is then caught locally instead of turning into a
422 round-trip.
"""
from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import Field, create_model

_PRIMITIVES: dict[str, type] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
}


def _python_type(schema: dict[str, Any], name: str) -> Any:
    """Map one JSON Schema node onto a Python type annotation."""
    if "enum" in schema:
        values = tuple(schema["enum"])
        return Literal[values] if values else str  # type: ignore[valid-type]

    if "const" in schema:
        return Literal[schema["const"]]  # type: ignore[valid-type]

    if "anyOf" in schema:
        members = tuple(_python_type(s, name) for s in schema["anyOf"])
        return Union[members] if members else Any  # type: ignore[valid-type]

    kind = schema.get("type")

    if kind == "array":
        return list[_python_type(schema.get("items", {}), name)]  # type: ignore[misc]

    if kind == "object":
        properties = schema.get("properties")
        if not properties:
            return dict[str, Any]
        return build_model(f"{name}_obj", schema)

    return _PRIMITIVES.get(kind, Any) if isinstance(kind, str) else Any


def build_model(name: str, schema: dict[str, Any]):
    """Create a Pydantic model class from an object JSON Schema."""
    properties: dict[str, Any] = schema.get("properties", {}) or {}
    required = set(schema.get("required", []) or [])

    fields: dict[str, tuple[Any, Any]] = {}
    for key, prop in properties.items():
        annotation = _python_type(prop, f"{name}_{key}")
        description = prop.get("description")

        if key in required:
            default = Field(..., description=description)
        else:
            # Optional fields carry their schema default when one is declared,
            # so the model reflects what the module would apply anyway.
            annotation = Optional[annotation]  # type: ignore[assignment]
            default = Field(prop.get("default"), description=description)

        fields[key] = (annotation, default)

    # A tool that takes no arguments still needs a model for LangChain to bind.
    if not fields:
        return create_model(_safe(name))

    return create_model(_safe(name), **fields)  # type: ignore[call-overload]


def _safe(name: str) -> str:
    cleaned = "".join(part.capitalize() for part in name.replace("-", "_").split("_") if part)
    return cleaned or "ToolInput"
