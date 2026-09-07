import { withRoute, ok, created, parseJson } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { budgetSchema, createBudget, listBudgets } from "@/modules/spend";

export const dynamic = "force-dynamic";

export const GET = withRoute("spend.budgets.list", async (req) => {
  await requirePermission(req, "spend:read");
  const year = new URL(req.url).searchParams.get("fiscalYear");
  return ok({ budgets: await listBudgets(year ? Number(year) : undefined) });
});

export const POST = withRoute("spend.budgets.create", async (req) => {
  await requirePermission(req, "spend:approve");
  const input = await parseJson(req, budgetSchema);
  return created({ budget: await createBudget(input) });
});
