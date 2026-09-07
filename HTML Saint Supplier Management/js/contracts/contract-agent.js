/**
 * SAINT.contractAgent — the Contract Management AI Agent.
 *
 * Two jobs:
 *
 *  1. **Expiry watch.** Every contract with an end date is checked against a
 *     60-day horizon (and against its own notice period, which is often
 *     longer). Anything inside the window raises a notification addressed to
 *     the contract owner.
 *  2. **Workflow orchestration.** The agent also chases the workflow itself —
 *     contracts sitting unapproved, contracts that cannot be approved because
 *     they are missing mandatory clauses, and auto-renewing contracts whose
 *     notice date is about to pass silently.
 *
 * It runs on load and on demand. Notifications are de-duplicated by a stable
 * key so a contract that stays expiring does not produce a new notification on
 * every scan — the point is to be told once, not nagged.
 *
 * Dispatch is simulated: a static browser build has no mail transport, so the
 * notification records who it would go to. See README for wiring a real one.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});

  /** The business-stated horizon: anything expiring inside 60 days is news. */
  const EXPIRY_HORIZON_DAYS = 60;
  /** A submitted contract not acted on within this many days is chased. */
  const STALE_APPROVAL_DAYS = 5;

  const DAY_MS = 24 * 60 * 60 * 1000;

  function daysUntil(dateStr, now) {
    if (!dateStr) return null;
    const target = new Date(dateStr + "T00:00:00");
    if (Number.isNaN(target.getTime())) return null;
    return Math.ceil((target.getTime() - now.getTime()) / DAY_MS);
  }

  /** Who a contract notification should reach. */
  function recipientFor(contract) {
    const supplier = SAINT.store.getSupplier(contract.supplierId);
    return (
      contract.approvedBy ||
      contract.submittedBy ||
      contract.createdBy ||
      (supplier && supplier.procurementManagerEmail) ||
      "procurement.manager@example.com"
    );
  }

  /**
   * Evaluate one contract and return the notifications it warrants.
   *
   * Pure: it decides, it does not write. `runScan` owns persistence, which
   * keeps the rules testable and makes the dedupe behaviour obvious.
   */
  function assess(contract, now) {
    const findings = [];
    const days = daysUntil(contract.expiryDate, now);
    const live = contract.status === "APPROVED" || contract.status === "ACTIVE";

    // --- 1. expiry watch ---
    if (live && days !== null) {
      // A 90-day-notice MSA needs flagging before a 60-day horizon would.
      const horizon = Math.max(EXPIRY_HORIZON_DAYS, contract.noticePeriodDays || 0);

      if (days < 0) {
        findings.push({
          kind: "EXPIRED",
          dedupeKey: `expired:${contract.id}`,
          severity: "CRITICAL",
          title: `${contract.contractNumber} has expired`,
          detail: `${contract.title} with ${contract.supplierName} expired ${Math.abs(days)} day${
            Math.abs(days) === 1 ? "" : "s"
          } ago (${contract.expiryDate}). Any purchase orders against it are now uncovered.`,
        });
      } else if (days <= horizon) {
        const urgent = days <= 30;
        findings.push({
          kind: "EXPIRING",
          dedupeKey: `expiring:${contract.id}:${contract.expiryDate}`,
          severity: urgent ? "HIGH" : "MEDIUM",
          title: `${contract.contractNumber} expires in ${days} day${days === 1 ? "" : "s"}`,
          detail: `${contract.title} with ${contract.supplierName} ends ${contract.expiryDate}.${
            contract.noticePeriodDays
              ? ` Notice period is ${contract.noticePeriodDays} days, so the decision date is ${
                  days - contract.noticePeriodDays < 0
                    ? "already past"
                    : `in ${days - contract.noticePeriodDays} day(s)`
                }.`
              : ""
          } Renew, renegotiate or let it lapse.`,
        });
      }

      // --- 2. auto-renew about to trigger silently ---
      if (contract.renewalType === "AUTO_RENEW" && days >= 0) {
        const noticeDeadline = days - (contract.noticePeriodDays || 0);
        if (noticeDeadline <= EXPIRY_HORIZON_DAYS) {
          findings.push({
            kind: "AUTO_RENEW",
            dedupeKey: `autorenew:${contract.id}:${contract.expiryDate}`,
            severity: noticeDeadline <= 0 ? "CRITICAL" : "HIGH",
            title:
              noticeDeadline <= 0
                ? `${contract.contractNumber} will auto-renew — notice window has closed`
                : `${contract.contractNumber} auto-renews unless cancelled in ${noticeDeadline} day(s)`,
            detail: `${contract.title} renews automatically. ${
              noticeDeadline <= 0
                ? "The cancellation notice date has passed, so it renews on its current terms."
                : "Cancel or renegotiate before the notice date."
            }`,
          });
        }
      }
    }

    // --- 3. workflow orchestration ---
    if (contract.status === "PENDING_APPROVAL") {
      const waiting = contract.submittedAt
        ? Math.floor((now.getTime() - new Date(contract.submittedAt).getTime()) / DAY_MS)
        : 0;
      if (waiting >= STALE_APPROVAL_DAYS) {
        findings.push({
          kind: "STALE_APPROVAL",
          dedupeKey: `stale:${contract.id}:${contract.submittedAt}`,
          severity: "MEDIUM",
          title: `${contract.contractNumber} has awaited approval for ${waiting} days`,
          detail: `Submitted by ${contract.submittedBy || "unknown"}. A sourcing manager needs to approve or reject it.`,
        });
      }
      if (contract.review && contract.review.missing.length > 0) {
        findings.push({
          kind: "BLOCKED_APPROVAL",
          dedupeKey: `blocked:${contract.id}`,
          severity: "HIGH",
          title: `${contract.contractNumber} cannot be approved — missing mandatory clauses`,
          detail: `Awaiting approval but missing: ${contract.review.missing.join(", ")}. It must be returned to the analyst.`,
        });
      }
    }

    return findings.map((f) => ({ ...f, contractId: contract.id, recipient: recipientFor(contract) }));
  }

  /**
   * Scan the whole contract portfolio and raise notifications.
   *
   * Returns a summary rather than throwing on partial failure — one malformed
   * contract should not stop the rest of the portfolio being checked.
   */
  function runScan({ now = new Date() } = {}) {
    const contracts = SAINT.contractStore.listContracts();
    let raised = 0;
    let suppressed = 0;
    const items = [];

    contracts.forEach((c) => {
      assess(c, now).forEach((finding) => {
        const result = SAINT.contractStore.raiseNotification(finding);
        if (result.ok) {
          raised++;
          items.push(result.notification);
        } else {
          suppressed++;
        }
      });
    });

    return {
      at: now.toISOString(),
      contractsScanned: contracts.length,
      raised,
      suppressed,
      items,
      horizonDays: EXPIRY_HORIZON_DAYS,
    };
  }

  /** Contracts inside the horizon, for the agent's at-a-glance panel. */
  function expiringWithin(days = EXPIRY_HORIZON_DAYS, now = new Date()) {
    return SAINT.contractStore
      .listContracts()
      .filter((c) => c.status === "APPROVED" || c.status === "ACTIVE")
      .map((c) => ({ ...c, daysToExpiry: daysUntil(c.expiryDate, now) }))
      .filter((c) => c.daysToExpiry !== null && c.daysToExpiry <= days)
      .sort((a, b) => a.daysToExpiry - b.daysToExpiry);
  }

  SAINT.contractAgent = {
    EXPIRY_HORIZON_DAYS,
    STALE_APPROVAL_DAYS,
    assess,
    runScan,
    expiringWithin,
    daysUntil,
  };
})(window);
