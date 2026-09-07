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
  let editingId = null;
  let editErrors = {};
  let flash = null;

  const STATUSES = ["DRAFT", "ACTIVE", "ON_HOLD", "BLOCKED"];
  const CADENCES = ["DAILY", "WEEKLY", "MONTHLY"];
  const TERMS = ["NET15", "NET30", "NET45", "NET60", "NET90", "DUE_ON_RECEIPT"];

  function err(name) {
    return editErrors[name] ? `<p class="field-error">${escapeHtml(editErrors[name])}</p>` : "";
  }

  /**
   * Inline edit form for one supplier.
   *
   * Deliberately a subset of the full onboarding form: the fields a buyer
   * actually maintains after onboarding. The tax ID is intentionally
   * write-only — only the last 4 digits are ever stored, so there is nothing
   * to pre-fill, and leaving it blank keeps what is already held.
   */
  function editForm(s) {
    return `
      <tr class="detail-row">
        <td colspan="9">
          <form class="card card-pad" data-edit-form="${escapeHtml(s.id)}" novalidate>
            <h4 class="section-title" style="margin-top:0;">Edit ${escapeHtml(s.supplierCode)} — ${escapeHtml(s.legalName)}</h4>
            <div class="grid grid-4 mt-2">
              <div class="col-span-2">
                <label class="label">Legal name *</label>
                <input class="input" name="legalName" maxlength="200" value="${escapeHtml(s.legalName)}" required />
                ${err("legalName")}
              </div>
              <div class="col-span-2">
                <label class="label">Business / DBA name</label>
                <input class="input" name="dbaName" maxlength="200" value="${escapeHtml(s.dbaName || "")}" />
              </div>

              <div>
                <label class="label">Company type</label>
                <select class="input" name="companyType">
                  <option value="PRIVATE" ${s.companyType === "PRIVATE" ? "selected" : ""}>PRIVATE</option>
                  <option value="PUBLIC" ${s.companyType === "PUBLIC" ? "selected" : ""}>PUBLIC</option>
                </select>
              </div>
              <div>
                <label class="label">Ticker</label>
                <input class="input" name="tickerSymbol" maxlength="12" value="${escapeHtml(s.tickerSymbol || "")}" style="text-transform:uppercase;" />
                ${err("tickerSymbol")}
              </div>
              <div>
                <label class="label">Status</label>
                <select class="input" name="status">
                  ${STATUSES.map((x) => `<option value="${x}" ${x === s.status ? "selected" : ""}>${x}</option>`).join("")}
                </select>
              </div>
              <div>
                <label class="label">Category</label>
                <input class="input" name="category" maxlength="120" value="${escapeHtml(s.category || "")}" />
              </div>

              <div>
                <label class="label">Contact name</label>
                <input class="input" name="contactName" maxlength="120" value="${escapeHtml(s.contactName || "")}" />
              </div>
              <div>
                <label class="label">Contact email</label>
                <input class="input" type="email" name="contactEmail" maxlength="200" value="${escapeHtml(s.contactEmail || "")}" />
                ${err("contactEmail")}
              </div>
              <div>
                <label class="label">Contact phone</label>
                <input class="input" name="contactPhone" maxlength="40" value="${escapeHtml(s.contactPhone || "")}" />
              </div>
              <div>
                <label class="label">Payment terms</label>
                <select class="input" name="paymentTerms">
                  ${TERMS.map((x) => `<option value="${x}" ${x === s.paymentTerms ? "selected" : ""}>${x.replace(/_/g, " ")}</option>`).join("")}
                </select>
              </div>

              <div>
                <label class="label">City</label>
                <input class="input" name="city" maxlength="100" value="${escapeHtml(s.city || "")}" />
              </div>
              <div>
                <label class="label">State</label>
                <input class="input" name="state" maxlength="60" value="${escapeHtml(s.state || "")}" />
              </div>
              <div>
                <label class="label">Postal code</label>
                <input class="input" name="postalCode" maxlength="20" value="${escapeHtml(s.postalCode || "")}" />
              </div>
              <div>
                <label class="label">News cadence</label>
                <select class="input" name="newsCadence">
                  ${CADENCES.map((x) => `<option value="${x}" ${x === s.newsCadence ? "selected" : ""}>${x}</option>`).join("")}
                </select>
              </div>

              <div class="col-span-2">
                <label class="label">Tax ID (leave blank to keep ${escapeHtml(s.taxIdMasked || "the stored value")})</label>
                <input class="input" name="taxId" maxlength="11" placeholder="12-3456789" />
                ${err("taxId")}
              </div>
              <div>
                <label class="label">Tax ID type</label>
                <select class="input" name="taxIdType">
                  <option value="EIN" ${s.taxIdType === "EIN" ? "selected" : ""}>EIN</option>
                  <option value="SSN" ${s.taxIdType === "SSN" ? "selected" : ""}>SSN</option>
                </select>
              </div>
              <div>
                <label class="label">Procurement manager email</label>
                <input class="input" type="email" name="procurementManagerEmail" maxlength="200" value="${escapeHtml(s.procurementManagerEmail || "")}" />
                ${err("procurementManagerEmail")}
              </div>
            </div>

            <div class="mt-4" style="display:flex; gap:8px;">
              <button type="submit" class="btn-primary btn-sm">Save changes</button>
              <button type="button" class="btn-ghost btn-sm" data-action="cancel-edit">Cancel</button>
            </div>
          </form>
        </td>
      </tr>
    `;
  }

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

              <div class="mt-4" style="display:flex; gap:8px; flex-wrap:wrap;">
                ${
                  SAINT.adminStore.can("suppliers:write")
                    ? `<button type="button" class="btn-ghost btn-sm" data-action="edit-supplier" data-id="${escapeHtml(s.id)}">Edit supplier</button>`
                    : ""
                }
                ${
                  SAINT.adminStore.can("suppliers:delete")
                    ? `<button type="button" class="btn-ghost btn-sm" data-action="remove-supplier" data-id="${escapeHtml(s.id)}">Remove</button>`
                    : ""
                }
              </div>
              ${
                !SAINT.adminStore.can("suppliers:write")
                  ? `<p class="muted" style="font-size:11px;">Your role cannot edit suppliers.</p>`
                  : ""
              }
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
      ${editingId === s.id ? editForm(s) : expandedId === s.id ? detailRow(s) : ""}
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
      const emptyFlash = flash
        ? `<div class="flash ${flash.kind === "ok" ? "flash-ok" : "flash-err"}" role="status">${escapeHtml(flash.text)}</div>`
        : "";
      mount.innerHTML = `${emptyFlash}<div class="card empty">No suppliers match. Try clearing the search/filter, or add one from the "Add Supplier" tab.</div>`;
      return;
    }

    const flashHtml = flash
      ? `<div class="flash ${flash.kind === "ok" ? "flash-ok" : "flash-err"}" role="status">${escapeHtml(flash.text)}</div>`
      : "";

    mount.innerHTML = `
      ${flashHtml}
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
        editingId = null;
        flash = null;
        rerender();
      } else if (btn.dataset.action === "edit-supplier") {
        editingId = id;
        expandedId = id;
        editErrors = {};
        flash = null;
        rerender();
      } else if (btn.dataset.action === "cancel-edit") {
        editingId = null;
        editErrors = {};
        rerender();
      } else if (btn.dataset.action === "remove-supplier") {
        const s = SAINT.store.getSupplier(id);
        if (!s) return;
        // Removing a supplier also drops its alerts, and any contract that
        // references it would be left orphaned — say so before doing it.
        const contractCount = SAINT.contractStore
          ? SAINT.contractStore.listContracts({ supplierId: id }).length
          : 0;
        const warning = contractCount
          ? `\n\nWarning: ${contractCount} contract${contractCount === 1 ? "" : "s"} reference this supplier and will be left orphaned.`
          : "";
        if (!global.confirm(`Remove ${s.supplierCode} — ${s.legalName}?\n\nThis also clears its risk alerts and cannot be undone.${warning}`)) return;
        const result = SAINT.store.removeSupplier(id);
        flash = result.ok
          ? { kind: "ok", text: `${result.removed.supplierCode} — ${result.removed.legalName} removed.` }
          : { kind: "err", text: result.error };
        expandedId = null;
        editingId = null;
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

    mount.addEventListener("submit", (e) => {
      const form = e.target.closest("[data-edit-form]");
      if (!form) return;
      e.preventDefault();

      const id = form.dataset.editForm;
      const get = (name) => (form.elements[name] ? form.elements[name].value : "");
      const existing = SAINT.store.getSupplier(id);
      if (!existing) return;

      const result = SAINT.store.updateSupplier(id, {
        legalName: get("legalName"),
        dbaName: get("dbaName"),
        companyType: get("companyType"),
        tickerSymbol: get("tickerSymbol"),
        // Not exposed in the inline form — carry the stored values forward so
        // validation sees a complete record rather than blanking them.
        taxClassification: existing.taxClassification,
        taxIdType: get("taxIdType"),
        taxId: get("taxId"),
        contactName: get("contactName"),
        contactEmail: get("contactEmail"),
        contactPhone: get("contactPhone"),
        website: existing.website,
        addressLine1: existing.addressLine1,
        addressLine2: existing.addressLine2,
        city: get("city"),
        state: get("state"),
        postalCode: get("postalCode"),
        country: existing.country,
        category: get("category"),
        paymentTerms: get("paymentTerms"),
        currency: existing.currency,
        status: get("status"),
        diverseSupplier: existing.diverseSupplier,
        newsCadence: get("newsCadence"),
        marketNews: existing.marketNews,
        newsKeywords: existing.newsKeywords,
        alertsEnabled: existing.alertsEnabled,
        procurementManagerEmail: get("procurementManagerEmail"),
      });

      if (!result.ok) {
        editErrors = result.errors || {};
        flash = { kind: "err", text: "Fix the highlighted fields." };
      } else {
        editErrors = {};
        editingId = null;
        flash = { kind: "ok", text: `${result.supplier.supplierCode} updated.` };
      }
      rerender();
    });

    searchInput.addEventListener("input", debounce(rerender, 200));
    typeFilter.addEventListener("change", rerender);

    rerender();
    SAINT.store.subscribe(rerender);
    // Permissions decide whether Edit/Remove are offered, so a sign-in or
    // role change has to re-render the rows too.
    SAINT.adminStore.subscribe(rerender);
  }

  SAINT.components.table = { init };
})(window);
