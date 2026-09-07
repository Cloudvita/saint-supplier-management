/**
 * Clause detection and the mandatory-clause guardrail.
 *
 * Deterministic and pure, in the same spirit as the supplier news classifier:
 * the rules are auditable, cheap, and produce identical results on every run —
 * which matters when the output becomes a compliance warning banner. An LLM
 * pass can layer on top later without changing this contract.
 */

export type ClauseKey =
  | "GDPR_DATA_PRIVACY"
  | "LIMITATION_OF_LIABILITY"
  | "TERMINATION_FOR_CONVENIENCE"
  | "INDEMNIFICATION"
  | "CONFIDENTIALITY"
  | "SLA"
  | "AUDIT_RIGHTS"
  | "INSURANCE"
  | "FORCE_MAJEURE"
  | "ASSIGNMENT"
  | "GOVERNING_LAW"
  | "PRICE_ESCALATION";

type ClauseRule = { key: ClauseKey; label: string; patterns: RegExp[] };

const CLAUSE_RULES: ClauseRule[] = [
  {
    key: "GDPR_DATA_PRIVACY",
    label: "Data privacy / GDPR",
    patterns: [/\bgdpr\b/i, /data protection/i, /personal data/i, /data processing agreement/i, /\bdpa\b/i],
  },
  {
    key: "LIMITATION_OF_LIABILITY",
    label: "Limitation of liability",
    patterns: [/limitation of liability/i, /liability (shall be )?limited/i, /aggregate liability/i, /consequential damages/i],
  },
  {
    key: "TERMINATION_FOR_CONVENIENCE",
    label: "Termination for convenience",
    patterns: [/termination for convenience/i, /terminate .{0,30}without cause/i, /upon \w+ days.{0,20}written notice/i],
  },
  {
    key: "INDEMNIFICATION",
    label: "Indemnification",
    patterns: [/indemnif(y|ication|ies)/i, /hold harmless/i],
  },
  {
    key: "CONFIDENTIALITY",
    label: "Confidentiality",
    patterns: [/confidential(ity)?/i, /non[- ]disclosure/i, /proprietary information/i],
  },
  {
    key: "SLA",
    label: "Service levels",
    patterns: [/service level/i, /\bsla\b/i, /uptime/i, /response time/i, /service credits?/i],
  },
  { key: "AUDIT_RIGHTS", label: "Audit rights", patterns: [/right to audit/i, /audit rights/i, /books and records/i] },
  { key: "INSURANCE", label: "Insurance", patterns: [/insurance/i, /certificate of insurance/i, /\bcoi\b/i] },
  { key: "FORCE_MAJEURE", label: "Force majeure", patterns: [/force majeure/i, /acts of god/i] },
  { key: "ASSIGNMENT", label: "Assignment", patterns: [/assignment/i, /may not assign/i, /change of control/i] },
  { key: "GOVERNING_LAW", label: "Governing law", patterns: [/governing law/i, /governed by the laws/i, /jurisdiction/i] },
  {
    key: "PRICE_ESCALATION",
    label: "Price escalation",
    patterns: [/price (increase|escalation|adjustment)/i, /\bcpi\b/i, /annual uplift/i],
  },
];

/**
 * Clauses a contract must carry to pass procurement review.
 *
 * Mirrors the platform's third governance control: a contract missing any of
 * these is flagged rather than silently accepted.
 */
export const MANDATORY_CLAUSES: ClauseKey[] = [
  "GDPR_DATA_PRIVACY",
  "LIMITATION_OF_LIABILITY",
  "TERMINATION_FOR_CONVENIENCE",
];

export const CLAUSE_LABELS: Record<ClauseKey, string> = Object.fromEntries(
  CLAUSE_RULES.map((r) => [r.key, r.label])
) as Record<ClauseKey, string>;

export type ClauseAudit = {
  detected: ClauseKey[];
  missing: ClauseKey[];
  /** Non-standard terms worth a human read. */
  riskFlags: string[];
  compliant: boolean;
};

export function detectClauses(text: string): ClauseKey[] {
  return CLAUSE_RULES.filter((rule) => rule.patterns.some((p) => p.test(text))).map((r) => r.key);
}

/** Non-standard commercial terms that should not pass unnoticed. */
function detectRiskFlags(text: string): string[] {
  const flags: string[] = [];

  if (/\bauto(matically)?[- ]renew/i.test(text) && !/terminat\w+ for convenience/i.test(text)) {
    flags.push("Auto-renewal without a termination-for-convenience right");
  }
  if (/unlimited liability|liability .{0,20}not .{0,20}limited/i.test(text)) {
    flags.push("Unlimited or uncapped liability");
  }
  if (/exclusiv(e|ity)/i.test(text)) {
    flags.push("Exclusivity commitment — check single-source exposure");
  }
  if (/\bnet\s*(60|75|90|120)\b/i.test(text)) {
    flags.push("Payment terms longer than NET30");
  }
  if (/perpetual/i.test(text) && /licen[cs]e/i.test(text)) {
    flags.push("Perpetual licence grant");
  }
  // Matches both orders: "8% annual increase" and "price increase of 8%".
  const escalation =
    text.match(/(\d{1,2}(?:\.\d)?)\s*%[^.\n]{0,30}?(?:increase|escalation|uplift|adjustment)/i) ??
    text.match(/(?:increase|escalation|uplift|adjustment)[^.\n]{0,30}?(\d{1,2}(?:\.\d)?)\s*%/i);
  if (escalation && Number(escalation[1]) > 5) {
    flags.push(`Price escalation above 5% (${escalation[1]}%)`);
  }
  return flags;
}

/**
 * Audit a contract body against the mandatory-clause policy.
 * `compliant` is false whenever a mandatory clause is absent.
 */
export function auditClauses(text: string): ClauseAudit {
  const detected = detectClauses(text);
  const missing = MANDATORY_CLAUSES.filter((c) => !detected.includes(c));
  return {
    detected,
    missing,
    riskFlags: detectRiskFlags(text),
    compliant: missing.length === 0,
  };
}
