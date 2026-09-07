import { and, asc, desc, eq, gte, ilike, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { AppError } from "@/core/errors";
import { publish } from "@/core/events";
import { createLogger } from "@/core/logger";
import { daysUntil, sequenceCode } from "@/shared/utils";
import { contracts, contractDocuments, contractSignatures } from "../schema";
import type { Contract } from "../schema";
import { MANDATORY_CLAUSES, type ClauseKey } from "../domain/clauses";
import type { ContractInput, ContractView } from "../domain/validation";

const log = createLogger("contracts");

function toView(c: Contract): ContractView {
  return {
    id: c.id,
    contractNumber: c.contractNumber,
    supplierId: c.supplierId,
    title: c.title,
    contractType: c.contractType,
    status: c.status,
    totalValue: c.totalValue,
    currency: c.currency,
    paymentTerms: c.paymentTerms,
    effectiveDate: c.effectiveDate?.toISOString() ?? null,
    expiryDate: c.expiryDate?.toISOString() ?? null,
    renewalType: c.renewalType,
    noticePeriodDays: c.noticePeriodDays,
    daysToExpiry: c.expiryDate ? daysUntil(c.expiryDate) : null,
    missingClauses: c.missingClauses,
    riskFlags: c.riskFlags,
  };
}

export type ContractListFilters = {
  q?: string;
  supplierId?: string;
  status?: (typeof contracts.status.enumValues)[number];
  limit?: number;
  offset?: number;
};

export async function listContracts(f: ContractListFilters = {}) {
  const limit = Math.min(f.limit ?? 25, 100);
  const offset = f.offset ?? 0;

  const filters = [];
  if (f.q) filters.push(or(ilike(contracts.title, `%${f.q}%`), ilike(contracts.contractNumber, `%${f.q}%`)));
  if (f.supplierId) filters.push(eq(contracts.supplierId, f.supplierId));
  if (f.status) filters.push(eq(contracts.status, f.status));
  const where = filters.length ? and(...filters) : undefined;

  const rows = await db
    .select()
    .from(contracts)
    .where(where)
    .orderBy(desc(contracts.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contracts)
    .where(where ?? sql`true`);

  return { items: rows.map(toView), total: count, limit, offset };
}

export async function getContract(id: string) {
  const contract = await db.query.contracts.findFirst({
    where: eq(contracts.id, id),
    with: {
      documents: { orderBy: [desc(contractDocuments.uploadedAt)] },
      signatures: { orderBy: [asc(contractSignatures.createdAt)] },
    },
  });
  if (!contract) throw AppError.notFound("Contract");
  return { ...toView(contract), documents: contract.documents, signatures: contract.signatures };
}

export async function createContract(input: ContractInput, _actorId = "system") {
  const contract = await db.transaction(async (tx) => {
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(contracts);
    const [row] = await tx
      .insert(contracts)
      .values({
        ...input,
        contractNumber: sequenceCode("CTR", count + 1),
        // Nothing has been read yet, so every mandatory clause is outstanding.
        missingClauses: MANDATORY_CLAUSES,
      })
      .returning();
    return row;
  });

  log.info("contract created", { contractId: contract.id, number: contract.contractNumber });
  await publish("contract.created", {
    contractId: contract.id,
    supplierId: contract.supplierId,
    value: contract.totalValue,
  });
  return toView(contract);
}

export async function updateContract(id: string, patch: Partial<ContractInput>) {
  const [row] = await db.update(contracts).set(patch).where(eq(contracts.id, id)).returning();
  if (!row) throw AppError.notFound("Contract");
  return toView(row);
}

export async function deleteContract(id: string): Promise<void> {
  await db.delete(contracts).where(eq(contracts.id, id));
}

/**
 * Contracts inside their notice window, soonest first.
 *
 * `noticePeriodDays` is per-contract, so this cannot be a single fixed
 * threshold — a 90-day-notice MSA and a 30-day SOW surface at different times.
 */
export async function getExpiringContracts(withinDays?: number) {
  const rows = await db
    .select()
    .from(contracts)
    .where(
      and(
        isNotNull(contracts.expiryDate),
        ne(contracts.status, "TERMINATED"),
        ne(contracts.status, "EXPIRED"),
        withinDays !== undefined
          ? lte(contracts.expiryDate, sql`now() + make_interval(days => ${withinDays})`)
          : sql`${contracts.expiryDate} <= now() + make_interval(days => ${contracts.noticePeriodDays})`,
        gte(contracts.expiryDate, sql`now() - interval '30 days'`)
      )
    )
    .orderBy(asc(contracts.expiryDate));

  return rows.map(toView);
}

/**
 * Move contracts through their lifecycle by date and announce the ones that
 * have entered their notice window. Run from the scheduled job.
 */
export async function runRenewalSweep() {
  const expiring = await getExpiringContracts();

  let flagged = 0;
  for (const c of expiring) {
    const days = c.daysToExpiry ?? 0;
    const nextStatus = days < 0 ? "EXPIRED" : "EXPIRING";
    if (c.status !== nextStatus) {
      await db.update(contracts).set({ status: nextStatus }).where(eq(contracts.id, c.id));
      flagged++;
    }
    if (days >= 0) {
      await publish("contract.expiring", {
        contractId: c.id,
        supplierId: c.supplierId,
        daysRemaining: days,
      });
    }
  }
  log.info("renewal sweep complete", { reviewed: expiring.length, statusChanges: flagged });
  return { reviewed: expiring.length, statusChanges: flagged, contracts: expiring };
}

/** Persist the result of a clause audit against a contract. */
export async function applyClauseAudit(
  contractId: string,
  audit: { detected: ClauseKey[]; missing: ClauseKey[]; riskFlags: string[] }
) {
  const [row] = await db
    .update(contracts)
    .set({
      detectedClauses: audit.detected,
      missingClauses: audit.missing,
      riskFlags: audit.riskFlags,
    })
    .where(eq(contracts.id, contractId))
    .returning();
  if (!row) throw AppError.notFound("Contract");
  return toView(row);
}

/** Contract coverage for one supplier — used by `/spend` to detect off-contract buying. */
export async function getActiveContractsForSupplier(supplierId: string) {
  const rows = await db
    .select()
    .from(contracts)
    .where(and(eq(contracts.supplierId, supplierId), eq(contracts.status, "ACTIVE")))
    .orderBy(desc(contracts.totalValue));
  return rows.map(toView);
}

export async function getContractStats() {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${contracts.status} = 'ACTIVE')::int`,
      expiring: sql<number>`count(*) filter (where ${contracts.status} = 'EXPIRING')::int`,
      nonCompliant: sql<number>`count(*) filter (where jsonb_array_length(${contracts.missingClauses}) > 0)::int`,
      totalValue: sql<number | null>`sum(${contracts.totalValue})`,
    })
    .from(contracts);
  return row;
}
