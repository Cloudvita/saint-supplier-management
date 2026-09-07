import type { RiskSeverity } from "@/shared/types";

const SEVERITY_CLASS: Record<RiskSeverity, string> = {
  CRITICAL: "bg-red-100 text-red-700",
  HIGH: "bg-orange-100 text-orange-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-slate-100 text-slate-600",
};

export function SeverityBadge({ severity }: { severity: string }) {
  const cls = SEVERITY_CLASS[severity as RiskSeverity] ?? SEVERITY_CLASS.LOW;
  return <span className={`chip ${cls}`}>{severity}</span>;
}

const STATUS_CLASS: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  SIGNED: "bg-emerald-100 text-emerald-700",
  MATCHED: "bg-emerald-100 text-emerald-700",
  DRAFT: "bg-slate-100 text-slate-600",
  PENDING: "bg-amber-100 text-amber-700",
  SUBMITTED: "bg-amber-100 text-amber-700",
  ON_HOLD: "bg-amber-100 text-amber-700",
  EXPIRING: "bg-orange-100 text-orange-700",
  EXCEPTION: "bg-red-100 text-red-700",
  BLOCKED: "bg-red-100 text-red-700",
  REJECTED: "bg-red-100 text-red-700",
  EXPIRED: "bg-red-100 text-red-700",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`chip ${STATUS_CLASS[status] ?? "bg-slate-100 text-slate-600"}`}>{status.replace(/_/g, " ")}</span>;
}
