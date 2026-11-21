import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { AppError, isAppError } from "@/core/errors";
import { createLogger } from "@/core/logger";
import { getSupplier } from "@/modules/suppliers";
import { partSources, type PartSource } from "../schema";
import {
  isSoleSource,
  type LinkSupplierInput,
  type PartSourceStatus,
  type UpdatePartSourceInput,
} from "../domain/sourcing";
import { searchParts } from "./product.service";

const log = createLogger("product.sourcing");

/**
 * Supplier ↔ part links: the module's first table, and the join between the
 * product graph and procurement.
 *
 * The part side lives in PMem and the supplier side in `/suppliers`, so this
 * service verifies both before writing and reads suppliers through their
 * module's barrel, never their table.
 */

export type SupplierSummary = {
  id: string;
  supplierCode: string;
  legalName: string;
  status: string;
  /** Risk alerts still NEW or NOTIFIED — acknowledged and dismissed ones are not open. */
  openRiskAlerts: number;
};

const OPEN_ALERT_STATUSES = new Set(["NEW", "NOTIFIED"]);

/** A link as callers see it: no audit columns, dates as ISO strings. */
export type PartSourceView = {
  id: string;
  partId: string;
  partName: string;
  supplierId: string;
  status: PartSource["status"];
  supplierPartNumber: string | null;
  unitPrice: number | null;
  currency: string;
  leadTimeDays: number | null;
  notes: string | null;
  updatedAt: string;
};

function toView(row: PartSource): PartSourceView {
  return {
    id: row.id,
    partId: row.partId,
    partName: row.partName,
    supplierId: row.supplierId,
    status: row.status,
    supplierPartNumber: row.supplierPartNumber,
    unitPrice: row.unitPrice,
    currency: row.currency,
    leadTimeDays: row.leadTimeDays,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A supplier as the sourcing views show it, or null if it has since been deleted. */
async function supplierSummary(supplierId: string): Promise<SupplierSummary | null> {
  try {
    const s = await getSupplier(supplierId);
    return {
      id: s.id,
      supplierCode: s.supplierCode,
      legalName: s.legalName,
      status: s.status,
      openRiskAlerts: s.riskAlerts.filter((a) => OPEN_ALERT_STATUSES.has(a.status)).length,
    };
  } catch (e) {
    // `/suppliers` hard-deletes, and there is no foreign key to cascade
    // through, so a link can outlive its supplier.
    if (isAppError(e) && e.code === "NOT_FOUND") return null;
    throw e;
  }
}

/**
 * Confirm a node exists in the product graph and return its canonical name.
 * PMem has no lookup by id, so search by the name the caller gave and match
 * the id among the results.
 */
async function resolvePart(partId: string, partName: string): Promise<{ id: string; name: string }> {
  const { parts } = await searchParts({ q: partName, limit: 100 });
  const part = parts.find((p) => p.id === partId);
  if (!part) {
    throw AppError.notFound(`Part "${partName}" (${partId}) in the product graph`);
  }
  return { id: part.id, name: part.name };
}

/**
 * Confirm a part id for another module (a requisition or PO naming a part)
 * and return its name.
 *
 * A part SAINT has already linked to a supplier is taken from `part_sources`,
 * so buying a known part keeps working while PMem is down. Only a part seen
 * for the first time is looked up in PMem, which needs its name.
 */
export async function confirmPart(partId: string, partName?: string | null): Promise<{ id: string; name: string }> {
  const known = await db.query.partSources.findFirst({
    where: eq(partSources.partId, partId),
    columns: { partId: true, partName: true },
  });
  if (known) return { id: known.partId, name: known.partName };
  if (!partName?.trim()) {
    throw AppError.validation("partName is required for a part no supplier is linked to yet", {
      partName: ["Required"],
    });
  }
  return resolvePart(partId, partName.trim());
}

/** The supplier's status as a source of the part, or null when it has no link to it. */
export async function getPartSourceStatus(partId: string, supplierId: string): Promise<PartSourceStatus | null> {
  const row = await db.query.partSources.findFirst({
    where: and(eq(partSources.partId, partId), eq(partSources.supplierId, supplierId)),
    columns: { status: true },
  });
  return row?.status ?? null;
}

/** Record that a supplier can make a part. One link per supplier and part. */
export async function linkSupplierToPart(
  input: LinkSupplierInput,
  createdBy = "system"
): Promise<PartSourceView> {
  const supplier = await supplierSummary(input.supplierId);
  if (!supplier) throw AppError.notFound("Supplier");
  if (supplier.status === "BLOCKED" && input.status === "APPROVED") {
    throw AppError.policy(`${supplier.legalName} is BLOCKED and cannot be approved as a source`);
  }

  const existing = await db.query.partSources.findFirst({
    where: and(eq(partSources.partId, input.partId), eq(partSources.supplierId, input.supplierId)),
  });
  if (existing) {
    throw AppError.conflict(`${supplier.legalName} is already linked to this part`, { partSourceId: existing.id });
  }

  const part = await resolvePart(input.partId, input.partName);
  const [row] = await db
    .insert(partSources)
    .values({
      partId: part.id,
      partName: part.name,
      supplierId: input.supplierId,
      status: input.status,
      supplierPartNumber: input.supplierPartNumber ?? null,
      unitPrice: input.unitPrice ?? null,
      currency: input.currency,
      leadTimeDays: input.leadTimeDays ?? null,
      notes: input.notes ?? null,
      createdBy,
    })
    .returning();

  log.info("supplier linked to part", { partSourceId: row.id, partId: row.partId, supplierId: row.supplierId });
  return toView(row);
}

export async function updatePartSource(id: string, patch: UpdatePartSourceInput): Promise<PartSourceView> {
  const before = await db.query.partSources.findFirst({ where: eq(partSources.id, id) });
  if (!before) throw AppError.notFound("Part source");

  if (patch.status === "APPROVED" && before.status !== "APPROVED") {
    const supplier = await supplierSummary(before.supplierId);
    if (!supplier) throw AppError.conflict("The supplier on this link no longer exists");
    if (supplier.status === "BLOCKED") {
      throw AppError.policy(`${supplier.legalName} is BLOCKED and cannot be approved as a source`);
    }
  }

  const [row] = await db.update(partSources).set(patch).where(eq(partSources.id, id)).returning();
  return toView(row);
}

export async function removePartSource(id: string): Promise<void> {
  const deleted = await db.delete(partSources).where(eq(partSources.id, id)).returning({ id: partSources.id });
  if (deleted.length === 0) throw AppError.notFound("Part source");
}

/** APPROVED supplier count per part, for the given parts. */
async function approvedCounts(partIds: string[]): Promise<Map<string, number>> {
  if (partIds.length === 0) return new Map();
  const rows = await db
    .select({ partId: partSources.partId, approved: sql<number>`count(*)::int` })
    .from(partSources)
    .where(and(inArray(partSources.partId, partIds), eq(partSources.status, "APPROVED")))
    .groupBy(partSources.partId);
  return new Map(rows.map((r) => [r.partId, r.approved]));
}

/** Postgres orders an enum by declaration, which would put candidates first. */
const STATUS_ORDER: Record<PartSource["status"], number> = { APPROVED: 0, CANDIDATE: 1, SUSPENDED: 2 };

/** Who can supply a part, approved sources first. */
export async function listSourcesForPart(partId: string) {
  const rows = (
    await db.query.partSources.findMany({
      where: eq(partSources.partId, partId),
      orderBy: [asc(partSources.createdAt)],
    })
  ).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  const sources = await Promise.all(
    rows.map(async (row) => ({ ...toView(row), supplier: await supplierSummary(row.supplierId) }))
  );
  const approvedCount = rows.filter((r) => r.status === "APPROVED").length;

  return {
    partId,
    partName: rows[0]?.partName ?? null,
    approvedCount,
    soleSource: isSoleSource(approvedCount),
    sources,
  };
}

/**
 * The parts a supplier is linked to, each with how many approved sources it
 * has in total. A part where this supplier is the only approved source is
 * what fails if the supplier does — that is the exposure figure.
 */
export async function listPartsForSupplier(supplierId: string) {
  const supplier = await supplierSummary(supplierId);
  if (!supplier) throw AppError.notFound("Supplier");

  const rows = await db.query.partSources.findMany({
    where: eq(partSources.supplierId, supplierId),
    orderBy: [asc(partSources.partName)],
  });
  const counts = await approvedCounts(rows.map((r) => r.partId));

  const parts = rows.map((row) => {
    const approvedSourceCount = counts.get(row.partId) ?? 0;
    return {
      ...toView(row),
      approvedSourceCount,
      /** True when this supplier is the part's only approved source. */
      soleSource: row.status === "APPROVED" && isSoleSource(approvedSourceCount),
    };
  });

  return {
    supplier,
    parts,
    soleSourceCount: parts.filter((p) => p.soleSource).length,
  };
}
