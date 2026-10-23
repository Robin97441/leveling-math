// Persistence for general-mode answers. The submit_answer RPC is the only
// authority allowed to assign XP and update the persisted projections.

async function saveQuestionResult(
  isCorrect, responseTime, category,
  subcategory = null, questionText = null, expectedAnswer = null, userAnswer = null,
  answerKind = "answer", clientAnswerId = null, seriesContext = null
) {
  if (!pseudo || typeof window.saveStudent !== "function") {
    console.error("saveQuestionResult cancelled: student identity is unavailable");
    return false;
  }
  if (!clientAnswerId) {
    console.error("saveQuestionResult cancelled: clientAnswerId is required");
    return false;
  }

  const hasSeriesContext = !!seriesContext?.localSeriesId;
  let seriesIdForSave = hasSeriesContext ? (seriesContext.seriesId || null) : activeSeriesId;
  let sessionForSave = hasSeriesContext ? (seriesContext.sessionId || null) : activeSessionForQuiz;
  const levelKeyForSave = hasSeriesContext ? seriesContext.levelKey : currentLevelKey;
  let refreshPenaltyPending = hasSeriesContext
    ? !!seriesContext.refreshPenaltyPending
    : _refreshPenaltyPending;
  let refreshPenaltyApplied = hasSeriesContext
    ? !!seriesContext.refreshPenaltyApplied
    : _refreshPenaltyApplied;
  let refreshPenaltyAnswerId = hasSeriesContext
    ? (seriesContext.refreshPenaltyAnswerId || null)
    : _refreshPenaltyAnswerId;

  function appliesToActiveSeries() {
    if (!hasSeriesContext) return true;
    const activeOwner = typeof getActiveStorageUserId === "function" ? getActiveStorageUserId() : null;
    return seriesContext.localSeriesId === activeLocalSeriesId
      && (!seriesContext.ownerAuthUserId || !activeOwner || seriesContext.ownerAuthUserId === activeOwner);
  }

  function updateSeriesContext() {
    if (!hasSeriesContext) return;
    seriesContext.seriesId = seriesIdForSave;
    seriesContext.sessionId = sessionForSave;
    seriesContext.refreshPenaltyPending = refreshPenaltyPending;
    seriesContext.refreshPenaltyApplied = refreshPenaltyApplied;
    seriesContext.refreshPenaltyAnswerId = refreshPenaltyAnswerId;
  }

  function updateActiveSeriesIdentity() {
    if (!appliesToActiveSeries()) return;
    activeSeriesId = seriesIdForSave;
    activeSessionForQuiz = sessionForSave;
    _refreshPenaltyPending = refreshPenaltyPending;
    _refreshPenaltyApplied = refreshPenaltyApplied;
    _refreshPenaltyAnswerId = refreshPenaltyAnswerId;
  }

  try {
    const student = await window.saveStudent(pseudo);
    if (!student) return false;
    if (sessionForSave == null) sessionForSave = student.session || 1;
    updateSeriesContext();
    updateActiveSeriesIdentity();

    if (refreshPenaltyPending) {
      if (!refreshPenaltyAnswerId) refreshPenaltyAnswerId = createAnswerSubmissionId();
      updateSeriesContext();
      updateActiveSeriesIdentity();
      const { data: penaltyData, error: penaltyError } = await _qClient.rpc("submit_answer", {
        p_student_id: student.id,
        p_series_id: seriesIdForSave,
        p_session: sessionForSave,
        p_level: levelKeyForSave,
        p_category: "refresh_penalty",
        p_subcategory: null,
        p_question_text: null,
        p_expected_answer: null,
        p_user_answer: null,
        p_is_correct: false,
        p_response_time: null,
        p_answer_kind: "refresh_penalty",
        p_client_answer_id: refreshPenaltyAnswerId
      });

      if (penaltyError || !penaltyData?.series_id) {
        refreshPenaltyPending = true;
        refreshPenaltyApplied = false;
        updateSeriesContext();
        updateActiveSeriesIdentity();
        if (appliesToActiveSeries()) {
          saveSeriesState();
          showPenaltyBanner(true);
        }
        console.error("Refresh penalty was not confirmed by submit_answer", penaltyError || penaltyData);
        return false;
      }

      seriesIdForSave = penaltyData.series_id;
      refreshPenaltyPending = false;
      refreshPenaltyApplied = true;
      updateSeriesContext();
      updateActiveSeriesIdentity();
      if (appliesToActiveSeries() && typeof applyConfirmedXpSnapshot === "function") {
        applyConfirmedXpSnapshot(penaltyData);
      }
      if (appliesToActiveSeries()) {
        _seriesXpDelta = Number(penaltyData.series_xp_gained) || 0;
        saveSeriesState();
        showPenaltyBanner(false);
      }
    }

    const payload = {
      p_student_id: student.id,
      p_series_id: seriesIdForSave,
      p_session: sessionForSave,
      p_level: levelKeyForSave,
      p_category: category,
      p_subcategory: subcategory,
      p_question_text: questionText,
      p_expected_answer: expectedAnswer,
      p_user_answer: userAnswer,
      p_is_correct: isCorrect,
      p_response_time: responseTime,
      p_answer_kind: answerKind,
      p_client_answer_id: clientAnswerId
    };
    const { data, error } = await _qClient.rpc("submit_answer", payload);
    if (error) {
      console.error("submit_answer failed", {
        clientAnswerId,
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        online: navigator.onLine
      });
      return false;
    }
    if (!data?.series_id || !Number.isFinite(Number(data.student_xp_total))) {
      console.error("submit_answer returned an incomplete confirmation", data);
      return false;
    }

    seriesIdForSave = data.series_id;
    updateSeriesContext();
    updateActiveSeriesIdentity();
    if (appliesToActiveSeries()) {
      _seriesXpDelta = Number(data.series_xp_gained) || 0;
      if (typeof applyConfirmedXpSnapshot === "function") applyConfirmedXpSnapshot(data);
      if (typeof updateFinishedSeriesXp === "function") updateFinishedSeriesXp();
      saveSeriesState();
    }
    return data;
  } catch (error) {
    console.error("saveQuestionResult exception", error);
    return false;
  }
}
