/**
 * SAINT.components.spend — Spend Management panel.
 *
 * A purchase order starts from an approved contract, never from a blank form:
 * picking the contract is what fixes the supplier, currency and payment terms,
 * and what caps the value. Those fields are shown read-only so it is obvious
 * they are inherited rather than typed.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  SAINT.components = SAINT.components || {};
  const { escapeHtml, formatDateTime } = SAINT.utils;

  let selectedContractId = "";
  let openId = null;
  let flash = null;
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
    const { STATUS_LABELS, STATUS_CHIPS } = SAINT.spendStore;
    return `<span class="chip ${STATUS_CHIPS[status] || "chip-slate"}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
  }

  function flashHtml() {
    if (!flash) return "";
    return `<div class="flash ${flash.kind === "ok" ? "flash-ok" : "flash-err"}" role="status">${escapeHtml(flash.text)}</div>`;
  }

  function fieldError(name) {
    return formErrors[name] ? `<p class="field-error">${escapeHtml(formErrors[name])}</p>` : "";
  }

  /* --------------------------- the agent ------------------------------ */

  /**
   * The agent panel and its approval queue.
   *
   * The queue is the human gate: the agent fills it, and nothing becomes a
   * purchase order — let alone reaches a supplier — until somebody approves a
   * row here.
   */
  function agentPanel() {
    const pending = SAINT.spendStore.listRequisitions({ status: "PENDING_APPROVAL" });
    const recent = SAINT.spendStore
      .listRequisitions()
      .filter((r) => r.status !== "PENDING_APPROVAL")
      .slice(0, 5);
    const canApprove = SAINT.adminStore.can("spend:issue_po");
    const { REQ_STATUS_LABELS, REQ_STATUS_CHIPS } = SAINT.spendStore;

    const summary = agentSummary
      ? `<div class="note">
          Last run ${escapeHtml(formatDateTime(agentSummary.at))} —
          ${agentSummary.contractsScanned} approved contract${agentSummary.contractsScanned === 1 ? "" : "s"} reviewed,
          <strong>${agentSummary.raised}</strong> requisition${agentSummary.raised === 1 ? "" : "s"} raised${
          agentSummary.flagged ? `, ${agentSummary.flagged} contract flag(s)` : ""
        }${agentSummary.suppressed ? `, ${agentSummary.suppressed} already pending (not repeated)` : ""}.
        </div>`
      : "";

    const queue = pending.length
      ? pending
          .map(
            (r) => `
        <li class="alert-mini">
          <div class="flex-between" style="gap:8px; align-items:flex-start; flex-wrap:wrap;">
            <div style="min-width:260px;">
              <span class="chip ${REQ_STATUS_CHIPS[r.status]}">${escapeHtml(REQ_STATUS_LABELS[r.status])}</span>
              <span class="mono" style="margin-left:6px;">${escapeHtml(r.reqNumber)}</span>
              <p style="margin:6px 0 0; font-size:12px;"><strong>${escapeHtml(r.description)}</strong></p>
              <p style="margin:2px 0 0; font-size:12px;">
                ${escapeHtml(r.supplierName)} · ${escapeHtml(money(r.amount, r.currency))} ·
                against <span class="mono">${escapeHtml(r.contractNumber)}</span>
              </p>
              <p style="margin:4px 0 0; font-size:11px;" class="muted">
                Raised by <strong>${escapeHtml(r.raisedBy)}</strong>${
              r.rationale ? ` — ${escapeHtml(r.rationale)}` : ""
            }
              </p>
            </div>
            <div style="display:flex; gap:6px; align-items:flex-start;">
              ${
                canApprove
                  ? `<button type="button" class="btn-primary btn-sm" data-action="approve-req" data-id="${escapeHtml(r.id)}">Approve → create PO</button>
                     <button type="button" class="btn-ghost btn-sm" data-action="reject-req" data-id="${escapeHtml(r.id)}">Reject…</button>`
                  : `<span class="muted" style="font-size:11px;">Your role cannot approve requisitions.</span>`
              }
            </div>
          </div>
        </li>`
          )
          .join("")
      : `<li class="muted" style="font-size:12px; list-style:none;">Nothing awaiting approval.</li>`;

    return `
      <div class="card card-pad mt-4">
        <div class="flex-between" style="flex-wrap:wrap; gap:8px;">
          <div>
            <h3 class="section-title" style="margin:0;">Spend Management AI Agent</h3>
            <p class="muted" style="font-size:12px; margin:4px 0 0;">
              Reviews approved contracts and drafts purchase requisitions where value is going unused
              or a contract is about to expire with headroom left. It stops at the requisition —
              <strong>a person approves it, which creates the purchase order, and a person sends that order</strong>.
              The agent never contacts a supplier.
            </p>
          </div>
          <div class="agent-controls">
            <button type="button" class="btn-primary" data-action="run-spend-agent" ${agentScanning ? "disabled" : ""}>
              ${agentScanning ? "Reviewing…" : "Run agent now"}
            </button>
          </div>
        </div>

        <div class="agent-log">${summary}</div>

        <h4 class="label mt-4">Approval queue (${pending.length})</h4>
        <ul style="list-style:none; margin:8px 0 0; padding:0; display:grid; gap:8px;">${queue}</ul>

        ${
          recent.length
            ? `<h4 class="label mt-4">Recently decided</h4>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Requisition</th><th>Description</th><th>Value</th><th>Status</th><th>Decided by</th></tr></thead>
                  <tbody>
                    ${recent
                      .map(
                        (r) => `<tr>
                          <td class="mono">${escapeHtml(r.reqNumber)}</td>
                          <td>${escapeHtml(r.description)}</td>
                          <td>${escapeHtml(money(r.amount, r.currency))}</td>
                          <td><span class="chip ${REQ_STATUS_CHIPS[r.status]}">${escapeHtml(REQ_STATUS_LABELS[r.status])}</span></td>
                          <td>${escapeHtml(r.decidedBy || "—")}${
                          r.rejectionReason ? `<div class="muted" style="font-size:11px;">${escapeHtml(r.rejectionReason)}</div>` : ""
                        }</td>
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

  /* ------------------------------ the form ---------------------------- */

  function poForm() {
    const approved = SAINT.contractStore.approvedContracts();
    if (approved.length === 0) {
      return `<div class="card empty">
        No approved contracts yet. A purchase order can only be raised against an approved contract —
        get one through the approval workflow on the Contracts tab first.
      </div>`;
    }

    const contract = approved.find((c) => c.id === selectedContractId) || null;
    const headroom = contract ? SAINT.spendStore.contractHeadroom(contract.id) : null;
    const supplier = contract ? SAINT.store.getSupplier(contract.supplierId) : null;

    return `
      <form class="card card-pad" id="po-form" novalidate>
        <h3 class="section-title" style="margin-top:0;">Raise a purchase order</h3>
        ${fieldError("_blocked")}

        <div class="grid grid-4 mt-2">
          <div class="col-span-2">
            <label class="label" for="po-contractId">Approved contract *</label>
            <select class="input" id="po-contractId" name="contractId">
              <option value="">Select an approved contract…</option>
              ${approved
                .map(
                  (c) =>
                    `<option value="${escapeHtml(c.id)}" ${c.id === selectedContractId ? "selected" : ""}>${escapeHtml(
                      c.contractNumber
                    )} — ${escapeHtml(c.title)}</option>`
                )
                .join("")}
            </select>
          </div>

          <div class="col-span-2">
            <label class="label">Supplier (from contract)</label>
            <input class="input" value="${escapeHtml(contract ? contract.supplierName : "")}" disabled placeholder="Select a contract first" />
            ${
              contract && supplier && !supplier.contactEmail
                ? `<p class="field-error">This supplier has no contact email, so the order cannot be sent. Add one on the supplier record.</p>`
                : contract && supplier
                ? `<p class="muted" style="font-size:11px;">Will be sent to ${escapeHtml(supplier.contactEmail)}</p>`
                : ""
            }
          </div>

          <div class="col-span-4">
            <label class="label" for="po-description">What is being purchased *</label>
            <input class="input" id="po-description" name="description" maxlength="2000"
              placeholder="e.g. Platform subscription — 250 seats, annual term" />
            ${fieldError("description")}
          </div>

          <div>
            <label class="label" for="po-amount">Purchase order value *</label>
            <input class="input" id="po-amount" name="amount" type="number" min="0" step="0.01" />
            ${fieldError("amount")}
            ${
              headroom && headroom.remaining !== null
                ? `<p class="muted" style="font-size:11px;">${escapeHtml(
                    money(headroom.remaining, headroom.currency)
                  )} remaining of ${escapeHtml(money(headroom.contractValue, headroom.currency))}</p>`
                : ""
            }
          </div>
          <div>
            <label class="label">Currency (from contract)</label>
            <input class="input" value="${escapeHtml(contract ? contract.currency : "")}" disabled />
          </div>
          <div>
            <label class="label">Payment terms (from contract)</label>
            <input class="input" value="${escapeHtml(contract ? (contract.paymentTerms || "").replace(/_/g, " ") : "")}" disabled />
          </div>
          <div>
            <label class="label" for="po-needByDate">Need by</label>
            <input class="input" id="po-needByDate" name="needByDate" type="date" />
          </div>

          <div class="col-span-2">
            <label class="label" for="po-category">Spend category</label>
            <input class="input" id="po-category" name="category" maxlength="120" placeholder="e.g. IT &amp; Telecommunications"
              value="${escapeHtml(contract && contract.supplierName ? "" : "")}" />
          </div>
        </div>

        <div class="mt-4">
          <button type="submit" class="btn-primary" ${contract ? "" : "disabled"}>Create purchase order</button>
        </div>
      </form>
    `;
  }

  /* ----------------------------- PO detail ---------------------------- */

  function orderDetail(po) {
    const canIssue = SAINT.adminStore.can("spend:issue_po");
    const buttons = [];

    if (po.status === "DRAFT" && canIssue) {
      buttons.push(`<button type="button" class="btn-primary" data-action="issue" data-id="${escapeHtml(po.id)}">Send to supplier</button>`);
      buttons.push(`<button type="button" class="btn-ghost" data-action="delete" data-id="${escapeHtml(po.id)}">Delete draft</button>`);
    } else if (po.status === "DRAFT") {
      buttons.push(
        `<span class="muted" style="font-size:12px;">Your role (${escapeHtml(
          SAINT.adminStore.currentActorRole()
        )}) cannot issue purchase orders.</span>`
      );
    }
    if (po.status === "ISSUED" && canIssue) {
      buttons.push(`<button type="button" class="btn-ghost" data-action="status" data-id="${escapeHtml(po.id)}" data-status="ACKNOWLEDGED">Mark acknowledged</button>`);
    }
    if ((po.status === "ISSUED" || po.status === "ACKNOWLEDGED") && canIssue) {
      buttons.push(`<button type="button" class="btn-ghost" data-action="status" data-id="${escapeHtml(po.id)}" data-status="RECEIVED">Mark received</button>`);
      buttons.push(`<button type="button" class="btn-ghost" data-action="status" data-id="${escapeHtml(po.id)}" data-status="CANCELLED">Cancel</button>`);
    }
    if (po.status === "RECEIVED" && canIssue) {
      buttons.push(`<button type="button" class="btn-ghost" data-action="status" data-id="${escapeHtml(po.id)}" data-status="CLOSED">Close</button>`);
    }

    return `
      <div class="card card-pad">
        <div class="flex-between" style="flex-wrap:wrap; gap:8px;">
          <div>
            <h3 class="section-title" style="margin:0;">${escapeHtml(po.poNumber)}</h3>
            <p class="muted" style="font-size:12px; margin:4px 0 0;">
              Against <strong>${escapeHtml(po.contractNumber)}</strong> — ${escapeHtml(po.contractTitle)}
            </p>
          </div>
          <div>${statusChip(po.status)}</div>
        </div>

        <div class="grid grid-4 mt-4">
          <div class="detail-row"><span class="label">Supplier</span><div>${escapeHtml(po.supplierName)}</div></div>
          <div class="detail-row"><span class="label">Value</span><div>${escapeHtml(money(po.amount, po.currency))}</div></div>
          <div class="detail-row"><span class="label">Payment terms</span><div>${escapeHtml((po.paymentTerms || "").replace(/_/g, " "))}</div></div>
          <div class="detail-row"><span class="label">Need by</span><div>${escapeHtml(po.needByDate || "—")}</div></div>
          <div class="detail-row col-span-2"><span class="label">Description</span><div>${escapeHtml(po.description)}</div></div>
          <div class="detail-row"><span class="label">Category</span><div>${escapeHtml(po.category || "Uncategorised")}</div></div>
          <div class="detail-row"><span class="label">Issued to</span><div>${escapeHtml(po.issuedTo || "Not yet sent")}</div></div>
        </div>

        <div class="mt-4" style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          ${buttons.join("")}
          <button type="button" class="btn-ghost" data-action="close">Close</button>
        </div>

        ${
          po.history && po.history.length
            ? `<div class="table-wrap mt-4">
                <table>
                  <thead><tr><th>When</th><th>Action</th><th>By</th><th>Detail</th></tr></thead>
                  <tbody>${po.history
                    .slice()
                    .reverse()
                    .map(
                      (h) =>
                        `<tr><td class="mono" style="white-space:nowrap;">${escapeHtml(formatDateTime(h.at))}</td>
                        <td><span class="chip chip-slate">${escapeHtml(h.action)}</span></td>
                        <td>${escapeHtml(h.actor)}</td><td>${escapeHtml(h.detail || "—")}</td></tr>`
                    )
                    .join("")}</tbody>
                </table>
              </div>`
            : ""
        }
      </div>
    `;
  }

  function orderRow(po) {
    return `
      <tr>
        <td class="mono">${escapeHtml(po.poNumber)}</td>
        <td><button type="button" class="btn-link" data-action="open" data-id="${escapeHtml(po.id)}">${escapeHtml(po.description)}</button></td>
        <td>${escapeHtml(po.supplierName)}</td>
        <td class="mono">${escapeHtml(po.contractNumber)}</td>
        <td>${escapeHtml(po.category || "—")}</td>
        <td>${escapeHtml(money(po.amount, po.currency))}</td>
        <td>${statusChip(po.status)}</td>
      </tr>
    `;
  }

  function render(mount) {
    const stats = SAINT.spendStore.spendStats();
    const orders = SAINT.spendStore.listOrders({ q: searchTerm, status: filterStatus || undefined });
    const open = openId ? SAINT.spendStore.getOrder(openId) : null;
    const { STATUS_LABELS } = SAINT.spendStore;

    mount.innerHTML = `
      ${flashHtml()}

      <div class="kpi-row">
        <div class="kpi-card"><div class="kpi-value">${stats.totalOrders}</div><div class="kpi-label">Purchase orders</div></div>
        <div class="kpi-card"><div class="kpi-value">${stats.activeOrders}</div><div class="kpi-label">Active with suppliers</div></div>
        <div class="kpi-card"><div class="kpi-value">${escapeHtml(money(stats.totalSpend, "USD"))}</div><div class="kpi-label">Total committed spend</div></div>
        <div class="kpi-card"><div class="kpi-value">${stats.draftOrders}</div><div class="kpi-label">Drafts not yet sent</div></div>
      </div>

      ${agentPanel()}

      ${open ? `<div class="mt-4">${orderDetail(open)}</div>` : ""}

      <div class="mt-4">${poForm()}</div>

      <h3 class="section-title">Purchase order register</h3>
      <div class="filters">
        <input type="search" class="input" id="po-search" placeholder="Search PO number, description, supplier…" maxlength="120"
          value="${escapeHtml(searchTerm)}" aria-label="Search purchase orders" />
        <select class="input" id="po-status-filter" aria-label="Filter purchase orders by status">
          <option value="">All statuses</option>
          ${Object.entries(STATUS_LABELS)
            .map(([k, v]) => `<option value="${k}" ${k === filterStatus ? "selected" : ""}>${escapeHtml(v)}</option>`)
            .join("")}
        </select>
      </div>

      ${
        orders.length === 0
          ? `<div class="card empty mt-4">No purchase orders yet. Raise one against an approved contract above.</div>`
          : `<div class="card mt-4" style="overflow:hidden;">
              <div class="table-wrap">
                <table>
                  <thead><tr><th>PO</th><th>Description</th><th>Supplier</th><th>Contract</th><th>Category</th><th>Value</th><th>Status</th></tr></thead>
                  <tbody>${orders.map(orderRow).join("")}</tbody>
                </table>
              </div>
            </div>`
      }
    `;
  }

  function init() {
    const mount = document.getElementById("spend-mount");
    if (!mount) return;

    const rerender = () => render(mount);

    mount.addEventListener("submit", (e) => {
      const form = e.target.closest("#po-form");
      if (!form) return;
      e.preventDefault();

      const actor = SAINT.adminStore.currentActorName();
      formErrors = {};
      const result = SAINT.spendStore.createOrder(
        {
          contractId: form.elements.contractId.value,
          description: form.elements.description.value,
          amount: form.elements.amount.value,
          needByDate: form.elements.needByDate.value,
          category: form.elements.category.value,
        },
        actor
      );

      if (!result.ok) {
        formErrors = result.errors || {};
        if (result.blocked) formErrors._blocked = result.blocked;
        flash = { kind: "err", text: result.blocked || "Fix the highlighted fields." };
      } else {
        flash = { kind: "ok", text: `${result.order.poNumber} created as a draft. Send it to the supplier when you are ready.` };
        openId = result.order.id;
        selectedContractId = "";
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
        flash = null;
      } else if (action === "close") {
        openId = null;
      } else if (action === "issue") {
        const result = SAINT.spendStore.issueOrder(id, actor);
        flash = result.ok
          ? {
              kind: "ok",
              text: `${result.order.poNumber} sent to ${result.recipient}. (Dispatch is simulated in this static build — no email leaves the browser.)`,
            }
          : { kind: "err", text: result.error };
        openId = id;
      } else if (action === "status") {
        const result = SAINT.spendStore.setStatus(id, btn.dataset.status, actor);
        flash = result.ok
          ? { kind: "ok", text: `${result.order.poNumber} is now ${SAINT.spendStore.STATUS_LABELS[result.order.status]}.` }
          : { kind: "err", text: result.error };
        openId = id;
      } else if (action === "delete") {
        const po = SAINT.spendStore.getOrder(id);
        if (!global.confirm(`Delete draft ${po.poNumber}? This cannot be undone.`)) return;
        const result = SAINT.spendStore.removeOrder(id);
        flash = result.ok ? { kind: "ok", text: "Draft purchase order deleted." } : { kind: "err", text: result.error };
        if (result.ok) openId = null;
      } else {
        return;
      }
      rerender();
    });

    mount.addEventListener("change", (e) => {
      if (e.target.id === "po-contractId") {
        // Re-render so the inherited supplier/currency/terms and the remaining
        // contract headroom update to match the chosen contract.
        selectedContractId = e.target.value;
        rerender();
      } else if (e.target.id === "po-status-filter") {
        filterStatus = e.target.value;
        rerender();
      }
    });

    mount.addEventListener("input", (e) => {
      if (e.target.id === "po-search") {
        searchTerm = e.target.value;
        const pos = e.target.selectionStart;
        rerender();
        const next = document.getElementById("po-search");
        if (next) {
          next.focus();
          next.setSelectionRange(pos, pos);
        }
      }
    });

    rerender();
    SAINT.spendStore.subscribe(rerender);
    SAINT.contractStore.subscribe(rerender);
    SAINT.adminStore.subscribe(rerender);
  }

  SAINT.components.spend = { init };
})(window);
