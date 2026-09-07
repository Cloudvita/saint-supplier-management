/**
 * SAINT.components.alerts — Risk Alerts panel.
 * The click listener is bound once (delegated on the mount container) so
 * re-rendering the list never accumulates duplicate listeners.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  SAINT.components = SAINT.components || {};
  const { escapeHtml } = SAINT.utils;

  const SEVERITY_CLASS = {
    CRITICAL: "alert-critical",
    HIGH: "alert-high",
    MEDIUM: "alert-medium",
    LOW: "alert-low",
  };

  function alertHtml(a) {
    const cls = SEVERITY_CLASS[a.severity] || "alert-low";
    return `
      <div class="alert-box ${cls}" data-alert-id="${escapeHtml(a.id)}">
        <button type="button" class="alert-dismiss" data-action="dismiss-alert" data-id="${escapeHtml(a.id)}" aria-label="Dismiss alert">✕</button>
        <div class="alert-row">
          <span class="chip" style="background:rgba(255,255,255,0.7);">${escapeHtml(a.eventType)}</span>
          <span style="font-size:11px; font-weight:700; text-transform:uppercase;">${escapeHtml(a.severity)}</span>
          <span style="font-weight:700;">${escapeHtml(a.supplier.legalName)} (${escapeHtml(a.supplier.supplierCode)})</span>
        </div>
        <p class="alert-title">${escapeHtml(a.title)}</p>
        ${a.sourceUrl ? `<a class="alert-source" href="${escapeHtml(a.sourceUrl)}" target="_blank" rel="noreferrer">source</a>` : ""}
      </div>
    `;
  }

  function render(mount, chipMount) {
    const alerts = SAINT.store.listOpenAlerts();

    chipMount.textContent = alerts.length > 0 ? String(alerts.length) : "";
    chipMount.className = alerts.length > 0 ? "chip chip-red" : "";

    if (alerts.length === 0) {
      mount.innerHTML = `<div class="card empty">No open risk alerts. Run the Supplier Management AI Agent on the Suppliers tab to scan for the latest news and risk events.</div>`;
      return;
    }

    mount.innerHTML = `
      <div class="alerts-head">
        <h2>Supplier Risk Alerts (${alerts.length})</h2>
        <button type="button" class="btn-link" id="dismiss-all-btn" data-action="dismiss-all">Close all</button>
      </div>
      ${alerts.map(alertHtml).join("")}
    `;
  }

  function init() {
    const mount = document.getElementById("alerts-mount");
    const chipMount = document.getElementById("alert-count-chip");

    mount.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn || !mount.contains(btn)) return;

      if (btn.dataset.action === "dismiss-alert") {
        SAINT.store.dismissAlert(btn.dataset.id);
      } else if (btn.dataset.action === "dismiss-all") {
        SAINT.store.dismissAllOpenAlerts();
      }
    });

    render(mount, chipMount);
    SAINT.store.subscribe(() => render(mount, chipMount));
  }

  SAINT.components.alerts = { init };
})(window);
