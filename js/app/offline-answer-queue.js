(function (root) {
  "use strict";

  const DB_NAME = "leveling_math";
  const DB_VERSION = 1;
  const STORE_NAME = "general_answer_queue";

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
  }

  function openDatabase() {
    if (!root.indexedDB) return Promise.reject(new Error("IndexedDB unavailable"));
    return new Promise((resolve, reject) => {
      const request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "clientAnswerId" });
          store.createIndex("ownerAuthUserId", "ownerAuthUserId", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
    });
  }

  async function withStore(mode, operation) {
    const db = await openDatabase();
    try {
      const tx = db.transaction(STORE_NAME, mode);
      const result = await operation(tx.objectStore(STORE_NAME));
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
        tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
      });
      return result;
    } finally {
      db.close();
    }
  }

  async function put(item) {
    if (!item?.clientAnswerId) throw new Error("clientAnswerId is required");
    const record = { ...item, createdAt: item.createdAt || Date.now() };
    await withStore("readwrite", store => requestToPromise(store.put(record)));
    return record;
  }

  async function remove(clientAnswerId) {
    await withStore("readwrite", store => requestToPromise(store.delete(clientAnswerId)));
  }

  async function list(ownerAuthUserId) {
    const rows = await withStore("readonly", store => requestToPromise(store.getAll()));
    return (rows || [])
      .filter(row => !ownerAuthUserId || row.ownerAuthUserId === ownerAuthUserId)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  root.LevelingMathOfflineQueue = { put, remove, list };
})(typeof globalThis !== "undefined" ? globalThis : window);
