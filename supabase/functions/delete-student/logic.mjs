const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const STUDENT_DEPENDENCY_TABLES = Object.freeze([
  "series_results",
  "question_results",
  "targeted_skill_progress",
  "targeted_series",
  "targeted_question_results",
  "parent_students"
]);

export class StudentDeletionError extends Error {
  constructor(code, message, status = 500, retryable = false, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "StudentDeletionError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function requireUuid(value, field) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new StudentDeletionError("INVALID_REQUEST", `${field} doit être un UUID valide.`, 400);
  }
  return value;
}

export function isDeletionComplete(state) {
  const counts = state?.dependencyCounts;
  const hasCompleteDependencySnapshot = counts
    && STUDENT_DEPENDENCY_TABLES.every(table => Number.isFinite(Number(counts[table])));
  return state?.authExists === false
    && state?.studentExists === false
    && hasCompleteDependencySnapshot
    && STUDENT_DEPENDENCY_TABLES.every(table => Number(counts[table]) === 0);
}

async function markFailedSafely(services, receiptId, code, message) {
  try {
    await services.markFailed(receiptId, code, message);
  } catch (error) {
    services.logError?.("Unable to mark student deletion as failed", error);
  }
}

async function inspectDeletionOrRetry(services, preflight) {
  try {
    return await services.inspectDeletion(preflight);
  } catch (error) {
    throw new StudentDeletionError(
      "POST_DELETE_VERIFICATION_FAILED",
      "L'état final n'a pas pu être vérifié. Relance la même demande.",
      503,
      true,
      error
    );
  }
}

async function markCompletedOrRetry(services, preflight, state, recovered) {
  try {
    await services.markCompleted(preflight.request_id, state, recovered);
  } catch (error) {
    throw new StudentDeletionError(
      "RECEIPT_UPDATE_FAILED",
      "La suppression est confirmée, mais son reçu doit être resynchronisé. Relance la même demande.",
      503,
      true,
      error
    );
  }
}

function successResult(preflight, state, options = {}) {
  return {
    ok: true,
    status: "completed",
    request_id: preflight.request_id,
    student_id: preflight.student_id,
    auth_user_id: preflight.auth_user_id,
    idempotent_replay: options.idempotentReplay === true,
    recovered_after_interruption: options.recoveredAfterInterruption === true,
    deleted_dependency_counts: state.dependencyCounts
  };
}

export async function executePermanentStudentDeletion(input, services) {
  const actor = await services.authenticate(input.authorization);
  if (!actor?.id) {
    throw new StudentDeletionError("UNAUTHENTICATED", "Connexion administrateur requise.", 401);
  }

  const studentId = requireUuid(input.studentId, "student_id");
  const requestId = requireUuid(input.requestId, "request_id");
  const attemptId = requireUuid(input.attemptId, "attempt_id");

  let preflight;
  try {
    preflight = await services.prepareDeletion({ studentId, requestId, attemptId, actor });
  } catch (error) {
    if (error instanceof StudentDeletionError) throw error;
    throw new StudentDeletionError(
      error?.code || "DELETION_PRECONDITION_FAILED",
      error?.message || "Les contrôles de sécurité ont refusé la suppression.",
      error?.status || 403,
      false,
      error
    );
  }

  if (!preflight?.request_id || !preflight?.student_id || !preflight?.auth_user_id) {
    throw new StudentDeletionError(
      "INVALID_PREFLIGHT_RESPONSE",
      "La vérification serveur a retourné une réponse incomplète.",
      500
    );
  }

  if (preflight.status === "completed") {
    const state = await inspectDeletionOrRetry(services, preflight);
    if (!isDeletionComplete(state)) {
      throw new StudentDeletionError(
        "DELETION_STATE_INCONSISTENT",
        "La demande est marquée terminée, mais des données de l'élève subsistent.",
        500
      );
    }
    return successResult(preflight, state, {
      idempotentReplay: true,
      recoveredAfterInterruption: preflight.recovered_after_interruption === true
    });
  }

  if (preflight.status === "in_progress" || preflight.should_execute !== true) {
    const state = await inspectDeletionOrRetry(services, preflight);
    if (isDeletionComplete(state)) {
      await markCompletedOrRetry(services, preflight, state, true);
      return successResult(preflight, state, {
        idempotentReplay: true,
        recoveredAfterInterruption: true
      });
    }
    throw new StudentDeletionError(
      "DELETION_IN_PROGRESS",
      "La suppression est déjà en cours. Réessaie dans quelques instants.",
      409,
      true
    );
  }

  try {
    await services.deleteAuthUser(preflight.auth_user_id);
  } catch (deleteError) {
    let state;
    try {
      state = await services.inspectDeletion(preflight);
    } catch (inspectionError) {
      await markFailedSafely(
        services,
        preflight.request_id,
        "AUTH_DELETE_UNCONFIRMED",
        deleteError?.message || "Suppression Auth non confirmée"
      );
      throw new StudentDeletionError(
        "AUTH_DELETE_UNCONFIRMED",
        "Supabase n'a pas permis de confirmer la suppression. Relance la même demande.",
        503,
        true,
        inspectionError
      );
    }

    if (isDeletionComplete(state)) {
      await markCompletedOrRetry(services, preflight, state, true);
      return successResult(preflight, state, {
        idempotentReplay: true,
        recoveredAfterInterruption: true
      });
    }

    await markFailedSafely(
      services,
      preflight.request_id,
      "AUTH_DELETE_FAILED",
      deleteError?.message || "Échec de suppression Auth"
    );
    throw new StudentDeletionError(
      "AUTH_DELETE_FAILED",
      "Le compte Auth n'a pas été supprimé. Aucune réussite n'a été affichée.",
      502,
      true,
      deleteError
    );
  }

  const state = await inspectDeletionOrRetry(services, preflight);
  if (!isDeletionComplete(state)) {
    await markFailedSafely(
      services,
      preflight.request_id,
      "CASCADE_INCOMPLETE",
      "Auth ou des données dépendantes existent encore après deleteUser"
    );
    throw new StudentDeletionError(
      "CASCADE_INCOMPLETE",
      "La suppression n'a pas pu être confirmée intégralement.",
      500,
      true
    );
  }

  await markCompletedOrRetry(services, preflight, state, false);
  return successResult(preflight, state);
}

export function errorPayload(error) {
  const known = error instanceof StudentDeletionError;
  return {
    status: known ? error.status : 500,
    body: {
      ok: false,
      code: known ? error.code : "INTERNAL_ERROR",
      message: known ? error.message : "Erreur serveur pendant la suppression.",
      retryable: known && error.retryable
    }
  };
}
