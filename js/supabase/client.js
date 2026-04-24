// ── Client Supabase partagé ───────────────────────────────────────────────
// Chargé après le CDN Supabase. Expose _qClient en global.
// dashboard.html utilise `supabaseClient` → défini localement via `const supabaseClient = _qClient`.
const SUPABASE_URL = "https://ypfgfvwpqcamcimppxaf.supabase.co";
const SUPABASE_KEY = "sb_publishable_j8u0ZTsNqHhSHL9jLmp9Sw_EuKb1ZKi";

const _qClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
console.log("[INIT] client chargé");
