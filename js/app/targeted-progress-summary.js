(function initializeTargetedProgressSummary(global) {
  "use strict";

  const XP_MAX = 500;
  const DIFFICULTIES = [
    { key: "beginner", label: "Débutant" },
    { key: "intermediate", label: "Intermédiaire" },
    { key: "expert", label: "Expert" }
  ];

  function clampXp(value) {
    return Math.max(0, Math.min(XP_MAX, Number(value) || 0));
  }

  function buildProgress(rows) {
    const rowsByDifficulty = Object.fromEntries(
      (rows || [])
        .filter(row => DIFFICULTIES.some(difficulty => difficulty.key === row?.difficulty))
        .map(row => [row.difficulty, row])
    );

    const progress = DIFFICULTIES.map(({ key, label }) => {
      const row = rowsByDifficulty[key] || {};
      const xp = clampXp(row.xp);
      return {
        key,
        label,
        xp,
        percent: Math.round((xp / XP_MAX) * 100),
        completed: row.completed === true || xp >= XP_MAX,
        unlocked: false
      };
    });

    progress.forEach((difficulty, index) => {
      difficulty.unlocked = index === 0 || progress[index - 1].completed;
    });
    return progress;
  }

  function render(container, rows, { errorMessage = "" } = {}) {
    if (!container) return [];
    container.innerHTML = "";

    if (errorMessage) {
      const error = document.createElement("p");
      error.className = "targeted-summary-error";
      error.textContent = errorMessage;
      container.appendChild(error);
      return [];
    }

    const progress = buildProgress(rows);
    const list = document.createElement("div");
    list.className = "targeted-summary-list";

    progress.forEach(difficulty => {
      const row = document.createElement("div");
      row.className = `targeted-summary-row${difficulty.unlocked ? "" : " locked"}`;

      const heading = document.createElement("div");
      heading.className = "targeted-summary-heading";

      const label = document.createElement("strong");
      label.textContent = difficulty.label;

      const value = document.createElement("span");
      value.className = "targeted-summary-value";
      value.textContent = `${difficulty.percent} % · ${difficulty.xp} / ${XP_MAX} XP`;

      heading.append(label, value);
      if (!difficulty.unlocked) {
        const locked = document.createElement("span");
        locked.className = "targeted-summary-locked";
        locked.textContent = "Verrouillé";
        heading.appendChild(locked);
      }

      const track = document.createElement("div");
      track.className = "targeted-summary-track";
      track.setAttribute("role", "progressbar");
      track.setAttribute("aria-label", `${difficulty.label} : ${difficulty.percent} %`);
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", "100");
      track.setAttribute("aria-valuenow", String(difficulty.percent));

      const fill = document.createElement("span");
      fill.style.width = `${difficulty.percent}%`;
      track.appendChild(fill);
      row.append(heading, track);
      list.appendChild(row);
    });

    container.appendChild(list);
    return progress;
  }

  global.LevelingMathTargetedProgressSummary = {
    XP_MAX,
    buildProgress,
    render
  };
})(typeof window !== "undefined" ? window : globalThis);
