import { z } from "zod";
import { defineAgentTool, type AgentToolDefinition } from "@/core/agent";
import { AppError } from "@/core/errors";
import {
  findSupplierByNameOrCode,
  getSupplierStats,
  listSuppliers,
  recordPerformance,
} from "./services/supplier.service";
import { refreshSupplierNews } from "./services/news.service";
import { listAlerts } from "./services/alert.service";
import { supplierViewSchema } from "./domain/validation";

/**
 * Supplier capabilities exposed to the AI layer.
 *
 * These are declarations, not LangChain objects: `/ai-agents` turns them into
 * `StructuredTool`s at runtime. Adding a capability here makes it available to
 * every agent that is allowed to use the suppliers module, with no change to
 * the AI engine.
 */

const severityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const searchSuppliers = defineAgentTool({
  name: "suppliers_search",
  module: "suppliers",
  description:
    "Search the supplier master by name, supplier code or category. Use this first whenever a " +
    "question names a vendor, to resolve it to a supplier record before calling any other tool.",
  permission: "suppliers:read",
  input: z.object({
    query: z.string().min(1).describe("Company name, supplier code (SUP-000123) or category"),
    status: z
      .enum(["DRAFT", "ACTIVE", "ON_HOLD", "BLOCKED"])
      .optional()
      .describe("Restrict to suppliers in this lifecycle state"),
    limit: z.number().int().min(1).max(25).default(5),
  }),
  output: z.object({
    total: z.number(),
    suppliers: z.array(supplierViewSchema.partial().extend({ id: z.string(), legalName: z.string() })),
  }),
  handler: async (input) => {
    const page = await listSuppliers({ q: input.query, status: input.status, limit: input.limit });
    return {
      total: page.total,
      suppliers: page.items.map((s) => ({
        id: s.id,
        supplierCode: s.supplierCode,
        legalName: s.legalName,
        category: s.category ?? undefined,
        status: s.status,
        country: s.country,
        companyType: s.companyType,
        performanceScore: s.performanceScore ?? undefined,
      })),
    };
  },
});

export const getSupplierProfile = defineAgentTool({
  name: "suppliers_get_profile",
  module: "suppliers",
  description:
    "Return the full risk and compliance profile for one supplier: status, category, payment terms, " +
    "performance metrics and the latest market-news digest. Use after suppliers_search.",
  permission: "suppliers:read",
  input: z.object({
    supplier: z.string().min(1).describe("Supplier code or legal name"),
  }),
  output: z.object({
    id: z.string(),
    supplierCode: z.string(),
    legalName: z.string(),
    status: z.string(),
    companyType: z.string(),
    category: z.string().nullable(),
    country: z.string(),
    paymentTerms: z.string(),
    currency: z.string(),
    diverseSupplier: z.boolean(),
    performanceScore: z.number().nullable(),
    onTimeDeliveryPct: z.number().nullable(),
    marketNewsDigest: z.string().nullable(),
    marketNewsUpdated: z.string().nullable(),
  }),
  handler: async (input) => {
    const s = await findSupplierByNameOrCode(input.supplier);
    if (!s) throw AppError.notFound(`Supplier "${input.supplier}"`);
    return {
      id: s.id,
      supplierCode: s.supplierCode,
      legalName: s.legalName,
      status: s.status,
      companyType: s.companyType,
      category: s.category,
      country: s.country,
      paymentTerms: s.paymentTerms,
      currency: s.currency,
      diverseSupplier: s.diverseSupplier,
      performanceScore: s.performanceScore,
      onTimeDeliveryPct: s.onTimeDeliveryPct,
      marketNewsDigest: s.marketNews,
      marketNewsUpdated: s.marketNewsUpdated?.toISOString() ?? null,
    };
  },
});

export const scanSupplierRisk = defineAgentTool({
  name: "suppliers_scan_risk",
  module: "suppliers",
  description:
    "Fetch and classify the latest market news for one supplier, raising alerts for acquisitions, " +
    "mergers, bankruptcy and disputes. Call this when asked whether anything has changed for a " +
    "vendor, or to refresh stale intelligence before advising on it.",
  permission: "suppliers:write",
  mutates: true,
  input: z.object({
    supplier: z.string().min(1).describe("Supplier code or legal name"),
  }),
  output: z.object({
    supplierId: z.string(),
    companyName: z.string(),
    provider: z.string(),
    articlesFound: z.number(),
    alertsCreated: z.number(),
    digest: z.string(),
    riskEvents: z.array(
      z.object({ eventType: z.string(), severity: z.string(), headline: z.string(), score: z.number() })
    ),
  }),
  handler: async (input) => {
    const s = await findSupplierByNameOrCode(input.supplier);
    if (!s) throw AppError.notFound(`Supplier "${input.supplier}"`);
    const result = await refreshSupplierNews(s.id);
    return {
      supplierId: result.supplierId,
      companyName: result.companyName,
      provider: result.provider,
      articlesFound: result.fetched,
      alertsCreated: result.alertsCreated,
      digest: result.digest,
      riskEvents: result.items
        .filter((i) => i.eventType !== "NONE")
        .map((i) => ({
          eventType: i.eventType,
          severity: i.severity,
          headline: i.headline,
          score: i.score,
        })),
    };
  },
});

export const listOpenRiskAlerts = defineAgentTool({
  name: "suppliers_list_risk_alerts",
  module: "suppliers",
  description:
    "List open supplier risk alerts across the whole vendor base, highest severity first. Use for " +
    "portfolio-level questions such as 'what should I worry about this week?'.",
  permission: "suppliers:read",
  input: z.object({
    minSeverity: severityEnum.default("MEDIUM").describe("Drop alerts below this severity"),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  output: z.object({
    alerts: z.array(
      z.object({
        supplierName: z.string(),
        supplierCode: z.string(),
        eventType: z.string(),
        severity: z.string(),
        title: z.string(),
        status: z.string(),
        sourceUrl: z.string().nullable(),
      })
    ),
  }),
  handler: async (input) => {
    const rank = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 } as const;
    const floor = rank[input.minSeverity];
    const alerts = await listAlerts({ limit: 50 });
    return {
      alerts: alerts
        .filter((a) => rank[a.severity] >= floor)
        .slice(0, input.limit)
        .map((a) => ({
          supplierName: a.supplier.legalName,
          supplierCode: a.supplier.supplierCode,
          eventType: a.eventType,
          severity: a.severity,
          title: a.title,
          status: a.status,
          sourceUrl: a.sourceUrl,
        })),
    };
  },
});

export const supplierBaseStats = defineAgentTool({
  name: "suppliers_base_stats",
  module: "suppliers",
  description:
    "Aggregate counts over the supplier master: total, active, blocked, diverse and listed vendors, " +
    "plus mean performance score. Use for 'how many suppliers…' questions instead of listing them.",
  permission: "suppliers:read",
  input: z.object({}),
  output: z.object({
    total: z.number(),
    active: z.number(),
    blocked: z.number(),
    diverse: z.number(),
    publicCompanies: z.number(),
    avgPerformance: z.number().nullable(),
  }),
  handler: async () => {
    const s = await getSupplierStats();
    return { ...s, avgPerformance: s.avgPerformance === null ? null : Number(s.avgPerformance) };
  },
});

export const recordSupplierPerformance = defineAgentTool({
  name: "suppliers_record_performance",
  module: "suppliers",
  description:
    "Record on-time delivery and quality scores for a supplier. Only call this when the user has " +
    "explicitly supplied the measured values — never estimate them.",
  permission: "suppliers:write",
  mutates: true,
  input: z.object({
    supplier: z.string().min(1),
    onTimeDeliveryPct: z.number().min(0).max(100).optional(),
    qualityScore: z.number().min(0).max(100).optional(),
  }),
  output: z.object({
    supplierCode: z.string(),
    legalName: z.string(),
    performanceScore: z.number().nullable(),
  }),
  handler: async (input) => {
    const s = await findSupplierByNameOrCode(input.supplier);
    if (!s) throw AppError.notFound(`Supplier "${input.supplier}"`);
    const updated = await recordPerformance(s.id, {
      onTimeDeliveryPct: input.onTimeDeliveryPct,
      qualityScore: input.qualityScore,
    });
    return {
      supplierCode: updated.supplierCode,
      legalName: updated.legalName,
      performanceScore: updated.performanceScore,
    };
  },
});

/** Every tool this module publishes to the AI layer. */
export const supplierAgentTools: AgentToolDefinition[] = [
  searchSuppliers,
  getSupplierProfile,
  scanSupplierRisk,
  listOpenRiskAlerts,
  supplierBaseStats,
  recordSupplierPerformance,
] as unknown as AgentToolDefinition[];
