import { withRoute, ok, created, intParam, parseJson } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { contractSchema, createContract, listContracts } from "@/modules/contracts";

export const dynamic = "force-dynamic";

export const GET = withRoute("contracts.list", async (req) => {
  await requirePermission(req, "contracts:read");
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const page = await listContracts({
    q: url.searchParams.get("q")?.trim() || undefined,
    supplierId: url.searchParams.get("supplierId") ?? undefined,
    status: (status as never) ?? undefined,
    limit: intParam(url, "limit", 25, 100),
  });
  return ok({ contracts: page.items, total: page.total, limit: page.limit });
});

export const POST = withRoute("contracts.create", async (req) => {
  const ctx = await requirePermission(req, "contracts:write");
  const input = await parseJson(req, contractSchema);
  return created({ contract: await createContract(input, ctx.userId) });
});
