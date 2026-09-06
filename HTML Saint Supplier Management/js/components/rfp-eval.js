/**
 * SAINT.components.rfpEval — RFP Step 3: pick a dispatched RFP, weight the
 * 8 evaluation parameters, score each vendor, and review the ranked result.
 * No charting library is loaded (this build has zero external dependencies)
 * — the comparison chart is plain divs sized by inline style, not canvas/SVG.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  SAINT.components = SAINT.components || {};
  const { escapeHtml } = SAINT.utils;
  const { DEFAULT_PARAMETERS } = SAINT.rfpData;

  const CHART_COLORS = ["#0d9488", "#6d28d9", "#b45309", "#0369a1", "#be123c", "#4d7c0f"];

  // Local UI state — which RFP/vendor tab is open, whether the weights panel
  // is expanded. Transient view state, not store data.
  let selectedRfpId = null;
  let activeVendorTab = 0;
  let weightsExpanded = false;

  function weightSlidersHtml(weights) {
    return DEFAULT_PARAMETERS.map((p) => {
      const raw = Math.max(1, Math.min(50, Math.round((weights[p] || 0.1) * 100)));
      return `
        <div>
          <label class="label">${escapeHtml(p)} <span class="mono" data-weight-display="${escapeHtml(p)}">${raw}</span></label>
          <input type="range" min="1" max="50" step="1" value="${raw}" data-weight-param="${escapeHtml(p)}" style="width:100%;" />
        </div>
      `;
    }).join("");
  }

  function scoreSlidersHtml(rfpId, row, weights) {
    return DEFAULT_PARAMETERS.map((p) => {
      const val = row.params[p] || 5;
      const weightPct = ((weights[p] || 0) * 100).toFixed(1);
      return `
        <div class="score-slider-row">
          <label>${escapeHtml(p)} <span class="mono">(${weightPct}%)</span></label>
          <input type="range" min="1" max="10" step="1" value="${val}"
                 data-score-param="${escapeHtml(p)}" data-vendor="${escapeHtml(row.vendor)}" />
          <span class="score-val" data-score-display="${escapeHtml(p)}|${escapeHtml(row.vendor)}">${val}</span>
        </div>
      `;
    }).join("");
  }

  function chartHtml(ranked) {
    const bars = ranked
      .map((r, vIdx) => {
        const color = CHART_COLORS[vIdx % CHART_COLORS.length];
        const barsForVendor = DEFAULT_PARAMETERS.map((p) => {
          const h = Math.round(((r.params[p] || 0) / 10) * 140);
          return `<div class="chart-bar" style="height:${h}px; background:${color};" title="${escapeHtml(p)}: ${escapeHtml(String(r.params[p] || 0))}/10"></div>`;
        }).join("");
        return `
          <div class="chart-group">
            <div class="chart-bars">${barsForVendor}</div>
            <div class="chart-group-label">${escapeHtml(r.vendor)}</div>
          </div>
        `;
      })
      .join("");

    const legend = ranked
      .map(
        (r, vIdx) =>
          `<span><span class="chart-legend-swatch" style="background:${CHART_COLORS[vIdx % CHART_COLORS.length]};"></span>${escapeHtml(r.vendor)}</span>`
      )
      .join("");

    return `
      <div class="chart-wrap">${bars}</div>
      <div class="chart-legend">${legend}</div>
      <p class="muted mt-2" style="font-size:11px;">Each group shows all 8 parameters (1-10 scale) for one vendor.</p>
    `;
  }

  function render(mount) {
    const rfps = SAINT.rfpStore.listRfps();

    if (rfps.length === 0) {
      mount.innerHTML = `<div class="card empty">No RFP has been dispatched yet. Build and send one from Step 2 first.</div>`;
      return;
    }

    if (!selectedRfpId || !rfps.some((r) => r.id === selectedRfpId)) {
      selectedRfpId = rfps[0].id;
      activeVendorTab = 0;
    }
    const rfp = SAINT.rfpStore.getRfp(selectedRfpId);
    const weights = SAINT.rfpStore.getWeights();

    if (activeVendorTab >= rfp.scoreRows.length) activeVendorTab = 0;
    const activeRow = rfp.scoreRows[activeVendorTab];
    const ranked = SAINT.rfpStore.computeWeightedScores(rfp.id);
    const winner = ranked[0];

    mount.innerHTML = `
      <h3 class="section-title" style="margin-top:0;">1. Select RFP to Evaluate</h3>
      <select class="input" id="rfp-eval-select" style="max-width:480px;">
        ${rfps.map((r) => `<option value="${escapeHtml(r.id)}" ${r.id === rfp.id ? "selected" : ""}>${escapeHtml(r.id)} — ${escapeHtml(r.title)} (${escapeHtml(new Date(r.createdAt).toLocaleDateString())})</option>`).join("")}
      </select>
      <p class="note mt-2">Evaluating <strong>${escapeHtml(rfp.title)}</strong> — dispatched vendors: ${escapeHtml(rfp.dispatchedVendors.join(", "))}</p>

      <h3 class="section-title">2. Vendor Scoring Grid &amp; Evaluator Rationale</h3>
      <div class="card card-pad">
        <button type="button" class="btn-ghost btn-sm" id="rfp-toggle-weights">${weightsExpanded ? "Hide" : "Configure"} Evaluation Parameter Weights</button>
        ${weightsExpanded ? `<div class="grid grid-4 mt-4" id="rfp-weight-grid">${weightSlidersHtml(weights)}</div>` : ""}

        <div class="vendor-eval-tabs mt-4">
          ${rfp.scoreRows
            .map(
              (row, i) =>
                `<button type="button" class="vendor-eval-tab-btn" data-vendor-tab="${i}" aria-pressed="${i === activeVendorTab}">🏢 ${escapeHtml(row.vendor)}</button>`
            )
            .join("")}
        </div>

        <div id="rfp-active-vendor-panel">
          <h4 style="margin:0 0 10px; font-size:13px;">Quantitative Scoring &amp; Notes for ${escapeHtml(activeRow.vendor)}</h4>
          <div class="grid grid-2">${scoreSlidersHtml(rfp.id, activeRow, weights)}</div>
          <label class="label mt-2">Qualitative Evaluator Notes &amp; Rationale</label>
          <textarea class="input" id="rfp-notes-field" data-vendor="${escapeHtml(activeRow.vendor)}" rows="3">${escapeHtml(activeRow.notes)}</textarea>
        </div>
      </div>

      <h3 class="section-title">3. Consolidated Decision Analytics &amp; Recommendation</h3>
      <div class="winner-card">
        <h3>🏆 Top Recommended Vendor: ${escapeHtml(winner.vendor)}</h3>
        <p><strong>Overall Score:</strong> ${winner.weightedScore.toFixed(2)} / 10.0</p>
        <p><em>Notes: "${escapeHtml(winner.notes || "Top scores across key parameters.")}"</em></p>
      </div>
      <button type="button" class="btn-primary" id="rfp-save-eval-btn">Save Final Evaluation to RFP History</button>
      <div id="rfp-save-eval-flash" class="mt-2" role="status" aria-live="polite"></div>

      <h4 class="section-title">Consolidated Score Table</h4>
      <div class="card" style="overflow:hidden;">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Vendor</th>${DEFAULT_PARAMETERS.map((p) => `<th>${escapeHtml(p)}</th>`).join("")}<th>Weighted Total</th></tr></thead>
            <tbody>
              ${ranked
                .map(
                  (r) => `
                <tr>
                  <td><strong>${escapeHtml(r.vendor)}</strong></td>
                  ${DEFAULT_PARAMETERS.map((p) => `<td>${escapeHtml(String(r.params[p] || "—"))}</td>`).join("")}
                  <td><strong>${r.weightedScore.toFixed(2)}</strong></td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>

      <h4 class="section-title">Score Visualization</h4>
      <div class="card card-pad">${chartHtml(ranked)}</div>
    `;
  }

  function init() {
    const mount = document.getElementById("rfp-eval-mount");
    const rerender = () => render(mount);

    mount.addEventListener("change", (e) => {
      const select = e.target.closest("#rfp-eval-select");
      if (select) {
        selectedRfpId = select.value;
        activeVendorTab = 0;
        rerender();
        return;
      }

      const weightSlider = e.target.closest("[data-weight-param]");
      if (weightSlider) {
        const raw = {};
        mount.querySelectorAll("[data-weight-param]").forEach((el) => {
          raw[el.dataset.weightParam] = Number(el.value);
        });
        SAINT.rfpStore.setWeights(raw);
        return;
      }

      const scoreSlider = e.target.closest("[data-score-param]");
      if (scoreSlider) {
        SAINT.rfpStore.updateScoreRow(selectedRfpId, scoreSlider.dataset.vendor, {
          param: scoreSlider.dataset.scoreParam,
          value: Number(scoreSlider.value),
        });
        return;
      }

      const notesField = e.target.closest("#rfp-notes-field");
      if (notesField) {
        SAINT.rfpStore.updateScoreRow(selectedRfpId, notesField.dataset.vendor, { notes: notesField.value });
      }
    });

    // Live numeric readout while dragging, without committing to the store
    // (and therefore without a re-render) until the slider is released.
    mount.addEventListener("input", (e) => {
      const weightSlider = e.target.closest("[data-weight-param]");
      if (weightSlider) {
        const display = mount.querySelector(`[data-weight-display="${CSS.escape(weightSlider.dataset.weightParam)}"]`);
        if (display) display.textContent = weightSlider.value;
        return;
      }
      const scoreSlider = e.target.closest("[data-score-param]");
      if (scoreSlider) {
        const key = `${scoreSlider.dataset.scoreParam}|${scoreSlider.dataset.vendor}`;
        const display = mount.querySelector(`[data-score-display="${CSS.escape(key)}"]`);
        if (display) display.textContent = scoreSlider.value;
      }
    });

    mount.addEventListener("click", (e) => {
      if (e.target.closest("#rfp-toggle-weights")) {
        weightsExpanded = !weightsExpanded;
        rerender();
        return;
      }
      const vendorTabBtn = e.target.closest("[data-vendor-tab]");
      if (vendorTabBtn) {
        activeVendorTab = Number(vendorTabBtn.dataset.vendorTab);
        rerender();
        return;
      }
      if (e.target.closest("#rfp-save-eval-btn")) {
        const result = SAINT.rfpStore.saveEvaluation(selectedRfpId);
        const flash = document.getElementById("rfp-save-eval-flash");
        if (flash && result.ok) {
          flash.innerHTML = `<div class="flash flash-ok">Evaluation committed! Vendor "${escapeHtml(result.winner)}" saved as selected winner for ${escapeHtml(selectedRfpId)}.</div>`;
        }
      }
    });

    rerender();
    SAINT.rfpStore.subscribe(rerender);
  }

  SAINT.components.rfpEval = { init };
})(window);
