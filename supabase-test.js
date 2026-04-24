const SUPABASE_URL = "https://ypfgfvwpqcamcimppxaf.supabase.co";
const SUPABASE_KEY = "sb_publishable_j8u0ZTsNqHhSHL9jLmp9Sw_EuKb1ZKi";

let gameSupabaseClient = null;

if (window.supabase && typeof window.supabase.createClient === "function") {
  gameSupabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log("✅ Supabase chargé");
} else {
  console.error("❌ Supabase CDN non chargé");
}

window.saveStudent = async function saveStudent(pseudo) {
  if (!gameSupabaseClient) {
    console.error("❌ Supabase not initialized");
    return null;
  }

  if (!pseudo || !pseudo.trim()) {
    console.error("❌ Pseudo vide");
    return null;
  }

  try {
    const cleanPseudo = pseudo.trim();

    // Cherche s'il existe déjà au moins un élève avec ce pseudo
    const { data: existingRows, error: selectError } = await gameSupabaseClient
      .from("students")
      .select("*")
      .eq("pseudo", cleanPseudo)
      .limit(1);

    if (selectError) {
      console.error("❌ ERROR SELECT:", selectError);
      return null;
    }

    if (existingRows && existingRows.length > 0) {
      console.log("ℹ️ Pseudo déjà existant :", existingRows[0]);
      return existingRows[0];
    }

    const { data, error } = await gameSupabaseClient
      .from("students")
      .insert([{ pseudo: cleanPseudo }])
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
  if (!gameSupabaseClient) {
    console.error("❌ Supabase not initialized");
    return null;
  }

  try {
    const { data: student, error: selectError } = await gameSupabaseClient
      .from("students")
      .select("*")
      .eq("id", studentId)
      .single();

    if (selectError) {
      console.error("❌ ERROR SELECT STUDENT:", selectError);
      return null;
    }

    const { data, error } = await gameSupabaseClient
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
  if (!gameSupabaseClient) {
    console.error("❌ Supabase not initialized");
    return null;
  }

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

    const { data, error } = await gameSupabaseClient
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

    const { error: updateError } = await gameSupabaseClient
      .from("students")
      .update(updatedStudent)
      .eq("id", student.id);

    if (updateError) {
      console.error("❌ ERROR UPDATE STUDENT:", updateError);
      return null;
    }

    console.log("✅ Étudiant mis à jour :", updatedStudent);
    console.log("✅ Série sauvegardée :", data);
    return data;
  } catch (e) {
    console.error("❌ EXCEPTION SAVE SERIES:", e);
    return null;
  }
};