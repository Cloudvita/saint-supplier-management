import { z } from "zod";
import { withRoute, ok, parseInput } from "@/core/http";
import { AppError } from "@/core/errors";
import { requirePermission } from "@/modules/auth";
import { commitImport } from "@/modules/product";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  /** Re-import: replace this earlier graph source; unchanged parts keep their ids. */
  replaceSourceId: z.string().trim().min(1).optional(),
});

/** POST /api/product/imports/:id/commit { replaceSourceId? } — write the preview into the graph */
export const POST = withRoute<Ctx>("product.imports.commit", async (req, { params }) => {
  const ctx = await requirePermission(req, "product:write");
  const { id } = await params;

  // An empty body means "no options"; anything else must be valid, so a
  // mistyped replaceSourceId never silently becomes a plain commit.
  const text = (await req.text()).trim();
  let raw: unknown = {};
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw AppError.badRequest("Invalid JSON body");
    }
  }
  return ok(await commitImport(id, ctx.userId, parseInput(bodySchema.strict(), raw)));
});
