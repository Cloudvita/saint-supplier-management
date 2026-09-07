/**
 * SAINT.contractStore — contract records, the analyst→manager approval
 * workflow, and the clause review results.
 *
 * Same shape as js/store.js: a Map keyed by id, pub/sub, debounced IndexedDB
 * writes, defensive copies out. Contracts reference a supplier by id only —
 * this store never reaches into SAINT.store's records.
 *
 * The workflow is enforced here rather than in the UI. A component can hide
 * the Approve button, but the rule that an analyst cannot approve their own
 * contract, and that a contract missing a mandatory clause cannot be approved
 * at all, belongs where it cannot be bypassed by a different button.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  const { createId, deepClone, debounce } = SAINT.utils;
  const { reviewContract, buildDemoContracts, CONTRACT_TYPES, RENEWAL_TYPES, PAYMENT_TERMS } = SAINT.contractData;
  const { openDb, getAll, replaceAll, getValue, putValue } = SAINT.idb;

  const DB_NAME = "saint-contract-db";
  // v2 adds the notifications store the Contract AI Agent writes to. Bumping
  // the version runs onupgradeneeded, which creates it without touching the
  // contracts already stored.
  const DB_VERSION = 2;
  const STORE_CONTRACTS = "contracts";
  const STORE_NOTIFICATIONS = "notifications";
  const STORE_META = "meta";

  function createContractStore() {
    /** @type {Map<string, object>} */
    const contracts = new Map();
    /** @type {Map<string, object>} Agent-raised notifications. */
    const notifications = new Map();
    let seq = 0;
    const listeners = new Set();
    let db = null;

    function notify() {
      Array.from(listeners).forEach((fn) => {
        try {
          fn();
        } catch (err) {
          console.error("SAINT.contractStore listener failed", err);
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
          replaceAll(db, STORE_CONTRACTS, Array.from(contracts.values())),
          replaceAll(db, STORE_NOTIFICATIONS, Array.from(notifications.values())),
          putValue(db, STORE_META, { key: "contractSeq", value: seq }),
        ]);
      } catch (err) {
        console.warn("SAINT.contractStore: persistence failed, continuing in-memory only", err);
      }
    }
    const persistDebounced = debounce(persist, 250);

    function nextContractNumber() {
      seq += 1;
      return `CTR-${String(seq).padStart(5, "0")}`;
    }

    /* --------------------------- validation --------------------------- */

    function validate(raw) {
      const errors = {};
      const clean = (v, max) => String(v === undefined || v === null ? "" : v).trim().slice(0, max);

      const title = clean(raw.title, 200);
      const supplierId = clean(raw.supplierId, 64);
      const contractType = CONTRACT_TYPES.includes(raw.contractType) ? raw.contractType : "MSA";
      const renewalType = RENEWAL_TYPES.includes(raw.renewalType) ? raw.renewalType : "MANUAL";
      const paymentTerms = PAYMENT_TERMS.includes(raw.paymentTerms) ? raw.paymentTerms : "NET30";

      if (title.length < 3) errors.title = "Contract title is required (at least 3 characters).";
      if (!supplierId) errors.supplierId = "Select the supplier this contract is with.";

      let totalValue = null;
      if (raw.totalValue !== "" && raw.totalValue !== null && raw.totalValue !== undefined) {
        const n = Number(raw.totalValue);
        if (!Number.isFinite(n) || n < 0) errors.totalValue = "Enter the contract value as a positive number.";
        else totalValue = Math.round(n * 100) / 100;
      }

      const effectiveDate = clean(raw.effectiveDate, 10) || null;
      const expiryDate = clean(raw.expiryDate, 10) || null;
      if (effectiveDate && expiryDate && expiryDate < effectiveDate) {
        errors.expiryDate = "Expiry date cannot be before the effective date.";
      }

      let noticePeriodDays = 0;
      if (raw.noticePeriodDays !== "" && raw.noticePeriodDays !== null && raw.noticePeriodDays !== undefined) {
        const n = Number(raw.noticePeriodDays);
        if (!Number.isFinite(n) || n < 0 || n > 730) errors.noticePeriodDays = "Notice period must be between 0 and 730 days.";
        else noticePeriodDays = Math.round(n);
      }

      return {
        valid: Object.keys(errors).length === 0,
        errors,
        data: {
          title,
          supplierId,
          contractType,
          renewalType,
          paymentTerms,
          totalValue,
          currency: clean(raw.currency, 3).toUpperCase() || "USD",
          effectiveDate,
          expiryDate,
          noticePeriodDays,
          termsText: clean(raw.termsText, 40000),
          notes: clean(raw.notes, 4000),
        },
      };
    }

    /* ----------------------------- audit ------------------------------ */

    function appendHistory(contract, action, actor, detail) {
      contract.history.push({
        at: new Date().toISOString(),
        action,
        actor: actor || "Unknown",
        detail: detail || null,
      });
    }

    /* ------------------------------ CRUD ------------------------------ */

    function listContracts({ q, status, supplierId } = {}) {
      let rows = Array.from(contracts.values());
      const term = (q || "").trim().toLowerCase();
      if (term) {
        rows = rows.filter((c) =>
          [c.title, c.contractNumber, c.supplierName, c.contractType].some((f) => f && f.toLowerCase().includes(term))
        );
      }
      if (status) rows = rows.filter((c) => c.status === status);
      if (supplierId) rows = rows.filter((c) => c.supplierId === supplierId);
      return rows.map(deepClone).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    function getContract(id) {
      const c = contracts.get(id);
      return c ? deepClone(c) : null;
    }

    /** Approved (or already active) contracts — the only ones Spend may raise a PO against. */
    function approvedContracts() {
      return Array.from(contracts.values())
        .filter((c) => c.status === "APPROVED" || c.status === "ACTIVE")
        .map(deepClone)
        .sort((a, b) => a.title.localeCompare(b.title));
    }

    function createContract(raw, actor) {
      const { valid, errors, data } = validate(raw);
      if (!valid) return { ok: false, errors };

      const now = new Date().toISOString();
      const record = {
        id: createId(),
        contractNumber: nextContractNumber(),
        ...data,
        supplierName: raw.supplierName || "",
        status: "DRAFT",
        review: null,
        createdBy: actor || "Unknown",
        createdAt: now,
        updatedAt: now,
        submittedBy: null,
        submittedAt: null,
        approvedBy: null,
        approvedAt: null,
        rejectionReason: null,
        history: [],
      };
      appendHistory(record, "CREATED", actor, `Drafted as ${record.contractNumber}`);
      // Review runs on write so the register always shows a current risk
      // position, rather than only after somebody opens the contract.
      record.review = reviewContract(record);
      contracts.set(record.id, record);

      persistDebounced();
      notify();
      return { ok: true, contract: deepClone(record) };
    }

    /**
     * Edit contract metadata.
     *
     * Refused once the contract is approved: changing the value or terms of an
     * approved agreement after the fact would invalidate the approval that a
     * purchase order relies on. Reject it and re-draft instead.
     */
    function updateContract(id, raw, actor) {
      const c = contracts.get(id);
      if (!c) return { ok: false, errors: { title: "Contract not found." } };
      if (c.status === "APPROVED" || c.status === "ACTIVE") {
        return {
          ok: false,
          errors: {},
          blocked: "This contract is already approved. Approved terms cannot be edited — reject it first if it must change.",
        };
      }

      const { valid, errors, data } = validate(raw);
      if (!valid) return { ok: false, errors };

      Object.assign(c, data, {
        supplierName: raw.supplierName || c.supplierName,
        updatedAt: new Date().toISOString(),
      });
      // A rejected contract that gets edited returns to draft for resubmission.
      if (c.status === "REJECTED") {
        c.status = "DRAFT";
        c.rejectionReason = null;
      }
      c.review = reviewContract(c);
      appendHistory(c, "UPDATED", actor, "Metadata revised");

      persistDebounced();
      notify();
      return { ok: true, contract: deepClone(c) };
    }

    function removeContract(id, actor) {
      const c = contracts.get(id);
      if (!c) return { ok: false, error: "Contract not found" };
      if (c.status === "APPROVED" || c.status === "ACTIVE") {
        return { ok: false, error: "An approved contract cannot be deleted — it may already carry purchase orders." };
      }
      contracts.delete(id);
      persistDebounced();
      notify();
      return { ok: true, removed: { id, contractNumber: c.contractNumber, title: c.title } };
    }

    /** Re-run the clause review on demand and store the result. */
    function runReview(id) {
      const c = contracts.get(id);
      if (!c) return { ok: false, error: "Contract not found" };
      c.review = reviewContract(c);
      c.updatedAt = new Date().toISOString();
      persistDebounced();
      notify();
      return { ok: true, review: deepClone(c.review) };
    }

    /* ---------------------------- workflow ---------------------------- */

    /** Analyst hands the contract to a manager for approval. */
    function submitForApproval(id, actor) {
      const c = contracts.get(id);
      if (!c) return { ok: false, error: "Contract not found" };
      if (c.status !== "DRAFT" && c.status !== "REJECTED") {
        return { ok: false, error: `A contract in "${c.status}" cannot be submitted.` };
      }
      if (!c.termsText || !c.termsText.trim()) {
        return { ok: false, error: "Paste the contract terms before submitting — approval requires a clause review." };
      }

      c.review = reviewContract(c);
      c.status = "PENDING_APPROVAL";
      c.submittedBy = actor || "Unknown";
      c.submittedAt = new Date().toISOString();
      c.updatedAt = c.submittedAt;
      c.rejectionReason = null;
      appendHistory(c, "SUBMITTED", actor, "Sent for sourcing manager approval");

      persistDebounced();
      notify();
      return { ok: true, contract: deepClone(c) };
    }

    /**
     * Manager approves.
     *
     * Two rules enforced here, not in the UI:
     *  - the contract must carry every mandatory clause; and
     *  - the approver must not be the person who submitted it.
     */
    function approve(id, actor, { approvalLimit } = {}) {
      const c = contracts.get(id);
      if (!c) return { ok: false, error: "Contract not found" };
      if (c.status !== "PENDING_APPROVAL") {
        return { ok: false, error: "Only a contract pending approval can be approved." };
      }

      const review = reviewContract(c);
      c.review = review;
      if (!review.approvable) {
        persistDebounced();
        notify();
        return { ok: false, error: review.verdict, review: deepClone(review) };
      }
      if (actor && c.submittedBy && actor === c.submittedBy) {
        return {
          ok: false,
          error: "You submitted this contract, so you cannot also approve it. Segregation of duties requires a second person.",
        };
      }
      if (approvalLimit !== null && approvalLimit !== undefined && c.totalValue && c.totalValue > approvalLimit) {
        return {
          ok: false,
          error: `Contract value ${c.currency} ${c.totalValue.toLocaleString()} exceeds your approval limit of ${c.currency} ${Number(
            approvalLimit
          ).toLocaleString()}. Escalate to a higher authority.`,
        };
      }

      c.status = "APPROVED";
      c.approvedBy = actor || "Unknown";
      c.approvedAt = new Date().toISOString();
      c.updatedAt = c.approvedAt;
      appendHistory(c, "APPROVED", actor, "Approved for purchase order issuance");

      persistDebounced();
      notify();
      return { ok: true, contract: deepClone(c) };
    }

    function reject(id, actor, reason) {
      const c = contracts.get(id);
      if (!c) return { ok: false, error: "Contract not found" };
      if (c.status !== "PENDING_APPROVAL") {
        return { ok: false, error: "Only a contract pending approval can be rejected." };
      }
      const cleanReason = String(reason || "").trim().slice(0, 1000);
      if (!cleanReason) return { ok: false, error: "Give a reason so the analyst knows what to fix." };

      c.status = "REJECTED";
      c.rejectionReason = cleanReason;
      c.updatedAt = new Date().toISOString();
      appendHistory(c, "REJECTED", actor, cleanReason);

      persistDebounced();
      notify();
      return { ok: true, contract: deepClone(c) };
    }

    /* -------------------------- notifications ------------------------- */

    /**
     * Raise an agent notification.
     *
     * `dedupeKey` is what stops a scheduled agent from re-notifying about the
     * same contract on every run: a key that already has an open notification
     * is skipped rather than duplicated. Dismissing one clears the way for the
     * next genuine occurrence.
     */
    function raiseNotification({ kind, contractId, dedupeKey, severity, title, detail, recipient }) {
      const existing = Array.from(notifications.values()).find(
        (n) => n.dedupeKey === dedupeKey && n.status === "OPEN"
      );
      if (existing) return { ok: false, duplicate: true, notification: deepClone(existing) };

      const record = {
        id: createId(),
        kind,
        contractId: contractId || null,
        dedupeKey,
        severity: severity || "MEDIUM",
        title,
        detail: detail || null,
        recipient: recipient || null,
        status: "OPEN",
        createdAt: new Date().toISOString(),
      };
      notifications.set(record.id, record);
      persistDebounced();
      notify();
      return { ok: true, notification: deepClone(record) };
    }

    function listNotifications({ status } = {}) {
      const rank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
      return Array.from(notifications.values())
        .filter((n) => (status ? n.status === status : true))
        .map(deepClone)
        .sort(
          (a, b) =>
            (rank[b.severity] || 0) - (rank[a.severity] || 0) ||
            new Date(b.createdAt) - new Date(a.createdAt)
        );
    }

    function dismissNotification(id) {
      const n = notifications.get(id);
      if (!n) return { ok: false };
      n.status = "DISMISSED";
      n.dismissedAt = new Date().toISOString();
      persistDebounced();
      notify();
      return { ok: true };
    }

    function dismissAllNotifications() {
      let changed = false;
      notifications.forEach((n) => {
        if (n.status === "OPEN") {
          n.status = "DISMISSED";
          n.dismissedAt = new Date().toISOString();
          changed = true;
        }
      });
      if (changed) {
        persistDebounced();
        notify();
      }
      return { ok: true };
    }

    /* ---------------------------- reporting --------------------------- */

    function contractStats() {
      const rows = Array.from(contracts.values());
      const active = rows.filter((c) => c.status === "APPROVED" || c.status === "ACTIVE");
      const byStatus = {};
      rows.forEach((c) => {
        byStatus[c.status] = (byStatus[c.status] || 0) + 1;
      });
      return {
        total: rows.length,
        active: active.length,
        pendingApproval: rows.filter((c) => c.status === "PENDING_APPROVAL").length,
        draft: rows.filter((c) => c.status === "DRAFT").length,
        rejected: rows.filter((c) => c.status === "REJECTED").length,
        nonCompliant: rows.filter((c) => c.review && c.review.missing.length > 0).length,
        totalValue: active.reduce((sum, c) => sum + (c.totalValue || 0), 0),
        byStatus,
      };
    }

    /* ------------------------------ load ------------------------------ */

    function seedDemo() {
      // Demo contracts attach to whichever suppliers the supplier store seeded,
      // so the two modules line up on a first run.
      const suppliers = SAINT.store.allSuppliers ? SAINT.store.allSuppliers() : [];
      if (suppliers.length === 0) return false;

      buildDemoContracts().forEach((demo, i) => {
        const supplier = suppliers[i % suppliers.length];
        const result = createContract(
          { ...demo, supplierId: supplier.id, supplierName: supplier.legalName },
          "Demo Seed"
        );
        if (!result.ok) return;
        const c = contracts.get(result.contract.id);
        if (demo.seedStatus === "PENDING_APPROVAL") {
          c.status = "PENDING_APPROVAL";
          c.submittedBy = "Ana Lyst (Sourcing Analyst)";
          c.submittedAt = new Date().toISOString();
          appendHistory(c, "SUBMITTED", c.submittedBy, "Sent for sourcing manager approval");
        } else if (demo.seedStatus === "APPROVED") {
          c.status = "APPROVED";
          c.submittedBy = "Ana Lyst (Sourcing Analyst)";
          c.submittedAt = new Date().toISOString();
          c.approvedBy = "Mo Nager (Sourcing Manager)";
          c.approvedAt = new Date().toISOString();
          appendHistory(c, "SUBMITTED", c.submittedBy, "Sent for sourcing manager approval");
          appendHistory(c, "APPROVED", c.approvedBy, "Approved for purchase order issuance");
        }
      });
      return true;
    }

    async function load() {
      try {
        db = await openDb(DB_NAME, DB_VERSION, [
          { name: STORE_CONTRACTS, keyPath: "id" },
          { name: STORE_NOTIFICATIONS, keyPath: "id" },
          { name: STORE_META, keyPath: "key" },
        ]);
      } catch (err) {
        console.warn("SAINT.contractStore: IndexedDB unavailable, continuing in-memory only", err);
      }

      let stored = [];
      if (db) {
        try {
          stored = await getAll(db, STORE_CONTRACTS);
          const storedNotifications = await getAll(db, STORE_NOTIFICATIONS);
          const seqRow = await getValue(db, STORE_META, "contractSeq");
          stored.forEach((c) => contracts.set(c.id, c));
          storedNotifications.forEach((n) => notifications.set(n.id, n));
          seq = seqRow ? Number(seqRow.value) || 0 : 0;
        } catch (err) {
          console.warn("SAINT.contractStore: failed reading from IndexedDB", err);
        }
      }

      if (stored.length === 0) {
        // Wait for the supplier store so demo contracts can reference real suppliers.
        try {
          await SAINT.store.ready;
        } catch {
          /* supplier store handles its own failures */
        }
        if (seedDemo()) await persist();
      }
      notify();
    }

    const ready = load();

    return {
      ready,
      subscribe,
      listContracts,
      getContract,
      approvedContracts,
      createContract,
      updateContract,
      removeContract,
      runReview,
      submitForApproval,
      approve,
      reject,
      raiseNotification,
      listNotifications,
      dismissNotification,
      dismissAllNotifications,
      contractStats,
    };
  }

  SAINT.contractStore = createContractStore();
})(window);
