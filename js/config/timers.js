// ── Timers par niveau ────────────────────────────────────────────────────
// Source de vérité unique : modifier ici pour changer tous les timers à la fois.
// Intermédiaire : tous à 10s, sauf fractions_simplification à 20s.
// Expert         : tous à 15s, sauf fractions_denominateurs_differents à 30s.
const TIMER_CONFIG = {
  beginner: {
    default: 15,
  },
  intermediate: {
    default: 10,
    fractions_simplification: 20,           // exception : simplification de fractions
  },
  expert: {
    default: 15,
    fractions_denominateurs_differents: 30, // exception : fractions dénominateurs différents
  },
};

function getTimeLimit(level, subcategory) {
  const cfg = TIMER_CONFIG[level];
  if (!cfg) return 15;
  return cfg[subcategory] ?? cfg.default;
}
