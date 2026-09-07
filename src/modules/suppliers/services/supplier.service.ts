import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { AppError } from "@/core/errors";
import { publish } from "@/core/events";
import { createLogger } from "@/core/logger";
import { sequenceCode, withMaskedTaxId } from "@/shared/utils";
import type { Paginated } from "@/shared/types";
import { suppliers, riskAlerts, w9Documents, marketNewsItems } from "../schema";
import type { Supplier } from "../schema";
import type { SupplierInput, SupplierView } from "../domain/validation";

const log = createLogger("suppliers");

export type SupplierListFilters = {
  q?: string;
  companyType?: "PUBLIC" | "PRIVATE";
  status?: "DRAFT" | "ACTIVE" | "ON_HOLD" | "BLOCKED";
  limit?: number;
  offset?: number;
};

function listWhere(f: SupplierListFilters) {
  const filters = [];
  if (f.q) {
    filters.push(
      or(
        ilike(suppliers.legalName, `%${f.q}%`),
        ilike(suppliers.dbaName, `%${f.q}%`),
        ilike(suppliers.supplierCode, `%${f.q}%`),
        ilike(suppliers.category, `%${f.q}%`)
      )
    );
  }
  if (f.companyType) filters.push(eq(suppliers.companyType, f.companyType));
  if (f.status) filters.push(eq(suppliers.status, f.status));
  return filters.length ? and(...filters) : undefined;
}

/**
 * List suppliers, newest first, with their open risk alerts.
 *
 * Raw tax IDs never leave this function — every row is masked on the way out,
 * so no caller (route, agent tool or report) can leak one by omission.
 */
export async function listSuppliers(
  f: SupplierListFilters = {}
): Promise<Paginated<SupplierView & { riskAlerts: unknown[] }>> {
  const limit = Math.min(f.limit ?? 10, 100);
  const offset = f.offset ?? 0;
  const where = listWhere(f);

  const rows = await db.query.suppliers.findMany({
    where,
    orderBy: [desc(suppliers.createdAt)],
    limit,
    offset,
    with: {
      riskAlerts: {
        where: inArray(riskAlerts.status, ["NEW", "NOTIFIED"]),
        orderBy: [desc(riskAlerts.createdAt)],
      },
    },
  });

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(suppliers)
    .where(where ?? sql`true`);

  return {
    items: rows.map((r) => withMaskedTaxId(r) as unknown as SupplierView & { riskAlerts: unknown[] }),
    total: count,
    limit,
    offset,
  };
}

/** Full supplier record with W-9s, news and alerts. Throws 404 when missing. */
export async function getSupplier(id: string) {
  const supplier = await db.query.suppliers.findFirst({
    where: eq(suppliers.id, id),
    with: {
      w9Documents: { orderBy: [desc(w9Documents.uploadedAt)] },
      newsItems: { orderBy: [desc(marketNewsItems.publishedAt)], limit: 25 },
      riskAlerts: { orderBy: [desc(riskAlerts.createdAt)], limit: 25 },
    },
  });
  if (!supplier) throw AppError.notFound("Supplier");
  return withMaskedTaxId(supplier);
}

/** Look a supplier up by code or by (partial) legal name — the agent's entry point. */
export async function findSupplierByNameOrCode(needle: string): Promise<Supplier | null> {
  const found = await db.query.suppliers.findFirst({
    where: or(eq(suppliers.supplierCode, needle), ilike(suppliers.legalName, `%${needle}%`)),
  });
  return found ?? null;
}

/**
 * Create a supplier and issue its sequential code inside one transaction, so a
 * concurrent insert cannot mint the same SUP-000123 twice.
 */
export async function createSupplier(input: SupplierInput, createdBy = "system") {
  const { w9DocumentId, ...data } = input;

  // A ticker only means something for a listed company.
  if (data.companyType === "PRIVATE") data.tickerSymbol = undefined;

  const supplier = await db.transaction(async (tx) => {
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(suppliers);
    const supplierCode = sequenceCode("SUP", count + 1);

    const [row] = await tx
      .insert(suppliers)
      .values({ ...data, supplierCode, createdBy })
      .returning();

    if (w9DocumentId) {
      await tx
        .update(w9Documents)
        .set({ supplierId: row.id })
        .where(and(eq(w9Documents.id, w9DocumentId), sql`${w9Documents.supplierId} is null`));
    }
    return row;
  });

  log.info("supplier created", { supplierId: supplier.id, supplierCode: supplier.supplierCode });
  await publish("supplier.created", {
    supplierId: supplier.id,
    supplierCode: supplier.supplierCode,
    legalName: supplier.legalName,
  });

  return withMaskedTaxId(supplier);
}

export async function updateSupplier(id: string, patch: Partial<SupplierInput>) {
  const { w9DocumentId: _ignored, ...data } = patch;
  const before = await db.query.suppliers.findFirst({ where: eq(suppliers.id, id) });
  if (!before) throw AppError.notFound("Supplier");

  const [supplier] = await db.update(suppliers).set(data).where(eq(suppliers.id, id)).returning();

  if (data.status && data.status !== before.status) {
    await publish("supplier.status_changed", {
      supplierId: id,
      from: before.status,
      to: data.status,
    });
  }
  return withMaskedTaxId(supplier);
}

export async function deleteSupplier(id: string): Promise<void> {
  await db.delete(suppliers).where(eq(suppliers.id, id));
}

/** Aggregate counts used by dashboards and by `/reports`. */
export async function getSupplierStats() {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${suppliers.status} = 'ACTIVE')::int`,
      blocked: sql<number>`count(*) filter (where ${suppliers.status} = 'BLOCKED')::int`,
      diverse: sql<number>`count(*) filter (where ${suppliers.diverseSupplier})::int`,
      publicCompanies: sql<number>`count(*) filter (where ${suppliers.companyType} = 'PUBLIC')::int`,
      avgPerformance: sql<number | null>`avg(${suppliers.performanceScore})`,
    })
    .from(suppliers);
  return row;
}

/** Set the news scan cadence for every supplier at once (the "AI Genie" schedule). */
export async function setScanCadenceForAll(cadence: "DAILY" | "WEEKLY" | "MONTHLY") {
  const result = await db.update(suppliers).set({ newsCadence: cadence }).returning({ id: suppliers.id });
  return { cadence, suppliersUpdated: result.length };
}

/** Current cadence spread — `cadence` is non-null only when every supplier agrees. */
export async function getScanCadence() {
  const rows = await db
    .select({ cadence: suppliers.newsCadence, count: sql<number>`count(*)::int` })
    .from(suppliers)
    .groupBy(suppliers.newsCadence);

  return {
    cadence: rows.length === 1 ? rows[0].cadence : null,
    totalSuppliers: rows.reduce((s, r) => s + r.count, 0),
    breakdown: rows,
  };
}

/** Record delivery/quality performance. Kept here so `/spend` never writes supplier rows. */
export async function recordPerformance(
  supplierId: string,
  metrics: { onTimeDeliveryPct?: number; qualityScore?: number }
) {
  const onTime = metrics.onTimeDeliveryPct;
  const quality = metrics.qualityScore;
  const parts = [onTime, quality].filter((n): n is number => typeof n === "number");
  const performanceScore = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : undefined;

  const [row] = await db
    .update(suppliers)
    .set({
      ...(onTime !== undefined ? { onTimeDeliveryPct: onTime } : {}),
      ...(quality !== undefined ? { qualityScore: quality } : {}),
      ...(performanceScore !== undefined ? { performanceScore } : {}),
    })
    .where(eq(suppliers.id, supplierId))
    .returning();
  if (!row) throw AppError.notFound("Supplier");
  return withMaskedTaxId(row);
}
