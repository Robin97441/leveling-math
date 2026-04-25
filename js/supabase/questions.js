// ── Couche questions (question_results) ──────────────────────────────────
// Dépend de _qClient (client.js).
// Dépend des globaux du jeu : pseudo, activeSessionForQuiz, activeSeriesId,
//   currentLevelKey, _currentAuthUserId, _refreshPenaltyPending,
//   _refreshPenaltyApplied, _seriesXpDelta (définis dans leveling_math.html).

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
      _refreshPenaltyPending = false;
      _refreshPenaltyApplied = true;
      saveSeriesState();
      showPenaltyBanner(false);
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
        _refreshPenaltyPending = true;
        _refreshPenaltyApplied = false;
        console.error("❌ Pénalité refresh non enregistrée:", penErr);
        return false;
      }
      else {
        _seriesXpDelta -= 10;
        activeSeriesId = penData?.series_id || activeSeriesId;
        saveSeriesState();
        console.log("🚫 Pénalité refresh enregistrée via RPC — série", activeSeriesId);
      }
    }

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
      console.error("❌ saveQuestionResult RPC submit_answer:", error);
      return false;
    }
    activeSeriesId = data?.series_id || activeSeriesId;
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

    const previousLocalXp = typeof xp !== "undefined" ? Number(xp) || 0 : null;
    const nextServerXp = (Number(freshStudent.xp_total) || 0) + (Number(freshStudent.manual_xp_bonus) || 0);
    if (typeof xp !== "undefined") xp = nextServerXp;
    if (typeof bestScore !== "undefined") bestScore = Number(freshStudent.best_score) || 0;
    if (typeof statBestAvgTime !== "undefined") statBestAvgTime = freshStudent.best_avg_time || null;
    if (typeof statGames !== "undefined") statGames = Number(freshStudent.games_played) || 0;
    if (typeof localSession !== "undefined") localSession = freshStudent.session || activeSessionForQuiz;
    if (typeof updateRankUI === "function") updateRankUI();
    if (
      previousLocalXp !== null &&
      typeof rankIndexFromXp === "function" &&
      typeof showRankOverlay === "function" &&
      typeof RANKS !== "undefined"
    ) {
      const previousIndex = rankIndexFromXp(previousLocalXp);
      const nextIndex = rankIndexFromXp(nextServerXp);
      if (nextIndex > previousIndex) {
        if (typeof playRankUpSound === "function") playRankUpSound();
        showRankOverlay(RANKS[nextIndex], false);
      } else if (nextIndex < previousIndex) {
        if (typeof playRankDownSound === "function") playRankDownSound();
        showRankOverlay(RANKS[nextIndex], true);
      }
    }
    if (typeof updateLevelButtons === "function") updateLevelButtons();
    if (typeof saveGame === "function") saveGame();
    return true;
  } catch (e) {
    console.error("Erreur saveQuestionResult:", e);
    return false;
  }
}
