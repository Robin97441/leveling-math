// ── Rangs XP ─────────────────────────────────────────────────────────────
// Source de vérité partagée entre le jeu et le dashboard.
// Chaque rang a : min (seuil XP), name/label (même valeur), icon, color.
// glow : effet visuel optionnel pour les rangs premium.
const RANKS = [
  { min: 0,    name: "Novice des nombres",      label: "Novice des nombres",      icon: "🟤", color: "#cd7f32" },
  { min: 100,  name: "Apprenti mathématicien",  label: "Apprenti mathématicien",  icon: "⚪", color: "#e5e7eb" },
  { min: 300,  name: "Aspirant des algèbres",   label: "Aspirant des algèbres",   icon: "🟡", color: "#facc15" },
  { min: 700,  name: "Maître des variables",    label: "Maître des variables",    icon: "🔷", color: "#22d3ee" },
  { min: 1500, name: "Génie des formules",      label: "Génie des formules",      icon: "💎", color: "#4FD1FF",
    glow: "0 0 6px rgba(79,209,255,.8), 0 0 12px rgba(79,209,255,.6), 0 0 20px rgba(79,209,255,.4)" },
  { min: 2500, name: "Maître des calculs",      label: "Maître des calculs",      icon: "👑", color: "#a78bfa" },
];

// Retourne l'index du rang pour un XP donné (utilisé dans le jeu).
function rankIndexFromXp(x) {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (x >= RANKS[i].min) return i;
  }
  return 0;
}

// Retourne l'objet rang complet avec progression (utilisé dans le dashboard).
function getRankFromXP(xp) {
  const displayXP = Math.max(0, xp);
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (displayXP >= RANKS[i].min) {
      const next = RANKS[i + 1];
      return {
        ...RANKS[i],
        threshold: RANKS[i].min, // alias pour compatibilité dashboard
        progress: next ? `${displayXP} / ${next.min} XP` : "Max atteint"
      };
    }
  }
  return { ...RANKS[0], threshold: 0, progress: `${displayXP} / ${RANKS[1].min} XP` };
}
