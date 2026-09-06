/**
 * SAINT.idb — a tiny, generic IndexedDB helper. Not tied to suppliers/alerts
 * specifically; any store module (js/store.js, js/rfp/rfp-store.js) can open
 * its own database and named object stores through this.
 *
 * IndexedDB's quota is typically hundreds of MB to a few GB (browser- and
 * disk-dependent) rather than localStorage's ~5-10MB per origin — the whole
 * reason to use it here. All operations are Promise-based; callers should
 * treat persistence as best-effort (catch and continue in-memory-only) since
 * IndexedDB can still be unavailable (e.g. some private-browsing modes).
 */
(function (global) {
  "use strict";

  const SAINT = (global.SAINT = global.SAINT || {});

  /** Opens (and upgrades, if needed) a database with the given object stores.
   * `storeConfigs` is an array of { name, keyPath }. */
  function openDb(dbName, version, storeConfigs) {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) {
        reject(new Error("IndexedDB is not available in this browser/context"));
        return;
      }
      const req = global.indexedDB.open(dbName, version);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        storeConfigs.forEach(({ name, keyPath }) => {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath });
          }
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error(`Failed to open IndexedDB database "${dbName}"`));
      req.onblocked = () => reject(new Error(`IndexedDB open blocked for "${dbName}" (another tab holds an older version open)`));
    });
  }

  function getAll(db, storeName) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  /** Replaces the entire contents of one object store in a single transaction
   * (clear + put every record) — simplest correct persistence strategy for
   * collections that are small enough to hold in memory anyway. */
  function replaceAll(db, storeName, records) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      store.clear();
      records.forEach((record) => store.put(record));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error(`Transaction aborted on "${storeName}"`));
    });
  }

  function getValue(db, storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function putValue(db, storeName, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  SAINT.idb = { openDb, getAll, replaceAll, getValue, putValue };
})(window);
