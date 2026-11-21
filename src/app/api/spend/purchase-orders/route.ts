import { withRoute, ok, created, intParam, parseJson } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { issuePurchaseOrder, listPurchaseOrders, purchaseOrderSchema } from "@/modules/spend";

export const dynamic = "force-dynamic";

export const GET = withRoute("spend.po.list", async (req) => {
  await requirePermission(req, "spend:read");
  const url = new URL(req.url);
  return ok({
    purchaseOrders: await listPurchaseOrders({
      supplierId: url.searchParams.get("supplierId") ?? undefined,
      partId: url.searchParams.get("partId") ?? undefined,
      status: (url.searchParams.get("status") as never) ?? undefined,
      limit: intParam(url, "limit", 25, 100),
    }),
  });
});

/**
 * POST /api/spend/purchase-orders
 * Runs the procurement controls first — a policy violation returns 409 with
 * the specific control that refused, and no purchase order is written.
 */
export const POST = withRoute("spend.po.issue", async (req) => {
  const ctx = await requirePermission(req, "spend:approve");
  const input = await parseJson(req, purchaseOrderSchema);
  return created(await issuePurchaseOrder(input, ctx.userId));
});
