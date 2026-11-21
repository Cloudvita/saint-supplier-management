import { z } from "zod";
import { defineAgentTool, type AgentToolDefinition } from "@/core/agent";
import { AppError } from "@/core/errors";
import { findSupplierByNameOrCode } from "@/modules/suppliers";
import { generateReport, getExecutiveDashboard, REPORT_KEYS } from "./services/report.service";
import { getSupplyRiskImpact, listSupplyRiskImpacts } from "./services/supply-risk.service";

/**
 * Reporting capabilities for the AI layer — the tools behind ANALYTICS_ENGINE
 * behaviour. These are the cross-module questions no single domain can answer.
 */

export const executiveDashboard = defineAgentTool({
  name: "reports_executive_dashboard",
  module: "reports",
  description:
    "The cross-module executive picture in one call: supply-base, contract, spend and risk metrics, " +
    "top spend categories, open risk alerts and contracts nearing expiry. Use for broad questions " +
    "like 'how are we doing?' or to open a briefing, rather than calling each module separately.",
  permission: "reports:read",
  input: z.object({}),
  output: z.object({
    generatedAt: z.string(),
    metrics: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        value: z.number().nullable(),
        unit: z.string(),
        direction: z.string(),
        note: z.string().optional(),
      })
    ),
    topCategories: z.array(
      z.object({ category: z.string(), totalSpend: z.number(), orderCount: z.number() })
    ),
    riskAlerts: z.array(
      z.object({ supplier: z.string(), eventType: z.string(), severity: z.string(), title: z.string() })
    ),
    expiringContracts: z.array(
      z.object({ contractNumber: z.string(), title: z.string(), daysToExpiry: z.number().nullable() })
    ),
  }),
  handler: async () => getExecutiveDashboard(),
});

export const exportReport = defineAgentTool({
  name: "reports_export",
  module: "reports",
  description:
    "Generate one of the standard reports as Markdown, CSV or JSON. Prefer markdown when the result " +
    "will be shown to the user in conversation. Available reports: " +
    REPORT_KEYS.join(", ") +
    ".",
  permission: "reports:export",
  input: z.object({
    report: z.enum(REPORT_KEYS as unknown as [string, ...string[]]),
    format: z.enum(["markdown", "csv", "json"]).default("markdown"),
  }),
  output: z.object({
    report: z.string(),
    format: z.string(),
    rowCount: z.number(),
    content: z.string(),
  }),
  handler: async (input) => {
    const result = await generateReport(
      input.report as (typeof REPORT_KEYS)[number],
      input.format as "markdown" | "csv" | "json"
    );
    return {
      report: result.key,
      format: result.format,
      rowCount: result.rowCount,
      content: result.content,
    };
  },
});

const openOrder = z.object({
  poNumber: z.string(),
  partId: z.string().nullable(),
  partName: z.string().nullable(),
  amount: z.number(),
  currency: z.string(),
});

const supplyRiskImpact = z.object({
  supplier: z.object({
    id: z.string(),
    supplierCode: z.string(),
    legalName: z.string(),
    status: z.string(),
    openRiskAlerts: z.number(),
  }),
  alerts: z.array(
    z.object({ id: z.string(), eventType: z.string(), severity: z.string(), title: z.string(), raisedAt: z.string() })
  ),
  severity: z.string().nullable(),
  soleSourceParts: z.array(
    z.object({ partId: z.string(), partName: z.string(), openOrders: z.array(openOrder), openOrderValue: z.number() })
  ),
  otherParts: z.array(
    z.object({ partId: z.string(), partName: z.string(), status: z.string(), approvedSourceCount: z.number() })
  ),
  openOrders: z.array(openOrder),
  openOrderValue: z.number(),
});

export const supplyRisk = defineAgentTool({
  name: "reports_supply_risk",
  module: "reports",
  description:
    "What a supplier risk event puts at stake: for each supplier with an open risk alert (or one " +
    "named supplier), the parts it is the only approved source of, the open purchase orders behind " +
    "them, and its other part links. Worst first. Use when asked about the impact of a bankruptcy, " +
    "acquisition or dispute, or which parts need a second source.",
  permission: "reports:read",
  input: z.object({
    supplier: z.string().optional().describe("Supplier code or legal name; omit for every supplier with an open alert"),
  }),
  output: z.object({ impacts: z.array(supplyRiskImpact) }),
  handler: async (input) => {
    if (!input.supplier) return { impacts: await listSupplyRiskImpacts() };
    const s = await findSupplierByNameOrCode(input.supplier);
    if (!s) throw AppError.notFound(`Supplier "${input.supplier}"`);
    return { impacts: [await getSupplyRiskImpact(s.id)] };
  },
});

export const reportAgentTools: AgentToolDefinition[] = [
  executiveDashboard,
  exportReport,
  supplyRisk,
] as unknown as AgentToolDefinition[];
