import { withRoute, ok, parseJson } from "@/core/http";
import { login, loginSchema } from "@/modules/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login  { userName, password }
 *
 * Returns a bearer token. When a second factor is enrolled the token is issued
 * but unusable until `/api/auth/mfa` is satisfied.
 */
export const POST = withRoute("auth.login", async (req) => {
  const input = await parseJson(req, loginSchema);
  const result = await login(input.userName, input.password, {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  return ok(result);
});
