/**
 * SAINT.components.genie — AI Genie panel: scan every supplier for a
 * simulated news refresh and report how many new risk alerts came out of it.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  SAINT.components = SAINT.components || {};
  const { escapeHtml, formatDateTime } = SAINT.utils;

  let scanning = false;
  let lastRunSummary = null; // { at, scanned, alertsRaised }

  function render(btn, countLabel, log) {
    countLabel.textContent = `${SAINT.store.totalSupplierCount()} supplier(s) in scope`;
    btn.disabled = scanning;
    btn.textContent = scanning ? "Scanning…" : "Scan all suppliers now";

    if (!lastRunSummary) {
      log.innerHTML = "";
      return;
    }
    log.innerHTML = `
      <div class="note">
        Last scan: ${escapeHtml(formatDateTime(lastRunSummary.at))} —
        ${lastRunSummary.scanned} supplier(s) scanned, ${lastRunSummary.alertsRaised} new risk alert(s) raised.
      </div>
    `;
  }

  function init() {
    const btn = document.getElementById("genie-scan-btn");
    const countLabel = document.getElementById("genie-supplier-count");
    const log = document.getElementById("genie-log");

    const rerender = () => render(btn, countLabel, log);

    btn.addEventListener("click", () => {
      if (scanning) return;
      scanning = true;
      rerender();
      setTimeout(() => {
        const results = SAINT.store.runGenieScanAll();
        const alertsRaised = results.reduce((sum, r) => sum + r.newAlerts.length, 0);
        lastRunSummary = { at: new Date().toISOString(), scanned: results.length, alertsRaised };
        scanning = false;
        rerender();
      }, 400);
    });

    rerender();
    SAINT.store.subscribe(rerender);
  }

  SAINT.components.genie = { init };
})(window);
