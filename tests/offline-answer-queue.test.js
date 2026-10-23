const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createFakeIndexedDb() {
  const rows = new Map();
  let database = null;

  function requestFor(transaction, operation) {
    const request = {};
    setTimeout(() => {
      try {
        request.result = operation();
        request.onsuccess?.();
        setTimeout(() => transaction.oncomplete?.(), 0);
      } catch (error) {
        request.error = error;
        request.onerror?.();
        setTimeout(() => transaction.onerror?.(), 0);
      }
    }, 0);
    return request;
  }

  return {
    open() {
      const request = {};
      setTimeout(() => {
        const isUpgrade = !database;
        if (!database) {
          database = {
            objectStoreNames: { contains: () => false },
            createObjectStore() {
              return { createIndex() {} };
            },
            transaction() {
              const transaction = {
                objectStore() {
                  return {
                    put(record) {
                      return requestFor(transaction, () => {
                        rows.set(record.clientAnswerId, structuredClone(record));
                        return record.clientAnswerId;
                      });
                    },
                    delete(clientAnswerId) {
                      return requestFor(transaction, () => rows.delete(clientAnswerId));
                    },
                    getAll() {
                      return requestFor(transaction, () => [...rows.values()].map(row => structuredClone(row)));
                    }
                  };
                }
              };
              return transaction;
            },
            close() {}
          };
        }
        request.result = database;
        if (isUpgrade) request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);
      return request;
    }
  };
}

test("offline answers survive database reopen, stay user-scoped, and are removed only explicitly", async () => {
  global.indexedDB = createFakeIndexedDb();
  delete global.LevelingMathOfflineQueue;
  delete require.cache[require.resolve("../js/app/offline-answer-queue.js")];
  require("../js/app/offline-answer-queue.js");

  const queue = global.LevelingMathOfflineQueue;
  await queue.put({ clientAnswerId: "a", ownerAuthUserId: "user-1", createdAt: 20, args: [true] });
  await queue.put({ clientAnswerId: "b", ownerAuthUserId: "user-1", createdAt: 10, args: [false] });
  await queue.put({ clientAnswerId: "c", ownerAuthUserId: "user-2", createdAt: 5, args: [true] });

  assert.deepEqual((await queue.list("user-1")).map(row => row.clientAnswerId), ["b", "a"]);
  assert.deepEqual((await queue.list("user-2")).map(row => row.clientAnswerId), ["c"]);

  await queue.put({ clientAnswerId: "a", ownerAuthUserId: "user-1", createdAt: 20, args: ["retry"] });
  assert.deepEqual((await queue.list("user-1")).map(row => row.args), [[false], ["retry"]]);

  await queue.remove("b");
  assert.deepEqual((await queue.list("user-1")).map(row => row.clientAnswerId), ["a"]);
});

test("client persists a stable refresh-penalty key before it persists the normal answer", () => {
  const main = fs.readFileSync(path.join(__dirname, "../js/app/main.js"), "utf8");
  const start = main.indexOf("function submitAnswerInBackground");
  const end = main.indexOf("function showSyncBanner", start);
  const flow = main.slice(start, end);

  const createPenaltyKey = flow.indexOf("_refreshPenaltyAnswerId = createAnswerSubmissionId()");
  const persistSeriesState = flow.indexOf("saveSeriesState()", createPenaltyKey);
  const enqueueAnswer = flow.indexOf("_enqueueOfflineSave(args", persistSeriesState);
  assert.ok(createPenaltyKey >= 0);
  assert.ok(persistSeriesState > createPenaltyKey);
  assert.ok(enqueueAnswer > persistSeriesState);
});

function createSyncBannerHarness() {
  const main = fs.readFileSync(path.join(__dirname, "../js/app/main.js"), "utf8");
  const start = main.indexOf("function showSyncBanner");
  const end = main.indexOf("function _updatePersistedSeriesIdentity", start);
  assert.ok(start >= 0 && end > start, "sync banner block should exist");

  const toast = { className: "sync-hidden", textContent: "" };
  const clearedIntervals = [];
  const timeoutCallbacks = new Map();
  let nextTimerId = 1;
  const context = vm.createContext({
    console,
    document: { getElementById: id => id === "sync-status-toast" ? toast : null },
    window: { LevelingMathOfflineQueue: { remove: async () => {} } },
    setTimeout(callback) {
      const id = nextTimerId++;
      timeoutCallbacks.set(id, callback);
      return id;
    },
    clearTimeout() {},
    setInterval() { return nextTimerId++; },
    clearInterval(id) { clearedIntervals.push(id); }
  });

  vm.runInContext(`
    let pendingSupabaseSaves = 0;
    let _offlineQueue = [];
    let _retryTimerId = null;
    let _retryInProgress = false;
    let _syncBannerTimeout = null;
    ${main.slice(start, end)}
    globalThis.syncBannerTestApi = {
      show: showSyncBanner,
      refresh: _refreshSyncBannerState,
      remove: _removeOfflineSave,
      setState(state) {
        if (Object.hasOwn(state, "pending")) pendingSupabaseSaves = state.pending;
        if (Object.hasOwn(state, "queue")) _offlineQueue = state.queue;
        if (Object.hasOwn(state, "retryInProgress")) _retryInProgress = state.retryInProgress;
        if (Object.hasOwn(state, "retryTimerId")) _retryTimerId = state.retryTimerId;
      },
      getState() {
        return {
          pending: pendingSupabaseSaves,
          queueLength: _offlineQueue.length,
          retryInProgress: _retryInProgress,
          retryTimerId: _retryTimerId,
          bannerTimeout: _syncBannerTimeout
        };
      }
    };
  `, context);

  return {
    api: context.syncBannerTestApi,
    toast,
    clearedIntervals,
    runTimeout(id) { timeoutCallbacks.get(id)?.(); }
  };
}

test("normal confirmed save hides pending banner only when every save is done", async () => {
  const harness = createSyncBannerHarness();
  harness.api.setState({
    pending: 2,
    queue: [{ clientAnswerId: "a" }, { clientAnswerId: "b" }],
    retryTimerId: 42
  });
  harness.api.show("pending");

  await harness.api.remove("a");
  harness.api.setState({ pending: 1 });
  harness.api.refresh();
  assert.equal(harness.toast.className, "sync-pending");
  assert.equal(harness.api.getState().retryTimerId, 42);

  await harness.api.remove("b");
  harness.api.setState({ pending: 0 });
  harness.api.refresh();
  assert.equal(harness.toast.className, "sync-hidden");
  assert.equal(harness.api.getState().retryTimerId, null);
  assert.deepEqual(harness.clearedIntervals, [42]);
});

test("a failed save keeps the yellow banner and retry timer", () => {
  const harness = createSyncBannerHarness();
  harness.api.setState({
    pending: 0,
    queue: [{ clientAnswerId: "still-pending" }],
    retryTimerId: 17
  });
  harness.api.refresh();

  assert.equal(harness.toast.className, "sync-pending");
  assert.equal(harness.api.getState().retryTimerId, 17);
  assert.deepEqual(harness.clearedIntervals, []);
});

test("offline recovery shows synced then hides after 2.5 seconds", () => {
  const harness = createSyncBannerHarness();
  harness.api.setState({ pending: 0, queue: [], retryInProgress: false, retryTimerId: 9 });
  harness.api.refresh({ resynchronized: true });

  assert.equal(harness.toast.className, "sync-synced");
  assert.equal(harness.api.getState().retryTimerId, null);
  const timeoutId = harness.api.getState().bannerTimeout;
  harness.runTimeout(timeoutId);
  assert.equal(harness.toast.className, "sync-hidden");
});

test("an idle hydration does not hide the active resynchronized message early", () => {
  const harness = createSyncBannerHarness();
  harness.api.setState({ pending: 0, queue: [], retryInProgress: false });
  harness.api.refresh({ resynchronized: true });
  const timeoutId = harness.api.getState().bannerTimeout;

  harness.api.refresh();
  assert.equal(harness.toast.className, "sync-synced");

  harness.runTimeout(timeoutId);
  assert.equal(harness.toast.className, "sync-hidden");
});

test("an old synced timeout cannot hide a newer pending save", () => {
  const harness = createSyncBannerHarness();
  harness.api.setState({ pending: 0, queue: [] });
  harness.api.show("synced");
  const oldTimeoutId = harness.api.getState().bannerTimeout;

  harness.api.setState({ pending: 1, queue: [{ clientAnswerId: "new" }] });
  harness.api.show("pending");
  harness.runTimeout(oldTimeoutId);

  assert.equal(harness.toast.className, "sync-pending");
  assert.match(harness.toast.textContent, /Sauvegarde en attente/);
});

test("idle cleanup does not interrupt an active retry", () => {
  const harness = createSyncBannerHarness();
  harness.api.show("pending");
  harness.api.setState({ pending: 0, queue: [], retryInProgress: true, retryTimerId: 23 });
  harness.api.refresh();

  assert.equal(harness.toast.className, "sync-pending");
  assert.equal(harness.api.getState().retryTimerId, 23);
  assert.deepEqual(harness.clearedIntervals, []);
});

function createSimulatedSubmitAnswerServer() {
  let nextSeriesNumber = 1;
  const answers = new Map();
  const series = new Map();
  const payloadSeriesIds = [];

  async function submit(item) {
    payloadSeriesIds.push({
      clientAnswerId: item.clientAnswerId,
      localSeriesId: item.localSeriesId,
      ownerAuthUserId: item.ownerAuthUserId,
      seriesId: item.seriesId || null
    });
    if (answers.has(item.clientAnswerId)) return structuredClone(answers.get(item.clientAnswerId));

    const seriesId = item.seriesId || `series-${nextSeriesNumber++}`;
    const current = series.get(seriesId) || { answers: 0, xp: 0 };
    current.answers++;
    current.xp += 5;
    series.set(seriesId, current);
    const result = {
      series_id: seriesId,
      series_xp_gained: current.xp,
      student_xp_total: [...series.values()].reduce((sum, value) => sum + value.xp, 0)
    };
    answers.set(item.clientAnswerId, result);
    return structuredClone(result);
  }

  return { answers, payloadSeriesIds, series, submit };
}

function createQueuedItem(number, localSeriesId = "local-series-a", ownerAuthUserId = "user-1") {
  return {
    clientAnswerId: `answer-${number}`,
    localSeriesId,
    ownerAuthUserId,
    seriesId: null
  };
}

function submitThroughCoordinator(coordinator, server, item) {
  return coordinator.run(item, async context => {
    const result = await server.submit(context);
    context.seriesId = result.series_id;
    return result;
  });
}

test("ten normal saves send one null series id then reuse one remote series", async () => {
  const coordinator = global.LevelingMathOfflineQueue.createSeriesSaveCoordinator();
  const server = createSimulatedSubmitAnswerServer();
  const items = Array.from({ length: 10 }, (_, index) => createQueuedItem(index + 1));

  await Promise.all(items.map(item => submitThroughCoordinator(coordinator, server, item)));

  assert.equal(server.answers.size, 10);
  assert.equal(server.series.size, 1);
  assert.deepEqual([...server.series.values()], [{ answers: 10, xp: 50 }]);
  assert.equal(server.payloadSeriesIds[0].seriesId, null);
  assert.deepEqual(new Set(server.payloadSeriesIds.slice(1).map(payload => payload.seriesId)), new Set(["series-1"]));
});

test("ten persisted offline answers resynchronize into one 50 XP series", async () => {
  const queue = global.LevelingMathOfflineQueue;
  const items = Array.from({ length: 10 }, (_, index) =>
    createQueuedItem(`offline-${index + 1}`, "offline-local-series", "offline-user")
  );
  for (const item of items) await queue.put(item);

  const reloadedItems = await queue.list("offline-user");
  const coordinator = queue.createSeriesSaveCoordinator();
  const server = createSimulatedSubmitAnswerServer();
  coordinator.seed(reloadedItems);
  for (let index = 0; index < reloadedItems.length; index++) {
    const item = reloadedItems[index];
    const result = await submitThroughCoordinator(coordinator, server, item);
    for (const pending of reloadedItems.slice(index)) {
      pending.seriesId = result.series_id;
      await queue.put(pending);
    }
    await queue.remove(item.clientAnswerId);
  }

  assert.equal(server.answers.size, 10);
  assert.equal(server.series.size, 1);
  assert.deepEqual([...server.series.values()], [{ answers: 10, xp: 50 }]);
  assert.equal((await queue.list("offline-user")).length, 0);
  assert.deepEqual(server.payloadSeriesIds.map(payload => payload.seriesId), [
    null,
    "series-1", "series-1", "series-1", "series-1", "series-1",
    "series-1", "series-1", "series-1", "series-1"
  ]);
});

test("normal save and offline flush cannot create two series concurrently", async () => {
  const coordinator = global.LevelingMathOfflineQueue.createSeriesSaveCoordinator();
  const server = createSimulatedSubmitAnswerServer();
  const backgroundItem = createQueuedItem(1);
  const flushItem = createQueuedItem(2);

  await Promise.all([
    submitThroughCoordinator(coordinator, server, backgroundItem),
    submitThroughCoordinator(coordinator, server, flushItem)
  ]);

  assert.equal(server.series.size, 1);
  assert.deepEqual(server.payloadSeriesIds.map(payload => payload.seriesId), [null, "series-1"]);
});

test("lost confirmation retries by client answer id without extra series or XP", async () => {
  const coordinator = global.LevelingMathOfflineQueue.createSeriesSaveCoordinator();
  const server = createSimulatedSubmitAnswerServer();
  const first = createQueuedItem(1);
  const second = createQueuedItem(2);

  const unconfirmed = await coordinator.run(first, async context => {
    await server.submit(context);
    return false;
  });
  assert.equal(unconfirmed, false);
  assert.equal(first.seriesId, null);

  await submitThroughCoordinator(coordinator, server, first);
  await submitThroughCoordinator(coordinator, server, second);

  assert.equal(server.answers.size, 2);
  assert.equal(server.series.size, 1);
  assert.deepEqual([...server.series.values()], [{ answers: 2, xp: 10 }]);
  assert.deepEqual(server.payloadSeriesIds.map(payload => payload.seriesId), [null, null, "series-1"]);
});

test("a later queued answer is deferred while the first answer lacks confirmation", async () => {
  const main = fs.readFileSync(path.join(__dirname, "../js/app/main.js"), "utf8");
  const sameStart = main.indexOf("function _sameLogicalSeries");
  const sameEnd = main.indexOf("async function _persistQueuedSeriesIdentity", sameStart);
  const saveStart = main.indexOf("async function _saveQueuedAnswer", sameEnd);
  const saveEnd = main.indexOf("function _enqueueOfflineSave", saveStart);
  const server = createSimulatedSubmitAnswerServer();
  const first = createQueuedItem("first");
  const second = createQueuedItem("second");
  first.args = [];
  second.args = [];
  let firstAttempts = 0;
  const context = vm.createContext({
    console,
    _offlineQueue: [first, second],
    setTimeout: callback => { callback(); return 1; },
    saveQuestionResult: async (...args) => {
      const item = args.at(-1);
      const result = await server.submit(item);
      if (item.clientAnswerId === first.clientAnswerId && firstAttempts++ < 2) return false;
      item.seriesId = result.series_id;
      return result;
    },
    _persistQueuedSeriesIdentity: async item => {
      for (const queued of context._offlineQueue) {
        if (queued.localSeriesId === item.localSeriesId && queued.ownerAuthUserId === item.ownerAuthUserId) {
          queued.seriesId = item.seriesId;
        }
      }
    },
    _removeOfflineSave: async clientAnswerId => {
      context._offlineQueue = context._offlineQueue.filter(item => item.clientAnswerId !== clientAnswerId);
    }
  });
  vm.runInContext(`
    ${main.slice(sameStart, sameEnd)}
    ${main.slice(saveStart, saveEnd)}
    globalThis.testSaveQueuedAnswer = _saveQueuedAnswer;
  `, context);

  const firstFailure = await context.testSaveQueuedAnswer(first, 0);
  const secondDeferred = await context.testSaveQueuedAnswer(second, 0);
  const firstRetry = await context.testSaveQueuedAnswer(first, 0);
  const secondRetry = await context.testSaveQueuedAnswer(second, 0);

  assert.equal(firstFailure.confirmed, false);
  assert.equal(secondDeferred.deferred, true);
  assert.equal(firstRetry.confirmed, true);
  assert.equal(secondRetry.confirmed, true);
  assert.equal(server.series.size, 1);
  assert.deepEqual(server.payloadSeriesIds.map(payload => payload.seriesId), [null, null, null, "series-1"]);
});

test("a coordinator rebuilt after reload restores the persisted local to remote mapping", async () => {
  const coordinator = global.LevelingMathOfflineQueue.createSeriesSaveCoordinator();
  const server = createSimulatedSubmitAnswerServer();
  const persisted = [createQueuedItem(2), createQueuedItem(3)];
  persisted.forEach(item => { item.seriesId = "persisted-series"; });

  coordinator.seed(persisted);
  await Promise.all(persisted.map(item => submitThroughCoordinator(coordinator, server, item)));

  assert.deepEqual(server.payloadSeriesIds.map(payload => payload.seriesId), ["persisted-series", "persisted-series"]);
  assert.deepEqual([...server.series.keys()], ["persisted-series"]);
});

test("two local series and two owners keep independent remote identities", async () => {
  const coordinator = global.LevelingMathOfflineQueue.createSeriesSaveCoordinator();
  const server = createSimulatedSubmitAnswerServer();
  const items = [
    createQueuedItem("a1", "local-a", "user-1"),
    createQueuedItem("b1", "local-b", "user-1"),
    createQueuedItem("a2", "local-a", "user-1"),
    createQueuedItem("other", "local-a", "user-2")
  ];

  await Promise.all(items.map(item => submitThroughCoordinator(coordinator, server, item)));

  assert.equal(server.series.size, 3);
  assert.equal(items[0].seriesId, items[2].seriesId);
  assert.notEqual(items[0].seriesId, items[1].seriesId);
  assert.notEqual(items[0].seriesId, items[3].seriesId);
  assert.deepEqual(server.payloadSeriesIds.map(payload => payload.seriesId), [null, null, "series-1", null]);
});

test("saveQuestionResult sends the queued series context without overwriting the active series", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../js/supabase/questions.js"), "utf8");
  const payloads = [];
  const context = vm.createContext({
    console,
    navigator: { onLine: true },
    pseudo: "Test",
    activeSeriesId: "active-series",
    activeLocalSeriesId: "active-local-series",
    activeSessionForQuiz: 9,
    currentLevelKey: "expert",
    _refreshPenaltyPending: false,
    _refreshPenaltyApplied: false,
    _refreshPenaltyAnswerId: null,
    _seriesXpDelta: 0,
    window: { saveStudent: async () => ({ id: "student-1", session: 9 }) },
    _qClient: {
      rpc: async (_name, payload) => {
        payloads.push(payload);
        return {
          data: { series_id: "queued-series", series_xp_gained: 5, student_xp_total: 5 },
          error: null
        };
      }
    },
    getActiveStorageUserId: () => "user-1",
    saveSeriesState() {},
    showPenaltyBanner() {},
    applyConfirmedXpSnapshot() {},
    updateFinishedSeriesXp() {},
    createAnswerSubmissionId: () => "penalty-id"
  });
  vm.runInContext(`${source}\nglobalThis.testSaveQuestionResult = saveQuestionResult;`, context);

  const queuedContext = {
    ownerAuthUserId: "user-1",
    localSeriesId: "queued-local-series",
    seriesId: "queued-series",
    sessionId: 2,
    levelKey: "intermediate",
    refreshPenaltyPending: false,
    refreshPenaltyApplied: false,
    refreshPenaltyAnswerId: null
  };
  const result = await context.testSaveQuestionResult(
    true, 1.2, "addition", null, "2 + 2", "4", "4", "answer", "answer-1", queuedContext
  );

  assert.equal(result.series_id, "queued-series");
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].p_series_id, "queued-series");
  assert.equal(payloads[0].p_session, 2);
  assert.equal(payloads[0].p_level, "intermediate");
  assert.equal(context.activeSeriesId, "active-series");

  const resumedContext = {
    ...queuedContext,
    seriesId: null,
    refreshPenaltyPending: true,
    refreshPenaltyApplied: false,
    refreshPenaltyAnswerId: "stable-penalty-id"
  };
  await context.testSaveQuestionResult(
    true, 1.1, "addition", null, "3 + 2", "5", "5", "answer", "answer-2", resumedContext
  );

  assert.equal(payloads[1].p_category, "refresh_penalty");
  assert.equal(payloads[1].p_series_id, null);
  assert.equal(payloads[1].p_client_answer_id, "stable-penalty-id");
  assert.equal(payloads[2].p_series_id, "queued-series");
  assert.equal(resumedContext.seriesId, "queued-series");
  assert.equal(resumedContext.refreshPenaltyPending, false);
  assert.equal(resumedContext.refreshPenaltyApplied, true);
  assert.equal(context.activeSeriesId, "active-series");
});

test("main routes both normal and offline saves through the shared coordinator", () => {
  const main = fs.readFileSync(path.join(__dirname, "../js/app/main.js"), "utf8");
  const normalStart = main.indexOf("function submitAnswerInBackground");
  const normalEnd = main.indexOf("function showSyncBanner", normalStart);
  const flushStart = main.indexOf("async function _flushOfflineQueue");
  const flushEnd = main.indexOf('window.addEventListener("online"', flushStart);

  assert.match(main.slice(normalStart, normalEnd), /_seriesSaveCoordinator\.run\(item, runSave\)/);
  assert.match(main.slice(flushStart, flushEnd), /_seriesSaveCoordinator\.run\(item/);
  assert.doesNotMatch(main.slice(flushStart, flushEnd), /saveQuestionResult\(/);
  assert.match(main, /saveQuestionResult\(\.\.\.item\.args, item\)/);
});
