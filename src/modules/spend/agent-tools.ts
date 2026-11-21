import { z } from "zod";
import { defineAgentTool, type AgentToolDefinition } from "@/core/agent";
import { AppError } from "@/core/errors";
import { findSupplierByNameOrCode } from "@/modules/suppliers";
import {
  evaluatePurchasePolicy,
  getSpendByCategory,
  getSpendBySupplier,
  getSpendStats,
  listBudgets,
  listInvoices,
  listPurchaseOrders,
} from "./services/spend.service";
import { classifySpend, threeWayMatch, SOLE_SOURCE_THRESHOLD_USD } from "./domain/policy";
import { policyDecisionSchema } from "./domain/validation";

/**
 * Spend capabilities for the AI layer — the tools behind BUYER_COPILOT and
 * ANALYTICS_ENGINE behaviour.
 *
 * Note what is absent: nothing here issues a purchase order or pays an
 * invoice. The agent can check whether a commitment *would* pass the controls
 * and explain why not; committing company funds stays a human action.
 */

export const checkPurchaseAllowed = defineAgentTool({
  name: "spend_check_purchase_policy",
  module: "spend",
  description:
    "Check a proposed purchase against the procurement controls: budget headroom, the approver's " +
    "delegation-of-authority limit, the sole-source justification requirement and — when a part is " +
    "given — whether the supplier is an approved source of that part. Always call this before " +
    "telling a user they can go ahead with a buy.",
  permission: "spend:read",
  input: z.object({
    amount: z.number().positive().describe("Committed amount"),
    currency: z.string().length(3).default("USD"),
    approverId: z.string().min(1).describe("User id of the person who would approve"),
    budgetId: z.string().optional(),
    supplier: z.string().optional().describe("Supplier code or legal name"),
    competitiveBids: z.number().int().min(0).default(0).describe("How many competing bids were received"),
    soleSourceJustification: z.string().optional(),
    partId: z.string().optional().describe("Product-graph part id, from product_search_parts"),
    partName: z.string().max(300).optional().describe("The part's name, with partId"),
  }),
  output: policyDecisionSchema.extend({
    approvalLimit: z.number().nullable(),
    budgetRemaining: z.number().nullable(),
    summary: z.string(),
  }),
  handler: async (input) => {
    let supplierId: string | undefined;
    if (input.supplier) {
      const s = await findSupplierByNameOrCode(input.supplier);
      if (!s) throw AppError.notFound(`Supplier "${input.supplier}"`);
      supplierId = s.id;
    }
    const decision = await evaluatePurchasePolicy({ ...input, supplierId });
    return {
      ...decision,
      summary: decision.approved
        ? `Approved${decision.warnings.length ? ` with ${decision.warnings.length} warning(s)` : ""}.`
        : `Blocked: ${decision.violations.map((v) => v.control).join(", ")}.`,
    };
  },
});

export const classifyPurchase = defineAgentTool({
  name: "spend_classify_purchase",
  module: "spend",
  description:
    "Assign a UNSPSC commodity segment to a free-text purchase description. Use when categorising a " +
    "request or explaining which spend category a buy falls into.",
  permission: "spend:read",
  input: z.object({
    description: z.string().min(3),
    category: z.string().optional(),
  }),
  output: z.object({
    commodityCode: z.string(),
    segment: z.string(),
    confident: z.boolean(),
  }),
  handler: async (input) => classifySpend(input.description, input.category),
});

export const runThreeWayMatch = defineAgentTool({
  name: "spend_three_way_match",
  module: "spend",
  description:
    "Compare a purchase order amount, the receipted value and an invoice amount, and report whether " +
    "they reconcile within tolerance. Use to explain why an invoice is in exception.",
  permission: "spend:read",
  input: z.object({
    poAmount: z.number().min(0),
    receivedAmount: z.number().min(0),
    invoiceAmount: z.number().min(0),
  }),
  output: z.object({
    matched: z.boolean(),
    variance: z.number(),
    poVsInvoiceVariancePct: z.number(),
    receiptVsInvoiceVariancePct: z.number(),
    reasons: z.array(z.string()),
  }),
  handler: async (input) => threeWayMatch(input),
});

export const spendAnalytics = defineAgentTool({
  name: "spend_analytics",
  module: "spend",
  description:
    "Spend broken down by category or by supplier, with totals and order counts. Use for " +
    "'where is our money going', consolidation opportunities and tail-spend questions.",
  permission: "spend:read",
  input: z.object({
    dimension: z.enum(["category", "supplier"]).default("category"),
    limit: z.number().int().min(1).max(50).default(15),
  }),
  output: z.object({
    dimension: z.string(),
    rows: z.array(
      z.object({ key: z.string(), totalSpend: z.number(), orderCount: z.number() })
    ),
    totalSpend: z.number(),
  }),
  handler: async (input) => {
    const rows =
      input.dimension === "supplier"
        ? (await getSpendBySupplier(input.limit)).map((r) => ({
            key: r.supplierId,
            totalSpend: Number(r.totalSpend),
            orderCount: r.orderCount,
          }))
        : (await getSpendByCategory()).slice(0, input.limit).map((r) => ({
            key: r.category,
            totalSpend: Number(r.totalSpend),
            orderCount: r.orderCount,
          }));

    return {
      dimension: input.dimension,
      rows,
      totalSpend: rows.reduce((s, r) => s + r.totalSpend, 0),
    };
  },
});

export const budgetPosition = defineAgentTool({
  name: "spend_budget_position",
  module: "spend",
  description:
    "Budget lines with their committed, spent and remaining amounts. Use to answer 'do we have " +
    "budget for this?' before checking the wider purchase policy.",
  permission: "spend:read",
  input: z.object({ fiscalYear: z.number().int().min(2000).max(2100).optional() }),
  output: z.object({
    budgets: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        fiscalYear: z.number(),
        costCenter: z.string(),
        amount: z.number(),
        committed: z.number(),
        spent: z.number(),
        remaining: z.number(),
        currency: z.string(),
      })
    ),
  }),
  handler: async (input) => {
    const rows = await listBudgets(input.fiscalYear);
    return {
      budgets: rows.map((b) => ({
        id: b.id,
        name: b.name,
        fiscalYear: b.fiscalYear,
        costCenter: b.costCenter,
        amount: b.amount,
        committed: b.committed,
        spent: b.spent,
        remaining: b.remaining,
        currency: b.currency,
      })),
    };
  },
});

export const invoiceExceptions = defineAgentTool({
  name: "spend_invoice_exceptions",
  module: "spend",
  description:
    "List invoices that failed the three-way match, with the reason each one is held. Use for " +
    "'what is stuck in AP?' and to prioritise exception clearing.",
  permission: "spend:read",
  input: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
  output: z.object({
    exceptions: z.array(
      z.object({
        invoiceNumber: z.string(),
        supplierId: z.string(),
        amount: z.number(),
        currency: z.string(),
        reason: z.string().nullable(),
      })
    ),
  }),
  handler: async (input) => {
    const rows = await listInvoices({ status: "EXCEPTION", limit: input.limit });
    return {
      exceptions: rows.map((i) => ({
        invoiceNumber: i.invoiceNumber,
        supplierId: i.supplierId,
        amount: i.amount,
        currency: i.currency,
        reason: i.exceptionReason,
      })),
    };
  },
});

export const openCommitments = defineAgentTool({
  name: "spend_open_commitments",
  module: "spend",
  description:
    "Open purchase orders, optionally for one supplier and/or one product-graph part. Use to size " +
    "exposure to a vendor before advising on a risk event affecting it, or to find what is on order " +
    "for a part that is changing.",
  permission: "spend:read",
  input: z.object({
    supplier: z.string().optional().describe("Supplier code or legal name"),
    partId: z.string().optional().describe("Product-graph part id, from product_search_parts"),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  output: z.object({
    orders: z.array(
      z.object({
        poNumber: z.string(),
        supplierId: z.string(),
        partName: z.string().nullable(),
        description: z.string(),
        amount: z.number(),
        currency: z.string(),
        status: z.string(),
      })
    ),
    totalExposure: z.number(),
  }),
  handler: async (input) => {
    let supplierId: string | undefined;
    if (input.supplier) {
      const s = await findSupplierByNameOrCode(input.supplier);
      if (!s) throw AppError.notFound(`Supplier "${input.supplier}"`);
      supplierId = s.id;
    }
    const rows = await listPurchaseOrders({ supplierId, partId: input.partId, status: "OPEN", limit: input.limit });
    return {
      orders: rows.map((p) => ({
        poNumber: p.poNumber,
        supplierId: p.supplierId,
        partName: p.partName,
        description: p.description,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
      })),
      totalExposure: rows.reduce((s, p) => s + p.amount, 0),
    };
  },
});

export const spendOverview = defineAgentTool({
  name: "spend_overview_stats",
  module: "spend",
  description: `Headline spend figures: committed value, open orders, invoice count and exceptions, and off-contract requisitions. The sole-source threshold is ${SOLE_SOURCE_THRESHOLD_USD} USD.`,
  permission: "spend:read",
  input: z.object({}),
  output: z.object({
    totalCommitted: z.number(),
    openOrders: z.number(),
    orderCount: z.number(),
    invoiceCount: z.number(),
    invoiceExceptions: z.number(),
    invoicedValue: z.number(),
    offContractRequisitions: z.number(),
  }),
  handler: async () => getSpendStats(),
});

export const spendAgentTools: AgentToolDefinition[] = [
  checkPurchaseAllowed,
  classifyPurchase,
  runThreeWayMatch,
  spendAnalytics,
  budgetPosition,
  invoiceExceptions,
  openCommitments,
  spendOverview,
] as unknown as AgentToolDefinition[];
