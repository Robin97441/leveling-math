// Persistence for general-mode answers. The submit_answer RPC is the only
// authority allowed to assign XP and update the persisted projections.

async function saveQuestionResult(
  isCorrect, responseTime, category,
  subcategory = null, questionText = null, expectedAnswer = null, userAnswer = null,
  answerKind = "answer", clientAnswerId = null
) {
  if (!pseudo || typeof window.saveStudent !== "function") {
    console.error("saveQuestionResult cancelled: student identity is unavailable");
    return false;
  }
  if (!clientAnswerId) {
    console.error("saveQuestionResult cancelled: clientAnswerId is required");
    return false;
  }

  try {
    const student = await window.saveStudent(pseudo);
    if (!student) return false;
    if (activeSessionForQuiz == null) activeSessionForQuiz = student.session || 1;

    if (_refreshPenaltyPending) {
      if (!_refreshPenaltyAnswerId) _refreshPenaltyAnswerId = createAnswerSubmissionId();
      const { data: penaltyData, error: penaltyError } = await _qClient.rpc("submit_answer", {
        p_student_id: student.id,
        p_series_id: activeSeriesId,
        p_session: activeSessionForQuiz,
        p_level: currentLevelKey,
        p_category: "refresh_penalty",
        p_subcategory: null,
        p_question_text: null,
        p_expected_answer: null,
        p_user_answer: null,
        p_is_correct: false,
        p_response_time: null,
        p_answer_kind: "refresh_penalty",
        p_client_answer_id: _refreshPenaltyAnswerId
      });

      if (penaltyError || !penaltyData?.series_id) {
        _refreshPenaltyPending = true;
        _refreshPenaltyApplied = false;
        saveSeriesState();
        showPenaltyBanner(true);
        console.error("Refresh penalty was not confirmed by submit_answer", penaltyError || penaltyData);
        return false;
      }

      activeSeriesId = penaltyData.series_id;
      _refreshPenaltyPending = false;
      _refreshPenaltyApplied = true;
      if (typeof applyConfirmedXpSnapshot === "function") applyConfirmedXpSnapshot(penaltyData);
      if (!_offlineReplayIsForInactiveSeries) {
        _seriesXpDelta = Number(penaltyData.series_xp_gained) || 0;
      }
      saveSeriesState();
      showPenaltyBanner(false);
    }

    const payload = {
      p_student_id: student.id,
      p_series_id: activeSeriesId,
      p_session: activeSessionForQuiz,
      p_level: currentLevelKey,
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

    activeSeriesId = data.series_id;
    if (!_offlineReplayIsForInactiveSeries) {
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
