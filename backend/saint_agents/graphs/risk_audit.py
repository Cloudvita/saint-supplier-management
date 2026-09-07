"""The Weighted Risk Index (WRI) forensic audit graph.

Carried over from the original agent service and kept as a distinct graph
rather than folded into the general agent: it is a fixed analytical pipeline
with a conditional escalation, and expressing it as a graph is exactly why it
is readable.

    ingest -> wri -> [HIGH?] -> deep_forensics -> memo
                  \\-> memo
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, TypedDict

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import END, START, StateGraph

# WRI weighting. Geopolitical exposure dominates, then leverage, then delivery
# reliability — the same weighting the platform's risk scoring has always used.
WRI_WEIGHTS = {"geopolitical": 0.4, "debt_to_equity": 0.3, "late_deliveries": 0.3}
HIGH_RISK_THRESHOLD = 50.0
MEDIUM_RISK_THRESHOLD = 30.0


class SaintState(TypedDict):
    supplier_name: str
    ticker: str
    macro_data: Optional[Dict[str, Any]]
    wri_score: float
    risk_tier: str
    forensic_findings: Optional[List[str]]
    executive_memo: str


STEP_DESCRIPTIONS = {
    "ingest": "Aggregating macro & fiscal indicators...",
    "wri": "Computing SAINT Weighted Risk Index (WRI)...",
    "deep_forensics": "Elevated risk detected. Running forensic auditor...",
    "memo_generator": "Synthesising final risk memo & governance directives...",
}


async def ingest_metrics(state: SaintState) -> Dict[str, Any]:
    await asyncio.sleep(0.4)
    metrics = {
        "geopolitical_risk_index": 78,
        "debt_to_equity": 1.9,
        "late_deliveries_pct": 12.0,
    }
    return {"macro_data": metrics}


async def compute_wri(state: SaintState) -> Dict[str, Any]:
    data = state.get("macro_data") or {}
    geo = data.get("geopolitical_risk_index", 0)
    debt = data.get("debt_to_equity", 0)
    late = data.get("late_deliveries_pct", 0)

    # Debt/equity and late-delivery percentage are rescaled onto the same
    # 0-100 range as the geopolitical index before weighting.
    wri = (
        geo * WRI_WEIGHTS["geopolitical"]
        + (debt * 20) * WRI_WEIGHTS["debt_to_equity"]
        + (late * 3) * WRI_WEIGHTS["late_deliveries"]
    )
    tier = (
        "HIGH" if wri >= HIGH_RISK_THRESHOLD
        else "MEDIUM" if wri >= MEDIUM_RISK_THRESHOLD
        else "LOW"
    )
    return {"wri_score": round(wri, 2), "risk_tier": tier}


def build_risk_audit_graph(llm):
    async def deep_forensic_analysis(state: SaintState) -> Dict[str, Any]:
        prompt = ChatPromptTemplate.from_template(
            "You are SAINT's Chief Risk Auditor. Analyse high-risk metrics for {supplier}:\n"
            "WRI: {wri} | Metrics: {metrics}\n"
            "Provide exactly 3 concise, bulleted findings detailing supply chain vulnerabilities."
        )
        chain = prompt | llm | StrOutputParser()
        analysis = await chain.ainvoke(
            {
                "supplier": state["supplier_name"],
                "wri": state["wri_score"],
                "metrics": state["macro_data"],
            }
        )
        return {"forensic_findings": [analysis]}

    async def generate_memo(state: SaintState) -> Dict[str, Any]:
        tier = state.get("risk_tier", "UNKNOWN")
        wri = state.get("wri_score", 0.0)
        supplier = state.get("supplier_name", "Unknown")

        if tier == "LOW":
            memo = f"STATUS: CLEAR. Supplier {supplier} shows baseline stability with WRI of {wri}."
        else:
            findings = state.get("forensic_findings")
            findings_text = (
                findings[0] if findings else "Automated metrics indicate elevated volatility."
            )
            memo = (
                "CRITICAL WATCHTOWER DIRECTIVE | SAINT SYSTEM\n"
                f"Target: {supplier} ({state.get('ticker')}) | Assessed WRI: {wri} [{tier} RISK]\n"
                f"{'-' * 70}\n"
                f"{findings_text}\n\n"
                "Recommended governance: initiate dual-sourcing contingency and audit "
                "Tier-2 buffer inventory."
            )
        return {"executive_memo": memo}

    def route_risk(state: SaintState) -> str:
        return "deep_forensics" if state.get("risk_tier") == "HIGH" else "memo_generator"

    workflow = StateGraph(SaintState)
    workflow.add_node("ingest", ingest_metrics)
    workflow.add_node("wri", compute_wri)
    workflow.add_node("deep_forensics", deep_forensic_analysis)
    workflow.add_node("memo_generator", generate_memo)

    workflow.add_edge(START, "ingest")
    workflow.add_edge("ingest", "wri")
    workflow.add_conditional_edges(
        "wri",
        route_risk,
        {"deep_forensics": "deep_forensics", "memo_generator": "memo_generator"},
    )
    workflow.add_edge("deep_forensics", "memo_generator")
    workflow.add_edge("memo_generator", END)

    return workflow.compile()
