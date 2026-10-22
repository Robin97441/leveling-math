(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LevelingMathXp = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const LEVEL_LIMITS = Object.freeze({
    beginner: 700,
    intermediate: 1500,
    expert: Infinity
  });

  function computeFlooredSeriesXp(seriesOrdered, xpBySeriesId) {
    let total = 0;
    for (const series of seriesOrdered || []) {
      const delta = Number(xpBySeriesId?.[series.id]) || 0;
      total = Math.max(0, total + delta);
    }
    return total;
  }

  function getGeneralLevelEligibility(levelKey, confirmedXp, options = {}) {
    if (!Object.prototype.hasOwnProperty.call(LEVEL_LIMITS, levelKey)) {
      return { allowed: false, reason: "unknown_level" };
    }

    if (options.resumeExistingSeries === true) {
      return { allowed: true, reason: "resume_existing_series" };
    }

    const xp = Math.max(0, Number(confirmedXp) || 0);
    const limit = LEVEL_LIMITS[levelKey];
    if (xp >= limit) return { allowed: false, reason: "xp_threshold", limit };
    return { allowed: true, reason: "eligible", limit };
  }

  return {
    LEVEL_LIMITS,
    computeFlooredSeriesXp,
    getGeneralLevelEligibility
  };
});
