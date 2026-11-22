import { withRoute, ok } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { procurementSchema, syncProcurementProjection } from "@/modules/product";

export const dynamic = "force-dynamic";

/** POST /api/ontology-kg/sync — re-project SAINT's suppliers, contracts and open risk alerts into the graph now */
export const POST = withRoute("ontology-kg.sync", async (req) => {
  await requirePermission(req, "product:write");
  await syncProcurementProjection({ force: true });
  return ok((await procurementSchema()).stats);
});
