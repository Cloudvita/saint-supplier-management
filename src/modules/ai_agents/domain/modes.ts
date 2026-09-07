import type { ModuleName } from "@/core/agent";

/**
 * The four operational modes the platform's AI assumes, and the tool surface
 * each one is given.
 *
 * Scoping tools per mode is a correctness measure as much as a security one:
 * an agent answering a spend-analytics question does better with eight
 * relevant tools than with thirty, and cannot wander into contract mutation on
 * the way to an answer.
 */
export type AgentMode = "SOURCING_ADVISOR" | "BUYER_COPILOT" | "ANALYTICS_ENGINE" | "CONTRACT_AUDITOR";

export type ModeDefinition = {
  mode: AgentMode;
  label: string;
  /** When the router should select this mode. */
  intent: string;
  modules: ModuleName[];
  responsibilities: string[];
};

export const AGENT_MODES: Record<AgentMode, ModeDefinition> = {
  SOURCING_ADVISOR: {
    mode: "SOURCING_ADVISOR",
    label: "Sourcing Advisor",
    intent: "RFx drafting, supplier selection, market analysis, negotiation preparation",
    modules: ["suppliers", "contracts", "spend", "reports", "auth"],
    responsibilities: [
      "Generate comparative bid tables and weighted evaluation matrices",
      "Evaluate trade-offs across cost, SLA, ESG and delivery",
      "Draft negotiation talking points grounded in contract and spend data",
    ],
  },
  BUYER_COPILOT: {
    mode: "BUYER_COPILOT",
    label: "Buyer Co-pilot",
    intent: "Raising requisitions, approvals, catalogue and guided-buying questions",
    modules: ["spend", "suppliers", "contracts", "user_admin", "auth"],
    responsibilities: [
      "Guide non-procurement users through guided buying",
      "Check the approval matrix and delegation-of-authority limits before advising",
      "Validate budget headroom and flag off-contract spend",
    ],
  },
  ANALYTICS_ENGINE: {
    mode: "ANALYTICS_ENGINE",
    label: "Analytics Engine",
    intent: "Spend breakdown, savings tracking, tail spend, supplier performance",
    modules: ["reports", "spend", "suppliers", "auth"],
    responsibilities: [
      "Compute spend metrics: addressable spend, tail spend share, exception rates",
      "Identify consolidation targets and volume-discount thresholds",
      "Present findings as tables, not prose",
    ],
  },
  CONTRACT_AUDITOR: {
    mode: "CONTRACT_AUDITOR",
    label: "Contract Auditor",
    intent: "Contract review, clause compliance, renewal tracking, risk checks",
    modules: ["contracts", "suppliers", "reports", "auth"],
    responsibilities: [
      "Highlight non-standard clauses and missing mandatory clauses",
      "Alert on pending renewals inside the notice window",
      "Verify commercial terms against the contracted position",
    ],
  },
};

export const AGENT_MODE_KEYS = Object.keys(AGENT_MODES) as AgentMode[];

/**
 * Lightweight intent routing.
 *
 * Deliberately keyword-based: the Python graph re-routes with the LLM when this
 * is ambiguous, but a cheap deterministic first pass keeps the common cases
 * fast and makes mode selection explainable.
 */
export function routeMode(prompt: string): AgentMode {
  const text = prompt.toLowerCase();
  const score: Record<AgentMode, number> = {
    SOURCING_ADVISOR: 0,
    BUYER_COPILOT: 0,
    ANALYTICS_ENGINE: 0,
    CONTRACT_AUDITOR: 0,
  };

  const rules: Array<[AgentMode, RegExp[]]> = [
    [
      "CONTRACT_AUDITOR",
      [/contract/, /clause/, /msa\b/, /sow\b/, /renew/, /expir/, /indemnif/, /liability/, /terminat/, /sign/],
    ],
    [
      "ANALYTICS_ENGINE",
      [/spend/, /analy[sz]/, /report/, /dashboard/, /savings?/, /tail/, /trend/, /how much/, /breakdown/, /metric/],
    ],
    [
      "BUYER_COPILOT",
      [/\bbuy\b/, /purchase/, /requisition/, /\bpo\b/, /approv/, /budget/, /invoice/, /order/, /catalog/],
    ],
    [
      "SOURCING_ADVISOR",
      [/rfp|rfi|rfq|rfx/, /sourc/, /bid/, /tender/, /negotiat/, /vendor selection/, /supplier discovery/, /evaluat/],
    ],
  ];

  for (const [mode, patterns] of rules) {
    score[mode] += patterns.filter((p) => p.test(text)).length;
  }

  const best = (Object.entries(score) as Array<[AgentMode, number]>).sort((a, b) => b[1] - a[1])[0];
  // Nothing matched: the analytics view answers the widest range of questions.
  return best[1] === 0 ? "ANALYTICS_ENGINE" : best[0];
}
