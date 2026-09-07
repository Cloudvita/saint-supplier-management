import { withRoute, ok, created, intParam, parseJson } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { invoiceSchema, listInvoices, recordInvoice } from "@/modules/spend";

export const dynamic = "force-dynamic";

export const GET = withRoute("spend.invoices.list", async (req) => {
  await requirePermission(req, "spend:read");
  const url = new URL(req.url);
  return ok({
    invoices: await listInvoices({
      status: (url.searchParams.get("status") as never) ?? undefined,
      limit: intParam(url, "limit", 25, 100),
    }),
  });
});

/** POST — records the invoice and runs the three-way match immediately. */
export const POST = withRoute("spend.invoices.create", async (req) => {
  await requirePermission(req, "spend:write");
  const input = await parseJson(req, invoiceSchema);
  return created(await recordInvoice(input));
});
