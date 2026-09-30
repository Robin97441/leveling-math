// Couche Supabase du mode Entrainement cible.
// N'ecrit jamais dans students.xp_total ni dans les tables du mode general.

const TARGETED_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let _verifiedTargetedIdentity = null;

function targetedDebugEnabled() {
  try {
    return window.localStorage?.getItem("leveling_math_debug_targeted") === "1";
  } catch (_) {
    return false;
  }
}

function targetedDebugLog(label, details) {
  if (targetedDebugEnabled()) console.log(label, details);
}

function targetedNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function targetedPersistenceError(message, { retrySafe = false, cause = null } = {}) {
  const error = new Error(message);
  if (cause) error.cause = cause;
  error.retrySafe = retrySafe;
  return error;
}

async function verifyTargetedStudentIdentity(studentId) {
  if (!TARGETED_UUID_RE.test(String(studentId || ""))) {
    throw targetedPersistenceError(`student_id ciblé invalide : ${studentId || "absent"}`, { retrySafe: true });
  }

  const knownAuthUserId = window._currentAuthUserId || null;
  if (
    knownAuthUserId &&
    _verifiedTargetedIdentity?.studentId === studentId &&
    _verifiedTargetedIdentity?.authUserId === knownAuthUserId
  ) {
    return { id: knownAuthUserId };
  }

  const { data: authData, error: authError } = await _qClient.auth.getUser();
  const authUser = authData?.user;
  if (authError || !authUser) {
    console.error("[TARGETED] auth error", authError || "utilisateur absent");
    throw targetedPersistenceError("Session Supabase introuvable pour l'entraînement ciblé.", {
      retrySafe: true,
      cause: authError
    });
  }
  if (_verifiedTargetedIdentity?.studentId === studentId && _verifiedTargetedIdentity?.authUserId === authUser.id) {
    return authUser;
  }

  const { data: student, error: studentError } = await _qClient
    .from("students")
    .select("id, auth_user_id, pseudo")
    .eq("id", studentId)
    .maybeSingle();
  targetedDebugLog("[TARGETED] identity", {
    auth_user_id: authUser.id,
    requested_student_id: studentId,
    resolved_student: student || null
  });
  if (studentError || !student) {
    console.error("[TARGETED] student lookup error", studentError || "élève invisible");
    throw targetedPersistenceError("L'élève ciblé n'est pas accessible avec ce compte.", {
      retrySafe: true,
      cause: studentError
    });
  }
  if (student.auth_user_id !== authUser.id) {
    throw targetedPersistenceError("Le student_id ciblé n'appartient pas à l'utilisateur connecté.", { retrySafe: true });
  }
  _verifiedTargetedIdentity = { studentId, authUserId: authUser.id };
  return authUser;
}

function normalizeTargetedRpcResult(data, params) {
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result !== "object") {
    throw targetedPersistenceError("submit_targeted_answer n'a retourné aucun résultat.", { retrySafe: false });
  }
  if (!TARGETED_UUID_RE.test(String(result.series_id || ""))) {
    throw targetedPersistenceError("submit_targeted_answer n'a retourné aucun series_id UUID valide.", { retrySafe: false });
  }
  if (result.skill_key !== params.skillKey || result.difficulty !== params.difficulty) {
    throw targetedPersistenceError("Le RPC a retourné une compétence ou une difficulté différente de la requête.", { retrySafe: false });
  }

  const numericFields = [
    "xp_delta", "difficulty_xp", "series_question_count", "series_correct_count",
    "series_wrong_count", "series_xp"
  ];
  for (const field of numericFields) {
    const value = result[field] == null ? NaN : Number(result[field]);
    if (!Number.isFinite(value)) {
      throw targetedPersistenceError(`Réponse RPC incomplète : ${field} est absent ou invalide.`, { retrySafe: false });
    }
    result[field] = value;
  }
  if (result.series_question_count < 1 || result.series_question_count > 10) {
    throw targetedPersistenceError("Le compteur de questions retourné par le RPC est invalide.", { retrySafe: false });
  }
  if (result.series_correct_count + result.series_wrong_count !== result.series_question_count) {
    throw targetedPersistenceError("Les agrégats de série retournés par le RPC sont incohérents.", { retrySafe: false });
  }
  if (result.difficulty_xp < 0 || result.difficulty_xp > 500) {
    throw targetedPersistenceError("La progression retournée par le RPC est hors limites.", { retrySafe: false });
  }
  return result;
}

function buildTargetedProgressMap(rows) {
  const progressBySkill = {};
  for (const [skillKey, skill] of Object.entries(TARGETED_SKILLS)) {
    progressBySkill[skillKey] = {};
    for (const difficulty of TARGETED_DIFFICULTY_ORDER) {
      progressBySkill[skillKey][difficulty] = { xp: 0, completed: false, completedAt: null };
    }
    for (const row of rows || []) {
      if (row.skill_key !== skillKey || !progressBySkill[skillKey][row.difficulty]) continue;
      const xpMax = skill.difficulties[row.difficulty]?.xpMax ?? 500;
      const xp = Math.max(0, Math.min(xpMax, Number(row.xp) || 0));
      progressBySkill[skillKey][row.difficulty] = {
        xp,
        completed: row.completed === true || xp >= xpMax,
        completedAt: row.completed_at || null
      };
    }
  }
  return progressBySkill;
}

async function queryTargetedProgress(studentId, skillKey = null) {
  const startedAt = targetedNow();
  targetedDebugLog("[TARGETED] progression submit", {
    student_id: studentId,
    skill_key: skillKey || "*",
    auth_user_id: window._currentAuthUserId || null
  });
  let query = _qClient
    .from("targeted_skill_progress")
    .select("skill_key, difficulty, xp, completed, completed_at")
    .eq("student_id", studentId);
  if (skillKey) query = query.eq("skill_key", skillKey);
  const { data, error } = await query;

  if (error) {
    console.error("[targeted] chargement progression impossible:", error);
    throw error;
  }

  targetedDebugLog("[TARGETED] progression result", {
    student_id: studentId,
    skill_key: skillKey || "*",
    count: data?.length || 0,
    duration_ms: Math.round((targetedNow() - startedAt) * 10) / 10
  });
  return data || [];
}

window.loadAllTargetedProgress = async function loadAllTargetedProgress(studentId) {
  const rows = await queryTargetedProgress(studentId);
  return buildTargetedProgressMap(rows);
};

window.loadTargetedSkillProgress = async function loadTargetedSkillProgress(studentId, skillKey) {
  const rows = await queryTargetedProgress(studentId, skillKey);
  return buildTargetedProgressMap(rows)[skillKey];
};

window.submitTargetedAnswer = async function submitTargetedAnswer(params) {
  if (typeof _qClient?.rpc !== "function") {
    throw targetedPersistenceError("Client Supabase ciblé non initialisé.", { retrySafe: true });
  }
  const authUser = await verifyTargetedStudentIdentity(params.studentId);
  const payload = {
    p_student_id: params.studentId,
    p_series_id: params.seriesId,
    p_skill_key: params.skillKey,
    p_difficulty: params.difficulty,
    p_subskill_key: params.subskillKey,
    p_question_text: params.questionText,
    p_expected_answer: params.expectedAnswer,
    p_user_answer: params.userAnswer,
    p_is_correct: params.isCorrect,
    p_response_time: params.responseTime
  };
  targetedDebugLog("[TARGETED] context", {
    supabase_url: typeof SUPABASE_URL !== "undefined" ? SUPABASE_URL : null,
    auth_user_id: authUser.id
  });
  targetedDebugLog("[TARGETED] submit", payload);

  let data;
  let error;
  const rpcStartedAt = targetedNow();
  try {
    ({ data, error } = await _qClient.rpc("submit_targeted_answer", payload));
  } catch (networkError) {
    targetedDebugLog("[TARGETED] timing", {
      phase: "submit_targeted_answer",
      duration_ms: Math.round((targetedNow() - rpcStartedAt) * 10) / 10,
      status: "network_error"
    });
    console.error("[TARGETED] RPC error", networkError);
    throw targetedPersistenceError("Erreur réseau pendant submit_targeted_answer.", {
      retrySafe: false,
      cause: networkError
    });
  }
  targetedDebugLog("[TARGETED] timing", {
    phase: "submit_targeted_answer",
    duration_ms: Math.round((targetedNow() - rpcStartedAt) * 10) / 10
  });
  targetedDebugLog("[TARGETED] RPC data", data);

  if (error) {
    console.error("[TARGETED] RPC error", error);
    throw targetedPersistenceError(error.message || "submit_targeted_answer a échoué.", {
      retrySafe: true,
      cause: error
    });
  }

  const result = normalizeTargetedRpcResult(data, params);
  targetedDebugLog("[TARGETED] RPC confirmed", {
    series_id: result.series_id,
    skill_key: result.skill_key,
    difficulty: result.difficulty,
    xp_delta: result.xp_delta,
    difficulty_xp: result.difficulty_xp,
    difficulty_completed: result.difficulty_completed,
    beginner_completed: result.beginner_completed,
    intermediate_completed: result.intermediate_completed,
    skill_mastered: result.skill_mastered,
    series_question_count: result.series_question_count,
    series_correct_count: result.series_correct_count,
    series_wrong_count: result.series_wrong_count,
    series_xp: result.series_xp,
    series_completed: result.series_completed
  });
  return result;
};
