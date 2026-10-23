// ── Client Supabase partagé ───────────────────────────────────────────────
// Chargé après le CDN Supabase. Expose _qClient en global.
// dashboard.html utilise `supabaseClient` → défini localement via `const supabaseClient = _qClient`.
const IS_LOCAL = ["localhost", "127.0.0.1"].includes(window.location.hostname);

const SUPABASE_URL = IS_LOCAL
  ? "http://127.0.0.1:54321"
  : "https://ypfgfvwpqcamcimppxaf.supabase.co";

// Renseigner ici UNIQUEMENT la clé publique (publishable/anon) de `supabase status`.
// Ne jamais utiliser une clé secret ou service_role dans le navigateur.
const LOCAL_SUPABASE_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const PRODUCTION_SUPABASE_KEY = "sb_publishable_j8u0ZTsNqHhSHL9jLmp9Sw_EuKb1ZKi";

const SUPABASE_KEY = IS_LOCAL ? LOCAL_SUPABASE_KEY : PRODUCTION_SUPABASE_KEY;

// Sécurité : sur localhost, ne jamais basculer vers Supabase production.
if (IS_LOCAL && (!SUPABASE_KEY || SUPABASE_KEY === "REMPLACER_PAR_CLE_PUBLIQUE_LOCALE")) {
  throw new Error("[MODE TEST LOCAL] Clé publique Supabase locale manquante dans js/supabase/client.js. Connexion bloquée.");
}
if (!window.supabase || typeof window.supabase.createClient !== "function") {
  throw new Error("[INIT] Bibliothèque Supabase introuvable.");
}

const _qClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
console.log("[INIT] client chargé —", IS_LOCAL ? "MODE TEST LOCAL" : "PRODUCTION");

if (IS_LOCAL) {
  const showLocalBadge = () => {
    if (document.getElementById("leveling-local-badge")) return;
    const badge = document.createElement("div");
    badge.id = "leveling-local-badge";
    badge.textContent = "🧪 MODE TEST LOCAL";
    badge.style.cssText = "position:fixed;top:8px;right:8px;z-index:2147483647;padding:7px 11px;border-radius:8px;background:#fff3cd;color:#573c00;border:2px solid #c58a00;font:700 12px/1.2 system-ui,sans-serif;box-shadow:0 2px 8px #0003;pointer-events:none";
    document.body.appendChild(badge);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showLocalBadge, { once: true });
  } else {
    showLocalBadge();
  }
}
