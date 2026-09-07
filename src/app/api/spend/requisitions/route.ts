import { withRoute, ok, created, intParam, parseJson } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { createRequisition, listRequisitions, requisitionSchema } from "@/modules/spend";

export const dynamic = "force-dynamic";

export const GET = withRoute("spend.requisitions.list", async (req) => {
  await requirePermission(req, "spend:read");
  const url = new URL(req.url);
  return ok({
    requisitions: await listRequisitions({
      status: (url.searchParams.get("status") as never) ?? undefined,
      limit: intParam(url, "limit", 25, 100),
    }),
  });
});

export const POST = withRoute("spend.requisitions.create", async (req) => {
  const ctx = await requirePermission(req, "spend:write");
  const input = await parseJson(req, requisitionSchema);
  return created({ requisition: await createRequisition(input, ctx.userId) });
});
