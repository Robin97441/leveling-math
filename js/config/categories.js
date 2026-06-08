// ── Correspondance sous-catégorie → catégorie ────────────────────────────
// Utilisé par le système adaptatif (genSmartQuestion) pour le fallback par catégorie.
const SUBCAT_TO_CAT = {
  // Intermédiaire
  carre_parfait:"puissances", racine_carree:"racines", puissance_10:"puissances",
  fractions_simplification:"fractions", fractions_meme_denominateur:"fractions",
  addition_relatifs:"addition", soustraction_relatifs:"soustraction",
  multiplication_relatifs:"multiplication", division_relatifs:"division",
  // Expert
  puissance_cube:"puissances", fractions_denominateurs_differents:"fractions",
  pourcentage_entier:"pourcentages", reduction_termes:"calcul_litteral", distributivite_simple:"calcul_litteral",
  addition_3chiffres:"addition", soustraction_3chiffres:"soustraction",
  // Historique avant refonte
  puissance_carre:"puissances",
  addition_grands_nombres:"addition", soustraction_grands_nombres:"soustraction",
  multiplication_grands_nombres:"multiplication", division_euclidienne:"division",
  fractions_multiplication:"fractions", fractions_division:"fractions",
  addition_simple:"addition", addition_retenue:"addition",
  soustraction_simple:"soustraction", soustraction_retenue:"soustraction",
  multiplication_simple:"multiplication", division_simple:"division",
};

// ── Libellés lisibles par sous-catégorie ─────────────────────────────────
// Utilisé dans le dashboard et le feedback élève.
const SUBCAT_LABELS = {
  // ── Débutant ──────────────────────────────────────────────────────────
  addition_simple:                    "Addition simple",
  addition_retenue:                   "Addition avec retenue",
  soustraction_simple:                "Soustraction simple",
  soustraction_retenue:               "Soustraction avec retenue",
  multiplication_simple:              "Tables de multiplication",
  division_simple:                    "Division simple",
  // ── Intermédiaire ─────────────────────────────────────────────────────
  carre_parfait:                      "Carrés parfaits (2²–15²)",
  racine_carree:                      "Racines carrées (√4–√225)",
  puissance_10:                       "Puissances de 10",
  fractions_simplification:           "Simplification de fractions",
  fractions_meme_denominateur:        "Fractions (même dénominateur)",
  addition_relatifs:                  "Addition de relatifs",
  soustraction_relatifs:              "Soustraction de relatifs",
  multiplication_relatifs:            "Multiplication de relatifs",
  division_relatifs:                  "Division de relatifs",
  // ── Expert ────────────────────────────────────────────────────────────
  addition_3chiffres:                 "Addition (3 chiffres)",
  soustraction_3chiffres:             "Soustraction (3 chiffres)",
  puissance_cube:                     "Puissances de 3 (2³–10³)",
  reduction_termes:                   "Réduction de termes",
  distributivite_simple:              "Distributivité simple",
  fractions_denominateurs_differents: "Fractions (dénominateurs différents)",
  pourcentage_entier:                 "Pourcentages",
  // ── Historique (données avant refonte) ────────────────────────────────
  addition_grands_nombres:            "Addition grands nombres",
  soustraction_grands_nombres:        "Soustraction grands nombres",
  multiplication_grands_nombres:      "Multiplication",
  division_euclidienne:               "Division",
  puissance_carre:                    "Puissance ²",
  fractions_multiplication:           "Fractions ×",
  fractions_division:                 "Fractions ÷",
  addition:                           "Addition",
  soustraction:                       "Soustraction",
};
