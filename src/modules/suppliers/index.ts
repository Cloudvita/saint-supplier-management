/**
 * `/suppliers` — supplier master data, W-9 onboarding, market-risk monitoring
 * and supplier performance.
 *
 * This barrel is the module's entire public surface. Other modules import from
 * `@/modules/suppliers` and nothing deeper: reaching into `./services/…` or
 * `./schema` from outside is a boundary violation and is rejected by
 * `npm run check:boundaries`.
 *
 * Owns tables: suppliers, w9_documents, market_news_items, risk_alerts.
 */

/* ---- service API (how other modules ask this one for things) ---- */
export {
  listSuppliers,
  getSupplier,
  findSupplierByNameOrCode,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getSupplierStats,
  setScanCadenceForAll,
  getScanCadence,
  recordPerformance,
  type SupplierListFilters,
} from "./services/supplier.service";

export {
  refreshSupplierNews,
  refreshDueSuppliers,
  refreshAllSuppliers,
  previewNews,
  type RefreshResult,
} from "./services/news.service";

export {
  listAlerts,
  setAlertStatus,
  raiseAlert,
  notifyRiskAlert,
  ALERT_STATUSES,
  type AlertStatus,
} from "./services/alert.service";

export { intakeW9, getW9DownloadUrl, type W9IntakeResult } from "./services/w9.service";

/* ---- domain contracts ---- */
export {
  supplierSchema,
  supplierViewSchema,
  companyTypes,
  supplierStatuses,
  taxClassifications,
  newsCadences,
  type SupplierInput,
  type SupplierView,
} from "./domain/validation";

export { classifyArticle, isAlertable, buildDigest } from "./domain/classifier";
export type { ClassifiedArticle, RawArticle, NewsProvider, NewsQuery } from "./domain/news-types";
export { mapToW9Fields, type W9Fields } from "./domain/w9-mapping";

/* ---- types re-exported so callers need not import the schema ---- */
export type { Supplier, MarketNewsItem, RiskAlert, W9Document } from "./schema";

/* ---- AI layer ---- */
export { supplierAgentTools } from "./agent-tools";
