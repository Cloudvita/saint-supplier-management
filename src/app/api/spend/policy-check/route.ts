import { z } from "zod";
import { withRoute, ok, parseJson } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { evaluatePurchasePolicy } from "@/modules/spend";

export const dynamic = "force-dynamic";

/**
 * POST /api/spend/policy-check
 *
 * Ask whether a commitment *would* pass the controls, without writing
 * anything. The buyer's UI calls this to warn before submit; the AI layer
 * calls the same logic through `spend_check_purchase_policy`.
 */
export const POST = withRoute("spend.policy-check", async (req) => {
  const ctx = await requirePermission(req, "spend:read");
  const input = await parseJson(
    req,
    z.object({
      amount: z.coerce.number().positive(),
      currency: z.string().length(3).default("USD"),
      approverId: z.string().optional(),
      budgetId: z.string().optional(),
      supplierId: z.string().optional(),
      competitiveBids: z.coerce.number().int().min(0).default(0),
      soleSourceJustification: z.string().optional(),
    })
  );

  return ok(await evaluatePurchasePolicy({ ...input, approverId: input.approverId ?? ctx.userId }));
});
