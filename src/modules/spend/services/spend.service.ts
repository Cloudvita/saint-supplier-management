import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { AppError } from "@/core/errors";
import { publish } from "@/core/events";
import { createLogger } from "@/core/logger";
import { round2, sequenceCode } from "@/shared/utils";
import { getEffectiveAuthorisation } from "@/modules/user_admin";
import { getActiveContractsForSupplier } from "@/modules/contracts";
import { budgets, goodsReceipts, invoices, purchaseOrders, requisitions } from "../schema";
import {
  checkPurchasePolicy,
  classifySpend,
  budgetRemaining,
  threeWayMatch,
  type PolicyDecision,
} from "../domain/policy";
import type {
  BudgetInput,
  GoodsReceiptInput,
  InvoiceInput,
  PurchaseOrderInput,
  RequisitionInput,
} from "../domain/validation";

const log = createLogger("spend");

/* ------------------------------ budgets -------------------------- */

export async function listBudgets(fiscalYear?: number) {
  const rows = await db
    .select()
    .from(budgets)
    .where(fiscalYear ? eq(budgets.fiscalYear, fiscalYear) : undefined)
    .orderBy(desc(budgets.fiscalYear));
  return rows.map((b) => ({ ...b, remaining: budgetRemaining(b) }));
}

export async function createBudget(input: BudgetInput) {
  const [row] = await db.insert(budgets).values(input).returning();
  return { ...row, remaining: budgetRemaining(row) };
}

async function loadBudget(budgetId?: string | null) {
  if (!budgetId) return null;
  const [row] = await db.select().from(budgets).where(eq(budgets.id, budgetId));
  return row ?? null;
}

/* --------------------------- requisitions ------------------------ */

/**
 * Raise a requisition, classifying it and checking it against an existing
 * contract so off-contract spend is visible from the moment it is requested.
 */
export async function createRequisition(input: RequisitionInput, requesterId: string) {
  const classification = classifySpend(input.description, input.category);

  let onContract = false;
  let contractId: string | undefined;
  if (input.supplierId) {
    const contracts = await getActiveContractsForSupplier(input.supplierId);
    onContract = contracts.length > 0;
    contractId = contracts[0]?.id;
  }

  const row = await db.transaction(async (tx) => {
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(requisitions);
    const [created] = await tx
      .insert(requisitions)
      .values({
        requisitionNumber: sequenceCode("REQ", count + 1),
        requesterId,
        supplierId: input.supplierId,
        budgetId: input.budgetId,
        description: input.description,
        commodityCode: classification.commodityCode,
        category: input.category ?? classification.segment,
        amount: input.amount,
        currency: input.currency,
        onContract,
        contractId,
        soleSourceJustification: input.soleSourceJustification,
        status: "SUBMITTED",
      })
      .returning();
    return created;
  });

  await publish("spend.requisition_submitted", {
    requisitionId: row.id,
    requesterId,
    amount: row.amount,
  });
  log.info("requisition submitted", { requisitionId: row.id, amount: row.amount });
  return { ...row, classification };
}

export async function listRequisitions(opts: { status?: (typeof requisitions.status.enumValues)[number]; limit?: number } = {}) {
  return db
    .select()
    .from(requisitions)
    .where(opts.status ? eq(requisitions.status, opts.status) : undefined)
    .orderBy(desc(requisitions.createdAt))
    .limit(Math.min(opts.limit ?? 25, 100));
}

/* ------------------------- policy evaluation --------------------- */

/**
 * Run the procurement controls for a proposed commitment.
 *
 * Exposed on its own (not just inside `issuePurchaseOrder`) because both the
 * buyer's UI and the AI layer need to *ask* whether something would pass
 * before anyone tries it.
 */
export async function evaluatePurchasePolicy(input: {
  amount: number;
  currency?: string;
  approverId: string;
  budgetId?: string | null;
  supplierId?: string | null;
  competitiveBids?: number;
  soleSourceJustification?: string | null;
}): Promise<PolicyDecision & { approvalLimit: number | null; budgetRemaining: number | null }> {
  // The system actor (scheduled jobs, seeding) has no user row and no DOA
  // ceiling; everything else must resolve to a real, active user.
  const approvalLimit =
    input.approverId === "system"
      ? null
      : (await getEffectiveAuthorisation(input.approverId)).approvalLimit;
  const budget = await loadBudget(input.budgetId);

  let onContract = false;
  if (input.supplierId) {
    onContract = (await getActiveContractsForSupplier(input.supplierId)).length > 0;
  }

  const decision = checkPurchasePolicy({
    amount: input.amount,
    currency: input.currency ?? "USD",
    approvalLimit,
    budget,
    onContract,
    competitiveBids: input.competitiveBids ?? 0,
    soleSourceJustification: input.soleSourceJustification,
  });

  return {
    ...decision,
    approvalLimit,
    budgetRemaining: budget ? budgetRemaining(budget) : null,
  };
}

/* ------------------------- purchase orders ----------------------- */

/**
 * Issue a purchase order.
 *
 * The policy check is not advisory here: a BLOCK-level violation throws, so
 * there is no code path that writes a PO which the controls would have refused.
 */
export async function issuePurchaseOrder(input: PurchaseOrderInput, issuedBy: string) {
  const decision = await evaluatePurchasePolicy({
    amount: input.amount,
    currency: input.currency,
    approverId: issuedBy,
    budgetId: input.budgetId,
    supplierId: input.supplierId,
    competitiveBids: input.competitiveBids,
    soleSourceJustification: input.soleSourceJustification,
  });

  if (!decision.approved) {
    throw AppError.policy("Purchase order blocked by procurement policy", {
      violations: decision.violations,
    });
  }

  const po = await db.transaction(async (tx) => {
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(purchaseOrders);
    const [created] = await tx
      .insert(purchaseOrders)
      .values({
        poNumber: sequenceCode("PO", count + 1),
        requisitionId: input.requisitionId,
        supplierId: input.supplierId,
        contractId: input.contractId,
        budgetId: input.budgetId,
        description: input.description,
        category: input.category,
        amount: input.amount,
        currency: input.currency,
        paymentTerms: input.paymentTerms,
        expectedDeliveryDate: input.expectedDeliveryDate,
        issuedBy,
      })
      .returning();

    // Commit the funds so a second PO cannot spend the same headroom.
    if (input.budgetId) {
      await tx
        .update(budgets)
        .set({ committed: sql`${budgets.committed} + ${input.amount}` })
        .where(eq(budgets.id, input.budgetId));
    }
    if (input.requisitionId) {
      await tx
        .update(requisitions)
        .set({ status: "CONVERTED", approverId: issuedBy, approvedAt: new Date() })
        .where(eq(requisitions.id, input.requisitionId));
    }
    return created;
  });

  await publish("spend.po_issued", {
    purchaseOrderId: po.id,
    supplierId: po.supplierId,
    amount: po.amount,
  });
  log.info("purchase order issued", { poNumber: po.poNumber, amount: po.amount });
  return { purchaseOrder: po, warnings: decision.warnings };
}

export async function listPurchaseOrders(opts: { supplierId?: string; status?: (typeof purchaseOrders.status.enumValues)[number]; limit?: number } = {}) {
  const filters = [];
  if (opts.supplierId) filters.push(eq(purchaseOrders.supplierId, opts.supplierId));
  if (opts.status) filters.push(eq(purchaseOrders.status, opts.status));

  return db
    .select()
    .from(purchaseOrders)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(purchaseOrders.issuedAt))
    .limit(Math.min(opts.limit ?? 25, 100));
}

/* ------------------------- goods receipts ------------------------ */

export async function recordGoodsReceipt(input: GoodsReceiptInput, receivedBy: string) {
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, input.purchaseOrderId));
  if (!po) throw AppError.notFound("Purchase order");

  const [receipt] = await db
    .insert(goodsReceipts)
    .values({ ...input, receivedBy })
    .returning();

  const [{ total }] = await db
    .select({ total: sql<number>`coalesce(sum(${goodsReceipts.receivedAmount}), 0)` })
    .from(goodsReceipts)
    .where(eq(goodsReceipts.purchaseOrderId, input.purchaseOrderId));

  await db
    .update(purchaseOrders)
    .set({ status: Number(total) >= po.amount ? "RECEIVED" : "PARTIALLY_RECEIVED" })
    .where(eq(purchaseOrders.id, input.purchaseOrderId));

  return { receipt, receivedToDate: round2(Number(total)) };
}

/* ----------------------------- invoices -------------------------- */

/**
 * Record a supplier invoice and run the three-way match immediately.
 *
 * An invoice that fails the match is never silently accepted: it lands in
 * EXCEPTION with the specific reasons attached, and the exception is published
 * so finance can pick it up.
 */
export async function recordInvoice(input: InvoiceInput) {
  const [invoice] = await db.insert(invoices).values(input).returning();

  if (!input.purchaseOrderId) {
    await db
      .update(invoices)
      .set({ status: "EXCEPTION", exceptionReason: "No purchase order referenced (non-PO invoice)" })
      .where(eq(invoices.id, invoice.id));
    await publish("spend.invoice_exception", {
      invoiceId: invoice.id,
      reason: "No purchase order referenced",
    });
    return { invoice, match: null };
  }

  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, input.purchaseOrderId));
  if (!po) throw AppError.notFound("Purchase order");

  const [{ received }] = await db
    .select({ received: sql<number>`coalesce(sum(${goodsReceipts.receivedAmount}), 0)` })
    .from(goodsReceipts)
    .where(eq(goodsReceipts.purchaseOrderId, input.purchaseOrderId));

  const match = threeWayMatch({
    poAmount: po.amount,
    receivedAmount: Number(received),
    invoiceAmount: input.amount,
  });

  const [updated] = await db
    .update(invoices)
    .set({
      status: match.matched ? "MATCHED" : "EXCEPTION",
      matchResult: match,
      exceptionReason: match.matched ? null : match.reasons.join(" "),
    })
    .where(eq(invoices.id, invoice.id))
    .returning();

  if (match.matched) {
    await publish("spend.invoice_matched", {
      invoiceId: invoice.id,
      purchaseOrderId: input.purchaseOrderId,
      variance: match.variance,
    });
  } else {
    await publish("spend.invoice_exception", {
      invoiceId: invoice.id,
      reason: match.reasons.join(" "),
    });
  }

  log.info("invoice processed", { invoiceId: invoice.id, matched: match.matched });
  return { invoice: updated, match };
}

export async function listInvoices(opts: { status?: (typeof invoices.status.enumValues)[number]; limit?: number } = {}) {
  return db
    .select()
    .from(invoices)
    .where(opts.status ? eq(invoices.status, opts.status) : undefined)
    .orderBy(desc(invoices.invoiceDate))
    .limit(Math.min(opts.limit ?? 25, 100));
}

/* ---------------------------- analytics -------------------------- */

/** Spend by category — the spend cube `/reports` renders. */
export async function getSpendByCategory(fromDate?: Date) {
  return db
    .select({
      category: sql<string>`coalesce(${purchaseOrders.category}, 'Unclassified')`,
      totalSpend: sql<number>`sum(${purchaseOrders.amount})`,
      orderCount: sql<number>`count(*)::int`,
    })
    .from(purchaseOrders)
    .where(fromDate ? gte(purchaseOrders.issuedAt, fromDate) : undefined)
    .groupBy(sql`coalesce(${purchaseOrders.category}, 'Unclassified')`)
    .orderBy(desc(sql`sum(${purchaseOrders.amount})`));
}

/** Spend by supplier, for consolidation and tail-spend analysis. */
export async function getSpendBySupplier(limit = 20) {
  return db
    .select({
      supplierId: purchaseOrders.supplierId,
      totalSpend: sql<number>`sum(${purchaseOrders.amount})`,
      orderCount: sql<number>`count(*)::int`,
    })
    .from(purchaseOrders)
    .groupBy(purchaseOrders.supplierId)
    .orderBy(desc(sql`sum(${purchaseOrders.amount})`))
    .limit(limit);
}

export async function getSpendStats() {
  const [po] = await db
    .select({
      totalCommitted: sql<number | null>`sum(${purchaseOrders.amount})`,
      openOrders: sql<number>`count(*) filter (where ${purchaseOrders.status} = 'OPEN')::int`,
      orderCount: sql<number>`count(*)::int`,
    })
    .from(purchaseOrders);

  const [inv] = await db
    .select({
      invoiceCount: sql<number>`count(*)::int`,
      exceptions: sql<number>`count(*) filter (where ${invoices.status} = 'EXCEPTION')::int`,
      invoicedValue: sql<number | null>`sum(${invoices.amount})`,
    })
    .from(invoices);

  const [offContract] = await db
    .select({ count: sql<number>`count(*) filter (where not ${requisitions.onContract})::int` })
    .from(requisitions);

  return {
    totalCommitted: po.totalCommitted === null ? 0 : Number(po.totalCommitted),
    openOrders: po.openOrders,
    orderCount: po.orderCount,
    invoiceCount: inv.invoiceCount,
    invoiceExceptions: inv.exceptions,
    invoicedValue: inv.invoicedValue === null ? 0 : Number(inv.invoicedValue),
    offContractRequisitions: offContract.count,
  };
}
