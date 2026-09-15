// ── Couche questions (question_results) ──────────────────────────────────
// Dépend de _qClient (client.js).
// Dépend des globaux du jeu : pseudo, activeSessionForQuiz, activeSeriesId,
//   currentLevelKey, _currentAuthUserId, _refreshPenaltyPending,
//   _refreshPenaltyApplied, _seriesXpDelta, applyXp (définis dans main.js).

async function saveQuestionResult(
  isCorrect, responseTime, category,
  subcategory = null, questionText = null, expectedAnswer = null, userAnswer = null,
  answerKind = "answer"
) {
  if (!pseudo || typeof window.saveStudent !== "function") {
    console.error("❌ saveQuestionResult annulé — pseudo ou saveStudent indisponible", {
      pseudo,
      hasSaveStudent: typeof window.saveStudent === "function"
    });
    return false;
  }
  if (!questionText || expectedAnswer == null || subcategory == null) {
    console.warn("⚠️ saveQuestionResult: champ manquant", { questionText, expectedAnswer, userAnswer, subcategory, category });
  }
  try {
    const student = await window.saveStudent(pseudo);
    if (!student) {
      console.error("❌ saveQuestionResult annulé — student Supabase introuvable/création échouée");
      return false;
    }

    if (activeSessionForQuiz == null) {
      activeSessionForQuiz = student.session || 1;
      console.warn("⚠️ activeSessionForQuiz était vide — récupérée depuis students.session", {
        activeSessionForQuiz,
        student_id: student.id
      });
    }

    console.log("[progress] submit_answer start", {
      user_id: typeof _currentAuthUserId !== "undefined" ? _currentAuthUserId : null,
      student_id: student.id,
      pseudo,
      session_id: activeSessionForQuiz,
      series_id: activeSeriesId,
      xp_local: typeof xp !== "undefined" ? xp : null,
      xp_supabase_before: student.xp_total,
      level: currentLevelKey,
      category,
      subcategory,
      answerKind
    });

    // ── Pénalité refresh : enregistrée exactement une fois par série reprise ──
    if (_refreshPenaltyPending) {
      const { data: penData, error: penErr } = await _qClient.rpc("submit_answer", {
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
        p_answer_kind: "refresh_penalty"
      });
      if (penErr) {
        // Sans confirmation serveur, la pénalité reste due au prochain retry.
        _refreshPenaltyPending = true;
        _refreshPenaltyApplied = false;
        saveSeriesState();
        showPenaltyBanner(true);
        console.error("❌ Pénalité refresh non enregistrée:", penErr);
        return false;
      }
      else {
        const penaltySeriesId = penData?.series_id || activeSeriesId;
        if (!penaltySeriesId) {
          _refreshPenaltyPending = true;
          _refreshPenaltyApplied = false;
          saveSeriesState();
          showPenaltyBanner(true);
          console.error("❌ Pénalité refresh confirmée sans series_id — retry conservé par sécurité");
          return false;
        }

        // Le series_id retourné devient l'identité définitive avant la réponse normale.
        activeSeriesId = penaltySeriesId;
        _refreshPenaltyPending = false;
        _refreshPenaltyApplied = true;
        if (typeof _offlineReplayIsForInactiveSeries === "undefined" || !_offlineReplayIsForInactiveSeries) {
          _seriesXpDelta -= 10;
        }
        // applyXp est l'unique source d'animation pour cette vraie perte d'XP.
        if (typeof applyXp === "function") applyXp(-10);
        saveSeriesState();
        showPenaltyBanner(false);
        console.log("🚫 Pénalité refresh enregistrée via RPC — série", activeSeriesId);
      }
    }

    console.log("[diag] submit_answer attempt", {
      browser: navigator.userAgent.substring(0, 100),
      online: navigator.onLine,
      student_id: student.id,
      series_id: activeSeriesId,
      session_id: activeSessionForQuiz,
      table: "question_results (via RPC submit_answer)",
      category,
      subcategory,
      answer_kind: answerKind,
      is_correct: isCorrect
    });
    const { data, error } = await _qClient.rpc("submit_answer", {
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
      p_answer_kind: answerKind
    });
    if (error) {
      console.error("❌ saveQuestionResult RPC submit_answer failed", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        browser: navigator.userAgent.substring(0, 100),
        online: navigator.onLine,
        student_id: student.id,
        series_id: activeSeriesId,
        session_id: activeSessionForQuiz
      });
      return false;
    }
    const returnedSeriesId = data?.series_id || activeSeriesId;
    if (!returnedSeriesId) {
      console.error("❌ submit_answer réussi sans series_id — identité de série non persistable");
      return false;
    }
    activeSeriesId = returnedSeriesId;
    // Persistance immédiate : les écritures suivantes réutilisent ce même UUID.
    saveSeriesState();
    console.log("[progress] submit_answer OK", {
      student_id: student.id,
      session_id: activeSessionForQuiz,
      series_id: activeSeriesId,
      rpc_result: data
    });

    const { data: freshStudent, error: freshError } = await _qClient
      .from("students")
      .select("xp_total, manual_xp_bonus, best_score, best_avg_time, games_played, session")
      .eq("id", student.id)
      .single();

    if (freshError) {
      console.error("❌ Lecture students après submit_answer échouée:", freshError);
      return true;
    }

    console.log("[progress] students après submit_answer", {
      student_id: student.id,
      xp_local_before_sync: typeof xp !== "undefined" ? xp : null,
      xp_supabase: freshStudent.xp_total,
      manual_xp_bonus: freshStudent.manual_xp_bonus,
      session_id: freshStudent.session,
      games_played: freshStudent.games_played
    });

    if (typeof pendingSupabaseSaves !== "undefined" && pendingSupabaseSaves > 1) {
      console.log("[progress] sync XP différée — autres réponses en attente", { pendingSupabaseSaves });
      return true;
    }

    const nextServerXp = (Number(freshStudent.xp_total) || 0) + (Number(freshStudent.manual_xp_bonus) || 0);
    if (typeof xp !== "undefined") xp = nextServerXp;
    if (typeof bestScore !== "undefined") bestScore = Number(freshStudent.best_score) || 0;
    if (typeof statBestAvgTime !== "undefined") statBestAvgTime = freshStudent.best_avg_time || null;
    if (typeof statGames !== "undefined") statGames = Number(freshStudent.games_played) || 0;
    if (typeof localSession !== "undefined") localSession = freshStudent.session || activeSessionForQuiz;
    if (typeof updateRankUI === "function") updateRankUI();
    if (typeof updateLevelButtons === "function") updateLevelButtons();
    if (typeof saveGame === "function") saveGame();
    return true;
  } catch (e) {
    console.error("Erreur saveQuestionResult:", e);
    return false;
  }
}
