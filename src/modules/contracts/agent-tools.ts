import { z } from "zod";
import { defineAgentTool, type AgentToolDefinition } from "@/core/agent";
import { AppError } from "@/core/errors";
import { findSupplierByNameOrCode } from "@/modules/suppliers";
import {
  getContract,
  getContractStats,
  getExpiringContracts,
  listContracts,
} from "./services/contract.service";
import { auditClauses, CLAUSE_LABELS, MANDATORY_CLAUSES, type ClauseKey } from "./domain/clauses";
import { contractViewSchema } from "./domain/validation";

/**
 * Contract capabilities for the AI layer — the tools behind the platform's
 * CONTRACT_AUDITOR behaviour.
 */

export const searchContracts = defineAgentTool({
  name: "contracts_search",
  module: "contracts",
  description:
    "Search contracts by title, contract number or supplier. Use to locate the agreement behind a " +
    "question about terms, value or expiry before answering.",
  permission: "contracts:read",
  input: z.object({
    query: z.string().optional().describe("Title or contract number fragment"),
    supplier: z.string().optional().describe("Supplier code or legal name"),
    status: z
      .enum(["DRAFT", "IN_REVIEW", "PENDING_SIGNATURE", "ACTIVE", "EXPIRING", "EXPIRED", "TERMINATED"])
      .optional(),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  output: z.object({ total: z.number(), contracts: z.array(contractViewSchema) }),
  handler: async (input) => {
    let supplierId: string | undefined;
    if (input.supplier) {
      const s = await findSupplierByNameOrCode(input.supplier);
      if (!s) throw AppError.notFound(`Supplier "${input.supplier}"`);
      supplierId = s.id;
    }
    const page = await listContracts({
      q: input.query,
      supplierId,
      status: input.status,
      limit: input.limit,
    });
    return { total: page.total, contracts: page.items };
  },
});

export const getContractDetail = defineAgentTool({
  name: "contracts_get_detail",
  module: "contracts",
  description:
    "Full detail for one contract: commercial terms, lifecycle dates, signature state and the " +
    "clause compliance audit. Use after contracts_search to answer a specific question.",
  permission: "contracts:read",
  input: z.object({ contractId: z.string().min(1) }),
  output: contractViewSchema.extend({
    signatureSummary: z.string(),
    documentCount: z.number(),
  }),
  handler: async (input) => {
    const c = await getContract(input.contractId);
    const signed = c.signatures.filter((s) => s.status === "SIGNED").length;
    return {
      ...c,
      signatureSummary:
        c.signatures.length === 0
          ? "No signature requests raised"
          : `${signed} of ${c.signatures.length} signatures collected`,
      documentCount: c.documents.length,
    };
  },
});

export const findExpiringContracts = defineAgentTool({
  name: "contracts_find_expiring",
  module: "contracts",
  description:
    "List contracts entering their renewal notice window, soonest first. Use for 'what needs " +
    "renewing?' and before advising on any sourcing plan, so an expiring agreement is not missed.",
  permission: "contracts:read",
  input: z.object({
    withinDays: z
      .number()
      .int()
      .min(1)
      .max(730)
      .optional()
      .describe("Override the per-contract notice period with a fixed horizon"),
  }),
  output: z.object({
    contracts: z.array(
      z.object({
        contractNumber: z.string(),
        title: z.string(),
        supplierId: z.string(),
        expiryDate: z.string().nullable(),
        daysToExpiry: z.number().nullable(),
        renewalType: z.string(),
        totalValue: z.number().nullable(),
        currency: z.string(),
      })
    ),
  }),
  handler: async (input) => {
    const rows = await getExpiringContracts(input.withinDays);
    return {
      contracts: rows.map((c) => ({
        contractNumber: c.contractNumber,
        title: c.title,
        supplierId: c.supplierId,
        expiryDate: c.expiryDate,
        daysToExpiry: c.daysToExpiry,
        renewalType: c.renewalType,
        totalValue: c.totalValue,
        currency: c.currency,
      })),
    };
  },
});

export const auditContractText = defineAgentTool({
  name: "contracts_audit_clauses",
  module: "contracts",
  description:
    "Audit contract text against the mandatory-clause policy (data privacy, limitation of liability, " +
    "termination for convenience) and flag non-standard commercial terms. Pass the clause text the " +
    "user supplied; do not invent contract language.",
  permission: "contracts:read",
  input: z.object({
    text: z.string().min(50).describe("The contract body or the clauses under review"),
  }),
  output: z.object({
    compliant: z.boolean(),
    detectedClauses: z.array(z.string()),
    missingMandatoryClauses: z.array(z.string()),
    riskFlags: z.array(z.string()),
    verdict: z.string(),
  }),
  handler: async (input) => {
    const audit = auditClauses(input.text);
    const label = (k: ClauseKey) => CLAUSE_LABELS[k] ?? k;
    return {
      compliant: audit.compliant,
      detectedClauses: audit.detected.map(label),
      missingMandatoryClauses: audit.missing.map(label),
      riskFlags: audit.riskFlags,
      verdict: audit.compliant
        ? `All ${MANDATORY_CLAUSES.length} mandatory clauses present.${
            audit.riskFlags.length ? ` ${audit.riskFlags.length} non-standard term(s) need review.` : ""
          }`
        : `BLOCKED: missing ${audit.missing.map(label).join(", ")}. This contract must not proceed to signature.`,
    };
  },
});

export const contractPortfolioStats = defineAgentTool({
  name: "contracts_portfolio_stats",
  module: "contracts",
  description:
    "Portfolio counts: total, active and expiring contracts, how many fail the mandatory-clause " +
    "policy, and aggregate contracted value.",
  permission: "contracts:read",
  input: z.object({}),
  output: z.object({
    total: z.number(),
    active: z.number(),
    expiring: z.number(),
    nonCompliant: z.number(),
    totalValue: z.number().nullable(),
  }),
  handler: async () => {
    const s = await getContractStats();
    return { ...s, totalValue: s.totalValue === null ? null : Number(s.totalValue) };
  },
});

export const contractAgentTools: AgentToolDefinition[] = [
  searchContracts,
  getContractDetail,
  findExpiringContracts,
  auditContractText,
  contractPortfolioStats,
] as unknown as AgentToolDefinition[];
