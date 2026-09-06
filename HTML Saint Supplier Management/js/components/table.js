/**
 * SAINT.components.table — Suppliers panel: search/filter, expandable rows,
 * per-supplier "Refresh" (simulated news pull). Listeners are delegated on
 * the mount container and bound exactly once in init().
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  SAINT.components = SAINT.components || {};
  const { escapeHtml, formatDateTime, debounce } = SAINT.utils;

  const SEVERITY_CHIP = {
    CRITICAL: "chip-critical",
    HIGH: "chip-orange",
    MEDIUM: "chip-amber",
    LOW: "chip-slate",
  };
  const STATUS_CHIP = {
    ACTIVE: "chip-emerald",
    DRAFT: "chip-slate",
    ON_HOLD: "chip-amber",
    BLOCKED: "chip-red",
  };

  // Local UI state — which row is expanded, which row is mid-refresh.
  // Kept outside the store because it's transient view state, not data.
  let expandedId = null;
  let busyId = null;

  function detailRow(s) {
    const alertsHtml =
      s.riskAlerts.length === 0
        ? `<p class="muted">None.</p>`
        : s.riskAlerts
            .map(
              (a) => `
          <li class="alert-mini">
            <span class="chip ${SEVERITY_CHIP[a.severity] || "chip-slate"}">${escapeHtml(a.eventType)} · ${escapeHtml(a.severity)}</span>
            <p style="margin:4px 0 0; font-size:12px;">${escapeHtml(a.title)}</p>
          </li>`
            )
            .join("");

    return `
      <tr class="detail-row">
        <td colspan="9">
          <div class="grid grid-3">
            <div class="col-span-2">
              <div class="muted" style="font-size:11px; font-weight:700; text-transform:uppercase; margin-bottom:4px;">
                Market News (${escapeHtml(s.newsCadence.toLowerCase())})
                ${s.marketNewsUpdated ? `<span style="font-weight:400; text-transform:none;"> — updated ${escapeHtml(formatDateTime(s.marketNewsUpdated))}</span>` : ""}
              </div>
              <pre class="news-pre">${escapeHtml(s.marketNews || "No news pulled yet — click Refresh.")}</pre>
            </div>
            <div>
              <div class="muted" style="font-size:11px; font-weight:700; text-transform:uppercase; margin-bottom:4px;">Open Risk Alerts</div>
              <ul style="list-style:none; margin:0; padding:0;">${alertsHtml}</ul>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  function supplierRow(s) {
    const riskCell =
      s.riskAlerts.length === 0
        ? `<span class="muted" style="font-size:12px;">clear</span>`
        : `<div style="display:flex; flex-wrap:wrap; gap:4px;">${s.riskAlerts
            .slice(0, 2)
            .map(
              (a) =>
                `<span class="chip ${SEVERITY_CHIP[a.severity] || "chip-slate"}" title="${escapeHtml(a.title)}">${escapeHtml(a.eventType)}</span>`
            )
            .join("")}${
            s.riskAlerts.length > 2 ? `<span class="chip chip-slate">+${s.riskAlerts.length - 2}</span>` : ""
          }</div>`;

    const typeChip = s.companyType === "PUBLIC" ? "chip-saint" : "chip-violet";

    return `
      <tr class="row-hover ${s.riskAlerts.length > 0 ? "row-alert" : ""}" data-row-id="${escapeHtml(s.id)}">
        <td class="mono">${escapeHtml(s.supplierCode)}</td>
        <td>
          <button type="button" class="supplier-link" data-action="toggle-row" data-id="${escapeHtml(s.id)}">${escapeHtml(s.legalName)}</button>
          ${s.dbaName ? `<div class="muted" style="font-size:11px;">dba ${escapeHtml(s.dbaName)}</div>` : ""}
        </td>
        <td>
          <span class="chip ${typeChip}">${escapeHtml(s.companyType)}</span>
          ${s.tickerSymbol ? `<span class="mono" style="margin-left:4px;">${escapeHtml(s.tickerSymbol)}</span>` : ""}
        </td>
        <td class="mono">${escapeHtml(s.taxIdMasked)}</td>
        <td>${escapeHtml(s.category || "—")}</td>
        <td>${escapeHtml([s.city, s.state].filter(Boolean).join(", ") || "—")}</td>
        <td><span class="chip ${STATUS_CHIP[s.status] || "chip-slate"}">${escapeHtml(s.status)}</span></td>
        <td>${riskCell}</td>
        <td>
          <button type="button" class="btn-ghost btn-sm" data-action="refresh-news" data-id="${escapeHtml(s.id)}" ${busyId === s.id ? "disabled" : ""}>
            ${busyId === s.id ? "…" : "Refresh"}
          </button>
        </td>
      </tr>
      ${expandedId === s.id ? detailRow(s) : ""}
    `;
  }

  function currentFilters() {
    return {
      q: document.getElementById("supplier-search").value,
      companyType: document.getElementById("supplier-type-filter").value,
    };
  }

  function render(mount, countLine) {
    const { q, companyType } = currentFilters();
    const { rows, total } = SAINT.store.listSuppliers({ q, companyType, limit: 10 });

    countLine.textContent = `Showing ${rows.length} of ${total} record${total === 1 ? "" : "s"}`;

    if (rows.length === 0) {
      mount.innerHTML = `<div class="card empty">No suppliers match. Try clearing the search/filter, or add one from the "Add Supplier" tab.</div>`;
      return;
    }

    mount.innerHTML = `
      <div class="card" style="overflow:hidden;">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th><th>Supplier</th><th>Type</th><th>Tax ID</th><th>Category</th>
                <th>Location</th><th>Status</th><th>Risk</th><th>News</th>
              </tr>
            </thead>
            <tbody>${rows.map(supplierRow).join("")}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  function init() {
    const mount = document.getElementById("suppliers-mount");
    const countLine = document.getElementById("supplier-count-line");
    const searchInput = document.getElementById("supplier-search");
    const typeFilter = document.getElementById("supplier-type-filter");

    const rerender = () => render(mount, countLine);

    mount.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn || !mount.contains(btn)) return;
      const id = btn.dataset.id;

      if (btn.dataset.action === "toggle-row") {
        expandedId = expandedId === id ? null : id;
        rerender();
      } else if (btn.dataset.action === "refresh-news") {
        busyId = id;
        rerender();
        // Yield a tick so the disabled "…" state paints before the (synchronous,
        // simulated) refresh runs — mirrors the async feel of a real network call.
        setTimeout(() => {
          SAINT.store.refreshSupplierNews(id);
          expandedId = id;
          busyId = null;
          // store.refreshSupplierNews() already notifies subscribers, which
          // calls rerender() — but do it explicitly too in case notify order changes.
          rerender();
        }, 150);
      }
    });

    searchInput.addEventListener("input", debounce(rerender, 200));
    typeFilter.addEventListener("change", rerender);

    rerender();
    SAINT.store.subscribe(rerender);
  }

  SAINT.components.table = { init };
})(window);
