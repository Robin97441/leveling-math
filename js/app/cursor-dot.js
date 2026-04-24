// ── Curseur custom (desktop uniquement) ───────────────────────────────────
// Nécessite dans la page :
//   <div id="cursor-dot" aria-hidden="true"></div>
//   + le CSS #cursor-dot
(function () {
  if (window.matchMedia) {
    if (window.matchMedia("(hover: none)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  }
  const el = document.getElementById("cursor-dot");
  if (!el) return;

  let shown = false;
  window.addEventListener("mousemove", (e) => {
    el.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
    if (!shown) { shown = true; el.classList.add("active"); }
  }, { passive: true });
  document.addEventListener("mouseleave", () => el.classList.remove("active"));
  document.addEventListener("mouseenter", () => { if (shown) el.classList.add("active"); });
})();
