const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const logicPromise = import(pathToFileURL(
  path.join(__dirname, "../supabase/functions/delete-student/logic.mjs")
).href);

const ids = {
  actor: "11111111-1111-4111-8111-111111111111",
  student: "22222222-2222-4222-8222-222222222222",
  auth: "33333333-3333-4333-8333-333333333333",
  request: "44444444-4444-4444-8444-444444444444",
  attempt: "55555555-5555-4555-8555-555555555555"
};

function deletedState() {
  return {
    authExists: false,
    studentExists: false,
    dependencyCounts: {
      series_results: 0,
      question_results: 0,
      targeted_skill_progress: 0,
      targeted_series: 0,
      targeted_question_results: 0,
      parent_students: 0
    }
  };
}

function existingState() {
  return {
    authExists: true,
    studentExists: true,
    dependencyCounts: { series_results: 2, question_results: 10 }
  };
}

function createServices(overrides = {}) {
  const calls = [];
  const services = {
    calls,
    async authenticate() {
      calls.push("authenticate");
      return { id: ids.actor };
    },
    async prepareDeletion() {
      calls.push("prepare");
      return {
        request_id: ids.request,
        student_id: ids.student,
        auth_user_id: ids.auth,
        status: "ready",
        should_execute: true
      };
    },
    async deleteAuthUser() {
      calls.push("deleteAuth");
    },
    async inspectDeletion() {
      calls.push("inspect");
      return deletedState();
    },
    async markCompleted() {
      calls.push("complete");
    },
    async markFailed() {
      calls.push("failed");
    },
    logError() {},
    ...overrides
  };
  return services;
}

function input() {
  return {
    authorization: "Bearer valid-user-token",
    studentId: ids.student,
    requestId: ids.request,
    attemptId: ids.attempt
  };
}

test("successful deletion removes Auth first and confirms every cascade", async () => {
  const { executePermanentStudentDeletion } = await logicPromise;
  const services = createServices();
  const result = await executePermanentStudentDeletion(input(), services);

  assert.equal(result.ok, true);
  assert.equal(result.status, "completed");
  assert.deepEqual(services.calls, ["authenticate", "prepare", "deleteAuth", "inspect", "complete"]);
});

test("an unauthenticated call is rejected before preflight or deletion", async () => {
  const { executePermanentStudentDeletion, StudentDeletionError } = await logicPromise;
  const services = createServices({
    async authenticate() { return null; }
  });

  await assert.rejects(
    executePermanentStudentDeletion(input(), services),
    error => error instanceof StudentDeletionError && error.code === "UNAUTHENTICATED"
  );
  assert.doesNotMatch(services.calls.join(","), /deleteAuth/);
});

for (const code of ["ADMIN_REQUIRED", "SHARED_AUTH_IDENTITY", "PROTECTED_ADMIN_ACCOUNT"]) {
  test(`${code} preflight refusal never calls Auth deletion`, async () => {
    const { executePermanentStudentDeletion, StudentDeletionError } = await logicPromise;
    const services = createServices({
      async prepareDeletion() {
        throw new StudentDeletionError(code, "refused", 403);
      }
    });

    await assert.rejects(
      executePermanentStudentDeletion(input(), services),
      error => error.code === code
    );
    assert.doesNotMatch(services.calls.join(","), /deleteAuth/);
  });
}

test("a confirmed Auth failure keeps the operation failed and retryable", async () => {
  const { executePermanentStudentDeletion } = await logicPromise;
  const services = createServices({
    async deleteAuthUser() { throw new Error("database constraint"); },
    async inspectDeletion() { return existingState(); }
  });

  await assert.rejects(
    executePermanentStudentDeletion(input(), services),
    error => error.code === "AUTH_DELETE_FAILED" && error.retryable === true
  );
  assert.match(services.calls.join(","), /failed/);
  assert.doesNotMatch(services.calls.join(","), /complete/);
});

test("a lost Auth response is recovered only when Auth and all dependent rows are absent", async () => {
  const { executePermanentStudentDeletion } = await logicPromise;
  const services = createServices({
    async deleteAuthUser() { throw new Error("network interrupted"); }
  });
  const result = await executePermanentStudentDeletion(input(), services);

  assert.equal(result.ok, true);
  assert.equal(result.recovered_after_interruption, true);
  assert.equal(result.idempotent_replay, true);
});

test("a completed repeated request is idempotent and never deletes Auth twice", async () => {
  const { executePermanentStudentDeletion } = await logicPromise;
  const services = createServices({
    async prepareDeletion() {
      return {
        request_id: ids.request,
        student_id: ids.student,
        auth_user_id: ids.auth,
        status: "completed",
        should_execute: false
      };
    }
  });
  const result = await executePermanentStudentDeletion(input(), services);

  assert.equal(result.idempotent_replay, true);
  assert.doesNotMatch(services.calls.join(","), /deleteAuth/);
});

test("a concurrent request is retryable and cannot start a second Auth deletion", async () => {
  const { executePermanentStudentDeletion } = await logicPromise;
  const services = createServices({
    async prepareDeletion() {
      return {
        request_id: ids.request,
        student_id: ids.student,
        auth_user_id: ids.auth,
        status: "in_progress",
        should_execute: false
      };
    },
    async inspectDeletion() { return existingState(); }
  });

  await assert.rejects(
    executePermanentStudentDeletion(input(), services),
    error => error.code === "DELETION_IN_PROGRESS" && error.retryable === true
  );
  assert.doesNotMatch(services.calls.join(","), /deleteAuth/);
});

test("a successful Auth deletion with incomplete cascades never reports success", async () => {
  const { executePermanentStudentDeletion } = await logicPromise;
  const services = createServices({
    async inspectDeletion() {
      return {
        authExists: false,
        studentExists: false,
        dependencyCounts: { question_results: 1 }
      };
    }
  });

  await assert.rejects(
    executePermanentStudentDeletion(input(), services),
    error => error.code === "CASCADE_INCOMPLETE"
  );
  assert.match(services.calls.join(","), /failed/);
});

test("an incomplete verification snapshot cannot be mistaken for a complete deletion", async () => {
  const { isDeletionComplete } = await logicPromise;
  assert.equal(isDeletionComplete({
    authExists: false,
    studentExists: false,
    dependencyCounts: {}
  }), false);
});

test("a post-delete read failure remains explicitly retryable", async () => {
  const { executePermanentStudentDeletion } = await logicPromise;
  const services = createServices({
    async inspectDeletion() { throw new Error("temporary read failure"); }
  });

  await assert.rejects(
    executePermanentStudentDeletion(input(), services),
    error => error.code === "POST_DELETE_VERIFICATION_FAILED" && error.retryable === true
  );
});
