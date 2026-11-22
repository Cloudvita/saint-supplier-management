"""Ontology-guided knowledge-graph extraction and Graph-RAG answers.

The LLM half of SAINT's procurement knowledge graph. SAINT (the /product
module) owns the ontology, the graph in Postgres and the path reasoning; this
service only does what needs a language model, and is stateless:

  extract   document text + the ontology -> candidate triples. SAINT checks
            every triple against the ontology again before storing it, so a
            model that ignores the prompt cannot write outside the schema.
  answer    question + graph context + traced risk paths -> a grounded answer.

Both take the LLM as a parameter (`get_llm()` in production, a fake in tests).
"""
from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

log = logging.getLogger("saint.ontology_kg")

# Documents beyond this are cut: extraction of a contract's relationships does
# not need the whole appendix, and a local model's context is small.
MAX_DOCUMENT_CHARS = 24_000


class GraphTriple(BaseModel):
    source_id: str = Field(description="Name of the source entity, as written in the document")
    source_type: str = Field(description="Ontology node type of the source")
    relation: str = Field(description="Ontology relationship type")
    target_id: str = Field(description="Name of the target entity")
    target_type: str = Field(description="Ontology node type of the target")
    properties: dict[str, Any] = Field(default_factory=dict, description="Attributes the ontology lists for these types")


class ExtractedSubgraph(BaseModel):
    triples: list[GraphTriple] = Field(default_factory=list)


def _ontology_text(ontology: dict[str, Any]) -> str:
    nodes = "\n".join(f"  {t}: {', '.join(attrs) or '-'}" for t, attrs in ontology.get("node_types", {}).items())
    rels = "\n".join(f"  ({s}) -[:{r}]-> ({o})" for s, r, o in ontology.get("allowed_relationships", []))
    return f"Node types and attributes:\n{nodes}\nAllowed relationships:\n{rels}"


def extract_triples(llm: BaseChatModel, text: str, ontology: dict[str, Any]) -> list[dict[str, Any]]:
    """Candidate triples from a document, in the ontology's terms."""
    structured = llm.with_structured_output(ExtractedSubgraph)
    system = (
        "You are a strict procurement knowledge-graph extractor for SAINT.\n"
        "Extract only relationships stated in the document, using only the node types "
        "and relationships below. Use entity names exactly as written. Put only listed "
        "attributes in properties. Never include tax ids, EINs, bank details or personal data. "
        "If nothing fits the ontology, return no triples.\n\n" + _ontology_text(ontology)
    )
    result = structured.invoke([SystemMessage(content=system), HumanMessage(content=text[:MAX_DOCUMENT_CHARS])])
    if isinstance(result, dict):  # some providers return plain dicts
        result = ExtractedSubgraph.model_validate(result)
    triples = [t.model_dump() for t in result.triples]
    log.info("extracted %d candidate triples", len(triples))
    return triples


def answer_question(
    llm: BaseChatModel,
    question: str,
    graph_context: str,
    risk_paths: list[dict[str, Any]] | None = None,
) -> str:
    """A Graph-RAG answer: grounded in the graph context SAINT supplied, nothing else."""
    system = (
        "You are SAINT's supply-network analyst. Answer only from the knowledge-graph "
        "relationships and risk paths given. Cite the propagation path for every risk you "
        "mention (A -> B -> C). If the graph does not contain the answer, say so plainly; "
        "do not guess."
    )
    paths = json.dumps(risk_paths or [], indent=2, default=str)
    user = f"Question: {question}\n\nGraph relationships:\n{graph_context}\n\nTraced risk paths:\n{paths}"
    reply = llm.invoke([SystemMessage(content=system), HumanMessage(content=user)])
    return str(getattr(reply, "content", reply))
