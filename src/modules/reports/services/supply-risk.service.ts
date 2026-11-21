import { listAlerts } from "@/modules/suppliers";
import { listPurchaseOrders } from "@/modules/spend";
import { listPartsForSupplier, type SupplierSummary } from "@/modules/product";

/**
 * Supply-risk impact: what a supplier's risk event puts at stake.
 *
 * A bankruptcy or acquisition alert on its own says something happened to a
 * company. Joined with the product links and open purchase orders, it says
 * which parts have no other approved source and how much is on order for
 * them — the figures a buyer needs to decide whether to dual-source now.
 *
 * Composed from three modules' public APIs; it reads no tables itself and
 * does not call PMem, so it keeps working when the graph service is down.
 */

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

type OpenOrder = { poNumber: string; partId: string | null; partName: string | null; amount: number; currency: string };

export type SupplyRiskImpact = {
  supplier: SupplierSummary;
  alerts: Array<{ id: string; eventType: string; severity: string; title: string; raisedAt: string }>;
  /** Highest open alert severity, or null when the supplier has none. */
  severity: string | null;
  /** Parts this supplier is the only approved source of — they stop if it does. */
  soleSourceParts: Array<{ partId: string; partName: string; openOrders: OpenOrder[]; openOrderValue: number }>;
  /**
   * Its other part links: approved where another approved source exists, or
   * candidate / suspended. `approvedSourceCount` says how covered each is.
   */
  otherParts: Array<{ partId: string; partName: string; status: string; approvedSourceCount: number }>;
  /** Every open PO with this supplier, whether or not it names a part. */
  openOrders: OpenOrder[];
  openOrderValue: number;
};

const sum = (orders: OpenOrder[]) => Math.round(orders.reduce((s, o) => s + o.amount, 0) * 100) / 100;

type OpenAlert = Awaited<ReturnType<typeof listAlerts>>[number];

async function buildImpact(supplierId: string, alerts: OpenAlert[]): Promise<SupplyRiskImpact> {
  const [exposure, orders] = await Promise.all([
    listPartsForSupplier(supplierId),
    listPurchaseOrders({ supplierId, status: "OPEN", limit: 100 }),
  ]);

  const openOrders: OpenOrder[] = orders.map((o) => ({
    poNumber: o.poNumber,
    partId: o.partId,
    partName: o.partName,
    amount: o.amount,
    currency: o.currency,
  }));

  const soleSourceParts = exposure.parts
    .filter((p) => p.soleSource)
    .map((p) => {
      const forPart = openOrders.filter((o) => o.partId === p.partId);
      return { partId: p.partId, partName: p.partName, openOrders: forPart, openOrderValue: sum(forPart) };
    });

  const otherParts = exposure.parts
    .filter((p) => !p.soleSource)
    .map((p) => ({
      partId: p.partId,
      partName: p.partName,
      status: p.status,
      approvedSourceCount: p.approvedSourceCount,
    }));

  const severity = alerts.reduce<string | null>(
    (top, a) => ((SEVERITY_RANK[a.severity] ?? 0) > (SEVERITY_RANK[top ?? ""] ?? 0) ? a.severity : top),
    null
  );

  return {
    supplier: exposure.supplier,
    alerts: alerts.map((a) => ({
      id: a.id,
      eventType: a.eventType,
      severity: a.severity,
      title: a.title,
      raisedAt: a.createdAt.toISOString(),
    })),
    severity,
    soleSourceParts,
    otherParts,
    openOrders,
    openOrderValue: sum(openOrders),
  };
}

/**
 * Open alerts grouped by supplier. `listAlerts` returns NEW and NOTIFIED by
 * default, most severe first, and at most 100 — beyond that the least severe
 * suppliers drop out of the list.
 */
async function openAlertsBySupplier(): Promise<Map<string, OpenAlert[]>> {
  const bySupplier = new Map<string, OpenAlert[]>();
  for (const alert of await listAlerts({ limit: 100 })) {
    const list = bySupplier.get(alert.supplierId) ?? [];
    list.push(alert);
    bySupplier.set(alert.supplierId, list);
  }
  return bySupplier;
}

/** The impact for one supplier, whether or not it has an open alert. */
export async function getSupplyRiskImpact(supplierId: string): Promise<SupplyRiskImpact> {
  const alerts = (await openAlertsBySupplier()).get(supplierId) ?? [];
  return buildImpact(supplierId, alerts);
}

/**
 * Every supplier with an open risk alert, worst first: by alert severity,
 * then by how many parts would lose their only approved source, then by the
 * value on order.
 */
export async function listSupplyRiskImpacts(): Promise<SupplyRiskImpact[]> {
  const bySupplier = await openAlertsBySupplier();
  const impacts = await Promise.all([...bySupplier].map(([id, alerts]) => buildImpact(id, alerts)));

  return impacts.sort(
    (a, b) =>
      (SEVERITY_RANK[b.severity ?? ""] ?? 0) - (SEVERITY_RANK[a.severity ?? ""] ?? 0) ||
      b.soleSourceParts.length - a.soleSourceParts.length ||
      b.openOrderValue - a.openOrderValue
  );
}
