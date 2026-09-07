import { withRoute, ok, parseJson } from "@/core/http";
import { mfaVerifySchema, verifyMfa } from "@/modules/auth";

export const dynamic = "force-dynamic";

/** POST /api/auth/mfa  { sessionToken, code } — completes a two-factor challenge. */
export const POST = withRoute("auth.mfa", async (req) => {
  const input = await parseJson(req, mfaVerifySchema);
  return ok({ context: await verifyMfa(input.sessionToken, input.code) });
});
