import { withRoute, ok } from "@/core/http";
import { AppError } from "@/core/errors";
import { requirePermission } from "@/modules/auth";
import { traceIndirectRisks } from "@/modules/product";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ supplier: string }> };

/**
 * GET /api/ontology-kg/risk-trace/:supplier?maxHops=3
 * Risk events reaching a supplier directly or through sub-tier vendors and
 * locations, with the propagation path. `supplier` is a SAINT id, code or name.
 */
export const GET = withRoute<Ctx>("ontology-kg.risk-trace", async (req, { params }) => {
  await requirePermission(req, "product:read");
  const { supplier } = await params;
  const raw = new URL(req.url).searchParams.get("maxHops");
  const maxHops = raw === null ? 3 : Number(raw);
  if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > 6) throw AppError.validation("maxHops must be 1–6");
  return ok(await traceIndirectRisks(decodeURIComponent(supplier), maxHops));
});
