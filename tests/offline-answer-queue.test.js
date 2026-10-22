const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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
