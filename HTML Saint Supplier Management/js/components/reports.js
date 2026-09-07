/**
 * SAINT.components.reports — the Reporting module.
 *
 * The only place in the app that reads across every module. It answers the
 * questions the business actually asks: how many suppliers are active, how
 * many contracts are live, what the total spend is, how it splits by category,
 * and how many purchase orders are open.
 *
 * Every figure is pulled from another store's public API (supplierStats,
 * contractStats, spendStats, cpoStats) rather than from its records, so a
 * change to how contracts are stored cannot break this file.
 *
 * Charting note: each chart shows a single series, so it uses a single hue and
 * carries no legend — the title names the series. Every bar is directly
 * labelled with its name and value, so nothing is encoded by colour alone.
 * Status distributions are deliberately NOT colour-coded bars: the red and
 * orange status tokens in this design system are indistinguishable to a
 * protanopic reader, so state is carried by its chip and label instead.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  SAINT.components = SAINT.components || {};
  const { escapeHtml } = SAINT.utils;

  const SUPPLIER_STATUS_LABELS = {
    ACTIVE: "Active",
    DRAFT: "Draft",
    ON_HOLD: "On hold",
    BLOCKED: "Blocked",
  };
  const SUPPLIER_STATUS_CHIPS = {
    ACTIVE: "chip-emerald",
    DRAFT: "chip-slate",
    ON_HOLD: "chip-amber",
    BLOCKED: "chip-red",
  };

  function money(value) {
    const n = Number(value) || 0;
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }

  function kpi(value, label, note) {
    return `
      <div class="kpi-card">
        <div class="kpi-value">${escapeHtml(String(value))}</div>
        <div class="kpi-label">${escapeHtml(label)}</div>
        ${note ? `<div class="muted" style="font-size:11px; margin-top:4px;">${escapeHtml(note)}</div>` : ""}
      </div>
    `;
  }

  /**
   * Horizontal magnitude bars for one series.
   *
   * Bars are scaled against the largest value so the longest fills the track;
   * `formatValue` renders the number at the end of each bar, which is what
   * makes this readable without a value axis.
   */
  function hbarChart(rows, formatValue) {
    if (rows.length === 0) return `<p class="muted">No data yet.</p>`;
    const max = Math.max(...rows.map((r) => r.value), 0) || 1;

    return `
      <div class="hbar-chart">
        ${rows
          .map((r) => {
            const pct = Math.max(1, Math.round((r.value / max) * 100));
            const formatted = formatValue(r.value);
            return `
              <div class="hbar-row">
                <div class="hbar-label" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</div>
                <div class="hbar-track">
                  <div class="hbar-fill" style="width:${pct}%;" title="${escapeHtml(r.label)}: ${escapeHtml(formatted)}"></div>
                </div>
                <div class="hbar-value">${escapeHtml(formatted)}</div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  /** Turn an object of { key: number } into sorted chart rows. */
  function toRows(obj, limit) {
    const rows = Object.entries(obj || {})
      .map(([label, value]) => ({ label, value: Number(value) || 0 }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);
    return limit ? rows.slice(0, limit) : rows;
  }

  function statusDistribution(counts, labels, chips) {
    const entries = Object.entries(counts || {}).filter(([, n]) => n > 0);
    if (entries.length === 0) return `<p class="muted">No records yet.</p>`;
    return `
      <div class="status-dist">
        ${entries
          .sort((a, b) => b[1] - a[1])
          .map(
            ([key, count]) => `
            <div class="status-dist-row">
              <span class="chip ${chips[key] || "chip-slate"}">${escapeHtml(labels[key] || key)}</span>
              <span class="status-dist-count">${count}</span>
            </div>`
          )
          .join("")}
      </div>
    `;
  }

  function render(mount) {
    const suppliers = SAINT.store.supplierStats();
    const contracts = SAINT.contractStore.contractStats();
    const spend = SAINT.spendStore.spendStats();
    const rfp = SAINT.rfpStore.cpoStats();
    const { STATUS_LABELS: CONTRACT_LABELS, STATUS_CHIPS: CONTRACT_CHIPS } = SAINT.contractData;

    const categoryRows = toRows(spend.byCategory, 10);
    const supplierSpendRows = toRows(spend.bySupplier, 10);
    const supplierCategoryRows = toRows(suppliers.byCategory, 10);

    const avgPoValue = spend.totalOrders > 0 ? spend.totalSpend / spend.totalOrders : 0;
    const contractedButUnspent = Math.max(0, contracts.totalValue - spend.totalSpend);

    mount.innerHTML = `
      <p class="page-sub">
        Every figure below is read live from the supplier, contract, spend and RFP modules.
        Nothing here is stored separately — this is a view, not a copy.
      </p>

      <h3 class="section-title">Headline position</h3>
      <div class="kpi-row">
        ${kpi(suppliers.active, "Active suppliers", `${suppliers.total} on the master in total`)}
        ${kpi(contracts.active, "Active contracts", `${contracts.pendingApproval} awaiting approval`)}
        ${kpi(money(spend.totalSpend), "Total committed spend", `across ${spend.totalOrders} purchase order${spend.totalOrders === 1 ? "" : "s"}`)}
        ${kpi(spend.activeOrders, "Active purchase orders", `${spend.draftOrders} still in draft`)}
      </div>

      <div class="kpi-row mt-2">
        ${kpi(money(contracts.totalValue), "Total contracted value", "approved and active contracts")}
        ${kpi(money(contractedButUnspent), "Contracted, not yet committed", "headroom remaining on contracts")}
        ${kpi(money(Math.round(avgPoValue)), "Average purchase order", spend.totalOrders ? "" : "no orders yet")}
        ${kpi(rfp.totalRfps, "RFPs executed", `${rfp.awardedRfps} awarded`)}
      </div>

      <div class="grid grid-2 mt-4">
        <div class="card card-pad report-section">
          <h3 class="section-title" style="margin-top:0;">Spend by category</h3>
          <p class="muted" style="font-size:12px;">Committed value across all live purchase orders.</p>
          ${hbarChart(categoryRows, money)}
          ${
            categoryRows.length > 0
              ? `<p class="muted mt-2" style="font-size:11px;">${categoryRows.length} categor${
                  categoryRows.length === 1 ? "y" : "ies"
                } · ${escapeHtml(money(categoryRows.reduce((s, r) => s + r.value, 0)))} shown</p>`
              : ""
          }
        </div>

        <div class="card card-pad report-section">
          <h3 class="section-title" style="margin-top:0;">Spend by supplier</h3>
          <p class="muted" style="font-size:12px;">Top suppliers by committed purchase order value.</p>
          ${hbarChart(supplierSpendRows, money)}
        </div>

        <div class="card card-pad report-section">
          <h3 class="section-title" style="margin-top:0;">Suppliers by category</h3>
          <p class="muted" style="font-size:12px;">How the supply base is distributed, by count.</p>
          ${hbarChart(supplierCategoryRows, (n) => String(n))}
        </div>

        <div class="card card-pad report-section">
          <h3 class="section-title" style="margin-top:0;">Supplier status</h3>
          <p class="muted" style="font-size:12px;">Lifecycle state across the whole supplier master.</p>
          ${statusDistribution(suppliers.byStatus, SUPPLIER_STATUS_LABELS, SUPPLIER_STATUS_CHIPS)}
          <p class="muted mt-2" style="font-size:11px;">
            ${suppliers.diverse} diverse supplier${suppliers.diverse === 1 ? "" : "s"} ·
            ${suppliers.publicCompanies} publicly listed
          </p>
        </div>

        <div class="card card-pad report-section">
          <h3 class="section-title" style="margin-top:0;">Contract status</h3>
          <p class="muted" style="font-size:12px;">Where contracts sit in the approval workflow.</p>
          ${statusDistribution(contracts.byStatus, CONTRACT_LABELS, CONTRACT_CHIPS)}
          ${
            contracts.nonCompliant > 0
              ? `<div class="flash flash-err mt-2">${contracts.nonCompliant} contract${
                  contracts.nonCompliant === 1 ? " is" : "s are"
                } missing mandatory clauses and cannot be approved.</div>`
              : `<p class="muted mt-2" style="font-size:11px;">All contracts carry their mandatory clauses.</p>`
          }
        </div>

        <div class="card card-pad report-section">
          <h3 class="section-title" style="margin-top:0;">Purchase order status</h3>
          <p class="muted" style="font-size:12px;">Where committed spend sits in the order lifecycle.</p>
          ${statusDistribution(
            SAINT.spendStore
              .listOrders()
              .reduce((acc, p) => {
                acc[p.status] = (acc[p.status] || 0) + 1;
                return acc;
              }, {}),
            SAINT.spendStore.STATUS_LABELS,
            SAINT.spendStore.STATUS_CHIPS
          )}
        </div>
      </div>

      <h3 class="section-title">Spend detail</h3>
      <p class="muted" style="font-size:12px;">The same figures as the charts above, as a table.</p>
      ${
        categoryRows.length === 0
          ? `<div class="card empty mt-2">No purchase orders raised yet, so there is no spend to report.</div>`
          : `<div class="card mt-2" style="overflow:hidden;">
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Category</th><th>Committed spend</th><th>Share of total</th></tr></thead>
                  <tbody>
                    ${categoryRows
                      .map(
                        (r) => `<tr>
                          <td>${escapeHtml(r.label)}</td>
                          <td class="mono">${escapeHtml(money(r.value))}</td>
                          <td>${spend.totalSpend ? ((r.value / spend.totalSpend) * 100).toFixed(1) : "0.0"}%</td>
                        </tr>`
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            </div>`
      }
    `;
  }

  function init() {
    const mount = document.getElementById("reports-mount");
    if (!mount) return;

    const rerender = () => render(mount);

    rerender();
    // Reporting reads from every module, so it refreshes when any of them changes.
    SAINT.store.subscribe(rerender);
    SAINT.contractStore.subscribe(rerender);
    SAINT.spendStore.subscribe(rerender);
    SAINT.rfpStore.subscribe(rerender);
  }

  SAINT.components.reports = { init };
})(window);
