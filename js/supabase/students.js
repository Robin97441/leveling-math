// ── Couche élève (students) ───────────────────────────────────────────────
// Utilise _qClient (défini dans client.js).
// Expose window.saveStudent, window.startNewSession, window.saveSeriesResult.
// Expose aussi normalizePseudo (clé logique) et formatPseudo (affichage).

window.normalizePseudo = function normalizePseudo(input) {
  return String(input ?? "").trim().toLowerCase();
};

window.formatPseudo = function formatPseudo(input) {
  const n = window.normalizePseudo(input);
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : "";
};

let _saveStudentInFlight = null;

async function getCurrentAuthUserForStudent() {
  if (typeof _qClient === "undefined" || !_qClient?.auth) return null;
  const { data, error } = await _qClient.auth.getUser();
  if (error) {
    console.error("❌ saveStudent auth.getUser:", error);
    return null;
  }
  return data?.user || null;
}

window.saveStudent = async function saveStudent(pseudo) {
  if (!_qClient) {
    console.error("❌ saveStudent annulé — _qClient non défini (client.js non chargé ?)");
    return null;
  }

  try {
    const authUser = await getCurrentAuthUserForStudent();
    const fallbackAuthUserId =
      (typeof _currentAuthUserId !== "undefined" ? _currentAuthUserId : null)
      || window._currentAuthUserId
      || null;
    const authUserId = authUser?.id || fallbackAuthUserId;
    const metaPseudo = authUser?.user_metadata?.pseudo || null;
    const cleanPseudo = window.normalizePseudo
      ? window.normalizePseudo(pseudo || metaPseudo || "")
      : String(pseudo || metaPseudo || "").trim().toLowerCase();

    console.log("[progress] saveStudent start", {
      auth_user_id: authUserId,
      pseudo: cleanPseudo || null
    });

    if (!cleanPseudo) {
      console.error("❌ Pseudo vide — impossible de créer/récupérer students");
      return null;
    }

    const inFlightKey = `${authUserId || "anon"}:${cleanPseudo}`;
    if (_saveStudentInFlight?.key === inFlightKey) {
      console.log("[progress] saveStudent réutilise la requête en cours", inFlightKey);
      return _saveStudentInFlight.promise;
    }

    const work = (async () => {
      if (authUserId) {
        const { data: byAuth, error: authSelectError } = await _qClient
          .from("students")
          .select("*")
          .eq("auth_user_id", authUserId)
          .maybeSingle();

        if (authSelectError) {
          console.error("❌ ERROR SELECT students par auth_user_id:", authSelectError);
          return null;
        }

        if (byAuth) {
          console.log("[progress] saveStudent trouvé par auth_user_id", {
            student_id: byAuth.id,
            pseudo: byAuth.pseudo,
            session: byAuth.session,
            xp_supabase: byAuth.xp_total
          });
          return byAuth;
        }
      }

      // Fallback pseudo : utile pour les anciens comptes déjà liés et visibles par RLS.
      const { data: existingRows, error: selectError } = await _qClient
        .from("students")
        .select("*")
        .ilike("pseudo", cleanPseudo)
        .limit(1);

      if (selectError) {
        console.error("❌ ERROR SELECT students par pseudo:", selectError);
        return null;
      }

      if (existingRows && existingRows.length > 0) {
        const existing = existingRows[0];
        if (authUserId && !existing.auth_user_id) {
          const { data: attached, error: attachError } = await _qClient
            .from("students")
            .update({ auth_user_id: authUserId, updated_at: new Date().toISOString() })
            .eq("id", existing.id)
            .select()
            .single();
          if (attachError) {
            console.error("❌ ERROR UPDATE students.auth_user_id:", attachError);
            return existing;
          }
          console.log("[progress] ancien student rattaché à auth_user_id", {
            student_id: attached.id,
            auth_user_id: authUserId
          });
          return attached;
        }
        console.log("[progress] saveStudent trouvé par pseudo", {
          student_id: existing.id,
          pseudo: existing.pseudo,
          session: existing.session,
          xp_supabase: existing.xp_total
        });
        return existing;
      }

      const studentPayload = {
        pseudo: cleanPseudo,
        xp_total: 0,
        best_score: 0,
        best_avg_time: null,
        games_played: 0,
        session: 1
      };
      if (authUserId) studentPayload.auth_user_id = authUserId;

      const { data, error } = await _qClient
        .from("students")
        .insert([studentPayload])
        .select()
        .single();

      if (error) {
        console.error("❌ ERROR INSERT students:", error);
        return null;
      }

      console.log("✅ SAVE students:", {
        student_id: data.id,
        pseudo: data.pseudo,
        auth_user_id: data.auth_user_id,
        session: data.session,
        xp_supabase: data.xp_total
      });
      return data;
    })();

    _saveStudentInFlight = { key: inFlightKey, promise: work };
    const result = await work;
    if (_saveStudentInFlight?.key === inFlightKey) _saveStudentInFlight = null;
    return result;
  } catch (e) {
    console.error("❌ EXCEPTION:", e);
    _saveStudentInFlight = null;
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
  console.warn("saveSeriesResult désactivé : les séries et XP sont gérés par la RPC submit_answer().");
  return null;
};
console.log("[INIT] students chargé");
