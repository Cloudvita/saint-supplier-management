/**
 * SAINT.components.rfpVendors — RFP Step 1: candidate vendor directory.
 * Add-vendor form is static markup bound once; the roster grid is
 * re-rendered from the store with delegated listeners (commit-on-change
 * for text fields so re-render never fights an in-progress keystroke).
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  SAINT.components = SAINT.components || {};
  const { escapeHtml } = SAINT.utils;

  function vendorCard(v) {
    return `
      <div class="vendor-card" data-vendor-id="${escapeHtml(v.id)}">
        <h4>🏢 ${escapeHtml(v.name)} ${v.sourceSupplierId ? '<span class="chip chip-saint" style="font-weight:600;">from Suppliers</span>' : ""}</h4>
        <label class="label">Vendor Name</label>
        <input class="input" data-field="name" data-vendor-id="${escapeHtml(v.id)}" value="${escapeHtml(v.name)}" maxlength="200" />
        <label class="label">Point of Contact</label>
        <input class="input" data-field="poc" data-vendor-id="${escapeHtml(v.id)}" value="${escapeHtml(v.poc)}" maxlength="200" />
        <label class="label">Contact Email</label>
        <input class="input" type="email" data-field="email" data-vendor-id="${escapeHtml(v.id)}" value="${escapeHtml(v.email)}" maxlength="200" />
        <label class="checkbox-row mt-2">
          <input type="checkbox" data-field="selected" data-vendor-id="${escapeHtml(v.id)}" ${v.selected ? "checked" : ""} />
          Active Distribution Target
        </label>
        <button type="button" class="btn-ghost btn-sm mt-2" data-action="remove-vendor" data-id="${escapeHtml(v.id)}">Remove</button>
      </div>
    `;
  }

  function render(mount) {
    const vendors = SAINT.rfpStore.listVendors();
    const activeCount = vendors.filter((v) => v.selected).length;

    if (vendors.length === 0) {
      mount.innerHTML = `<div class="card empty">No vendors currently registered. Use the form above to add vendor records.</div>`;
      return;
    }

    mount.innerHTML = `
      <div class="grid grid-3">${vendors.map(vendorCard).join("")}</div>
      <p class="note mt-4">Directory summary: ${vendors.length} total vendor(s) registered (${activeCount} selected for active RFP distribution).</p>
    `;
  }

  /* ------------------ Import from Suppliers ------------------ */

  function importCandidateCard(supplier) {
    const hasEmail = Boolean(supplier.contactEmail);
    return `
      <label class="vendor-check-card ${hasEmail ? "" : "disabled"}">
        <input type="checkbox" data-supplier-id="${escapeHtml(supplier.id)}" ${hasEmail ? "" : "disabled"} />
        <span>
          <strong>${escapeHtml(supplier.legalName)}</strong> <span class="mono">${escapeHtml(supplier.supplierCode)}</span><br />
          ${supplier.contactName ? escapeHtml(supplier.contactName) + " — " : ""}${hasEmail ? escapeHtml(supplier.contactEmail) : ""}
          ${hasEmail ? "" : `<span class="import-note">No contact email on file — add one on the Suppliers tab first.</span>`}
        </span>
      </label>
    `;
  }

  function renderImportPicker(mount, countLabel) {
    const { rows: suppliers } = SAINT.store.listSuppliers({ limit: 1000 });
    const imported = SAINT.rfpStore.importedSupplierIds();
    const candidates = suppliers.filter((s) => !imported.has(s.id));

    if (suppliers.length === 0) {
      mount.innerHTML = `<p class="muted">No suppliers on file yet — add some on the Suppliers tab first.</p>`;
      countLabel.textContent = "";
      return;
    }
    if (candidates.length === 0) {
      mount.innerHTML = `<p class="muted">All current suppliers have already been imported as RFP vendors.</p>`;
      countLabel.textContent = "";
      return;
    }

    mount.innerHTML = `<div class="supplier-import-grid">${candidates.map(importCandidateCard).join("")}</div>`;
    countLabel.textContent = "";
  }

  function init() {
    const mount = document.getElementById("rfp-vendor-roster-mount");
    const rerender = () => render(mount);

    /* -------------------- add vendor -------------------- */
    const form = document.getElementById("rfp-add-vendor-form");
    const flash = document.getElementById("rfp-vendor-form-flash");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const nameEl = document.getElementById("rv-name");
      const pocEl = document.getElementById("rv-poc");
      const emailEl = document.getElementById("rv-email");

      const result = SAINT.rfpStore.addVendor({ name: nameEl.value, poc: pocEl.value, email: emailEl.value });
      if (!result.ok) {
        flash.innerHTML = `<div class="flash flash-err">${escapeHtml(result.error)}</div>`;
        return;
      }
      flash.innerHTML = `<div class="flash flash-ok">Vendor "${escapeHtml(result.vendor.name)}" successfully added!</div>`;
      form.reset();
    });

    /* -------------------- roster grid (delegated) -------------------- */
    mount.addEventListener("change", (e) => {
      const el = e.target.closest("[data-vendor-id][data-field]");
      if (!el || !mount.contains(el)) return;
      const id = el.dataset.vendorId;
      const field = el.dataset.field;
      const value = field === "selected" ? el.checked : el.value;
      SAINT.rfpStore.updateVendor(id, { [field]: value });
    });

    mount.addEventListener("click", (e) => {
      const btn = e.target.closest('[data-action="remove-vendor"]');
      if (!btn || !mount.contains(btn)) return;
      const card = btn.closest(".vendor-card");
      const nameInput = card ? card.querySelector('input[data-field="name"]') : null;
      const name = nameInput ? nameInput.value : "this vendor";
      if (!global.confirm(`Remove ${name} from the vendor directory? This can't be undone.`)) return;
      SAINT.rfpStore.removeVendor(btn.dataset.id);
    });

    rerender();
    SAINT.rfpStore.subscribe(rerender);

    /* -------------------- import from suppliers -------------------- */
    const importMount = document.getElementById("rfp-import-suppliers-mount");
    const importBtn = document.getElementById("rfp-import-suppliers-btn");
    const importCountLabel = document.getElementById("rfp-import-selected-count");
    const importFlash = document.getElementById("rfp-import-flash");

    const rerenderImportPicker = () => renderImportPicker(importMount, importCountLabel);

    importMount.addEventListener("change", () => {
      const checked = importMount.querySelectorAll("input[type=checkbox]:checked").length;
      importCountLabel.textContent = checked > 0 ? `${checked} supplier(s) selected` : "";
    });

    importBtn.addEventListener("click", () => {
      const checkedIds = Array.from(importMount.querySelectorAll("input[type=checkbox]:checked")).map(
        (el) => el.dataset.supplierId
      );
      if (checkedIds.length === 0) {
        importFlash.innerHTML = `<div class="flash flash-err">Select at least one supplier to import.</div>`;
        return;
      }

      let added = 0;
      checkedIds.forEach((id) => {
        const supplier = SAINT.store.getSupplier(id);
        if (!supplier || !supplier.contactEmail) return;
        const result = SAINT.rfpStore.addVendor({
          name: supplier.dbaName ? `${supplier.legalName} (${supplier.dbaName})` : supplier.legalName,
          poc: supplier.contactName || "Procurement Contact",
          email: supplier.contactEmail,
          sourceSupplierId: supplier.id,
        });
        if (result.ok) added += 1;
      });

      importFlash.innerHTML =
        added > 0
          ? `<div class="flash flash-ok">Added ${added} supplier(s) to the RFP vendor directory — see the roster below.</div>`
          : `<div class="flash flash-err">Nothing was imported — check the selected suppliers have a contact email on file.</div>`;
      importCountLabel.textContent = "";
    });

    rerenderImportPicker();
    SAINT.rfpStore.subscribe(rerenderImportPicker);
    SAINT.store.subscribe(rerenderImportPicker);
  }

  SAINT.components.rfpVendors = { init };
})(window);
