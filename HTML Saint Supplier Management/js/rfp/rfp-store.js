/**
 * SAINT.rfpStore — persistence + state for the RFP tab (vendor directory,
 * dispatched RFPs, per-vendor scoring, evaluation weights). Same design as
 * js/store.js: Map()s keyed by id, pub/sub, debounced localStorage writes.
 * Deliberately separate from SAINT.store — vendors here are RFP-response
 * vendors, not the supplier master data on the other tabs.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  const { createId, deepClone, debounce } = SAINT.utils;
  const { DEFAULT_VENDORS, DEFAULT_PARAMETERS, DEFAULT_WEIGHTS, generateMockRfp } = SAINT.rfpData;

  const VENDORS_KEY = "saint.rfp.vendors.v1";
  const RFPS_KEY = "saint.rfp.records.v1";
  const WEIGHTS_KEY = "saint.rfp.weights.v1";
  const SEQ_KEY = "saint.rfp.seq.v1";

  function safeParse(json, fallback) {
    if (!json) return fallback;
    try {
      return JSON.parse(json) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function createRfpStore() {
    /** @type {Map<string, object>} */
    const vendors = new Map();
    /** @type {Map<string, object>} */
    const rfps = new Map();
    let weights = { ...DEFAULT_WEIGHTS };
    let seq = 0;
    const listeners = new Set();

    function notify() {
      Array.from(listeners).forEach((fn) => {
        try {
          fn();
        } catch (err) {
          console.error("SAINT.rfpStore listener failed", err);
        }
      });
    }

    function persist() {
      try {
        localStorage.setItem(VENDORS_KEY, JSON.stringify(Array.from(vendors.values())));
        localStorage.setItem(RFPS_KEY, JSON.stringify(Array.from(rfps.values())));
        localStorage.setItem(WEIGHTS_KEY, JSON.stringify(weights));
        localStorage.setItem(SEQ_KEY, String(seq));
      } catch (err) {
        console.warn("SAINT.rfpStore: persistence failed, continuing in-memory only", err);
      }
    }
    const persistDebounced = debounce(persist, 250);

    function subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }

    function defaultScoreRow(vendorName, index) {
      const row = { vendor: vendorName, notes: `Evaluator feedback for ${vendorName}.`, params: {} };
      const base = 9 - index;
      DEFAULT_PARAMETERS.forEach((p, i) => {
        const nudge = p.length % 2 === 0 ? 1 : -1;
        row.params[p] = Math.max(Math.min(base + nudge, 10), 5);
      });
      return row;
    }

    function load() {
      const storedVendors = safeParse(localStorage.getItem(VENDORS_KEY), null);
      const storedRfps = safeParse(localStorage.getItem(RFPS_KEY), null);
      const storedWeights = safeParse(localStorage.getItem(WEIGHTS_KEY), null);
      const storedSeq = Number(localStorage.getItem(SEQ_KEY) || 0);

      if (Array.isArray(storedVendors) && storedVendors.length > 0) {
        storedVendors.forEach((v) => vendors.set(v.id, v));
      } else {
        DEFAULT_VENDORS.forEach((v) => {
          const id = createId();
          vendors.set(id, { id, name: v.name, poc: v.poc, email: v.email, selected: true });
        });
      }

      if (Array.isArray(storedRfps)) storedRfps.forEach((r) => rfps.set(r.id, r));
      if (storedWeights && typeof storedWeights === "object") weights = storedWeights;
      seq = Number.isFinite(storedSeq) ? storedSeq : 0;

      persist();
    }

    /* -------------------------- vendors -------------------------- */

    function listVendors() {
      return Array.from(vendors.values()).map(deepClone);
    }

    /** Supplier ids already pulled into the RFP vendor directory (via
     * addVendor's sourceSupplierId) — used by the UI to avoid offering the
     * same supplier for import twice. */
    function importedSupplierIds() {
      return new Set(Array.from(vendors.values()).map((v) => v.sourceSupplierId).filter(Boolean));
    }

    function addVendor({ name, poc, email, sourceSupplierId }) {
      const cleanName = (name || "").trim().slice(0, 200);
      const cleanPoc = (poc || "").trim().slice(0, 200);
      const cleanEmail = (email || "").trim().slice(0, 200);
      if (!cleanName || !cleanPoc || !cleanEmail) {
        return { ok: false, error: "Vendor name, point of contact, and email are all required." };
      }
      const id = createId();
      vendors.set(id, {
        id,
        name: cleanName,
        poc: cleanPoc,
        email: cleanEmail,
        selected: true,
        sourceSupplierId: sourceSupplierId || null,
      });
      persistDebounced();
      notify();
      return { ok: true, vendor: deepClone(vendors.get(id)) };
    }

    function updateVendor(id, patch) {
      const v = vendors.get(id);
      if (!v) return;
      if (typeof patch.name === "string") v.name = patch.name.trim().slice(0, 200) || v.name;
      if (typeof patch.poc === "string") v.poc = patch.poc.trim().slice(0, 200) || v.poc;
      if (typeof patch.email === "string") v.email = patch.email.trim().slice(0, 200) || v.email;
      if (typeof patch.selected === "boolean") v.selected = patch.selected;
      persistDebounced();
      notify();
    }

    function removeVendor(id) {
      if (vendors.delete(id)) {
        persistDebounced();
        notify();
      }
    }

    /* --------------------------- weights --------------------------- */

    function getWeights() {
      return { ...weights };
    }

    /** Normalizes raw slider values (1-50) to fractions summing to 1, same as the
     * original app's `new_weights / total_w` normalization. */
    function setWeights(rawWeights) {
      const total = DEFAULT_PARAMETERS.reduce((sum, p) => sum + (Number(rawWeights[p]) || 0), 0) || 1;
      const normalized = {};
      DEFAULT_PARAMETERS.forEach((p) => {
        normalized[p] = (Number(rawWeights[p]) || 0) / total;
      });
      weights = normalized;
      persistDebounced();
      notify();
    }

    /* ---------------------------- RFPs ----------------------------- */

    function listRfps() {
      return Array.from(rfps.values())
        .map(deepClone)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    function getRfp(id) {
      const r = rfps.get(id);
      return r ? deepClone(r) : null;
    }

    /** Dispatch a generated RFP to the given vendors — creates the historical
     * record and seeds default per-vendor score rows, mirroring the original
     * app's instant-testing defaults so Evaluation has something to show. */
    function createRfp({ title, rfpText, dispatchedVendors }) {
      if (!dispatchedVendors || dispatchedVendors.length === 0) {
        return { ok: false, error: "Select at least one vendor to dispatch to." };
      }
      seq += 1;
      const id = `RFP-${String(seq).padStart(4, "0")}`;
      const record = {
        id,
        title: (title || "Untitled RFP").trim().slice(0, 200),
        createdAt: new Date().toISOString(),
        rfpText,
        dispatchedVendors: dispatchedVendors.map((v) => v.name),
        status: "Dispatched",
        winningVendor: "Pending Evaluation",
        scoreRows: dispatchedVendors.map((v, i) => defaultScoreRow(v.name, i)),
        finalScores: null,
      };
      rfps.set(id, record);
      persistDebounced();
      notify();
      return { ok: true, rfp: deepClone(record) };
    }

    function updateScoreRow(rfpId, vendorName, patch) {
      const r = rfps.get(rfpId);
      if (!r) return;
      const row = r.scoreRows.find((s) => s.vendor === vendorName);
      if (!row) return;
      if (patch.notes !== undefined) row.notes = String(patch.notes).slice(0, 2000);
      if (patch.param && DEFAULT_PARAMETERS.includes(patch.param)) {
        row.params[patch.param] = Math.max(1, Math.min(10, Number(patch.value) || 1));
      }
      persistDebounced();
      notify();
    }

    /** Weighted scores for an RFP's current score rows, highest first — pure
     * read, does not mutate or persist. */
    function computeWeightedScores(rfpId) {
      const r = rfps.get(rfpId);
      if (!r) return [];
      return r.scoreRows
        .map((row) => {
          let total = 0;
          DEFAULT_PARAMETERS.forEach((p) => {
            total += (row.params[p] || 0) * (weights[p] || 0);
          });
          return { vendor: row.vendor, notes: row.notes, params: { ...row.params }, weightedScore: Math.round(total * 100) / 100 };
        })
        .sort((a, b) => b.weightedScore - a.weightedScore);
    }

    function saveEvaluation(rfpId) {
      const r = rfps.get(rfpId);
      if (!r) return { ok: false };
      const ranked = computeWeightedScores(rfpId);
      r.finalScores = ranked;
      r.winningVendor = ranked[0] ? ranked[0].vendor : "Pending Evaluation";
      r.status = "Evaluated & Awarded";
      persistDebounced();
      notify();
      return { ok: true, winner: r.winningVendor };
    }

    function cpoStats() {
      const all = Array.from(rfps.values());
      const awarded = all.filter((r) => r.winningVendor !== "Pending Evaluation").length;
      const uniqueVendors = new Set();
      all.forEach((r) => r.dispatchedVendors.forEach((v) => uniqueVendors.add(v)));
      return {
        totalRfps: all.length,
        awardedRfps: awarded,
        pendingRfps: all.length - awarded,
        uniqueVendors: uniqueVendors.size,
      };
    }

    load();

    return {
      subscribe,
      listVendors,
      importedSupplierIds,
      addVendor,
      updateVendor,
      removeVendor,
      getWeights,
      setWeights,
      listRfps,
      getRfp,
      createRfp,
      updateScoreRow,
      computeWeightedScores,
      saveEvaluation,
      cpoStats,
      generateMockRfp,
    };
  }

  SAINT.rfpStore = createRfpStore();
})(window);
