// ── Niveaux pédagogiques ──────────────────────────────────────────────────
// Source de vérité pour la configuration des niveaux.
// Modifier ici pour changer gain, pénalité ou timer global d'un niveau.
const LEVELS = {
  beginner:     { name: "🟢 Débutant",      nbQuestions: 10, gain: 2,  wrong: 0,  timeout: 0  },
  intermediate: { name: "🟡 Intermédiaire", nbQuestions: 10, gain: 5,  wrong: 5,  timeout: 5  },
  expert:       { name: "🔴 Expert",        nbQuestions: 10, gain: 10, wrong: 15, timeout: 15 },
};
