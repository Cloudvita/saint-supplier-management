import { withRoute, ok, created, intParam, parseJson } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { createUser, createUserSchema, listUsers } from "@/modules/user_admin";

export const dynamic = "force-dynamic";

export const GET = withRoute("users.list", async (req) => {
  await requirePermission(req, "user_admin:read");
  const url = new URL(req.url);
  return ok({
    users: await listUsers({
      q: url.searchParams.get("q")?.trim() || undefined,
      limit: intParam(url, "limit", 50, 200),
    }),
  });
});

export const POST = withRoute("users.create", async (req) => {
  const ctx = await requirePermission(req, "user_admin:write");
  const input = await parseJson(req, createUserSchema);
  return created({ user: await createUser(input, ctx.userId) });
});
