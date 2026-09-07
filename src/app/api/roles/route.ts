import { withRoute, ok } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { listRoles } from "@/modules/user_admin";

export const dynamic = "force-dynamic";

/** The role catalogue with permissions and delegation-of-authority limits. */
export const GET = withRoute("roles.list", async (req) => {
  await requirePermission(req, "user_admin:read");
  return ok({ roles: await listRoles() });
});
