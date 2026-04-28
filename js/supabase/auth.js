// ── Couche authentification ───────────────────────────────────────────────
// Dépend de _qClient (client.js).
// Dépend des globaux du jeu : pseudo, xp, pseudoInputEl, renderPseudo,
//   saveGame, unlockPseudo, clearSeriesState, syncStudentFromSupabase
//   (définis dans leveling_math.html).
// Doit être chargé en dernier (après client.js et le script principal).

let _currentAuthUserId = null; // uuid Supabase Auth | null si non connecté
let _authMode = "login";       // "login" | "signup" | "recovery"
let _authStep = 1;             // pertinent uniquement en mode signup (1 = pseudo/emails, 2 = mots de passe)
let _authPrevStep = 1;         // pour déterminer le sens de l'animation (forward / back)
let _authRecoveryActive = false;

function switchAuthTab(mode) {
  if (_authMode === "recovery") return;
  _authMode = mode;
  _authStep = 1;
  _authSetMessage("", "");
  _clearSignupErrors();
  _authApplyLayout();
}

function authStepBack() {
  if (_authMode !== "signup" || _authStep !== 2) return;
  _authStep = 1;
  _authSetMessage("", "");
  _authApplyLayout();
}

function _authApplyLayout() {
  const isSignup = _authMode === "signup";
  const isRecovery = _authMode === "recovery";
  const step1 = isSignup && _authStep === 1;
  const step2 = isSignup && _authStep === 2;

  const show = (id, visible) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? "" : "none";
  };

  const tabs = document.querySelector(".auth-tabs");
  if (tabs) tabs.style.display = isRecovery ? "none" : "";

  document.getElementById("tab-login").classList.toggle("active", !isSignup && !isRecovery);
  document.getElementById("tab-signup").classList.toggle("active", isSignup);

  // Champs étape 1 (signup uniquement)
  show("auth-pseudo-field",        step1);
  show("auth-email-confirm-field", step1);

  // Email : login + signup step1
  show("auth-email-field", (!isSignup || step1) && !isRecovery);

  // Mots de passe : login + signup step2
  show("auth-password-field",         (!isSignup || step2) || isRecovery);
  show("auth-password-confirm-field", step2 || isRecovery);

  // Bouton retour : signup step2 uniquement
  show("auth-back-btn", step2);

  // Indicateur d'étape : signup uniquement
  const indicator = document.getElementById("auth-step-indicator");
  if (indicator) {
    indicator.style.display = (isSignup || isRecovery) ? "" : "none";
    indicator.textContent = isRecovery ? "Nouveau mot de passe"
                                      : step1 ? "Étape 1 sur 2" : "Étape 2 sur 2";
  }

  // Label bouton principal
  const submit = document.getElementById("auth-submit-btn");
  submit.textContent = isRecovery ? "Mettre à jour le mot de passe"
                     : !isSignup ? "Se connecter"
                     :    step1 ? "Suivant"
                                : "Créer mon compte";

  const passwordLabel = document.querySelector("label[for='auth-password']");
  if (passwordLabel) passwordLabel.textContent = isRecovery ? "Nouveau mot de passe" : "Mot de passe";
  document.getElementById("auth-password").autocomplete = (isSignup || isRecovery) ? "new-password" : "current-password";

  _updateSignupSubmitState();

  // Animation directionnelle (forward / back) entre étapes
  if (isSignup || isRecovery) {
    const direction = _authStep >= _authPrevStep ? "forward" : "back";
    _authPrevStep = _authStep;
    const animClass = direction === "forward" ? "auth-step-in-forward" : "auth-step-in-back";
    const targets = isRecovery
      ? ["auth-password-field", "auth-password-confirm-field", "auth-step-indicator"]
      : step1
      ? ["auth-pseudo-field", "auth-email-field", "auth-email-confirm-field", "auth-step-indicator"]
      : ["auth-password-field", "auth-password-confirm-field", "auth-step-indicator", "auth-back-btn"];
    targets.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove("auth-step-in-forward", "auth-step-in-back");
      void el.offsetWidth; // reflow pour relancer l'animation
      el.classList.add(animClass);
    });
  } else {
    _authPrevStep = 1;
  }
}

function _setFieldError(key, msg) {
  const el = document.getElementById("err-" + key);
  if (el) el.textContent = msg || "";
}

function _clearSignupErrors() {
  ["pseudo", "email", "email-confirm", "password", "password-confirm"].forEach(k => _setFieldError(k, ""));
}

function _validateStep1({ showErrors = true } = {}) {
  const pseudo = (document.getElementById("auth-pseudo").value || "").trim();
  const email  = (document.getElementById("auth-email").value || "").trim();
  const emailC = (document.getElementById("auth-email-confirm").value || "").trim();
  const errors = {};
  if (!pseudo) errors.pseudo = "Le pseudo est requis.";
  if (!email) errors.email = "Email requis.";
  else if (!/^\S+@\S+\.\S+$/.test(email)) errors.email = "Email invalide.";
  if (!emailC) errors["email-confirm"] = "Confirme ton email.";
  else if (email && emailC.toLowerCase() !== email.toLowerCase()) errors["email-confirm"] = "Les emails ne correspondent pas.";
  if (showErrors) {
    ["pseudo", "email", "email-confirm"].forEach(k => _setFieldError(k, errors[k] || ""));
  }
  return Object.keys(errors).length === 0;
}

function _validateStep2({ showErrors = true } = {}) {
  const pw  = document.getElementById("auth-password").value || "";
  const pwC = document.getElementById("auth-password-confirm").value || "";
  const errors = {};
  if (!pw) errors.password = "Mot de passe requis.";
  else if (pw.length < 6) errors.password = "6 caractères minimum.";
  if (!pwC) errors["password-confirm"] = "Confirme le mot de passe.";
  else if (pw && pwC !== pw) errors["password-confirm"] = "Les mots de passe ne correspondent pas.";
  if (showErrors) {
    ["password", "password-confirm"].forEach(k => _setFieldError(k, errors[k] || ""));
  }
  return Object.keys(errors).length === 0;
}

function _validateSignup({ showErrors = true } = {}) {
  const a = _validateStep1({ showErrors });
  const b = _validateStep2({ showErrors });
  return a && b;
}

function _updateSignupSubmitState() {
  const btn = document.getElementById("auth-submit-btn");
  if (_authMode === "recovery") {
    btn.disabled = !_validateStep2({ showErrors: false });
    return;
  }
  if (_authMode !== "signup") { btn.disabled = false; return; }
  btn.disabled = _authStep === 1
    ? !_validateStep1({ showErrors: false })
    : !_validateStep2({ showErrors: false });
}

function _authSetMessage(text, type) {
  const el = document.getElementById("auth-message");
  el.textContent = text;
  el.className = "auth-message" + (type ? " " + type : "");
}

function _authTranslateError(msg) {
  if (!msg) return "Erreur inconnue.";
  if (msg.includes("Invalid login credentials"))        return "Email ou mot de passe incorrect.";
  if (msg.includes("Email not confirmed"))              return "Confirme ton email avant de te connecter.";
  if (msg.includes("User already registered"))          return "Cet email est déjà utilisé.";
  if (msg.includes("Password should be at least"))      return "Mot de passe trop court (6 caractères min).";
  if (msg.includes("Unable to validate email address")) return "Adresse email invalide.";
  if (msg.includes("signup_disabled"))                  return "Les inscriptions sont désactivées.";
  return msg;
}

function _isPasswordRecoveryUrl() {
  const tokenSource = `${window.location.hash || ""}${window.location.search || ""}`;
  return /(?:^|[&#?])type=recovery(?:&|$)/.test(tokenSource)
      || /(?:^|[&#?])type=password_recovery(?:&|$)/.test(tokenSource);
}

function _clearPasswordRecoveryUrl() {
  if (!window.history?.replaceState) return;
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("type");
  cleanUrl.hash = "";
  window.history.replaceState({}, document.title, cleanUrl.toString());
}

function _authEnterPasswordRecoveryMode(session = null) {
  _authRecoveryActive = true;
  _authMode = "recovery";
  _authStep = 1;
  _authShowAppInProgress = false;
  _clearSignupErrors();
  _authSetMessage("Choisis un nouveau mot de passe pour ton compte.", "");
  document.getElementById("auth-password").value = "";
  document.getElementById("auth-password-confirm").value = "";
  if (session?.user) {
    _currentAuthUserId = session.user.id;
    window._currentAuthUserId = session.user.id;
    window._levelingMathAuthUser = session.user;
    console.log("[auth] PASSWORD_RECOVERY user:", { id: session.user.id, email: session.user.email });
  }
  document.body.classList.add("auth-visible");
  document.getElementById("auth-overlay").style.display = "flex";
  document.getElementById("auth-user-bar").classList.remove("visible");
  _hideLoader();
  _authApplyLayout();
  setTimeout(() => {
    const p = document.getElementById("auth-password");
    if (p) p.focus();
  }, 60);
}

async function authSubmit() {
  const email    = (document.getElementById("auth-email").value || "").trim();
  const password = document.getElementById("auth-password").value || "";
  const btn      = document.getElementById("auth-submit-btn");
  _authSetMessage("", "");

  if (_authMode === "recovery") {
    if (!_validateStep2()) { _updateSignupSubmitState(); return; }
  } else if (_authMode === "signup") {
    // Étape 1 : valider pseudo + emails, puis passer à l'étape 2 (pas de signUp ici).
    if (_authStep === 1) {
      if (!_validateStep1()) { _updateSignupSubmitState(); return; }
      _authStep = 2;
      _authApplyLayout();
      setTimeout(() => { const p = document.getElementById("auth-password"); if (p) p.focus(); }, 60);
      return;
    }
    // Étape 2 : validation finale complète avant signUp.
    if (!_validateSignup()) { _updateSignupSubmitState(); return; }
  } else if (!email || !password) {
    _authSetMessage("Email et mot de passe requis.", "error");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Chargement…";

  try {
    if (_authMode === "recovery") {
      const { error } = await _qClient.auth.updateUser({ password });
      if (error) throw error;

      _authSetMessage("Mot de passe mis à jour. Tu peux maintenant te connecter.", "success");
      console.log("[auth] password recovery updateUser success");
      _clearPasswordRecoveryUrl();
      await _qClient.auth.signOut();

      _authRecoveryActive = false;
      _authMode = "login";
      _authStep = 1;
      document.getElementById("auth-password").value = "";
      document.getElementById("auth-password-confirm").value = "";
      _authApplyLayout();
      _authShowOverlay();
      _authSetMessage("Mot de passe mis à jour. Connecte-toi avec ton nouveau mot de passe.", "success");
      btn.disabled = false;
      return;
    } else if (_authMode === "signup") {
      const pseudoRaw = document.getElementById("auth-pseudo").value || "";
      const pseudoVal = window.normalizePseudo ? window.normalizePseudo(pseudoRaw) : pseudoRaw.trim().toLowerCase();

      const { data, error } = await _qClient.auth.signUp({
        email, password,
        options: { data: { pseudo: pseudoVal } }
      });
      if (error) throw error;

      // Création immédiate de l'élève dans students (lien auth_user_id).
      // Idempotent : si la ligne existe déjà (même pseudo) on ne la duplique pas.
      // Non-bloquant : si RLS bloque sans session active, saveStudent prendra le relais au 1er jeu.
      if (data.user) {
        try {
          const { data: existing } = await _qClient
            .from("students").select("id").ilike("pseudo", pseudoVal).limit(1);
          if (!existing || existing.length === 0) {
            const { error: insErr } = await _qClient.from("students").insert([{
              pseudo: pseudoVal,
              auth_user_id: data.user.id,
              xp_total: 0,
              best_score: 0,
              games_played: 0,
              session: 1
            }]);
            if (insErr) console.warn("[auth] Insert students différé:", insErr.message);
            else console.log("[auth] ✅ Élève créé à l'inscription →", pseudoVal);
          } else {
            console.log("[auth] Élève existant pour ce pseudo, pas d'insert.");
          }
        } catch (e) {
          console.warn("[auth] Insert students exception:", e?.message || e);
        }
      }

      unlockPseudo();
      clearSeriesState();

      if (data.user && !data.session) {
        _authSetMessage("Compte créé ! Vérifie ton email pour confirmer ta connexion.", "success");
        btn.disabled = false;
        btn.textContent = "Créer mon compte";
        return;
      }
      if (data.session) {
        pseudo = pseudoVal;
        renderPseudo();
        saveGame();
        _authShowApp(data.user, true);
      }
    } else {
      const { error } = await _qClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      console.log("[auth] authSubmit login success — onAuthStateChange prendra le relais");
      btn.disabled = false;
      btn.textContent = "Se connecter";
    }
  } catch (err) {
    _authSetMessage(_authTranslateError(err.message), "error");
    btn.disabled = false;
    btn.textContent = _authMode === "recovery" ? "Mettre à jour le mot de passe"
                    : _authMode === "signup" ? "Créer mon compte"
                    : "Se connecter";
    _updateSignupSubmitState();
  }
}

async function authSignOut() {
  if (typeof clearXpBonus === "function") clearXpBonus("logout");
  else console.log("[bonus-x2] nettoyage logout demandé, clearXpBonus indisponible");
  await _qClient.auth.signOut();
  _authShowOverlay();
}

/* ── Loader helpers ───────────────────────────────────────────────────── */
function _showLoader(msg) {
  const el = document.getElementById("loading-overlay");
  if (el) {
    el.style.display = "flex";
    const msgEl = document.getElementById("loader-message");
    if (msgEl && msg) msgEl.textContent = msg;
  }
}
function _hideLoader() {
  const el = document.getElementById("loading-overlay");
  if (el) el.style.display = "none";
}

/* ── Affichage de l'app après auth + restauration ──────────────────────── */
let _authShowAppInProgress = false;

async function _authShowApp(user, fromLogin = false) {
  if (_authShowAppInProgress) {
    console.log("[auth] _authShowApp déjà en cours — appel dupliqué ignoré (event:", user.email, ")");
    return;
  }
  _authShowAppInProgress = true;
  _currentAuthUserId = user.id;
  window._currentAuthUserId = user.id;
  window._levelingMathAuthUser = user;
  console.log("[auth] _authShowApp start — user:", user.email, "id:", user.id.slice(0, 8) + "…", "fromLogin:", fromLogin);
  if (typeof clearXpBonus === "function") clearXpBonus(fromLogin ? "login" : "auth_restore");
  else console.log("[bonus-x2] nettoyage login demandé, clearXpBonus indisponible");

  const storedUserId = localStorage.getItem("auth_user_id");
  if (storedUserId !== null && storedUserId !== user.id) {
    console.log("[auth] utilisateur différent → reset localStorage");
    unlockPseudo();
    clearSeriesState();
  }
  localStorage.setItem("auth_user_id", user.id);

  document.getElementById("auth-user-bar").classList.add("visible");
  document.getElementById("auth-user-email").textContent = user.email;
  _hideLoader();

  const overlay = document.getElementById("auth-overlay");
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (fromLogin && overlay && !reduceMotion) {
    // On retire auth-visible AVANT l'animation : le vrai bg de l'app (assets/images/bg.png
    // + gradients) est rendu derrière l'overlay encore opaque, donc la carte
    // fade révèle un fond déjà en place (plus de "pop in" du background).
    document.body.classList.remove("auth-visible");
    document.body.classList.add("auth-transitioning");
    overlay.classList.add("auth-transitioning");
    setTimeout(() => {
      document.body.classList.remove("auth-transitioning");
      overlay.style.display = "none";
      overlay.classList.remove("auth-transitioning");
    }, 1000);
  } else {
    // Restauration de session / reduced-motion : bascule immédiate (comportement d'origine)
    document.body.classList.remove("auth-visible");
    if (overlay) overlay.style.display = "none";
  }

  _authShowAppInProgress = false;
  console.log("[AUTH] app shown", fromLogin ? "with transition" : "immediately");

  // Restauration du profil en arrière-plan, exposée pour que startQuiz puisse l'attendre.
  window._authReadyPromise = new Promise(resolve => setTimeout(resolve, 300))
    .then(() => {
      console.log("[SYNC] background sync started");
      return syncStudentFromSupabase(user);
    })
    .catch(e => {
      console.error("[auth] ❌ Erreur restauration profil (background):", e);
    })
    .finally(() => {
      console.log("[SYNC] background sync finished");
    });
}

function _authShowOverlay() {
  _currentAuthUserId = null;
  window._currentAuthUserId = null;
  document.body.classList.add("auth-visible");
  document.getElementById("auth-overlay").style.display = "flex";
  document.getElementById("auth-user-bar").classList.remove("visible");
  _hideLoader();
}

// Touche Entrée + validation live sur tous les champs auth
["auth-pseudo", "auth-email", "auth-email-confirm", "auth-password", "auth-password-confirm"].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("keydown", e => { if (e.key === "Enter") authSubmit(); });
  el.addEventListener("input", () => {
    if (_authMode === "signup") _validateSignup();
    _updateSignupSubmitState();
  });
});

// Toggle œil afficher/masquer mot de passe
document.querySelectorAll(".auth-password-toggle").forEach(btn => {
  btn.addEventListener("click", () => {
    const id = btn.getAttribute("data-target");
    const input = document.getElementById(id);
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.textContent = show ? "🙈" : "👁";
    btn.setAttribute("aria-label", show ? "Masquer le mot de passe" : "Afficher le mot de passe");
  });
});

console.log("[INIT] auth chargé");

// Écoute les changements d'état d'auth.
_qClient.auth.onAuthStateChange(async (event, session) => {
  console.log("[auth] onAuthStateChange →", event, session ? `(${session.user?.email})` : "(pas de session)");
  if (event === "PASSWORD_RECOVERY") {
    console.log("[auth] PASSWORD_RECOVERY détecté");
    _authEnterPasswordRecoveryMode(session);
    return;
  }
  if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
    if (_authRecoveryActive || _isPasswordRecoveryUrl()) {
      console.log("[auth] session recovery détectée → formulaire nouveau mot de passe");
      _authEnterPasswordRecoveryMode(session);
      return;
    }
    if (session) {
      if (event === "SIGNED_IN") console.log("[auth] onAuthStateChange SIGNED_IN →", session.user?.email);
      await _authShowApp(session.user, event === "SIGNED_IN");
    } else {
      console.log("[auth] Pas de session → formulaire auth");
      _authShowOverlay();
    }
  } else if (event === "SIGNED_OUT") {
    console.log("[auth] SIGNED_OUT → overlay auth");
    _authShowOverlay();
  }
});
