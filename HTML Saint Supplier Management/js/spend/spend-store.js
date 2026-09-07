/**
 * SAINT.spendStore — purchase orders raised against approved contracts.
 *
 * The controlling rule: a PO can only be created from a contract that is
 * APPROVED (or already ACTIVE). That is what makes the contract approval
 * workflow mean something — without it, approval is decoration and spend can
 * leave the building against terms nobody signed off.
 *
 * The store also tracks committed value per contract so a contract cannot be
 * over-consumed: the sum of its POs may not exceed the contract value.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  const { createId, deepClone, debounce } = SAINT.utils;
  const { openDb, getAll, replaceAll, getValue, putValue } = SAINT.idb;

  const DB_NAME = "saint-spend-db";
  // v2 adds the requisitions store the Spend AI Agent writes to.
  const DB_VERSION = 2;
  const STORE_POS = "purchaseOrders";
  const STORE_REQS = "requisitions";
  const STORE_META = "meta";

  const PO_STATUSES = ["DRAFT", "ISSUED", "ACKNOWLEDGED", "RECEIVED", "CLOSED", "CANCELLED"];

  /**
   * A requisition is the request; a purchase order is the commitment.
   * The agent may raise the former. Only a person can turn it into the latter.
   */
  const REQ_STATUSES = ["PENDING_APPROVAL", "APPROVED", "REJECTED", "CONVERTED"];

  const REQ_STATUS_LABELS = {
    PENDING_APPROVAL: "Awaiting approval",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    CONVERTED: "Converted to PO",
  };

  const REQ_STATUS_CHIPS = {
    PENDING_APPROVAL: "chip-amber",
    APPROVED: "chip-emerald",
    REJECTED: "chip-red",
    CONVERTED: "chip-slate",
  };

  const STATUS_LABELS = {
    DRAFT: "Draft",
    ISSUED: "Issued to supplier",
    ACKNOWLEDGED: "Acknowledged",
    RECEIVED: "Goods/services received",
    CLOSED: "Closed",
    CANCELLED: "Cancelled",
  };

  const STATUS_CHIPS = {
    DRAFT: "chip-slate",
    ISSUED: "chip-saint",
    ACKNOWLEDGED: "chip-violet",
    RECEIVED: "chip-emerald",
    CLOSED: "chip-slate",
    CANCELLED: "chip-red",
  };

  function createSpendStore() {
    /** @type {Map<string, object>} */
    const orders = new Map();
    /** @type {Map<string, object>} Agent- or human-raised purchase requisitions. */
    const requisitions = new Map();
    let seq = 0;
    let reqSeq = 0;
    const listeners = new Set();
    let db = null;

    function notify() {
      Array.from(listeners).forEach((fn) => {
        try {
          fn();
        } catch (err) {
          console.error("SAINT.spendStore listener failed", err);
        }
      });
    }

    function subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }

    async function persist() {
      if (!db) return;
      try {
        await Promise.all([
          replaceAll(db, STORE_POS, Array.from(orders.values())),
          replaceAll(db, STORE_REQS, Array.from(requisitions.values())),
          putValue(db, STORE_META, { key: "poSeq", value: seq }),
          putValue(db, STORE_META, { key: "reqSeq", value: reqSeq }),
        ]);
      } catch (err) {
        console.warn("SAINT.spendStore: persistence failed, continuing in-memory only", err);
      }
    }
    const persistDebounced = debounce(persist, 250);

    function nextPoNumber() {
      seq += 1;
      return `PO-${String(seq).padStart(5, "0")}`;
    }

    /** Value already committed against a contract by live purchase orders. */
    function committedAgainstContract(contractId, excludingPoId) {
      return Array.from(orders.values())
        .filter((p) => p.contractId === contractId && p.status !== "CANCELLED" && p.id !== excludingPoId)
        .reduce((sum, p) => sum + (p.amount || 0), 0);
    }

    function validate(raw, contract) {
      const errors = {};
      const description = String(raw.description || "").trim().slice(0, 2000);
      if (description.length < 5) errors.description = "Describe what is being purchased (at least 5 characters).";

      let amount = null;
      const n = Number(raw.amount);
      if (!Number.isFinite(n) || n <= 0) errors.amount = "Enter a purchase order value greater than zero.";
      else amount = Math.round(n * 100) / 100;

      // A PO may not take a contract past its own value — that is the point of
      // having a contract value at all.
      if (amount !== null && contract && contract.totalValue) {
        const alreadyCommitted = committedAgainstContract(contract.id, raw.id);
        const remaining = Math.round((contract.totalValue - alreadyCommitted) * 100) / 100;
        if (amount > remaining) {
          errors.amount = `Only ${contract.currency} ${remaining.toLocaleString()} remains on contract ${contract.contractNumber}. Reduce the value or raise a contract variation.`;
        }
      }

      const needBy = String(raw.needByDate || "").trim().slice(0, 10) || null;

      return {
        valid: Object.keys(errors).length === 0,
        errors,
        data: { description, amount, needByDate: needBy, category: String(raw.category || "").trim().slice(0, 120) },
      };
    }

    function appendHistory(po, action, actor, detail) {
      po.history.push({ at: new Date().toISOString(), action, actor: actor || "Unknown", detail: detail || null });
    }

    /* ------------------------------ CRUD ------------------------------ */

    function listOrders({ q, status, contractId, supplierId } = {}) {
      let rows = Array.from(orders.values());
      const term = (q || "").trim().toLowerCase();
      if (term) {
        rows = rows.filter((p) =>
          [p.poNumber, p.description, p.supplierName, p.contractNumber, p.category].some(
            (f) => f && f.toLowerCase().includes(term)
          )
        );
      }
      if (status) rows = rows.filter((p) => p.status === status);
      if (contractId) rows = rows.filter((p) => p.contractId === contractId);
      if (supplierId) rows = rows.filter((p) => p.supplierId === supplierId);
      return rows.map(deepClone).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    function getOrder(id) {
      const p = orders.get(id);
      return p ? deepClone(p) : null;
    }

    /**
     * Raise a purchase order against an approved contract.
     *
     * The contract is re-read from the contract store at creation time rather
     * than trusted from the caller: a UI that was open while the contract got
     * rejected must not still be able to spend against it.
     */
    function createOrder(raw, actor) {
      const contract = SAINT.contractStore.getContract(raw.contractId);
      if (!contract) return { ok: false, errors: {}, blocked: "Select an approved contract to raise this purchase order against." };
      if (contract.status !== "APPROVED" && contract.status !== "ACTIVE") {
        return {
          ok: false,
          errors: {},
          blocked: `Contract ${contract.contractNumber} is "${contract.status}", not approved. A purchase order can only be raised against an approved contract.`,
        };
      }

      const { valid, errors, data } = validate(raw, contract);
      if (!valid) return { ok: false, errors };

      const now = new Date().toISOString();
      const record = {
        id: createId(),
        poNumber: nextPoNumber(),
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        contractTitle: contract.title,
        supplierId: contract.supplierId,
        supplierName: contract.supplierName,
        description: data.description,
        category: data.category,
        amount: data.amount,
        currency: contract.currency,
        paymentTerms: contract.paymentTerms,
        needByDate: data.needByDate,
        status: "DRAFT",
        issuedTo: null,
        issuedAt: null,
        createdBy: actor || "Unknown",
        createdAt: now,
        updatedAt: now,
        history: [],
      };
      appendHistory(record, "CREATED", actor, `Raised against ${contract.contractNumber}`);
      orders.set(record.id, record);

      persistDebounced();
      notify();
      return { ok: true, order: deepClone(record) };
    }

    /**
     * Send the purchase order to the supplier.
     *
     * Dispatch is simulated — a static browser build has no mail transport —
     * but the recipient is resolved from the real supplier record, so a
     * supplier with no contact email is a blocking error rather than a silent
     * no-op that looks like success.
     */
    function issueOrder(id, actor) {
      const po = orders.get(id);
      if (!po) return { ok: false, error: "Purchase order not found" };
      if (po.status !== "DRAFT") return { ok: false, error: `This purchase order is already "${STATUS_LABELS[po.status]}".` };

      const supplier = SAINT.store.getSupplier(po.supplierId);
      const recipient = supplier && supplier.contactEmail;
      if (!recipient) {
        return {
          ok: false,
          error: `No contact email on record for ${po.supplierName}. Add one on the supplier record before issuing this purchase order.`,
        };
      }

      po.status = "ISSUED";
      po.issuedTo = recipient;
      po.issuedAt = new Date().toISOString();
      po.updatedAt = po.issuedAt;
      appendHistory(po, "ISSUED", actor, `Dispatched to ${recipient}`);

      persistDebounced();
      notify();
      return { ok: true, order: deepClone(po), recipient, simulated: true };
    }

    function setStatus(id, status, actor) {
      const po = orders.get(id);
      if (!po) return { ok: false, error: "Purchase order not found" };
      if (!PO_STATUSES.includes(status)) return { ok: false, error: "Unknown purchase order status." };
      if (po.status === "DRAFT" && status !== "CANCELLED") {
        return { ok: false, error: "Issue the purchase order to the supplier before advancing it." };
      }
      po.status = status;
      po.updatedAt = new Date().toISOString();
      appendHistory(po, "STATUS_CHANGED", actor, STATUS_LABELS[status]);
      persistDebounced();
      notify();
      return { ok: true, order: deepClone(po) };
    }

    function removeOrder(id) {
      const po = orders.get(id);
      if (!po) return { ok: false, error: "Purchase order not found" };
      if (po.status !== "DRAFT") {
        return { ok: false, error: "Only a draft purchase order can be deleted. Cancel it instead to keep the audit trail." };
      }
      orders.delete(id);
      persistDebounced();
      notify();
      return { ok: true };
    }

    /** Remaining headroom on a contract, for the PO form and the agent. */
    function contractHeadroom(contractId) {
      const contract = SAINT.contractStore.getContract(contractId);
      if (!contract) return null;
      const committed = committedAgainstContract(contractId);
      const requested = pendingRequestedAgainstContract(contractId);
      return {
        contractValue: contract.totalValue,
        committed,
        // Pending requisitions are not yet committed, but the agent must treat
        // them as spoken for or it will keep proposing against the same money.
        requested,
        remaining: contract.totalValue === null ? null : Math.round((contract.totalValue - committed) * 100) / 100,
        available:
          contract.totalValue === null
            ? null
            : Math.round((contract.totalValue - committed - requested) * 100) / 100,
        currency: contract.currency,
      };
    }

    /* -------------------------- requisitions -------------------------- */

    function nextReqNumber() {
      reqSeq += 1;
      return `REQ-${String(reqSeq).padStart(5, "0")}`;
    }

    /**
     * Raise a purchase requisition against an approved contract.
     *
     * This is the step the Spend AI Agent is allowed to perform. It is
     * deliberately NOT a purchase order: a requisition commits nothing and
     * reaches no supplier. `dedupeKey` stops a scheduled agent proposing the
     * same requisition on every run.
     */
    function createRequisition(raw, raisedBy, { dedupeKey, rationale } = {}) {
      const contract = SAINT.contractStore.getContract(raw.contractId);
      if (!contract) return { ok: false, blocked: "Select an approved contract for this requisition." };
      if (contract.status !== "APPROVED" && contract.status !== "ACTIVE") {
        return {
          ok: false,
          blocked: `Contract ${contract.contractNumber} is "${contract.status}", not approved.`,
        };
      }

      if (dedupeKey) {
        const existing = Array.from(requisitions.values()).find(
          (r) => r.dedupeKey === dedupeKey && r.status === "PENDING_APPROVAL"
        );
        if (existing) return { ok: false, duplicate: true, requisition: deepClone(existing) };
      }

      const { valid, errors, data } = validate(raw, contract);
      if (!valid) return { ok: false, errors };

      const now = new Date().toISOString();
      const record = {
        id: createId(),
        reqNumber: nextReqNumber(),
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        contractTitle: contract.title,
        supplierId: contract.supplierId,
        supplierName: contract.supplierName,
        description: data.description,
        category: data.category,
        amount: data.amount,
        currency: contract.currency,
        needByDate: data.needByDate,
        status: "PENDING_APPROVAL",
        raisedBy: raisedBy || "Unknown",
        rationale: rationale || null,
        dedupeKey: dedupeKey || null,
        createdAt: now,
        decidedBy: null,
        decidedAt: null,
        rejectionReason: null,
        purchaseOrderId: null,
      };
      requisitions.set(record.id, record);
      persistDebounced();
      notify();
      return { ok: true, requisition: deepClone(record) };
    }

    function listRequisitions({ status } = {}) {
      return Array.from(requisitions.values())
        .filter((r) => (status ? r.status === status : true))
        .map(deepClone)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    function getRequisition(id) {
      const r = requisitions.get(id);
      return r ? deepClone(r) : null;
    }

    /**
     * Approve a requisition, which creates the purchase order.
     *
     * The PO is created in DRAFT, not issued: approving the request and
     * dispatching it to the supplier stay two separate human actions, so the
     * buyer sees the finished order before it leaves the building.
     */
    function approveRequisition(id, actor) {
      const r = requisitions.get(id);
      if (!r) return { ok: false, error: "Requisition not found" };
      if (r.status !== "PENDING_APPROVAL") {
        return { ok: false, error: `This requisition is already "${REQ_STATUS_LABELS[r.status]}".` };
      }

      // Re-check the contract at approval time: it may have changed since the
      // agent proposed this, and headroom may have been consumed meanwhile.
      const created = createOrder(
        {
          contractId: r.contractId,
          description: r.description,
          amount: r.amount,
          category: r.category,
          needByDate: r.needByDate,
        },
        actor
      );
      if (!created.ok) {
        return {
          ok: false,
          error:
            created.blocked ||
            (created.errors && created.errors.amount) ||
            "The purchase order could not be created from this requisition.",
        };
      }

      r.status = "CONVERTED";
      r.decidedBy = actor || "Unknown";
      r.decidedAt = new Date().toISOString();
      r.purchaseOrderId = created.order.id;

      persistDebounced();
      notify();
      return { ok: true, requisition: deepClone(r), order: created.order };
    }

    function rejectRequisition(id, actor, reason) {
      const r = requisitions.get(id);
      if (!r) return { ok: false, error: "Requisition not found" };
      if (r.status !== "PENDING_APPROVAL") {
        return { ok: false, error: "Only a requisition awaiting approval can be rejected." };
      }
      const clean = String(reason || "").trim().slice(0, 1000);
      if (!clean) return { ok: false, error: "Give a reason so the requester knows why." };

      r.status = "REJECTED";
      r.decidedBy = actor || "Unknown";
      r.decidedAt = new Date().toISOString();
      r.rejectionReason = clean;
      persistDebounced();
      notify();
      return { ok: true, requisition: deepClone(r) };
    }

    /** Value already requested but not yet converted — the agent must not double-request. */
    function pendingRequestedAgainstContract(contractId) {
      return Array.from(requisitions.values())
        .filter((r) => r.contractId === contractId && r.status === "PENDING_APPROVAL")
        .reduce((sum, r) => sum + (r.amount || 0), 0);
    }

    /* ---------------------------- reporting --------------------------- */

    function spendStats() {
      const rows = Array.from(orders.values()).filter((p) => p.status !== "CANCELLED");
      const live = rows.filter((p) => p.status === "ISSUED" || p.status === "ACKNOWLEDGED");

      const byCategory = {};
      const bySupplier = {};
      rows.forEach((p) => {
        const cat = p.category || "Uncategorised";
        byCategory[cat] = (byCategory[cat] || 0) + p.amount;
        bySupplier[p.supplierName || "Unknown"] = (bySupplier[p.supplierName || "Unknown"] || 0) + p.amount;
      });

      return {
        totalOrders: rows.length,
        activeOrders: live.length,
        draftOrders: Array.from(orders.values()).filter((p) => p.status === "DRAFT").length,
        cancelledOrders: Array.from(orders.values()).filter((p) => p.status === "CANCELLED").length,
        totalSpend: Math.round(rows.reduce((s, p) => s + p.amount, 0) * 100) / 100,
        activeSpend: Math.round(live.reduce((s, p) => s + p.amount, 0) * 100) / 100,
        byCategory,
        bySupplier,
      };
    }

    /* ------------------------------ load ------------------------------ */

    async function load() {
      try {
        db = await openDb(DB_NAME, DB_VERSION, [
          { name: STORE_POS, keyPath: "id" },
          { name: STORE_REQS, keyPath: "id" },
          { name: STORE_META, keyPath: "key" },
        ]);
      } catch (err) {
        console.warn("SAINT.spendStore: IndexedDB unavailable, continuing in-memory only", err);
      }

      let stored = [];
      if (db) {
        try {
          stored = await getAll(db, STORE_POS);
          const storedReqs = await getAll(db, STORE_REQS);
          const seqRow = await getValue(db, STORE_META, "poSeq");
          const reqSeqRow = await getValue(db, STORE_META, "reqSeq");
          stored.forEach((p) => orders.set(p.id, p));
          storedReqs.forEach((r) => requisitions.set(r.id, r));
          seq = seqRow ? Number(seqRow.value) || 0 : 0;
          reqSeq = reqSeqRow ? Number(reqSeqRow.value) || 0 : 0;
        } catch (err) {
          console.warn("SAINT.spendStore: failed reading from IndexedDB", err);
        }
      }

      if (stored.length === 0) {
        try {
          await SAINT.contractStore.ready;
        } catch {
          /* contract store handles its own failures */
        }
        const approved = SAINT.contractStore.approvedContracts();
        if (approved.length > 0) {
          const c = approved[0];
          const created = createOrder(
            {
              contractId: c.id,
              description: "Initial platform subscription and onboarding services",
              amount: Math.min(120000, (c.totalValue || 120000) * 0.25),
              category: "IT & Telecommunications",
              needByDate: null,
            },
            "Demo Seed"
          );
          if (created.ok) issueOrder(created.order.id, "Demo Seed");
          await persist();
        }
      }
      notify();
    }

    const ready = load();

    return {
      ready,
      subscribe,
      PO_STATUSES,
      STATUS_LABELS,
      STATUS_CHIPS,
      REQ_STATUSES,
      REQ_STATUS_LABELS,
      REQ_STATUS_CHIPS,
      createRequisition,
      listRequisitions,
      getRequisition,
      approveRequisition,
      rejectRequisition,
      pendingRequestedAgainstContract,
      listOrders,
      getOrder,
      createOrder,
      issueOrder,
      setStatus,
      removeOrder,
      contractHeadroom,
      committedAgainstContract,
      spendStats,
    };
  }

  SAINT.spendStore = createSpendStore();
})(window);
