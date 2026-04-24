// ── Couche questions (question_results) ──────────────────────────────────
// Dépend de _qClient (client.js) et de ensureSeriesRow (series.js).
// Dépend des globaux du jeu : pseudo, activeSessionForQuiz, activeSeriesId,
//   currentLevelKey, _currentAuthUserId, _refreshPenaltyPending,
//   _refreshPenaltyApplied, _seriesXpDelta (définis dans leveling_math.html).

async function saveQuestionResult(
  isCorrect, responseTime, category, xpDelta = 0,
  subcategory = null, questionText = null, expectedAnswer = null, userAnswer = null
) {
  if (activeSessionForQuiz == null) {
    console.error("❌ saveQuestionResult annulé — pas de session", { activeSessionForQuiz });
    return;
  }
  if (!pseudo || typeof window.saveStudent !== "function") return;
  if (!questionText || expectedAnswer == null || subcategory == null) {
    console.warn("⚠️ saveQuestionResult: champ manquant", { questionText, expectedAnswer, userAnswer, subcategory, category });
  }
  try {
    const student = await window.saveStudent(pseudo);
    if (!student) return;
    const ok = await ensureSeriesRow(student);
    if (!ok) { console.error("❌ saveQuestionResult annulé — ensureSeriesRow a échoué"); return; }

    // ── Pénalité refresh : enregistrée exactement une fois par série reprise ──
    if (_refreshPenaltyPending) {
      _refreshPenaltyPending = false;
      _refreshPenaltyApplied = true;
      _seriesXpDelta -= 10;
      applyXp(-10);
      saveSeriesState();
      showPenaltyBanner(false);
      const { error: penErr } = await _qClient.from("question_results").insert([{
        student_id:     student.id,
        // auth_user_id absent de la table — ne pas envoyer
        session:        activeSessionForQuiz,
        series_id:      activeSeriesId,
        level:          currentLevelKey,
        category:       "refresh_penalty",
        subcategory:    null,
        question_text:  null,
        expected_answer: null,
        user_answer:    null,
        is_correct:     false,
        response_time:  null,
        xp_delta:       -10
      }]);
      if (penErr) console.error("❌ Pénalité refresh non enregistrée:", penErr);
      else console.log("🚫 Pénalité refresh -10 XP enregistrée — série", activeSeriesId);
    }

    const supabasePayload = {
      student_id:     student.id,
      // auth_user_id absent de la table — ne pas envoyer
      session:        activeSessionForQuiz,
      series_id:      activeSeriesId,
      level:          currentLevelKey,
      category,
      subcategory,
      question_text:  questionText,
      expected_answer: expectedAnswer,
      user_answer:    userAnswer,
      is_correct:     isCorrect,
      response_time:  responseTime,
      xp_delta:       xpDelta
    };
    const { data, error } = await _qClient.from("question_results").insert([supabasePayload]);
    if (error) console.error("❌ saveQuestionResult insert:", error);
  } catch (e) {
    console.error("Erreur saveQuestionResult:", e);
  }
}
