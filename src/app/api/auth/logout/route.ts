import { withRoute, ok } from "@/core/http";
import { AppError } from "@/core/errors";
import { logout } from "@/modules/auth";

export const dynamic = "force-dynamic";

export const POST = withRoute("auth.logout", async (req) => {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) throw AppError.unauthenticated();
  await logout(header.slice(7).trim());
  return ok({ ok: true });
});
