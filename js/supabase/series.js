// ── Couche séries (series_results) ───────────────────────────────────────
// Dépend de _qClient (client.js).
// Dépend des globaux du jeu : activeSeriesId, activeSessionForQuiz,
//   currentLevelKey, _seriesTimes, score, streak (définis dans leveling_math.html).

function updateSeriesProgress() {
  // Les agrégats de série sont maintenant recalculés côté Supabase par submit_answer().
}

// Crée la ligne series_results dans Supabase si elle n'existe pas encore.
// Reporté à la première réponse pour éviter les séries fantômes (refresh avant Q1).
async function ensureSeriesRow(student) {
  console.warn("ensureSeriesRow désactivé : la RPC submit_answer crée/récupère la série.");
  return activeSeriesId != null;
}
