import { SendEmailCommand } from "@aws-sdk/client-ses";
import { getEnv } from "@/core/config";
import { createLogger } from "@/core/logger";
import { getSes } from "./clients";

const log = createLogger("mailer");

export type Email = { to: string; subject: string; body: string };

/**
 * Send a plain-text email through Amazon SES.
 *
 * Falls back to a log line when ALERT_FROM_EMAIL is unset so local dev and
 * demos run without SES. Returns whether the message was actually dispatched —
 * callers persist that (e.g. an alert only becomes NOTIFIED when true).
 */
export async function sendEmail({ to, subject, body }: Email): Promise<boolean> {
  const from = getEnv().ALERT_FROM_EMAIL;
  if (!from) {
    log.warn("email not sent — ALERT_FROM_EMAIL unset", { to, subject });
    return false;
  }
  try {
    await getSes().send(
      new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: [to] },
        Message: { Subject: { Data: subject }, Body: { Text: { Data: body } } },
      })
    );
    return true;
  } catch (e) {
    log.error("SES send failed", { message: e instanceof Error ? e.message : String(e) });
    return false;
  }
}
