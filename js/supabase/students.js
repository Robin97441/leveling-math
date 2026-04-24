// ── Couche élève (students) ───────────────────────────────────────────────
// Remplace supabase-test.js. Utilise _qClient (défini dans client.js).
// Expose window.saveStudent, window.startNewSession, window.saveSeriesResult.
// Expose aussi normalizePseudo (clé logique) et formatPseudo (affichage).

window.normalizePseudo = function normalizePseudo(input) {
  return String(input ?? "").trim().toLowerCase();
};

window.formatPseudo = function formatPseudo(input) {
  const n = window.normalizePseudo(input);
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : "";
};

window.saveStudent = async function saveStudent(pseudo) {
  if (!_qClient) {
    console.error("❌ saveStudent annulé — _qClient non défini (client.js non chargé ?)");
    return null;
  }
  if (!pseudo || !pseudo.trim()) {
    console.error("❌ Pseudo vide");
    return null;
  }

  try {
    const cleanPseudo = window.normalizePseudo ? window.normalizePseudo(pseudo) : pseudo.trim().toLowerCase();

    // ilike (case-insensitive, exact) : matche aussi les anciens pseudos capitalisés en base.
    const { data: existingRows, error: selectError } = await _qClient
      .from("students")
      .select("*")
      .ilike("pseudo", cleanPseudo)
      .limit(1);

    if (selectError) {
      console.error("❌ ERROR SELECT:", selectError);
      return null;
    }

    if (existingRows && existingRows.length > 0) {
      return existingRows[0];
    }

    const studentPayload = { pseudo: cleanPseudo };
    if (typeof _currentAuthUserId !== "undefined" && _currentAuthUserId) {
      studentPayload.auth_user_id = _currentAuthUserId;
    }

    const { data, error } = await _qClient
      .from("students")
      .insert([studentPayload])
      .select()
      .single();

    if (error) {
      console.error("❌ ERROR INSERT:", error);
      return null;
    }

    console.log("✅ SAVE:", data);
    return data;
  } catch (e) {
    console.error("❌ EXCEPTION:", e);
    return null;
  }
};

window.startNewSession = async function startNewSession(studentId) {
  try {
    const { data: student, error: selectError } = await _qClient
      .from("students")
      .select("*")
      .eq("id", studentId)
      .single();

    if (selectError) {
      console.error("❌ ERROR SELECT STUDENT:", selectError);
      return null;
    }

    const { data, error } = await _qClient
      .from("students")
      .update({
        xp_total: 0,
        best_score: 0,
        best_avg_time: null,
        games_played: 0,
        session: (student.session || 1) + 1,
        updated_at: new Date().toISOString()
      })
      .eq("id", studentId)
      .select()
      .single();

    if (error) {
      console.error("❌ ERROR START NEW SESSION:", error);
      return null;
    }

    console.log("✅ Nouvelle session démarrée pour", student.pseudo, "→ session", data.session);
    return data;
  } catch (e) {
    console.error("❌ EXCEPTION START NEW SESSION:", e);
    return null;
  }
};

window.saveSeriesResult = async function saveSeriesResult({
  pseudo,
  level,
  score,
  avgTime,
  xpGained,
  streakMax
}) {
  if (!pseudo || !pseudo.trim()) {
    console.error("❌ Pseudo vide");
    return null;
  }

  try {
    const student = await window.saveStudent(pseudo);
    if (!student) {
      console.error("❌ Impossible de récupérer/créer l'élève");
      return null;
    }

    const { data, error } = await _qClient
      .from("series_results")
      .insert([{
        student_id: student.id,
        level,
        score,
        avg_time: avgTime,
        xp_gained: xpGained,
        streak_max: streakMax,
        session: student.session || 1
      }])
      .select()
      .single();

    if (error) {
      console.error("❌ ERROR SAVE SERIES:", error);
      return null;
    }

    const updatedStudent = {
      xp_total: (student.xp_total || 0) + (xpGained || 0),
      best_score: Math.max(student.best_score || 0, score || 0),
      best_avg_time: student.best_avg_time == null ? avgTime : Math.min(student.best_avg_time, avgTime),
      games_played: (student.games_played || 0) + 1,
      updated_at: new Date().toISOString()
    };

    const { error: updateError } = await _qClient
      .from("students")
      .update(updatedStudent)
      .eq("id", student.id);

    if (updateError) {
      console.error("❌ ERROR UPDATE STUDENT:", updateError);
      return null;
    }

    console.log("✅ Série sauvegardée :", data);
    return data;
  } catch (e) {
    console.error("❌ EXCEPTION SAVE SERIES:", e);
    return null;
  }
};
console.log("[INIT] students chargé");
