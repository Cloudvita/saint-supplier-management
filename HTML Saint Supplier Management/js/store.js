/**
 * SAINT.store — the app's single source of truth.
 *
 * Design notes:
 * - Suppliers/alerts are kept in Map()s keyed by id for O(1) lookup/update
 *   instead of scanning arrays on every render.
 * - Persistence lives in IndexedDB (via SAINT.idb), not localStorage — its
 *   quota is typically hundreds of MB to a few GB rather than localStorage's
 *   ~5-10MB per origin, which is what actually caps how many suppliers a
 *   browser tab can hold. Writes are debounced so rapid changes (e.g.
 *   dismissing several alerts) coalesce into one transaction instead of one
 *   per mutation. Any data from this app's earlier localStorage-only version
 *   is migrated in automatically on first load (see migrateFromLocalStorage).
 * - A minimal pub/sub lets UI modules re-render on change without polling;
 *   subscribe() returns an unsubscribe function so listeners can always be
 *   torn down cleanly (no accumulating callbacks across hot-reloads/tests).
 *   Because the initial IndexedDB read is async, components render once
 *   immediately (against whatever's in memory, initially nothing) and again
 *   automatically via notify() once load() resolves — no boot sequencing
 *   needed elsewhere.
 * - Raw tax IDs are never retained: validateSupplier() extracts the digits,
 *   the store immediately reduces them to { taxIdType, taxIdLast4 } and the
 *   digit string is discarded before this function returns.
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});
  const { createId, deepClone, debounce } = SAINT.utils;
  const { validateSupplier, maskTaxId } = SAINT.validation;
  const { buildDemoRows, generateNewsDigest } = SAINT.demoData;
  const { openDb, getAll, replaceAll, getValue, putValue } = SAINT.idb;

  const DB_NAME = "saint-supplier-db";
  const DB_VERSION = 1;
  const STORE_SUPPLIERS = "suppliers";
  const STORE_ALERTS = "alerts";
  const STORE_META = "meta";

  // Pre-IndexedDB (localStorage) keys — read once for a one-time import, then cleared.
  const LEGACY_STORAGE_KEY = "saint.suppliers.v1";
  const LEGACY_ALERTS_KEY = "saint.alerts.v1";
  const LEGACY_SEQ_KEY = "saint.supplierSeq.v1";

  const DEMO_MANAGER_EMAIL = "procurement.manager@example.com";

  function safeParse(json, fallback) {
    if (!json) return fallback;
    try {
      const parsed = JSON.parse(json);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function createStore() {
    /** @type {Map<string, object>} */
    const suppliers = new Map();
    /** @type {Map<string, object>} */
    const alerts = new Map();
    let seq = 0;
    const listeners = new Set();

    function notify() {
      // Iterate a snapshot so a listener that unsubscribes mid-notify can't
      // mutate the Set out from under this loop.
      Array.from(listeners).forEach((fn) => {
        try {
          fn();
        } catch (err) {
          console.error("SAINT.store listener failed", err);
        }
      });
    }

    let db = null; // set once openDb() resolves; persist()/load() no-op gracefully until then

    async function persist() {
      if (!db) return; // IndexedDB unavailable or not yet open — stay in-memory only
      try {
        await Promise.all([
          replaceAll(db, STORE_SUPPLIERS, Array.from(suppliers.values())),
          replaceAll(db, STORE_ALERTS, Array.from(alerts.values())),
          putValue(db, STORE_META, { key: "supplierSeq", value: seq }),
        ]);
      } catch (err) {
        // Quota exceeded or storage disabled (private browsing, etc.) — the
        // in-memory state is still correct, just not durable. Don't throw.
        console.warn("SAINT.store: IndexedDB persistence failed, continuing in-memory only", err);
      }
    }
    const persistDebounced = debounce(persist, 250);

    function subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }

    /** One-time import of data saved by this app's earlier localStorage-only
     * version, so switching to IndexedDB doesn't silently drop anything a
     * user already added. Only runs when IndexedDB has no supplier data yet. */
    function migrateFromLocalStorage() {
      const storedSuppliers = safeParse(localStorage.getItem(LEGACY_STORAGE_KEY), null);
      if (!Array.isArray(storedSuppliers) || storedSuppliers.length === 0) return false;

      const storedAlerts = safeParse(localStorage.getItem(LEGACY_ALERTS_KEY), null);
      const storedSeq = Number(localStorage.getItem(LEGACY_SEQ_KEY) || 0);

      storedSuppliers.forEach((s) => suppliers.set(s.id, s));
      (storedAlerts || []).forEach((a) => alerts.set(a.id, a));
      seq = Number.isFinite(storedSeq) && storedSeq > 0 ? storedSeq : storedSuppliers.length;
      return true;
    }

    async function load() {
      try {
        db = await openDb(DB_NAME, DB_VERSION, [
          { name: STORE_SUPPLIERS, keyPath: "id" },
          { name: STORE_ALERTS, keyPath: "id" },
          { name: STORE_META, keyPath: "key" },
        ]);
      } catch (err) {
        console.warn("SAINT.store: IndexedDB unavailable, continuing in-memory only", err);
      }

      let storedSuppliers = [];
      if (db) {
        try {
          storedSuppliers = await getAll(db, STORE_SUPPLIERS);
          const storedAlerts = await getAll(db, STORE_ALERTS);
          const seqRow = await getValue(db, STORE_META, "supplierSeq");
          storedSuppliers.forEach((s) => suppliers.set(s.id, s));
          storedAlerts.forEach((a) => alerts.set(a.id, a));
          seq = seqRow ? Number(seqRow.value) || 0 : 0;
        } catch (err) {
          console.warn("SAINT.store: failed reading from IndexedDB, continuing in-memory only", err);
        }
      }

      if (storedSuppliers.length === 0) {
        const migrated = migrateFromLocalStorage();
        if (migrated) {
          await persist();
          try {
            localStorage.removeItem(LEGACY_STORAGE_KEY);
            localStorage.removeItem(LEGACY_ALERTS_KEY);
            localStorage.removeItem(LEGACY_SEQ_KEY);
          } catch {
            /* not critical if cleanup fails */
          }
        } else {
          await seedDemoData();
        }
      }

      notify(); // components already rendered once against empty state — refresh them now
    }

    async function seedDemoData() {
      const rows = buildDemoRows(DEMO_MANAGER_EMAIL);
      rows.forEach((row) => {
        addSupplierInternal(row, { silent: true });
      });
      await persist();
    }

    function nextSupplierCode() {
      seq += 1;
      return `SUP-${String(seq).padStart(6, "0")}`;
    }

    function toPublicSupplier(s) {
      // Defensive copy — callers (renderers) must never receive a live
      // reference they could mutate behind the store's back.
      return deepClone(s);
    }

    function addSupplierInternal(rawFields, opts) {
      const { valid, errors, data } = validateSupplier(rawFields);
      if (!valid) return { ok: false, errors };

      const now = new Date().toISOString();
      const taxIdLast4 = data.taxIdDigits ? data.taxIdDigits.slice(-4) : null;
      const record = {
        id: createId(),
        supplierCode: nextSupplierCode(),
        legalName: data.legalName,
        dbaName: data.dbaName,
        companyType: data.companyType,
        tickerSymbol: data.tickerSymbol,
        taxClassification: data.taxClassification,
        taxIdType: taxIdLast4 ? data.taxIdType : null,
        taxIdLast4, // full tax id is never stored — only the last 4 digits + type
        contactName: data.contactName,
        contactEmail: data.contactEmail,
        contactPhone: data.contactPhone,
        website: data.website,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        city: data.city,
        state: data.state,
        postalCode: data.postalCode,
        country: data.country,
        category: data.category,
        paymentTerms: data.paymentTerms,
        currency: data.currency,
        status: data.status,
        diverseSupplier: data.diverseSupplier,
        newsCadence: data.newsCadence,
        marketNews: data.marketNews,
        marketNewsUpdated: data.marketNews ? now : null,
        newsKeywords: data.newsKeywords,
        alertsEnabled: data.alertsEnabled,
        procurementManagerEmail: data.procurementManagerEmail,
        w9: rawFields.w9Draft
          ? {
              fileName: rawFields.w9Draft.fileName,
              contentType: rawFields.w9Draft.contentType,
              sizeBytes: rawFields.w9Draft.sizeBytes,
              simulated: true,
            }
          : null,
        createdAt: now,
        updatedAt: now,
      };
      suppliers.set(record.id, record);

      if (!opts || !opts.silent) {
        persistDebounced();
        notify();
      }
      return { ok: true, supplier: toPublicSupplier(record) };
    }

    function addSupplier(rawFields) {
      return addSupplierInternal(rawFields, { silent: false });
    }

    function getSupplier(id) {
      const s = suppliers.get(id);
      return s ? toPublicSupplier(s) : null;
    }

    function openAlertsFor(supplierId) {
      return Array.from(alerts.values())
        .filter((a) => a.supplierId === supplierId && (a.status === "NEW" || a.status === "NOTIFIED"))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    /** List suppliers newest-first, optionally filtered — mirrors GET /api/suppliers. */
    function listSuppliers({ q, companyType, limit } = {}) {
      let rows = Array.from(suppliers.values());

      const term = (q || "").trim().toLowerCase();
      if (term) {
        rows = rows.filter((s) =>
          [s.legalName, s.dbaName, s.supplierCode, s.category].some(
            (field) => field && field.toLowerCase().includes(term)
          )
        );
      }
      if (companyType === "PUBLIC" || companyType === "PRIVATE") {
        rows = rows.filter((s) => s.companyType === companyType);
      }

      rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const total = rows.length;
      if (limit) rows = rows.slice(0, limit);

      const withAlerts = rows.map((s) => ({
        ...toPublicSupplier(s),
        taxIdMasked: maskTaxId(s.taxIdLast4, s.taxIdType),
        riskAlerts: openAlertsFor(s.id),
      }));

      return { rows: withAlerts, total };
    }

    const SEVERITY_THRESHOLD = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

    /** Shared by refreshSupplierNews() and runGenieScanAll(): pulls a fresh digest
     * for one supplier and raises risk alerts (MEDIUM+) when it opted in. Mutates
     * the record in place but never persists/notifies — callers own that. */
    function applyNewsRefresh(s) {
      const { digest, riskEvents } = generateNewsDigest(s.legalName, s.newsCadence, s.newsKeywords, s.tickerSymbol);
      s.marketNews = digest;
      s.marketNewsUpdated = new Date().toISOString();
      s.updatedAt = s.marketNewsUpdated;

      const createdAlerts = [];
      if (s.alertsEnabled) {
        riskEvents
          .filter((e) => SEVERITY_THRESHOLD[e.severity] >= SEVERITY_THRESHOLD.MEDIUM)
          .forEach((e) => {
            const alert = {
              id: createId(),
              supplierId: s.id,
              eventType: e.eventType,
              severity: e.severity,
              title: e.headline,
              detail: null,
              sourceUrl: null,
              status: "NEW",
              createdAt: new Date().toISOString(),
            };
            alerts.set(alert.id, alert);
            createdAlerts.push(alert);
          });
      }
      return { riskEvents, createdAlerts };
    }

    /** Simulated "pull latest news" — writes marketNews and raises risk alerts
     * for anything at MEDIUM severity or above, when the supplier opted in. */
    function refreshSupplierNews(id) {
      const s = suppliers.get(id);
      if (!s) return { ok: false, error: "Supplier not found" };

      const { riskEvents, createdAlerts } = applyNewsRefresh(s);
      persistDebounced();
      notify();
      return { ok: true, supplier: toPublicSupplier(s), newAlerts: createdAlerts, riskEvents };
    }

    /** Preview a digest without persisting anything — used by the Add Supplier form's
     * "Pull news" button before the supplier record exists. */
    function previewNews(companyName, ticker, keywords, cadence) {
      return generateNewsDigest(companyName, cadence, keywords, ticker);
    }

    function runGenieScanAll() {
      const results = Array.from(suppliers.values()).map((s) => {
        const { createdAlerts } = applyNewsRefresh(s);
        return { supplierId: s.id, newAlerts: createdAlerts };
      });
      persistDebounced();
      notify();
      return results;
    }

    function listOpenAlerts() {
      const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
      return Array.from(alerts.values())
        .filter((a) => a.status === "NEW" || a.status === "NOTIFIED")
        .sort((a, b) => {
          const rankDiff = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
          if (rankDiff !== 0) return rankDiff;
          return new Date(b.createdAt) - new Date(a.createdAt);
        })
        .map((a) => {
          const supplier = suppliers.get(a.supplierId);
          return {
            ...a,
            supplier: supplier
              ? { legalName: supplier.legalName, supplierCode: supplier.supplierCode }
              : { legalName: "Unknown supplier", supplierCode: "—" },
          };
        });
    }

    function dismissAlert(id) {
      const a = alerts.get(id);
      if (!a) return;
      a.status = "DISMISSED";
      persistDebounced();
      notify();
    }

    function dismissAllOpenAlerts() {
      let changed = false;
      alerts.forEach((a) => {
        if (a.status === "NEW" || a.status === "NOTIFIED") {
          a.status = "DISMISSED";
          changed = true;
        }
      });
      if (changed) {
        persistDebounced();
        notify();
      }
    }

    function totalSupplierCount() {
      return suppliers.size;
    }

    // Fire the async load; components render immediately against the (initially
    // empty) in-memory state and re-render automatically via notify() once this
    // resolves. `ready` is exposed for any caller that prefers to await it.
    const ready = load();

    return {
      ready,
      subscribe,
      addSupplier,
      getSupplier,
      listSuppliers,
      totalSupplierCount,
      refreshSupplierNews,
      previewNews,
      runGenieScanAll,
      listOpenAlerts,
      dismissAlert,
      dismissAllOpenAlerts,
    };
  }

  SAINT.store = createStore();
})(window);
