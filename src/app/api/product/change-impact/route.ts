import { z } from "zod";
import { withRoute, ok, parseJson } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { analyseChangeImpact } from "@/modules/product";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    partName: z.string().trim().min(1).max(200).optional(),
    changeName: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => Boolean(v.partName) !== Boolean(v.changeName), { message: "Give exactly one of partName or changeName" });

/** POST /api/product/change-impact { partName } | { changeName } — what a design change touches */
export const POST = withRoute("product.change-impact", async (req) => {
  await requirePermission(req, "product:read");
  const { partName, changeName } = await parseJson(req, bodySchema);
  return ok(
    changeName ? await analyseChangeImpact(changeName, { asChange: true }) : await analyseChangeImpact(partName as string)
  );
});
