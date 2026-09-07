import json
import asyncio
from typing import TypedDict, Optional, Dict, Any, List
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from langgraph.graph import StateGraph, START, END
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_ollama import ChatOllama

# 1. State Definition
class SaintState(TypedDict):
    supplier_name: str
    ticker: str
    macro_data: Optional[Dict[str, Any]]
    wri_score: float
    risk_tier: str
    forensic_findings: Optional[List[str]]
    executive_memo: str

# 2. Local Mistral via Ollama
llm = ChatOllama(model="mistral", temperature=0)

# 3. Graph Nodes
async def ingest_metrics(state: SaintState) -> Dict[str, Any]:
    await asyncio.sleep(0.4)
    metrics = {
        "geopolitical_risk_index": 78,
        "debt_to_equity": 1.9,
        "late_deliveries_pct": 12.0
    }
    return {"macro_data": metrics}

async def compute_wri(state: SaintState) -> Dict[str, Any]:
    await asyncio.sleep(0.3)
    data = state.get("macro_data", {})
    geo = data.get("geopolitical_risk_index", 0)
    de = data.get("debt_to_equity", 0)
    late = data.get("late_deliveries_pct", 0)

    # WRI Formula: (Geo * 0.4) + (D/E * 20 * 0.3) + (Late% * 3 * 0.3)
    wri = (geo * 0.4) + (de * 20 * 0.3) + (late * 3 * 0.3)
    tier = "HIGH" if wri >= 50.0 else ("MEDIUM" if wri >= 30.0 else "LOW")
    return {"wri_score": round(wri, 2), "risk_tier": tier}

async def deep_forensic_analysis(state: SaintState) -> Dict[str, Any]:
    prompt = ChatPromptTemplate.from_template(
        "You are S.A.I.N.T.'s Chief Risk Auditor. Analyze high-risk metrics for {supplier}:\n"
        "WRI: {wri} | Metrics: {metrics}\n"
        "Provide exactly 3 concise, bulleted findings detailing supply chain vulnerabilities."
    )
    chain = prompt | llm | StrOutputParser()
    analysis = await chain.ainvoke({
        "supplier": state["supplier_name"],
        "wri": state["wri_score"],
        "metrics": state["macro_data"]
    })
    return {"forensic_findings": [analysis]}

async def generate_memo(state: SaintState) -> Dict[str, Any]:
    tier = state.get("risk_tier", "UNKNOWN")
    wri = state.get("wri_score", 0.0)
    supplier = state.get("supplier_name", "Unknown")

    if tier == "LOW":
        memo = f"STATUS: CLEAR. Supplier {supplier} shows baseline stability with WRI of {wri}."
    else:
        findings = state.get("forensic_findings")
        findings_text = findings[0] if findings else "Automated metrics indicate elevated volatility."
        memo = (
            f"CRITICAL WATCHTOWER DIRECTIVE | S.A.I.N.T. SYSTEM\n"
            f"Target: {supplier} ({state.get('ticker')}) | Assessed WRI: {wri} [{tier} RISK]\n"
            f"----------------------------------------------------------------------\n"
            f"{findings_text}\n\n"
            f"Recommended Governance: Initiate dual-sourcing contingency and audit Tier-2 buffer inventory."
        )
    return {"executive_memo": memo}

def route_risk(state: SaintState) -> str:
    return "deep_forensics" if state.get("risk_tier") == "HIGH" else "memo_generator"

# 4. Construct Graph
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
    {
        "deep_forensics": "deep_forensics",
        "memo_generator": "memo_generator"
    }
)
workflow.add_edge("deep_forensics", "memo_generator")
workflow.add_edge("memo_generator", END)

saint_engine = workflow.compile()

# 5. FastAPI App & Streaming Endpoint
app = FastAPI(title="S.A.I.N.T. Local Agent Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/stream-audit")
async def stream_audit(supplier_name: str, ticker: str, request: Request):
    async def event_generator():
        initial_state: SaintState = {
            "supplier_name": supplier_name,
            "ticker": ticker,
            "macro_data": None,
            "wri_score": 0.0,
            "risk_tier": "UNKNOWN",
            "forensic_findings": None,
            "executive_memo": ""
        }

        step_descriptions = {
            "ingest": "Aggregating Macro & Fiscal Indicators...",
            "wri": "Computing S.A.I.N.T. Weighted Risk Index (WRI)...",
            "deep_forensics": "Elevated Risk Detected. Running Local Mistral Forensic Auditor...",
            "memo_generator": "Synthesizing Final Risk Memo & Governance Directives..."
        }

        try:
            async for chunk in saint_engine.astream(initial_state, stream_mode="updates"):
                if await request.is_disconnected():
                    break

                for node_name, node_update in chunk.items():
                    event_payload = {
                        "node": node_name,
                        "status_text": step_descriptions.get(node_name, f"Executing {node_name}..."),
                        "data": node_update
                    }
                    yield {"event": "node_update", "data": json.dumps(event_payload)}

            yield {"event": "done", "data": json.dumps({"status": "COMPLETE"})}
        except Exception as e:
            yield {"event": "error", "data": json.dumps({"error": str(e)})}

    return EventSourceResponse(event_generator())
