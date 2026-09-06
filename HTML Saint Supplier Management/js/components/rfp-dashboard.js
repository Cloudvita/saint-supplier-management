/**
 * SAINT.components.rfpDashboard — RFP Step 4: executive KPI overview, the
 * master historical registry, and a per-RFP audit inspector.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  SAINT.components = SAINT.components || {};
  const { escapeHtml, formatDateTime } = SAINT.utils;
  const { DEFAULT_PARAMETERS } = SAINT.rfpData;

  let auditRfpId = null;
  let auditTab = "document"; // "document" | "scores" | "vendors"

  function kpiCard(value, label) {
    return `
      <div class="kpi-card">
        <div class="kpi-value">${escapeHtml(String(value))}</div>
        <div class="kpi-label">${escapeHtml(label)}</div>
      </div>
    `;
  }

  function registryRow(r) {
    return `
      <tr>
        <td class="mono">${escapeHtml(r.id)}</td>
        <td>${escapeHtml(r.title)}</td>
        <td>${escapeHtml(formatDateTime(r.createdAt))}</td>
        <td>${escapeHtml(r.dispatchedVendors.join(", "))}</td>
        <td>${escapeHtml(r.winningVendor)}</td>
        <td><span class="chip ${r.status === "Evaluated & Awarded" ? "chip-emerald" : "chip-slate"}">${escapeHtml(r.status)}</span></td>
      </tr>
    `;
  }

  function auditPanelHtml(rfp) {
    if (auditTab === "document") {
      return `<pre class="news-pre">${escapeHtml(rfp.rfpText || "No RFP document text recorded.")}</pre>`;
    }
    if (auditTab === "scores") {
      if (!rfp.finalScores) return `<p class="muted">Evaluation scoring pending or not yet finalized for this RFP.</p>`;
      return `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Vendor</th>${DEFAULT_PARAMETERS.map((p) => `<th>${escapeHtml(p)}</th>`).join("")}<th>Weighted Total</th><th>Notes</th></tr></thead>
            <tbody>
              ${rfp.finalScores
                .map(
                  (r) => `
                <tr>
                  <td><strong>${escapeHtml(r.vendor)}</strong></td>
                  ${DEFAULT_PARAMETERS.map((p) => `<td>${escapeHtml(String(r.params[p] || "—"))}</td>`).join("")}
                  <td><strong>${r.weightedScore.toFixed(2)}</strong></td>
                  <td style="max-width:220px;">${escapeHtml(r.notes || "")}</td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `;
    }
    // vendors
    return `<ul>${rfp.dispatchedVendors.map((v) => `<li><strong>${escapeHtml(v)}</strong></li>`).join("")}</ul>`;
  }

  function render(mount) {
    const stats = SAINT.rfpStore.cpoStats();
    const rfps = SAINT.rfpStore.listRfps();

    if (rfps.length === 0) {
      mount.innerHTML = `<div class="card empty">No historical RFP records found. Run an RFP cycle in Steps 2 &amp; 3 to view CPO analytics.</div>`;
      return;
    }

    if (!auditRfpId || !rfps.some((r) => r.id === auditRfpId)) auditRfpId = rfps[0].id;
    const auditRfp = rfps.find((r) => r.id === auditRfpId);

    mount.innerHTML = `
      <h3 class="section-title" style="margin-top:0;">Executive Portfolio Overview</h3>
      <div class="kpi-row">
        ${kpiCard(stats.totalRfps, "Total RFPs Executed")}
        ${kpiCard(stats.awardedRfps, "Vendor Selections Awarded")}
        ${kpiCard(stats.pendingRfps, "Pending Evaluations")}
        ${kpiCard(stats.uniqueVendors, "Unique Vendors Participated")}
      </div>

      <h3 class="section-title">Master RFP Historical Registry</h3>
      <div class="card" style="overflow:hidden;">
        <div class="registry-table-wrap">
          <table>
            <thead><tr><th>RFP ID</th><th>Program Title</th><th>Date Dispatched</th><th>Dispatched Vendors</th><th>Selected Winner</th><th>Status</th></tr></thead>
            <tbody>${rfps.map(registryRow).join("")}</tbody>
          </table>
        </div>
      </div>

      <h3 class="section-title">Detailed RFP Program Audit Inspector</h3>
      <select class="input" id="rfp-audit-select" style="max-width:480px;">
        ${rfps.map((r) => `<option value="${escapeHtml(r.id)}" ${r.id === auditRfpId ? "selected" : ""}>${escapeHtml(r.id)} — ${escapeHtml(r.title)}</option>`).join("")}
      </select>

      <div class="card card-pad mt-4">
        <p><strong>Date Dispatched:</strong> ${escapeHtml(formatDateTime(auditRfp.createdAt))} &nbsp;·&nbsp; <strong>Status:</strong> ${escapeHtml(auditRfp.status)}</p>
        <p><strong>Winning Vendor:</strong> 🏆 <code>${escapeHtml(auditRfp.winningVendor)}</code></p>

        <div class="audit-tabs">
          <button type="button" class="btn-ghost btn-sm" data-audit-tab="document" aria-pressed="${auditTab === "document"}">📄 Generated RFP Document</button>
          <button type="button" class="btn-ghost btn-sm" data-audit-tab="scores" aria-pressed="${auditTab === "scores"}">📊 Vendor Scores &amp; Notes</button>
          <button type="button" class="btn-ghost btn-sm" data-audit-tab="vendors" aria-pressed="${auditTab === "vendors"}">🏢 Dispatched Vendors</button>
        </div>
        <div id="rfp-audit-panel">${auditPanelHtml(auditRfp)}</div>
      </div>
    `;
  }

  function init() {
    const mount = document.getElementById("rfp-dashboard-mount");
    const rerender = () => render(mount);

    mount.addEventListener("change", (e) => {
      const select = e.target.closest("#rfp-audit-select");
      if (select) {
        auditRfpId = select.value;
        rerender();
      }
    });

    mount.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-audit-tab]");
      if (btn) {
        auditTab = btn.dataset.auditTab;
        rerender();
      }
    });

    rerender();
    SAINT.rfpStore.subscribe(rerender);
  }

  SAINT.components.rfpDashboard = { init };
})(window);
