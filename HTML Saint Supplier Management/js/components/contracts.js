/**
 * SAINT.components.contracts — Contract Management panel.
 *
 * Three regions inside one tab: a register of all contracts, a create/edit
 * form, and a review-and-approve drawer for whichever contract is open.
 * Buttons are shown or hidden by SAINT.adminStore.can(), but every rule is
 * re-checked by the store — the UI only decides what to offer, never what is
 * allowed.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  SAINT.components = SAINT.components || {};
  const { escapeHtml, formatDateTime } = SAINT.utils;
  const { CONTRACT_TYPES, RENEWAL_TYPES, PAYMENT_TERMS, STATUS_LABELS, STATUS_CHIPS, CLAUSE_LABELS } = SAINT.contractData;

  const SEVERITY_CHIP = { CRITICAL: "chip-critical", HIGH: "chip-orange", MEDIUM: "chip-amber", LOW: "chip-slate" };

  // Transient view state — never persisted.
  let openId = null;
  let editingId = null;
  let flash = null; // { kind: "ok"|"err", text }
  let formErrors = {};
  let filterStatus = "";
  let searchTerm = "";
  let agentScanning = false;
  let agentSummary = null;
  let agentAutoRun = false;

  function money(value, currency) {
    if (value === null || value === undefined) return "—";
    return `${currency || "USD"} ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }

  function statusChip(status) {
    return `<span class="chip ${STATUS_CHIPS[status] || "chip-slate"}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
  }

  function flashHtml() {
    if (!flash) return "";
    return `<div class="flash ${flash.kind === "ok" ? "flash-ok" : "flash-err"}" role="status">${escapeHtml(flash.text)}</div>`;
  }

  function fieldError(name) {
    return formErrors[name] ? `<p class="field-error">${escapeHtml(formErrors[name])}</p>` : "";
  }

  /* ----------------------------- the form ----------------------------- */

  function contractForm(contract) {
    const suppliers = SAINT.store.allSuppliers();
    const c = contract || {};
    const isEdit = Boolean(contract);

    if (suppliers.length === 0) {
      return `<div class="card empty">Add a supplier first — a contract has to be with somebody.</div>`;
    }

    return `
      <form class="card card-pad" id="contract-form" novalidate>
        <h3 class="section-title" style="margin-top:0;">${isEdit ? `Edit ${escapeHtml(c.contractNumber)}` : "New contract"}</h3>
        ${fieldError("_blocked")}
        <div class="grid grid-4 mt-2">
          <div class="col-span-2">
            <label class="label" for="c-title">Contract title *</label>
            <input class="input" id="c-title" name="title" maxlength="200" value="${escapeHtml(c.title || "")}" required />
            ${fieldError("title")}
          </div>
          <div class="col-span-2">
            <label class="label" for="c-supplierId">Supplier *</label>
            <select class="input" id="c-supplierId" name="supplierId" ${isEdit ? "disabled" : ""}>
              <option value="">Select a supplier…</option>
              ${suppliers
                .map(
                  (s) =>
                    `<option value="${escapeHtml(s.id)}" ${s.id === c.supplierId ? "selected" : ""}>${escapeHtml(
                      s.legalName
                    )} (${escapeHtml(s.supplierCode)})</option>`
                )
                .join("")}
            </select>
            ${fieldError("supplierId")}
            ${isEdit ? `<p class="muted" style="font-size:11px;">The counterparty cannot be changed after drafting.</p>` : ""}
          </div>

          <div>
            <label class="label" for="c-contractType">Type</label>
            <select class="input" id="c-contractType" name="contractType">
              ${CONTRACT_TYPES.map((t) => `<option value="${t}" ${t === c.contractType ? "selected" : ""}>${t}</option>`).join("")}
            </select>
          </div>
          <div>
            <label class="label" for="c-totalValue">Contract value</label>
            <input class="input" id="c-totalValue" name="totalValue" type="number" min="0" step="0.01" value="${
              c.totalValue === null || c.totalValue === undefined ? "" : c.totalValue
            }" />
            ${fieldError("totalValue")}
          </div>
          <div>
            <label class="label" for="c-currency">Currency</label>
            <select class="input" id="c-currency" name="currency">
              ${["USD", "EUR", "GBP", "INR", "CAD", "AUD"]
                .map((x) => `<option value="${x}" ${x === (c.currency || "USD") ? "selected" : ""}>${x}</option>`)
                .join("")}
            </select>
          </div>
          <div>
            <label class="label" for="c-paymentTerms">Payment terms</label>
            <select class="input" id="c-paymentTerms" name="paymentTerms">
              ${PAYMENT_TERMS.map(
                (t) => `<option value="${t}" ${t === (c.paymentTerms || "NET30") ? "selected" : ""}>${t.replace(/_/g, " ")}</option>`
              ).join("")}
            </select>
          </div>

          <div>
            <label class="label" for="c-effectiveDate">Effective date</label>
            <input class="input" id="c-effectiveDate" name="effectiveDate" type="date" value="${escapeHtml(c.effectiveDate || "")}" />
          </div>
          <div>
            <label class="label" for="c-expiryDate">Expiry date</label>
            <input class="input" id="c-expiryDate" name="expiryDate" type="date" value="${escapeHtml(c.expiryDate || "")}" />
            ${fieldError("expiryDate")}
          </div>
          <div>
            <label class="label" for="c-renewalType">Renewal</label>
            <select class="input" id="c-renewalType" name="renewalType">
              ${RENEWAL_TYPES.map(
                (t) => `<option value="${t}" ${t === (c.renewalType || "MANUAL") ? "selected" : ""}>${t.replace(/_/g, " ")}</option>`
              ).join("")}
            </select>
          </div>
          <div>
            <label class="label" for="c-noticePeriodDays">Notice period (days)</label>
            <input class="input" id="c-noticePeriodDays" name="noticePeriodDays" type="number" min="0" max="730" value="${
              c.noticePeriodDays === undefined ? 90 : c.noticePeriodDays
            }" />
            ${fieldError("noticePeriodDays")}
          </div>

          <div class="col-span-4">
            <label class="label" for="c-termsText">Contract terms *</label>
            <textarea class="input" id="c-termsText" name="termsText" rows="8"
              style="font-family: ui-monospace, monospace; font-size:12px;" maxlength="40000"
              placeholder="Paste the clauses here. The quick review reads this text to find missing mandatory clauses and non-standard terms.">${escapeHtml(
                c.termsText || ""
              )}</textarea>
            <p class="muted" style="font-size:11px;">Required before submission — approval depends on a clause review of this text.</p>
          </div>
          <div class="col-span-4">
            <label class="label" for="c-notes">Internal notes</label>
            <input class="input" id="c-notes" name="notes" maxlength="4000" value="${escapeHtml(c.notes || "")}" />
          </div>
        </div>

        <div class="mt-4" style="display:flex; gap:8px; align-items:center;">
          <button type="submit" class="btn-primary">${isEdit ? "Save changes" : "Create draft contract"}</button>
          ${isEdit ? `<button type="button" class="btn-ghost" data-action="cancel-edit">Cancel</button>` : ""}
        </div>
      </form>
    `;
  }

  /* --------------------------- review drawer -------------------------- */

  function reviewHtml(c) {
    const review = c.review;
    if (!review) return `<p class="muted">No review has been run yet.</p>`;

    const missing =
      review.missing.length === 0
        ? `<p class="muted">None — all mandatory clauses are present.</p>`
        : `<ul style="margin:4px 0 0; padding-left:18px;">${review.missing
            .map((m) => `<li style="color:var(--red-700, #b91c1c);"><strong>${escapeHtml(CLAUSE_LABELS[m] || m)}</strong></li>`)
            .join("")}</ul>`;

    const flags =
      review.flags.length === 0
        ? `<p class="muted">No non-standard terms detected.</p>`
        : review.flags
            .map(
              (f) => `
        <li class="alert-mini">
          <span class="chip ${SEVERITY_CHIP[f.severity] || "chip-slate"}">${escapeHtml(f.severity)}</span>
          <p style="margin:4px 0 0; font-size:12px;"><strong>${escapeHtml(f.title)}</strong></p>
          <p style="margin:2px 0 0; font-size:12px;" class="muted">${escapeHtml(f.detail)}</p>
        </li>`
            )
            .join("");

    const detected =
      review.detected.length === 0
        ? `<span class="muted">None detected.</span>`
        : review.detected.map((d) => `<span class="chip chip-emerald">${escapeHtml(CLAUSE_LABELS[d] || d)}</span>`).join(" ");

    return `
      <div class="card card-pad">
        <div class="flex-between">
          <h4 class="section-title" style="margin:0;">Quick contract review</h4>
          <button type="button" class="btn-ghost btn-sm" data-action="rerun-review" data-id="${escapeHtml(c.id)}">Re-run review</button>
        </div>
        <p class="mt-2" style="font-weight:600; ${review.approvable ? "" : "color:var(--red-700, #b91c1c);"}">${escapeHtml(review.verdict)}</p>
        <p class="muted" style="font-size:11px;">Risk score ${review.riskScore}/100 · reviewed ${escapeHtml(formatDateTime(review.reviewedAt))}</p>

        <div class="grid grid-2 mt-4">
          <div>
            <h5 class="label">Missing mandatory clauses</h5>
            ${missing}
          </div>
          <div>
            <h5 class="label">Clauses detected</h5>
            <div style="display:flex; flex-wrap:wrap; gap:4px;">${detected}</div>
          </div>
        </div>

        <h5 class="label mt-4">Risk findings</h5>
        <ul style="list-style:none; margin:0; padding:0; display:grid; gap:8px;">${flags}</ul>
      </div>
    `;
  }

  function historyHtml(c) {
    if (!c.history || c.history.length === 0) return "";
    return `
      <div class="card card-pad mt-4">
        <h4 class="section-title" style="margin-top:0;">Audit trail</h4>
        <div class="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Action</th><th>By</th><th>Detail</th></tr></thead>
            <tbody>
              ${c.history
                .slice()
                .reverse()
                .map(
                  (h) => `<tr>
                    <td class="mono" style="white-space:nowrap;">${escapeHtml(formatDateTime(h.at))}</td>
                    <td><span class="chip chip-slate">${escapeHtml(h.action)}</span></td>
                    <td>${escapeHtml(h.actor)}</td>
                    <td>${escapeHtml(h.detail || "—")}</td>
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function workflowHtml(c) {
    const canSubmit = SAINT.adminStore.can("contracts:submit");
    const canApprove = SAINT.adminStore.can("contracts:approve");
    const actor = SAINT.adminStore.currentActorName();

    const buttons = [];
    if ((c.status === "DRAFT" || c.status === "REJECTED") && canSubmit) {
      buttons.push(`<button type="button" class="btn-primary" data-action="submit" data-id="${escapeHtml(c.id)}">Submit for approval</button>`);
    }
    if (c.status === "PENDING_APPROVAL" && canApprove) {
      buttons.push(`<button type="button" class="btn-primary" data-action="approve" data-id="${escapeHtml(c.id)}">Approve</button>`);
      buttons.push(`<button type="button" class="btn-ghost" data-action="reject" data-id="${escapeHtml(c.id)}">Reject…</button>`);
    }
    if (c.status === "PENDING_APPROVAL" && !canApprove) {
      buttons.push(
        `<span class="muted" style="font-size:12px;">Waiting on a sourcing manager. Your role (${escapeHtml(
          SAINT.adminStore.currentActorRole()
        )}) cannot approve contracts.</span>`
      );
    }

    const owner = [
      c.createdBy ? `Drafted by <strong>${escapeHtml(c.createdBy)}</strong>` : null,
      c.submittedBy ? `submitted by <strong>${escapeHtml(c.submittedBy)}</strong>` : null,
      c.approvedBy ? `approved by <strong>${escapeHtml(c.approvedBy)}</strong>` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    return `
      <div class="card card-pad">
        <div class="flex-between" style="flex-wrap:wrap; gap:8px;">
          <div>
            <h3 class="section-title" style="margin:0;">${escapeHtml(c.contractNumber)} — ${escapeHtml(c.title)}</h3>
            <p class="muted" style="font-size:12px; margin:4px 0 0;">${owner || "No workflow history yet."}</p>
          </div>
          <div>${statusChip(c.status)}</div>
        </div>

        ${
          c.rejectionReason
            ? `<div class="flash flash-err mt-2"><strong>Rejected:</strong> ${escapeHtml(c.rejectionReason)}</div>`
            : ""
        }

        <div class="grid grid-4 mt-4">
          <div class="detail-row"><span class="label">Supplier</span><div>${escapeHtml(c.supplierName || "—")}</div></div>
          <div class="detail-row"><span class="label">Type</span><div>${escapeHtml(c.contractType)}</div></div>
          <div class="detail-row"><span class="label">Value</span><div>${escapeHtml(money(c.totalValue, c.currency))}</div></div>
          <div class="detail-row"><span class="label">Payment terms</span><div>${escapeHtml((c.paymentTerms || "").replace(/_/g, " "))}</div></div>
          <div class="detail-row"><span class="label">Effective</span><div>${escapeHtml(c.effectiveDate || "—")}</div></div>
          <div class="detail-row"><span class="label">Expires</span><div>${escapeHtml(c.expiryDate || "—")}</div></div>
          <div class="detail-row"><span class="label">Renewal</span><div>${escapeHtml((c.renewalType || "").replace(/_/g, " "))}</div></div>
          <div class="detail-row"><span class="label">Notice period</span><div>${c.noticePeriodDays} days</div></div>
        </div>

        <div class="mt-4" style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          ${buttons.join("")}
          ${
            c.status !== "APPROVED" && c.status !== "ACTIVE" && SAINT.adminStore.can("contracts:write")
              ? `<button type="button" class="btn-ghost" data-action="edit" data-id="${escapeHtml(c.id)}">Edit metadata</button>
                 <button type="button" class="btn-ghost" data-action="delete" data-id="${escapeHtml(c.id)}">Delete</button>`
              : ""
          }
          <button type="button" class="btn-ghost" data-action="close" data-id="${escapeHtml(c.id)}">Close</button>
        </div>
        <p class="muted mt-2" style="font-size:11px;">Signed in as ${escapeHtml(actor)} (${escapeHtml(SAINT.adminStore.currentActorRole())}).</p>
      </div>
    `;
  }

  /* --------------------------- the agent ------------------------------ */

  function agentPanel() {
    const horizon = SAINT.contractAgent.EXPIRY_HORIZON_DAYS;
    const expiring = SAINT.contractAgent.expiringWithin(horizon);
    const open = SAINT.contractStore.listNotifications({ status: "OPEN" });

    const summary = agentSummary
      ? `<div class="note">
           Last run ${escapeHtml(formatDateTime(agentSummary.at))} —
           ${agentSummary.contractsScanned} contract${agentSummary.contractsScanned === 1 ? "" : "s"} scanned,
           <strong>${agentSummary.raised}</strong> new notification${agentSummary.raised === 1 ? "" : "s"}${
          agentSummary.suppressed ? `, ${agentSummary.suppressed} already open (not repeated)` : ""
        }.
         </div>`
      : "";

    const notificationList = open.length
      ? `<ul style="list-style:none; margin:12px 0 0; padding:0; display:grid; gap:8px;">
          ${open
            .map(
              (n) => `
            <li class="alert-mini">
              <div class="flex-between" style="gap:8px; align-items:flex-start;">
                <div>
                  <span class="chip ${SEVERITY_CHIP[n.severity] || "chip-slate"}">${escapeHtml(n.severity)}</span>
                  <span class="chip chip-slate">${escapeHtml(n.kind.replace(/_/g, " "))}</span>
                  <p style="margin:6px 0 0; font-size:12px;"><strong>${escapeHtml(n.title)}</strong></p>
                  <p style="margin:2px 0 0; font-size:12px;" class="muted">${escapeHtml(n.detail || "")}</p>
                  <p style="margin:4px 0 0; font-size:11px;" class="muted">
                    Notification sent to ${escapeHtml(n.recipient || "the contract owner")}
                    · ${escapeHtml(formatDateTime(n.createdAt))}
                    <em>(dispatch simulated in this static build)</em>
                  </p>
                </div>
                <button type="button" class="btn-ghost btn-sm" data-action="dismiss-notification" data-id="${escapeHtml(n.id)}">Dismiss</button>
              </div>
            </li>`
            )
            .join("")}
        </ul>`
      : `<p class="muted mt-2" style="font-size:12px;">No open notifications.</p>`;

    return `
      <div class="card card-pad mt-4">
        <div class="flex-between" style="flex-wrap:wrap; gap:8px;">
          <div>
            <h3 class="section-title" style="margin:0;">Contract Management AI Agent</h3>
            <p class="muted" style="font-size:12px; margin:4px 0 0;">
              Watches for contracts expiring within ${horizon} days (or inside their own notice period,
              whichever is longer), auto-renewals about to trigger, and approvals that have stalled —
              then notifies the contract owner. Runs on load and on demand.
            </p>
          </div>
          <div class="agent-controls">
            <button type="button" class="btn-primary" data-action="run-contract-agent" ${agentScanning ? "disabled" : ""}>
              ${agentScanning ? "Scanning…" : "Run agent now"}
            </button>
            ${open.length ? `<button type="button" class="btn-ghost btn-sm" data-action="dismiss-all-notifications">Dismiss all</button>` : ""}
          </div>
        </div>

        <div class="kpi-row mt-4">
          <div class="kpi-card"><div class="kpi-value">${expiring.filter((c) => c.daysToExpiry >= 0).length}</div><div class="kpi-label">Expiring within ${horizon} days</div></div>
          <div class="kpi-card"><div class="kpi-value">${expiring.filter((c) => c.daysToExpiry < 0).length}</div><div class="kpi-label">Already expired</div></div>
          <div class="kpi-card"><div class="kpi-value">${open.length}</div><div class="kpi-label">Open notifications</div></div>
        </div>

        <div class="agent-log">${summary}</div>
        ${notificationList}

        ${
          expiring.length
            ? `<div class="table-wrap mt-4">
                <table>
                  <thead><tr><th>Contract</th><th>Supplier</th><th>Expires</th><th>Days</th><th>Renewal</th><th>Value</th></tr></thead>
                  <tbody>
                    ${expiring
                      .map(
                        (c) => `<tr>
                          <td class="mono">${escapeHtml(c.contractNumber)}</td>
                          <td>${escapeHtml(c.supplierName || "—")}</td>
                          <td>${escapeHtml(c.expiryDate || "—")}</td>
                          <td>${
                            c.daysToExpiry < 0
                              ? `<span class="chip chip-red">${Math.abs(c.daysToExpiry)} overdue</span>`
                              : c.daysToExpiry <= 30
                              ? `<span class="chip chip-orange">${c.daysToExpiry}</span>`
                              : `<span class="chip chip-amber">${c.daysToExpiry}</span>`
                          }</td>
                          <td>${escapeHtml((c.renewalType || "").replace(/_/g, " "))}</td>
                          <td>${escapeHtml(money(c.totalValue, c.currency))}</td>
                        </tr>`
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>`
            : ""
        }
      </div>
    `;
  }

  /* ----------------------------- register ----------------------------- */

  function registerRow(c) {
    const risk = c.review && c.review.missing.length > 0
      ? `<span class="chip chip-red">${c.review.missing.length} missing</span>`
      : c.review && c.review.flags.length > 0
      ? `<span class="chip chip-amber">${c.review.flags.length} flag${c.review.flags.length === 1 ? "" : "s"}</span>`
      : `<span class="chip chip-emerald">Clean</span>`;

    return `
      <tr>
        <td class="mono">${escapeHtml(c.contractNumber)}</td>
        <td><button type="button" class="btn-link" data-action="open" data-id="${escapeHtml(c.id)}">${escapeHtml(c.title)}</button></td>
        <td>${escapeHtml(c.supplierName || "—")}</td>
        <td>${escapeHtml(c.contractType)}</td>
        <td>${escapeHtml(money(c.totalValue, c.currency))}</td>
        <td>${escapeHtml(c.expiryDate || "—")}</td>
        <td>${statusChip(c.status)}</td>
        <td>${risk}</td>
      </tr>
    `;
  }

  function render(mount) {
    const contracts = SAINT.contractStore.listContracts({ q: searchTerm, status: filterStatus || undefined });
    const stats = SAINT.contractStore.contractStats();
    const open = openId ? SAINT.contractStore.getContract(openId) : null;
    const editing = editingId ? SAINT.contractStore.getContract(editingId) : null;
    const canWrite = SAINT.adminStore.can("contracts:write");

    mount.innerHTML = `
      ${flashHtml()}

      <div class="kpi-row">
        <div class="kpi-card"><div class="kpi-value">${stats.total}</div><div class="kpi-label">Contracts</div></div>
        <div class="kpi-card"><div class="kpi-value">${stats.active}</div><div class="kpi-label">Approved / active</div></div>
        <div class="kpi-card"><div class="kpi-value">${stats.pendingApproval}</div><div class="kpi-label">Awaiting approval</div></div>
        <div class="kpi-card"><div class="kpi-value">${stats.nonCompliant}</div><div class="kpi-label">Missing mandatory clauses</div></div>
      </div>

      ${agentPanel()}

      ${open ? `<div class="mt-4">${workflowHtml(open)}</div><div class="mt-4">${reviewHtml(open)}</div>${historyHtml(open)}` : ""}

      ${canWrite ? `<div class="mt-4">${contractForm(editing)}</div>` : `<div class="card empty mt-4">Your role cannot create contracts.</div>`}

      <h3 class="section-title">Contract register</h3>
      <div class="filters">
        <input type="search" class="input" id="contract-search" placeholder="Search title, number, supplier…" maxlength="120"
          value="${escapeHtml(searchTerm)}" aria-label="Search contracts" />
        <select class="input" id="contract-status-filter" aria-label="Filter contracts by status">
          <option value="">All statuses</option>
          ${Object.entries(STATUS_LABELS)
            .map(([k, v]) => `<option value="${k}" ${k === filterStatus ? "selected" : ""}>${escapeHtml(v)}</option>`)
            .join("")}
        </select>
      </div>

      ${
        contracts.length === 0
          ? `<div class="card empty mt-4">No contracts match. Create one above to start the workflow.</div>`
          : `<div class="card mt-4" style="overflow:hidden;">
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Number</th><th>Title</th><th>Supplier</th><th>Type</th><th>Value</th><th>Expires</th><th>Status</th><th>Review</th></tr></thead>
                  <tbody>${contracts.map(registerRow).join("")}</tbody>
                </table>
              </div>
            </div>`
      }
    `;
  }

  function readForm(form) {
    const get = (name) => {
      const el = form.elements[name];
      return el ? el.value : "";
    };
    const supplierId = get("supplierId");
    const supplier = SAINT.store.allSuppliers().find((s) => s.id === supplierId);
    return {
      title: get("title"),
      supplierId,
      supplierName: supplier ? supplier.legalName : "",
      contractType: get("contractType"),
      totalValue: get("totalValue"),
      currency: get("currency"),
      paymentTerms: get("paymentTerms"),
      effectiveDate: get("effectiveDate"),
      expiryDate: get("expiryDate"),
      renewalType: get("renewalType"),
      noticePeriodDays: get("noticePeriodDays"),
      termsText: get("termsText"),
      notes: get("notes"),
    };
  }

  function init() {
    const mount = document.getElementById("contracts-mount");
    if (!mount) return;

    const rerender = () => render(mount);

    mount.addEventListener("submit", (e) => {
      const form = e.target.closest("#contract-form");
      if (!form) return;
      e.preventDefault();

      const actor = SAINT.adminStore.currentActorName();
      const raw = readForm(form);
      formErrors = {};

      if (editingId) {
        // The supplier select is disabled while editing, so carry it forward.
        const existing = SAINT.contractStore.getContract(editingId);
        raw.supplierId = existing.supplierId;
        raw.supplierName = existing.supplierName;
        const result = SAINT.contractStore.updateContract(editingId, raw, actor);
        if (!result.ok) {
          formErrors = result.errors || {};
          if (result.blocked) formErrors._blocked = result.blocked;
          flash = { kind: "err", text: result.blocked || "Fix the highlighted fields." };
        } else {
          flash = { kind: "ok", text: `${result.contract.contractNumber} updated.` };
          editingId = null;
          openId = result.contract.id;
        }
      } else {
        const result = SAINT.contractStore.createContract(raw, actor);
        if (!result.ok) {
          formErrors = result.errors || {};
          flash = { kind: "err", text: "Fix the highlighted fields." };
        } else {
          flash = { kind: "ok", text: `${result.contract.contractNumber} drafted. Submit it when the terms are final.` };
          openId = result.contract.id;
        }
      }
      rerender();
    });

    mount.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn || !mount.contains(btn)) return;
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      const actor = SAINT.adminStore.currentActorName();

      if (action === "open") {
        openId = openId === id ? null : id;
        editingId = null;
        flash = null;
      } else if (action === "close") {
        openId = null;
      } else if (action === "edit") {
        editingId = id;
        formErrors = {};
        flash = null;
      } else if (action === "cancel-edit") {
        editingId = null;
        formErrors = {};
      } else if (action === "delete") {
        const c = SAINT.contractStore.getContract(id);
        if (!global.confirm(`Delete ${c.contractNumber} — "${c.title}"? This cannot be undone.`)) return;
        const result = SAINT.contractStore.removeContract(id, actor);
        flash = result.ok
          ? { kind: "ok", text: `${result.removed.contractNumber} deleted.` }
          : { kind: "err", text: result.error };
        if (result.ok && openId === id) openId = null;
      } else if (action === "submit") {
        const result = SAINT.contractStore.submitForApproval(id, actor);
        flash = result.ok
          ? { kind: "ok", text: `${result.contract.contractNumber} submitted for sourcing manager approval.` }
          : { kind: "err", text: result.error };
        openId = id;
      } else if (action === "approve") {
        const result = SAINT.contractStore.approve(id, actor, {
          approvalLimit: SAINT.adminStore.currentApprovalLimit(),
        });
        flash = result.ok
          ? { kind: "ok", text: `${result.contract.contractNumber} approved. A purchase order can now be raised against it in Spend.` }
          : { kind: "err", text: result.error };
        openId = id;
      } else if (action === "reject") {
        const reason = global.prompt("Why is this contract being rejected? The analyst will see this.");
        if (reason === null) return;
        const result = SAINT.contractStore.reject(id, actor, reason);
        flash = result.ok ? { kind: "ok", text: "Contract rejected and returned to the analyst." } : { kind: "err", text: result.error };
        openId = id;
      } else if (action === "run-contract-agent") {
        if (agentScanning) return;
        agentScanning = true;
        rerender();
        // Yield so the disabled state paints before the (synchronous) scan.
        setTimeout(() => {
          agentSummary = SAINT.contractAgent.runScan();
          agentScanning = false;
          flash = {
            kind: "ok",
            text: agentSummary.raised
              ? `Agent raised ${agentSummary.raised} notification(s) across ${agentSummary.contractsScanned} contract(s).`
              : `Agent scanned ${agentSummary.contractsScanned} contract(s) — nothing new to report.`,
          };
          rerender();
        }, 400);
        return;
      } else if (action === "dismiss-notification") {
        SAINT.contractStore.dismissNotification(id);
      } else if (action === "dismiss-all-notifications") {
        SAINT.contractStore.dismissAllNotifications();
        flash = { kind: "ok", text: "All contract notifications dismissed." };
      } else if (action === "rerun-review") {
        SAINT.contractStore.runReview(id);
        flash = { kind: "ok", text: "Contract review re-run against the current terms." };
      } else {
        return;
      }
      rerender();
    });

    mount.addEventListener("input", (e) => {
      if (e.target.id === "contract-search") {
        searchTerm = e.target.value;
        const pos = e.target.selectionStart;
        rerender();
        // Re-rendering replaces the input, so restore focus and caret.
        const next = document.getElementById("contract-search");
        if (next) {
          next.focus();
          next.setSelectionRange(pos, pos);
        }
      }
    });

    mount.addEventListener("change", (e) => {
      if (e.target.id === "contract-status-filter") {
        filterStatus = e.target.value;
        rerender();
      }
    });

    rerender();
    SAINT.contractStore.subscribe(rerender);
    SAINT.adminStore.subscribe(rerender);
    SAINT.store.subscribe(rerender);

    // The agent runs itself once the contracts have loaded, so expiring
    // contracts are surfaced without anyone remembering to press a button.
    // Guarded so it happens once per page load, not on every store notify.
    SAINT.contractStore.ready
      .then(() => {
        if (agentAutoRun) return;
        agentAutoRun = true;
        agentSummary = SAINT.contractAgent.runScan();
        rerender();
      })
      .catch((err) => console.warn("Contract agent auto-run skipped", err));
  }

  SAINT.components.contracts = { init };
})(window);
