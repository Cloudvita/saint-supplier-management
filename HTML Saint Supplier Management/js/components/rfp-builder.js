/**
 * SAINT.components.rfpBuilder — RFP Step 2: 10-question intake, simulated
 * document generation, and dispatch to selected vendors from the directory.
 *
 * The intake questionnaire is intentionally NOT persisted to localStorage —
 * like the Add Supplier form, it's a working draft; only a *dispatched* RFP
 * (Step 2's "Send" action) becomes a durable record via rfpStore.createRfp().
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  SAINT.components = SAINT.components || {};
  const { escapeHtml } = SAINT.utils;
  const { INTAKE_QUESTIONS, DEFAULT_INTAKE, generateMockRfp } = SAINT.rfpData;

  const RESET_INTAKE = {
    q1_outcomes: "List minimum or top 3 outcomes/objectives of the RFP program.",
    q2_scope: "",
    q3_tech: "",
    q4_timeline: "",
    q5_budget: "",
    q6_sla: "",
    q7_security: "",
    q8_support: "",
    q9_qualifications: "",
    q10_pricing: "",
  };

  function buildIntakeGrid(container) {
    container.innerHTML = INTAKE_QUESTIONS.map(([key, label]) => {
      const val = DEFAULT_INTAKE[key] || "";
      return `
        <div>
          <label class="label" for="rfp-q-${key}">
            ${escapeHtml(label)}
            <span class="charcount" data-charcount-for="${key}">${val.length}/200</span>
          </label>
          <textarea class="input" id="rfp-q-${key}" data-intake-key="${key}" maxlength="200" rows="3">${escapeHtml(val)}</textarea>
        </div>
      `;
    }).join("");
  }

  function readIntake() {
    const intake = {};
    INTAKE_QUESTIONS.forEach(([key]) => {
      const el = document.getElementById(`rfp-q-${key}`);
      intake[key] = el ? el.value : "";
    });
    return intake;
  }

  function applyIntake(intake) {
    INTAKE_QUESTIONS.forEach(([key]) => {
      const el = document.getElementById(`rfp-q-${key}`);
      const counter = document.querySelector(`[data-charcount-for="${key}"]`);
      if (el) el.value = intake[key] || "";
      if (counter) counter.textContent = `${(intake[key] || "").length}/200`;
    });
  }

  function vendorCheckCard(v) {
    return `
      <label class="vendor-check-card">
        <input type="checkbox" data-vendor-id="${escapeHtml(v.id)}" ${v.selected ? "checked" : ""} />
        <span><strong>${escapeHtml(v.name)}</strong><br />POC: ${escapeHtml(v.poc)} (${escapeHtml(v.email)})</span>
      </label>
    `;
  }

  function init() {
    const titleInput = document.getElementById("rfp-title");
    const intakeGrid = document.getElementById("rfp-intake-grid");
    const generateBtn = document.getElementById("rfp-generate-btn");
    const generateStatus = document.getElementById("rfp-generate-status");
    const previewMount = document.getElementById("rfp-preview-mount");
    const dispatchSection = document.getElementById("rfp-dispatch-section");
    const dispatchVendorList = document.getElementById("rfp-dispatch-vendor-list");
    const dispatchBtn = document.getElementById("rfp-dispatch-btn");
    const dispatchFlash = document.getElementById("rfp-dispatch-flash");
    const resetIntakeBtn = document.getElementById("rfp-reset-intake-btn");
    const saveIntakeBtn = document.getElementById("rfp-save-intake-btn");
    const resetRunBtn = document.getElementById("rfp-reset-run-btn");

    let generatedRfpText = "";

    buildIntakeGrid(intakeGrid);

    intakeGrid.addEventListener("input", (e) => {
      const el = e.target.closest("[data-intake-key]");
      if (!el) return;
      const counter = document.querySelector(`[data-charcount-for="${el.dataset.intakeKey}"]`);
      if (counter) {
        counter.textContent = `${el.value.length}/200`;
        counter.classList.toggle("limit-near", el.value.length >= 180);
      }
    });

    saveIntakeBtn.addEventListener("click", () => {
      generateStatus.innerHTML = `<div class="flash flash-ok">RFP intake responses saved for this session.</div>`;
    });

    resetIntakeBtn.addEventListener("click", () => {
      applyIntake(RESET_INTAKE);
      generatedRfpText = "";
      previewMount.innerHTML = "";
      dispatchSection.style.display = "none";
      generateStatus.innerHTML = `<div class="flash flash-ok">Intake form reset.</div>`;
    });

    function renderPreview() {
      previewMount.innerHTML = `
        <div class="card card-pad">
          <h3 class="section-title" style="margin-top:0;">Generated Document Preview</h3>
          <pre class="news-pre">${escapeHtml(generatedRfpText)}</pre>
        </div>
      `;
    }

    function renderDispatchVendors() {
      const vendors = SAINT.rfpStore.listVendors();
      if (vendors.length === 0) {
        dispatchVendorList.innerHTML = `<p class="muted col-span-3">No vendors found in the directory. Add vendors in Step 1 first.</p>`;
        return;
      }
      dispatchVendorList.innerHTML = vendors.map(vendorCheckCard).join("");
    }

    generateBtn.addEventListener("click", () => {
      generateBtn.disabled = true;
      generateBtn.textContent = "Generating…";
      generateStatus.innerHTML = "";
      setTimeout(() => {
        const intake = readIntake();
        generatedRfpText = generateMockRfp(intake, titleInput.value.trim());
        generateBtn.disabled = false;
        generateBtn.textContent = "Generate Formal RFP Document";
        generateStatus.innerHTML = `<div class="flash flash-ok">Generated using the simulated mock engine (no live LLM call in this static build).</div>`;
        renderPreview();
        renderDispatchVendors();
        dispatchSection.style.display = "";
        dispatchFlash.innerHTML = "";
      }, 350);
    });

    dispatchBtn.addEventListener("click", () => {
      const vendors = SAINT.rfpStore.listVendors();
      const checkedIds = Array.from(dispatchVendorList.querySelectorAll("input[type=checkbox]:checked")).map(
        (el) => el.dataset.vendorId
      );
      const dispatchedVendors = vendors.filter((v) => checkedIds.includes(v.id));

      const result = SAINT.rfpStore.createRfp({
        title: titleInput.value.trim(),
        rfpText: generatedRfpText,
        dispatchedVendors,
      });

      if (!result.ok) {
        dispatchFlash.innerHTML = `<div class="flash flash-err">${escapeHtml(result.error)}</div>`;
        return;
      }

      dispatchFlash.innerHTML = `<div class="flash flash-ok">RFP "${escapeHtml(result.rfp.title)}" (${escapeHtml(result.rfp.id)}) dispatched to ${result.rfp.dispatchedVendors.length} vendor(s)! Continue to Step 3 to evaluate responses.</div>`;
      generatedRfpText = "";
      previewMount.innerHTML = "";
      dispatchSection.style.display = "none";
    });

    resetRunBtn.addEventListener("click", () => {
      generatedRfpText = "";
      previewMount.innerHTML = "";
      dispatchSection.style.display = "none";
      dispatchFlash.innerHTML = "";
      titleInput.value = "New Enterprise Solution RFP";
      generateStatus.innerHTML = `<div class="flash flash-ok">Session reset for a new RFP run.</div>`;
    });
  }

  SAINT.components.rfpBuilder = { init };
})(window);
