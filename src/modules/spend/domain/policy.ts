import { round2, variancePct } from "@/shared/utils";

/**
 * The procurement control set, as pure functions.
 *
 * These are the platform's three standing guardrails:
 *   1. No PO without budget verification and delegation-of-authority (DOA) cover.
 *   2. Single-source spend above the threshold needs a documented justification.
 *   3. Invoices must pass a three-way match before payment.
 *
 * Keeping them free of database access means the same rule that blocks a
 * purchase order in the UI is the rule an agent quotes when asked "can I buy
 * this?", with no chance of the two drifting apart.
 */

/** Spend above this on a single supplier without competition needs a justification. */
export const SOLE_SOURCE_THRESHOLD_USD = 50_000;

/** Tolerance on the three-way match before an invoice becomes an exception. */
export const MATCH_TOLERANCE_PCT = 2;
export const MATCH_TOLERANCE_ABS_USD = 25;

export type PolicyViolation = { control: string; message: string; severity: "BLOCK" | "WARN" };

export type PolicyDecision = {
  approved: boolean;
  violations: PolicyViolation[];
  warnings: PolicyViolation[];
};

function decide(all: PolicyViolation[]): PolicyDecision {
  const violations = all.filter((v) => v.severity === "BLOCK");
  return { approved: violations.length === 0, violations, warnings: all.filter((v) => v.severity === "WARN") };
}

export type BudgetPosition = {
  amount: number;
  committed: number;
  spent: number;
};

/** Remaining headroom on a budget line. */
export function budgetRemaining(b: BudgetPosition): number {
  return round2(b.amount - b.committed - b.spent);
}

export type PurchaseCheck = {
  amount: number;
  currency: string;
  /** Approver's DOA ceiling; null = unlimited. */
  approvalLimit: number | null;
  budget?: BudgetPosition | null;
  onContract: boolean;
  competitiveBids: number;
  soleSourceJustification?: string | null;
};

/**
 * Control 1 + 2, evaluated together for a requisition or purchase order.
 *
 * A missing budget line, insufficient headroom, an over-limit approver, or an
 * unjustified single-source award above the threshold all BLOCK. Off-contract
 * (maverick) buying WARNs — it is a leakage signal, not an illegal act.
 */
export function checkPurchasePolicy(input: PurchaseCheck): PolicyDecision {
  const found: PolicyViolation[] = [];

  // --- Control 1: budget verification ---
  if (!input.budget) {
    found.push({
      control: "BUDGET_VERIFICATION",
      message: "No budget line is assigned. A purchase order cannot be issued without one.",
      severity: "BLOCK",
    });
  } else {
    const remaining = budgetRemaining(input.budget);
    if (input.amount > remaining) {
      found.push({
        control: "BUDGET_VERIFICATION",
        message: `Amount ${input.currency} ${round2(input.amount)} exceeds remaining budget of ${input.currency} ${remaining}.`,
        severity: "BLOCK",
      });
    } else if (input.amount > remaining * 0.8) {
      found.push({
        control: "BUDGET_VERIFICATION",
        message: `This commitment consumes over 80% of the remaining budget (${input.currency} ${remaining}).`,
        severity: "WARN",
      });
    }
  }

  // --- Control 1: delegation of authority ---
  if (input.approvalLimit !== null && input.amount > input.approvalLimit) {
    found.push({
      control: "DELEGATION_OF_AUTHORITY",
      message: `Amount ${input.currency} ${round2(input.amount)} exceeds the approver's authority of ${input.currency} ${input.approvalLimit}. Escalate to the next approval level.`,
      severity: "BLOCK",
    });
  }

  // --- Control 2: sole source ---
  if (
    input.amount >= SOLE_SOURCE_THRESHOLD_USD &&
    input.competitiveBids < 2 &&
    !input.soleSourceJustification?.trim()
  ) {
    found.push({
      control: "SOLE_SOURCE_JUSTIFICATION",
      message: `Single-source award of ${input.currency} ${round2(input.amount)} is at or above the ${SOLE_SOURCE_THRESHOLD_USD} threshold and has no documented sole-source justification.`,
      severity: "BLOCK",
    });
  }

  // --- Leakage signal ---
  if (!input.onContract) {
    found.push({
      control: "OFF_CONTRACT_SPEND",
      message: "No catalogue contract covers this purchase — off-contract (maverick) spend.",
      severity: "WARN",
    });
  }

  return decide(found);
}

/* ------------------------- three-way match ----------------------- */

export type MatchInput = {
  poAmount: number;
  receivedAmount: number;
  invoiceAmount: number;
};

export type MatchResult = {
  matched: boolean;
  poVsInvoiceVariancePct: number;
  receiptVsInvoiceVariancePct: number;
  variance: number;
  reasons: string[];
};

/**
 * Control 3: PO vs goods receipt vs invoice.
 *
 * Tolerance is both relative and absolute, so a $4 rounding difference on a
 * $12,000 order does not raise an exception while a 10% overcharge on a small
 * order still does.
 */
export function threeWayMatch(input: MatchInput): MatchResult {
  const reasons: string[] = [];

  const poVar = variancePct(input.poAmount, input.invoiceAmount);
  const receiptVar = variancePct(input.receivedAmount, input.invoiceAmount);
  const absPo = Math.abs(input.invoiceAmount - input.poAmount);
  const absReceipt = Math.abs(input.invoiceAmount - input.receivedAmount);

  const withinTolerance = (pct: number, abs: number) =>
    pct <= MATCH_TOLERANCE_PCT || abs <= MATCH_TOLERANCE_ABS_USD;

  if (!withinTolerance(poVar, absPo)) {
    reasons.push(
      `Invoice ${round2(input.invoiceAmount)} differs from PO ${round2(input.poAmount)} by ${poVar.toFixed(1)}%.`
    );
  }
  if (input.receivedAmount === 0) {
    reasons.push("No goods receipt recorded against this purchase order.");
  } else if (!withinTolerance(receiptVar, absReceipt)) {
    reasons.push(
      `Invoice ${round2(input.invoiceAmount)} differs from receipted value ${round2(input.receivedAmount)} by ${receiptVar.toFixed(1)}%.`
    );
  }

  return {
    matched: reasons.length === 0,
    poVsInvoiceVariancePct: Number(poVar.toFixed(2)),
    receiptVsInvoiceVariancePct: Number(receiptVar.toFixed(2)),
    variance: round2(input.invoiceAmount - input.poAmount),
    reasons,
  };
}

/* ------------------------ spend classification ------------------- */

/**
 * Coarse UNSPSC segment assignment from free text.
 *
 * A deliberate first pass: it cleanses the long tail into spend-cube segments
 * cheaply and repeatably. An LLM classifier can refine it later — the return
 * shape is what the rest of the module depends on, not the mechanism.
 */
const TAXONOMY: Array<{ code: string; segment: string; patterns: RegExp[] }> = [
  { code: "43000000", segment: "IT & Telecommunications", patterns: [/software|licen[cs]e|saas|server|laptop|cloud|hosting|network/i] },
  { code: "80000000", segment: "Professional Services", patterns: [/consult|advisory|audit|legal|accounting|staffing|contractor/i] },
  { code: "81000000", segment: "Engineering & Research", patterns: [/engineering|r&d|research|design services|testing/i] },
  { code: "72000000", segment: "Facilities & Construction", patterns: [/facilit|building|construction|maintenance|hvac|cleaning/i] },
  { code: "78000000", segment: "Transportation & Logistics", patterns: [/freight|logistics|shipping|courier|warehous|transport/i] },
  { code: "44000000", segment: "Office Equipment & Supplies", patterns: [/stationery|office supplies|printer|furniture|desk/i] },
  { code: "82000000", segment: "Marketing & Media", patterns: [/marketing|advertis|media|branding|campaign|events?/i] },
  { code: "84000000", segment: "Financial & Insurance", patterns: [/insurance|banking|financial services|treasury/i] },
  { code: "86000000", segment: "Training & Education", patterns: [/training|course|certification|education|workshop/i] },
];

export function classifySpend(description: string, category?: string | null) {
  const text = `${description} ${category ?? ""}`;
  const hit = TAXONOMY.find((t) => t.patterns.some((p) => p.test(text)));
  return hit
    ? { commodityCode: hit.code, segment: hit.segment, confident: true }
    : { commodityCode: "99000000", segment: "Unclassified / Tail Spend", confident: false };
}
