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

    /* ---------------- W-9 upload — Supplier AI Bot ------------------ */

    /**
     * The bot proposes; a person disposes.
     *
     * `analysis` holds the current proposals with their accepted/edited state.
     * Nothing reaches the supplier form until "Apply approved fields" is
     * clicked, and only the rows still ticked are applied — which is what
     * makes this a review gate rather than an autofill with extra steps.
     */
    let analysis = null;
    const reviewMount = document.getElementById("w9-review-mount");

    function confidenceChip(p) {
      const cls =
        p.confidence >= SAINT.w9Bot.CONFIDENCE.HIGH
          ? "chip-emerald"
          : p.confidence >= SAINT.w9Bot.CONFIDENCE.GOOD
          ? "chip-saint"
          : p.confidence >= SAINT.w9Bot.CONFIDENCE.FAIR
          ? "chip-amber"
          : "chip-red";
      return `<span class="chip ${cls}">${escapeHtml(p.confidenceLabel)} · ${Math.round(p.confidence * 100)}%</span>`;
    }

    function renderReview() {
      if (!analysis) {
        reviewMount.innerHTML = "";
        return;
      }

      const warnings = analysis.warnings
        .map((w) => `<div class="flash flash-err" style="margin-top:6px;">${escapeHtml(w)}</div>`)
        .join("");

      if (analysis.proposals.length === 0) {
        reviewMount.innerHTML = `${warnings}`;
        return;
      }

      const acceptedCount = analysis.proposals.filter((p) => p.accepted).length;

      reviewMount.innerHTML = `
        <div class="card card-pad">
          <div class="flex-between" style="flex-wrap:wrap; gap:8px;">
            <div>
              <h4 class="section-title" style="margin:0;">Supplier AI Bot — review before applying</h4>
              <p class="muted" style="font-size:12px; margin:4px 0 0;">
                Read ${escapeHtml(analysis.fileName)} and proposed ${analysis.proposals.length} field${
        analysis.proposals.length === 1 ? "" : "s"
      }.
                Tick what is correct, edit anything that is not, then apply. Nothing is saved until you do.
              </p>
            </div>
            ${confidenceChipSummary()}
          </div>
          ${warnings}

          <div class="table-wrap mt-4">
            <table>
              <thead>
                <tr><th style="width:34px;">Use</th><th>Field</th><th>Proposed value</th><th>Confidence</th><th>Source</th></tr>
              </thead>
              <tbody>
                ${analysis.proposals
                  .map(
                    (p, i) => `
                  <tr>
                    <td><input type="checkbox" data-w9-accept="${i}" ${p.accepted ? "checked" : ""}
                      aria-label="Apply ${escapeHtml(p.label)}" /></td>
                    <td>${escapeHtml(p.label)}</td>
                    <td><input class="input" data-w9-value="${i}" value="${escapeHtml(p.value)}" maxlength="200" /></td>
                    <td>${confidenceChip(p)}</td>
                    <td class="muted" style="font-size:11px;">${escapeHtml(p.source)}</td>
                  </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>

          <div class="mt-4" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <button type="button" class="btn-primary btn-sm" id="w9-apply-btn" ${acceptedCount ? "" : "disabled"}>
              Apply ${acceptedCount} approved field${acceptedCount === 1 ? "" : "s"}
            </button>
            <button type="button" class="btn-ghost btn-sm" id="w9-reject-btn">Discard proposals</button>
            <span class="muted" style="font-size:11px;">
              Low-confidence rows start unticked on purpose — approve them only after checking the document.
            </span>
          </div>
        </div>
      `;
    }

    function confidenceChipSummary() {
      const low = analysis.proposals.filter((p) => p.confidence < SAINT.w9Bot.CONFIDENCE.GOOD).length;
      return low
        ? `<span class="chip chip-amber">${low} need${low === 1 ? "s" : ""} checking</span>`
        : `<span class="chip chip-emerald">All read from the document</span>`;
    }

    w9FileInput.addEventListener("change", async () => {
      const file = w9FileInput.files && w9FileInput.files[0];
      w9Info.style.display = "none";
      w9Draft = null;
      analysis = null;
      renderReview();
      w9AttachedNote.style.display = "none";
      if (!file) {
        w9Status.textContent = "";
        return;
      }

      w9Status.textContent = "Supplier AI Bot is reading the document…";
      try {
        analysis = await SAINT.w9Bot.analyze(file);
        w9Draft = { fileName: analysis.fileName, contentType: analysis.contentType, sizeBytes: analysis.sizeBytes };
        w9AttachedNote.style.display = "";
        w9Status.textContent = "";
        renderReview();
      } catch (err) {
        console.error("W-9 analysis failed", err);
        w9Status.textContent = "";
        w9Info.style.display = "";
        w9Info.style.color = "var(--red-700)";
        w9Info.textContent = "The bot could not read that file. Enter the supplier details manually.";
      }
    });

    // Review interactions are delegated so they survive each re-render.
    reviewMount.addEventListener("change", (e) => {
      const acceptIdx = e.target.dataset && e.target.dataset.w9Accept;
      if (acceptIdx !== undefined && analysis) {
        analysis.proposals[Number(acceptIdx)].accepted = e.target.checked;
        renderReview();
      }
    });

    reviewMount.addEventListener("input", (e) => {
      const valueIdx = e.target.dataset && e.target.dataset.w9Value;
      if (valueIdx !== undefined && analysis) {
        // Store the human's correction without re-rendering, so the caret stays put.
        analysis.proposals[Number(valueIdx)].value = e.target.value;
      }
    });

    reviewMount.addEventListener("click", (e) => {
      if (e.target.id === "w9-reject-btn") {
        analysis = null;
        w9Draft = null;
        w9FileInput.value = "";
        w9AttachedNote.style.display = "none";
        renderReview();
        return;
      }
      if (e.target.id !== "w9-apply-btn" || !analysis) return;

      const applied = [];
      analysis.proposals
        .filter((p) => p.accepted && String(p.value).trim())
        .forEach((p) => {
          const el = document.getElementById(`f-${p.field}`);
          if (!el) return;
          el.value = p.value;
          // A programmatic value change fires no events, so nudge the
          // listeners that depend on these fields (ticker visibility, etc).
          el.dispatchEvent(new Event("change", { bubbles: true }));
          applied.push(p.label);
        });

      w9Info.style.display = "";
      w9Info.style.color = "var(--emerald-700)";
      w9Info.textContent = applied.length
        ? `Applied ${applied.length} approved field${applied.length === 1 ? "" : "s"}: ${applied.join(", ")}. Check the form, then save.`
        : "No fields were approved, so nothing was applied.";
      analysis = null;
      renderReview();
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
