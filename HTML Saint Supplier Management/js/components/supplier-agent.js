/**
 * SAINT.components.supplierAgent — the Supplier Management AI Agent.
 *
 * Lives inside the Suppliers tab rather than on a tab of its own: the agent
 * acts on the supplier list shown directly beneath it, and its results (fresh
 * market news, new risk alerts) land on those same rows. Keeping the two
 * together means you see what it changed without navigating anywhere.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  SAINT.components = SAINT.components || {};
  const { escapeHtml, formatDateTime } = SAINT.utils;

  let scanning = false;
  let lastRunSummary = null; // { at, scanned, alertsRaised, flagged[] }

  function render(btn, countLabel, log) {
    const total = SAINT.store.totalSupplierCount();
    countLabel.textContent = `${total} supplier${total === 1 ? "" : "s"} in scope`;
    btn.disabled = scanning || !SAINT.adminStore.can("suppliers:write");
    btn.textContent = scanning ? "Scanning…" : "Scan all suppliers now";

    if (!SAINT.adminStore.can("suppliers:write")) {
      log.innerHTML = `<div class="note">Your role (${escapeHtml(
        SAINT.adminStore.currentActorRole()
      )}) cannot run the agent — it writes market news and raises alerts.</div>`;
      return;
    }

    if (!lastRunSummary) {
      log.innerHTML = "";
      return;
    }

    const flagged = lastRunSummary.flagged;
    log.innerHTML = `
      <div class="note">
        Last run ${escapeHtml(formatDateTime(lastRunSummary.at))} —
        ${lastRunSummary.scanned} supplier${lastRunSummary.scanned === 1 ? "" : "s"} scanned,
        <strong>${lastRunSummary.alertsRaised}</strong> new risk alert${lastRunSummary.alertsRaised === 1 ? "" : "s"} raised.
        ${
          flagged.length
            ? `<br />Flagged: ${flagged.map((f) => escapeHtml(f)).join(", ")}. See the Risk Alerts tab.`
            : "<br />Nothing new needs attention."
        }
      </div>
    `;
  }

  function init() {
    const btn = document.getElementById("supplier-agent-scan-btn");
    const countLabel = document.getElementById("supplier-agent-count");
    const log = document.getElementById("supplier-agent-log");
    if (!btn) return;

    const rerender = () => render(btn, countLabel, log);

    btn.addEventListener("click", () => {
      if (scanning) return;
      scanning = true;
      rerender();
      // Yield a tick so the disabled "Scanning…" state paints before the
      // (synchronous, simulated) scan runs.
      setTimeout(() => {
        const results = SAINT.store.runAgentScanAll();
        const alertsRaised = results.reduce((sum, r) => sum + r.newAlerts.length, 0);
        const flagged = results
          .filter((r) => r.newAlerts.length > 0)
          .map((r) => {
            const s = SAINT.store.getSupplier(r.supplierId);
            return s ? s.legalName : "Unknown supplier";
          });
        lastRunSummary = { at: new Date().toISOString(), scanned: results.length, alertsRaised, flagged };
        scanning = false;
        rerender();
      }, 400);
    });

    rerender();
    SAINT.store.subscribe(rerender);
    SAINT.adminStore.subscribe(rerender);
  }

  SAINT.components.supplierAgent = { init };
})(window);
