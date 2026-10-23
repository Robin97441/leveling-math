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

  function createSeriesSaveCoordinator() {
    const remoteSeriesIds = new Map();
    let saveChain = Promise.resolve();

    function getSeriesKey(item) {
      if (!item?.ownerAuthUserId || !item?.localSeriesId) return null;
      return `${item.ownerAuthUserId}:${item.localSeriesId}`;
    }

    function rememberSeriesId(item, seriesId) {
      const key = getSeriesKey(item);
      if (!key || !seriesId) return seriesId || null;
      const knownSeriesId = remoteSeriesIds.get(key);
      if (knownSeriesId && knownSeriesId !== seriesId) {
        console.error("[offline-queue] conflicting remote series identity", {
          localSeriesId: item.localSeriesId,
          knownSeriesId,
          receivedSeriesId: seriesId
        });
        return knownSeriesId;
      }
      remoteSeriesIds.set(key, seriesId);
      return seriesId;
    }

    function getSeriesId(item) {
      const key = getSeriesKey(item);
      return (key && remoteSeriesIds.get(key)) || item?.seriesId || null;
    }

    function seed(items) {
      for (const item of items || []) {
        if (item?.seriesId) rememberSeriesId(item, item.seriesId);
      }
      for (const item of items || []) {
        const knownSeriesId = getSeriesId(item);
        if (knownSeriesId) item.seriesId = knownSeriesId;
      }
    }

    function run(item, operation) {
      const execute = async () => {
        const knownSeriesId = getSeriesId(item);
        if (knownSeriesId) item.seriesId = knownSeriesId;
        const result = await operation(item);
        const assignedSeriesId = result?.series_id || item?.seriesId || null;
        if (assignedSeriesId) {
          item.seriesId = rememberSeriesId(item, assignedSeriesId);
        }
        return result;
      };
      const scheduled = saveChain.then(execute, execute);
      saveChain = scheduled.catch(() => false);
      return scheduled;
    }

    function whenIdle() {
      return saveChain;
    }

    return { getSeriesId, rememberSeriesId, run, seed, whenIdle };
  }

  root.LevelingMathOfflineQueue = { put, remove, list, createSeriesSaveCoordinator };
})(typeof globalThis !== "undefined" ? globalThis : window);
