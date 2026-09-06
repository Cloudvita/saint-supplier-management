/**
 * SAINT.components.form — Add Supplier panel.
 *
 * The form markup itself is static HTML (see index.html) and is bound
 * exactly once here; only small, targeted DOM updates happen afterwards
 * (error text, flash banner, risk preview list). This sidesteps the
 * "re-render the whole form → re-attach every listener" leak pattern
 * entirely, and it means typing never fights a re-render.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  SAINT.components = SAINT.components || {};
  const { escapeHtml } = SAINT.utils;
  const { simulateW9Extraction } = SAINT.demoData;

  const FIELD_IDS = [
    "legalName", "dbaName", "taxClassification", "tickerSymbol", "taxIdType", "taxId",
    "contactName", "contactEmail", "contactPhone", "addressLine1", "addressLine2",
    "city", "state", "postalCode", "category", "paymentTerms", "currency", "status",
    "newsCadence", "newsKeywords", "marketNews", "procurementManagerEmail",
  ];

  function init() {
    const form = document.getElementById("supplier-form");
    const flash = document.getElementById("form-flash");
    const w9FileInput = document.getElementById("w9-file");
    const w9Status = document.getElementById("w9-status");
    const w9Info = document.getElementById("w9-info");
    const w9AttachedNote = document.getElementById("w9-attached-note");
    const pullNewsBtn = document.getElementById("pull-news-btn");
    const riskPreviewMount = document.getElementById("risk-preview-mount");
    const saveBtn = document.getElementById("save-supplier-btn");
    const resetBtn = document.getElementById("reset-supplier-btn");
    const tickerField = document.getElementById("ticker-field");

    let w9Draft = null; // { fileName, contentType, sizeBytes } — metadata only, never file bytes

    function clearFieldErrors() {
      form.querySelectorAll("[data-error-for]").forEach((el) => (el.textContent = ""));
    }

    function showFieldErrors(errors) {
      clearFieldErrors();
      Object.entries(errors).forEach(([key, msgs]) => {
        const el = form.querySelector(`[data-error-for="${key}"]`);
        if (el && msgs && msgs[0]) el.textContent = msgs[0];
      });
    }

    function showFlash(kind, msg) {
      flash.innerHTML = `<div class="flash ${kind === "ok" ? "flash-ok" : "flash-err"}">${escapeHtml(msg)}</div>`;
    }

    function clearFlash() {
      flash.innerHTML = "";
    }

    function clearRiskPreview() {
      riskPreviewMount.innerHTML = "";
    }

    function showRiskPreview(events) {
      if (!events || events.length === 0) return clearRiskPreview();
      riskPreviewMount.innerHTML = `
        <div class="risk-preview">
          <p class="risk-preview-title">${events.length} risk event(s) detected (simulated)</p>
          <ul style="margin:0; padding-left:18px;">
            ${events
              .map(
                (r) => `<li><span class="chip chip-amber">${escapeHtml(r.eventType)}</span> <strong>${escapeHtml(r.severity)}</strong> — ${escapeHtml(r.headline)}</li>`
              )
              .join("")}
          </ul>
          <p class="mt-2 muted" style="font-size:11px;">These will be raised as alerts once the supplier is saved and news is refreshed.</p>
        </div>
      `;
    }

    /* -------------------- company type radio -------------------- */
    form.querySelectorAll('input[name="companyType"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        form.querySelectorAll("[data-radio-card]").forEach((card) => {
          card.classList.toggle("checked", card.dataset.radioCard === radio.value);
        });
        tickerField.style.display = radio.value === "PUBLIC" ? "" : "none";
      });
    });

    /* -------------------- ticker uppercase -------------------- */
    const tickerInput = document.getElementById("f-tickerSymbol");
    tickerInput.addEventListener("input", () => {
      const start = tickerInput.selectionStart;
      tickerInput.value = tickerInput.value.toUpperCase();
      tickerInput.setSelectionRange(start, start);
    });

    /* -------------------- W-9 upload (simulated) -------------------- */
    w9FileInput.addEventListener("change", () => {
      const file = w9FileInput.files && w9FileInput.files[0];
      w9Info.style.display = "none";
      w9Draft = null;
      w9AttachedNote.style.display = "none";
      if (!file) {
        w9Status.textContent = "";
        return;
      }

      w9Status.textContent = "Reading file metadata…";
      // setTimeout so the UI can paint the "reading" state — the work itself is
      // metadata-only and effectively instant (see simulateW9Extraction docs).
      setTimeout(() => {
        w9Draft = { fileName: file.name, contentType: file.type || "application/octet-stream", sizeBytes: file.size };
        const result = simulateW9Extraction(file);
        w9Status.textContent = "";
        w9AttachedNote.style.display = "";

        const applied = [];
        Object.entries(result.fields).forEach(([key, value]) => {
          const el = document.getElementById(`f-${key}`);
          if (el && value) {
            el.value = value;
            applied.push(key);
          }
        });

        w9Info.style.display = "";
        w9Info.textContent = applied.length
          ? `Simulated extraction filled ${applied.length} field(s) — this is a demo, not real OCR. Review before saving.`
          : `No fields could be guessed from the file name. Enter details manually.`;
      }, 200);
    });

    /* -------------------- pull news (simulated) -------------------- */
    pullNewsBtn.addEventListener("click", () => {
      const legalName = document.getElementById("f-legalName").value.trim();
      if (!legalName) {
        showFlash("err", "Enter the supplier legal name first.");
        return;
      }
      clearFlash();
      pullNewsBtn.disabled = true;
      pullNewsBtn.textContent = "Pulling…";
      setTimeout(() => {
        const ticker = document.getElementById("f-tickerSymbol").value.trim();
        const keywords = document.getElementById("f-newsKeywords").value.trim();
        const cadence = document.getElementById("f-newsCadence").value;
        const { digest, riskEvents } = SAINT.store.previewNews(legalName, ticker, keywords, cadence);
        document.getElementById("f-marketNews").value = digest;
        showRiskPreview(riskEvents);
        pullNewsBtn.disabled = false;
        pullNewsBtn.textContent = "Pull news";
      }, 300);
    });

    /* -------------------- reset -------------------- */
    // `keepFlash` lets a successful save reset the fields without wiping the
    // "Saved ..." confirmation that was just shown.
    function resetForm({ keepFlash } = {}) {
      form.reset();
      w9Draft = null;
      clearFieldErrors();
      if (!keepFlash) clearFlash();
      clearRiskPreview();
      w9Info.style.display = "none";
      w9Status.textContent = "";
      w9AttachedNote.style.display = "none";
      form.querySelectorAll("[data-radio-card]").forEach((card) => {
        card.classList.toggle("checked", card.dataset.radioCard === "PRIVATE");
      });
      tickerField.style.display = "none";
    }
    resetBtn.addEventListener("click", () => resetForm());

    /* -------------------- submit -------------------- */
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      clearFlash();
      clearFieldErrors();
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";

      const raw = { w9Draft };
      FIELD_IDS.forEach((key) => {
        const el = document.getElementById(`f-${key}`);
        raw[key] = el ? el.value : "";
      });
      raw.companyType = form.querySelector('input[name="companyType"]:checked').value;
      raw.alertsEnabled = document.getElementById("f-alertsEnabled").checked;
      raw.diverseSupplier = document.getElementById("f-diverseSupplier").checked;

      // Yield a tick so the "Saving…" state is visible even though the work is synchronous.
      setTimeout(() => {
        const result = SAINT.store.addSupplier(raw);
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Supplier";

        if (!result.ok) {
          showFieldErrors(result.errors);
          showFlash("err", "Please fix the highlighted fields.");
          return;
        }

        showFlash("ok", `Saved ${result.supplier.supplierCode} — ${result.supplier.legalName}`);
        resetForm({ keepFlash: true });
      }, 150);
    });
  }

  SAINT.components.form = { init };
})(window);
