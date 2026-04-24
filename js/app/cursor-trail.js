// ── Cursor trailing light (desktop uniquement) ────────────────────────────
// Nécessite dans la page :
//   <div id="cursor-trail" aria-hidden="true"></div>
//   + le CSS #cursor-trail / .cursor-trail__dot
(function () {
  if (window.matchMedia) {
    if (window.matchMedia("(hover: none)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  }
  const container = document.getElementById("cursor-trail");
  if (!container) return;

  const N = 8;
  const LEAD_EASE = 0.30;
  const TAIL_EASE = 0.34;
  const IDLE_HOLD = 80;    // ms avant de fade
  const IDLE_FADE = 380;   // ms pour fade complet

  const dots = [];
  for (let i = 0; i < N; i++) {
    const d = document.createElement("div");
    d.className = "cursor-trail__dot";
    container.appendChild(d);
    dots.push({ el: d, x: -9999, y: -9999, scale: 1 - i * 0.09, baseAlpha: 0.85 - i * 0.095 });
  }

  let tx = -9999, ty = -9999;
  let primed = false, running = false, lastMove = 0;

  function tick(now) {
    dots[0].x += (tx - dots[0].x) * LEAD_EASE;
    dots[0].y += (ty - dots[0].y) * LEAD_EASE;
    for (let i = 1; i < N; i++) {
      dots[i].x += (dots[i-1].x - dots[i].x) * TAIL_EASE;
      dots[i].y += (dots[i-1].y - dots[i].y) * TAIL_EASE;
    }
    const idle = now - lastMove;
    let fade = 1;
    if (idle > IDLE_HOLD) fade = Math.max(0, 1 - (idle - IDLE_HOLD) / IDLE_FADE);

    for (let i = 0; i < N; i++) {
      const d = dots[i];
      d.el.style.transform = `translate3d(${d.x}px, ${d.y}px, 0) scale(${d.scale})`;
      d.el.style.opacity = (d.baseAlpha * fade).toFixed(3);
    }

    if (fade <= 0) { running = false; return; }
    requestAnimationFrame(tick);
  }

  window.addEventListener("mousemove", (e) => {
    tx = e.clientX; ty = e.clientY;
    lastMove = performance.now();
    if (!primed) {
      primed = true;
      for (let i = 0; i < N; i++) { dots[i].x = tx; dots[i].y = ty; }
    }
    if (!running) { running = true; requestAnimationFrame(tick); }
  }, { passive: true });
})();
