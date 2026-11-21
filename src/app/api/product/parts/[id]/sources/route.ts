import { z } from "zod";
import { withRoute, ok, created, parseJson, parseInput } from "@/core/http";
import { requirePermission } from "@/modules/auth";
import { linkSupplierSchema, linkSupplierToPart, listSourcesForPart } from "@/modules/product";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/product/parts/:id/sources — suppliers that can make this part */
export const GET = withRoute<Ctx>("product.sources.list", async (req, { params }) => {
  await requirePermission(req, "product:read");
  const { id } = await params;
  return ok(await listSourcesForPart(decodeURIComponent(id)));
});

/** POST /api/product/parts/:id/sources { partName, supplierId, status?, unitPrice?, ... } */
export const POST = withRoute<Ctx>("product.sources.link", async (req, { params }) => {
  const ctx = await requirePermission(req, "product:write");
  const { id } = await params;
  const body = await parseJson(req, z.record(z.unknown()));
  // The path names the part; a partId in the body is overridden, not trusted.
  const input = parseInput(linkSupplierSchema, { ...body, partId: decodeURIComponent(id) });
  return created({ partSource: await linkSupplierToPart(input, ctx.userId) });
});
