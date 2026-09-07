/**
 * `/reports` — cross-module dashboards, the metric pipeline and the export
 * engine.
 *
 * Owns no tables, by design. Every figure is composed from other modules'
 * public service APIs, which is what stops "one report needs a join" from
 * becoming a hole through every boundary in the system.
 */
export {
  getExecutiveDashboard,
  generateReport,
  REPORT_KEYS,
  type ExecutiveDashboard,
  type ReportKey,
  type RenderedReport,
} from "./services/report.service";

export {
  render,
  toCsv,
  toMarkdown,
  CONTENT_TYPES,
  FILE_EXTENSIONS,
  type ExportFormat,
  type ExportColumn,
} from "./domain/export";

export { metric, share, tailSpendShare, type Metric, type MetricDirection } from "./domain/metrics";

export { reportAgentTools } from "./agent-tools";
