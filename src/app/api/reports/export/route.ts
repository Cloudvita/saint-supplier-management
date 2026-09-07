import { withRoute } from "@/core/http";
import { AppError } from "@/core/errors";
import { requirePermission } from "@/modules/auth";
import {
  CONTENT_TYPES,
  FILE_EXTENSIONS,
  generateReport,
  REPORT_KEYS,
  type ExportFormat,
  type ReportKey,
} from "@/modules/reports";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/export?report=spend_by_category&format=csv
 * Streams the rendered report as a download.
 */
export const GET = withRoute("reports.export", async (req) => {
  await requirePermission(req, "reports:export");

  const url = new URL(req.url);
  const report = url.searchParams.get("report") ?? "";
  const format = (url.searchParams.get("format") ?? "csv") as ExportFormat;

  if (!(REPORT_KEYS as readonly string[]).includes(report)) {
    throw AppError.badRequest(`Unknown report. Available: ${REPORT_KEYS.join(", ")}`);
  }
  if (!["csv", "json", "markdown"].includes(format)) {
    throw AppError.badRequest("format must be csv, json or markdown");
  }

  const result = await generateReport(report as ReportKey, format);

  return new Response(result.content, {
    headers: {
      "Content-Type": CONTENT_TYPES[format],
      "Content-Disposition": `attachment; filename="${result.fileName}.${FILE_EXTENSIONS[format]}"`,
      "X-Row-Count": String(result.rowCount),
    },
  });
});
