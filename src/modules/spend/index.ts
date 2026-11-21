/**
 * `/spend` — requisitions, purchase orders, goods receipts, invoices, budgets
 * and the procurement control set.
 *
 * Owns tables: budgets, requisitions, purchase_orders, goods_receipts, invoices.
 * Depends on `/user-admin` (approval limits), `/contracts` (contract cover) and
 * `/product` (the part being bought, and its approved sources) through their
 * public barrels only.
 */
export {
  listBudgets,
  createBudget,
  createRequisition,
  listRequisitions,
  evaluatePurchasePolicy,
  issuePurchaseOrder,
  listPurchaseOrders,
  recordGoodsReceipt,
  recordInvoice,
  listInvoices,
  getSpendByCategory,
  getSpendBySupplier,
  getSpendStats,
} from "./services/spend.service";

export {
  checkPurchasePolicy,
  threeWayMatch,
  classifySpend,
  budgetRemaining,
  SOLE_SOURCE_THRESHOLD_USD,
  MATCH_TOLERANCE_PCT,
  MATCH_TOLERANCE_ABS_USD,
  type PolicyDecision,
  type PolicyViolation,
  type MatchResult,
} from "./domain/policy";

export {
  requisitionSchema,
  purchaseOrderSchema,
  invoiceSchema,
  budgetSchema,
  goodsReceiptSchema,
  policyDecisionSchema,
  requisitionStatuses,
  poStatuses,
  invoiceStatuses,
  type RequisitionInput,
  type PurchaseOrderInput,
  type InvoiceInput,
  type BudgetInput,
  type GoodsReceiptInput,
} from "./domain/validation";

export type { Budget, Requisition, PurchaseOrder, GoodsReceipt, Invoice } from "./schema";

export { spendAgentTools } from "./agent-tools";
