import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { AppError } from "@/core/errors";
import { getEnv } from "@/core/config";
import { sendEmail } from "@/core/aws";
import { publish } from "@/core/events";
import { riskAlerts, severityRank } from "../schema";

export const ALERT_STATUSES = ["NEW", "NOTIFIED", "ACKNOWLEDGED", "DISMISSED"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/** Open alerts (NEW + NOTIFIED) unless a specific status is requested. */
export async function listAlerts(opts: { status?: string; limit?: number } = {}) {
  const limit = Math.min(opts.limit ?? 20, 100);
  const where =
    opts.status && (ALERT_STATUSES as readonly string[]).includes(opts.status)
      ? eq(riskAlerts.status, opts.status as AlertStatus)
      : inArray(riskAlerts.status, ["NEW", "NOTIFIED"]);

  return db.query.riskAlerts.findMany({
    where,
    orderBy: [desc(severityRank), desc(riskAlerts.createdAt)],
    limit,
    with: { supplier: { columns: { id: true, legalName: true, supplierCode: true } } },
  });
}

export async function setAlertStatus(id: string, status: string) {
  if (!(ALERT_STATUSES as readonly string[]).includes(status)) {
    throw AppError.badRequest("id and a valid status are required");
  }
  const [alert] = await db
    .update(riskAlerts)
    .set({ status: status as AlertStatus })
    .where(eq(riskAlerts.id, id))
    .returning();
  if (!alert) throw AppError.notFound("Alert");
  return alert;
}

export type RiskAlertNotification = {
  to: string;
  supplierName: string;
  supplierCode: string;
  eventType: string;
  severity: string;
  headline: string;
  summary?: string | null;
  url?: string | null;
};

/**
 * Notify the procurement manager about a supplier risk event.
 * Returns whether the notification actually went out (see `core/aws/mailer`).
 */
export async function notifyRiskAlert(a: RiskAlertNotification): Promise<boolean> {
  return sendEmail({
    to: a.to,
    subject: `[SAINT] ${a.severity} supplier risk — ${a.eventType} — ${a.supplierName}`,
    body: [
      `Supplier : ${a.supplierName} (${a.supplierCode})`,
      `Event    : ${a.eventType}`,
      `Severity : ${a.severity}`,
      ``,
      a.headline,
      a.summary ?? "",
      a.url ? `\nSource: ${a.url}` : "",
      ``,
      `Recommended action: review open POs, contract exposure and single-source dependency for this supplier.`,
    ].join("\n"),
  });
}

/** Raise an alert, notify, and announce it to the rest of the application. */
export async function raiseAlert(input: {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  eventType: "ACQUISITION" | "MERGER" | "BANKRUPTCY" | "DISPUTE" | "NONE";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  detail?: string | null;
  sourceUrl?: string | null;
  managerEmail?: string | null;
}) {
  const [alert] = await db
    .insert(riskAlerts)
    .values({
      supplierId: input.supplierId,
      eventType: input.eventType,
      severity: input.severity,
      title: input.title,
      detail: input.detail,
      sourceUrl: input.sourceUrl,
    })
    .returning();

  const to = input.managerEmail || getEnv().DEFAULT_PROCUREMENT_MANAGER_EMAIL;
  if (to) {
    const sent = await notifyRiskAlert({
      to,
      supplierName: input.supplierName,
      supplierCode: input.supplierCode,
      eventType: input.eventType,
      severity: input.severity,
      headline: input.title,
      summary: input.detail,
      url: input.sourceUrl,
    });
    if (sent) {
      await db
        .update(riskAlerts)
        .set({ status: "NOTIFIED", notifiedTo: to, notifiedAt: new Date() })
        .where(eq(riskAlerts.id, alert.id));
    }
  }

  await publish("supplier.risk_alert_raised", {
    supplierId: input.supplierId,
    alertId: alert.id,
    eventType: input.eventType,
    severity: input.severity,
    headline: input.title,
  });

  return alert;
}
