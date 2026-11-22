import { withRoute, ok } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { procurementSchema } from "@/modules/product";

export const dynamic = "force-dynamic";

/** GET /api/ontology-kg/schema — the procurement ontology and the size of the supply-network graph */
export const GET = withRoute("ontology-kg.schema", async (req) => {
  await requirePermission(req, "product:read");
  return ok(await procurementSchema());
});
