// ── Couche séries (series_results) ───────────────────────────────────────
// Dépend de _qClient (client.js).
// Dépend des globaux du jeu : activeSeriesId, activeSessionForQuiz,
//   currentLevelKey, _seriesTimes, score, streak (définis dans leveling_math.html).

function updateSeriesProgress() {
  if (!activeSeriesId) return;
  const currentAvgTime = _seriesTimes.length
    ? _seriesTimes.reduce((a, b) => a + b, 0) / _seriesTimes.length
    : null;
  _qClient.from("series_results").update({
    score,
    avg_time: currentAvgTime,
    streak_max: streak
  }).eq("id", activeSeriesId).then(() => {}).catch(e => console.error("Erreur updateSeriesProgress:", e));
}

// Crée la ligne series_results dans Supabase si elle n'existe pas encore.
// Reporté à la première réponse pour éviter les séries fantômes (refresh avant Q1).
async function ensureSeriesRow(student) {
  if (activeSeriesId != null) return true; // déjà créée
  try {
    const { data: seriesRow, error } = await _qClient.from("series_results").insert([{
      student_id: student.id,
      level: currentLevelKey,
      score: 0,
      avg_time: null,
      xp_gained: 0,
      streak_max: 0,
      session: activeSessionForQuiz
    }]).select().single();
    if (error) { console.error("❌ ensureSeriesRow:", error); return false; }
    activeSeriesId = seriesRow.id;
    saveSeriesState();
    console.log("📋 Ligne série créée à la 1ère réponse — id:", activeSeriesId);
    return true;
  } catch (e) {
    console.error("❌ ensureSeriesRow exception:", e);
    return false;
  }
}
