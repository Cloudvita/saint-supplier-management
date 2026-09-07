import { AppError } from "@/core/errors";
import { createLogger } from "@/core/logger";
import {
  getSupplierStats,
  listAlerts,
  listSuppliers,
} from "@/modules/suppliers";
import { getContractStats, getExpiringContracts, listContracts } from "@/modules/contracts";
import {
  getSpendByCategory,
  getSpendBySupplier,
  getSpendStats,
  listInvoices,
} from "@/modules/spend";
import { getUserStats } from "@/modules/user_admin";
import { metric, share, tailSpendShare, type Metric } from "../domain/metrics";
import { render, type ExportColumn, type ExportFormat } from "../domain/export";

const log = createLogger("reports");

/**
 * `/reports` owns no tables.
 *
 * Every figure below is composed from another module's *service API*, never
 * from its tables. That is the rule that keeps cross-module reporting from
 * quietly becoming cross-module coupling: when `/spend` changes how a purchase
 * order is stored, nothing here breaks, because nothing here knows.
 */

export type ExecutiveDashboard = {
  generatedAt: string;
  metrics: Metric[];
  topCategories: Array<{ category: string; totalSpend: number; orderCount: number }>;
  riskAlerts: Array<{ supplier: string; eventType: string; severity: string; title: string }>;
  expiringContracts: Array<{ contractNumber: string; title: string; daysToExpiry: number | null }>;
};

/** The cross-module executive view: supply base, contracts, spend and risk in one call. */
export async function getExecutiveDashboard(): Promise<ExecutiveDashboard> {
  const [supplierStats, contractStats, spendStats, userStats, categories, bySupplier, alerts, expiring] =
    await Promise.all([
      getSupplierStats(),
      getContractStats(),
      getSpendStats(),
      getUserStats(),
      getSpendByCategory(),
      getSpendBySupplier(200),
      listAlerts({ limit: 5 }),
      getExpiringContracts(),
    ]);

  const tail = tailSpendShare(bySupplier.map((r) => ({ totalSpend: Number(r.totalSpend) })));

  const metrics: Metric[] = [
    metric("suppliers_total", "Suppliers", supplierStats.total, "COUNT"),
    metric("suppliers_active", "Active suppliers", supplierStats.active, "COUNT", "HIGHER_IS_BETTER"),
    metric(
      "suppliers_diverse_share",
      "Diverse supplier share",
      share(supplierStats.diverse, supplierStats.total),
      "PERCENT",
      "HIGHER_IS_BETTER"
    ),
    metric(
      "supplier_performance",
      "Mean supplier performance",
      supplierStats.avgPerformance === null ? null : Number(Number(supplierStats.avgPerformance).toFixed(1)),
      "SCORE",
      "HIGHER_IS_BETTER"
    ),
    metric("contracts_active", "Active contracts", contractStats.active, "COUNT"),
    metric("contracts_expiring", "Contracts in notice window", contractStats.expiring, "COUNT", "LOWER_IS_BETTER"),
    metric(
      "contracts_non_compliant",
      "Contracts missing mandatory clauses",
      contractStats.nonCompliant,
      "COUNT",
      "LOWER_IS_BETTER",
      contractStats.nonCompliant > 0 ? "These cannot proceed to signature until remediated." : undefined
    ),
    metric(
      "contract_value",
      "Contracted value",
      contractStats.totalValue === null ? null : Number(contractStats.totalValue),
      "CURRENCY"
    ),
    metric("spend_committed", "Committed spend", spendStats.totalCommitted, "CURRENCY"),
    metric("spend_open_orders", "Open purchase orders", spendStats.openOrders, "COUNT"),
    metric(
      "invoice_exception_rate",
      "Invoice exception rate",
      share(spendStats.invoiceExceptions, spendStats.invoiceCount),
      "PERCENT",
      "LOWER_IS_BETTER",
      `${spendStats.invoiceExceptions} of ${spendStats.invoiceCount} invoices failed the three-way match.`
    ),
    metric(
      "off_contract_requisitions",
      "Off-contract requisitions",
      spendStats.offContractRequisitions,
      "COUNT",
      "LOWER_IS_BETTER",
      "Maverick spend — candidates for catalogue coverage."
    ),
    metric("tail_spend_share", "Tail spend share", tail.tailSharePct, "PERCENT", "LOWER_IS_BETTER", `${tail.tailSuppliers} suppliers outside the top 20.`),
    metric("open_risk_alerts", "Open supplier risk alerts", alerts.length, "COUNT", "LOWER_IS_BETTER"),
    metric("platform_users", "Platform users", userStats.active, "COUNT"),
  ];

  return {
    generatedAt: new Date().toISOString(),
    metrics,
    topCategories: categories.slice(0, 8).map((c) => ({
      category: c.category,
      totalSpend: Number(c.totalSpend),
      orderCount: c.orderCount,
    })),
    riskAlerts: alerts.map((a) => ({
      supplier: a.supplier.legalName,
      eventType: a.eventType,
      severity: a.severity,
      title: a.title,
    })),
    expiringContracts: expiring.slice(0, 8).map((c) => ({
      contractNumber: c.contractNumber,
      title: c.title,
      daysToExpiry: c.daysToExpiry,
    })),
  };
}

/* --------------------------- export engine ----------------------- */

export const REPORT_KEYS = [
  "suppliers",
  "contracts",
  "spend_by_category",
  "spend_by_supplier",
  "invoice_exceptions",
  "expiring_contracts",
  "executive_metrics",
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

type Dataset = { rows: Record<string, unknown>[]; columns: ExportColumn<Record<string, unknown>>[] };

const col = (key: string, header: string): ExportColumn<Record<string, unknown>> => ({ key, header });

async function buildDataset(key: ReportKey): Promise<Dataset> {
  switch (key) {
    case "suppliers": {
      const page = await listSuppliers({ limit: 100 });
      return {
        rows: page.items as unknown as Record<string, unknown>[],
        columns: [
          col("supplierCode", "Supplier Code"),
          col("legalName", "Legal Name"),
          col("category", "Category"),
          col("companyType", "Type"),
          col("status", "Status"),
          col("country", "Country"),
          col("paymentTerms", "Payment Terms"),
          col("performanceScore", "Performance"),
        ],
      };
    }
    case "contracts": {
      const page = await listContracts({ limit: 100 });
      return {
        rows: page.items as unknown as Record<string, unknown>[],
        columns: [
          col("contractNumber", "Contract"),
          col("title", "Title"),
          col("contractType", "Type"),
          col("status", "Status"),
          col("totalValue", "Value"),
          col("currency", "Currency"),
          col("expiryDate", "Expiry"),
          col("daysToExpiry", "Days To Expiry"),
        ],
      };
    }
    case "spend_by_category": {
      const rows = await getSpendByCategory();
      return {
        rows: rows as unknown as Record<string, unknown>[],
        columns: [col("category", "Category"), col("totalSpend", "Total Spend"), col("orderCount", "Orders")],
      };
    }
    case "spend_by_supplier": {
      const rows = await getSpendBySupplier(100);
      return {
        rows: rows as unknown as Record<string, unknown>[],
        columns: [col("supplierId", "Supplier"), col("totalSpend", "Total Spend"), col("orderCount", "Orders")],
      };
    }
    case "invoice_exceptions": {
      const rows = await listInvoices({ status: "EXCEPTION", limit: 100 });
      return {
        rows: rows as unknown as Record<string, unknown>[],
        columns: [
          col("invoiceNumber", "Invoice"),
          col("supplierId", "Supplier"),
          col("amount", "Amount"),
          col("currency", "Currency"),
          col("exceptionReason", "Reason"),
        ],
      };
    }
    case "expiring_contracts": {
      const rows = await getExpiringContracts();
      return {
        rows: rows as unknown as Record<string, unknown>[],
        columns: [
          col("contractNumber", "Contract"),
          col("title", "Title"),
          col("expiryDate", "Expiry"),
          col("daysToExpiry", "Days To Expiry"),
          col("renewalType", "Renewal"),
          col("totalValue", "Value"),
        ],
      };
    }
    case "executive_metrics": {
      const dash = await getExecutiveDashboard();
      return {
        rows: dash.metrics as unknown as Record<string, unknown>[],
        columns: [col("label", "Metric"), col("value", "Value"), col("unit", "Unit"), col("note", "Note")],
      };
    }
  }
}

export type RenderedReport = {
  key: ReportKey;
  format: ExportFormat;
  rowCount: number;
  content: string;
  fileName: string;
};

/** Build a report and render it in the requested format. */
export async function generateReport(key: ReportKey, format: ExportFormat = "csv"): Promise<RenderedReport> {
  if (!REPORT_KEYS.includes(key)) throw AppError.badRequest(`Unknown report "${key}"`);
  const { rows, columns } = await buildDataset(key);
  log.info("report generated", { report: key, format, rows: rows.length });

  return {
    key,
    format,
    rowCount: rows.length,
    content: render(rows, columns, format),
    fileName: `saint-${key}-${new Date().toISOString().slice(0, 10)}`,
  };
}
