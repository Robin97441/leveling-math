# ⚠️ Instructions critiques pour Claude Code
Toujours lire ce fichier avant toute modification du projet.
Ne jamais faire de refactor global.
Toujours faire des modifications minimales et locales.
# Leveling Math — Contexte projet et règles à respecter

## Objectif du projet
Leveling Math est une application de calcul mental gamifiée avec :
- interface élève
- authentification / reconnexion
- sauvegarde Supabase
- dashboard prof
- statistiques pédagogiques
- adaptation progressive du contenu

Le projet doit rester :
- rapide
- lisible
- stable
- pédagogique
- facilement modifiable sans casser l’existant

---

## Règle absolue
Avant toute modification :
1. lire uniquement les parties concernées
2. ne pas analyser tout le projet si ce n’est pas nécessaire
3. faire la correction minimale
4. éviter les refactors globaux non demandés
5. ne jamais casser une logique déjà validée par les tests réels

Si un bug ou une demande concerne une fonction précise, ne lire que :
- le fichier concerné
- la fonction concernée
- les helpers directement liés

---

## Architecture logique actuelle

### Identifiants
- `student_id` = clé métier principale
- `auth_user_id` = clé technique secondaire
- le dashboard repose sur `student_id`
- `auth_user_id` sert à la session élève, reconnexion, mapping local

### Tables importantes
- `students`
- `series_results`
- `question_results`

### Liaison des données
- `series_results.id` doit être exactement le même que `question_results.series_id`
- toute question sauvegardée pendant une série doit être rattachée au bon `series_id`
- ne jamais recréer un autre id en parallèle pour une même série

### Session élève
- la restauration de session fonctionne actuellement
- ne pas casser la logique actuelle
- ne pas refactorer auth / sync / restore sans demande explicite

---

## Dashboard — règles à respecter

### Source de vérité
- `question_results` = source de vérité pour :
  - XP net
  - justes / fausses
  - détail de série
  - stats par catégorie
  - stats par sous-catégorie

- `series_results` = résumé / structure des séries

### Important
Le dashboard fonctionne maintenant.
Ne pas modifier la logique de récupération des séries ou questions sans nécessité absolue.

### UX dashboard
Le dashboard doit rester :
- compact
- lisible
- utile pédagogiquement
- sans sections longues inutiles

### Sections déjà pertinentes
- progression globale
- dernières séries
- XP cumulé
- stats par type de calcul
- détail par sous-type
- plan de révision
- détail d’une série

### Sections à éviter
- longues timelines avec 100 lignes
- doublons avec les infos déjà visibles
- widgets inutiles ou décoratifs

---

## Règles de modification du code

### Quand une demande est simple
Ne pas relire tout le projet.
Se limiter aux fonctions directement concernées.

### Toujours privilégier
- correction minimale
- modification locale
- conservation du comportement actuel
- lisibilité du code

### Éviter
- refactor massif
- renommages globaux
- changement de structure sans demande
- lecture complète du fichier si seule une petite zone est concernée

### Si debug temporaire
- ajouter des logs courts et explicites
- les retirer ensuite quand le bug est confirmé résolu

---

## Niveaux pédagogiques — logique officielle à respecter

### Débutant
- addition
- soustraction
- division
- multiplication
- nombres à 2 chiffres maximum

### Intermédiaire
- puissances de 2 jusqu’à 15²
- racines carrées jusqu’à 225
- fractions à même dénominateur
- simplification de fractions
- nombres relatifs :
  - addition
  - soustraction
  - division
  - multiplication
- puissances de 10 positives jusqu’à 10^6
- puissances de 10 négatives jusqu’à 10^-6

### Expert
- additions et soustractions à 3 chiffres
- puissances de 3 jusqu’à 10³
- calcul littéral simple
- distributivité simple
- fractions à dénominateurs différents
- pourcentages

Ne pas réinventer ces niveaux sans demande explicite.

---

## Timers officiels à respecter

### Intermédiaire
- tous les sous-types à 10 secondes
- sauf `fractions_simplification` à 20 secondes

### Expert
- tous les sous-types à 15 secondes
- sauf `fractions_denominateurs_differents` à 30 secondes

Ne pas modifier ces timers sans demande explicite.

---

## Logique pédagogique actuelle
Le système doit favoriser automatiquement les faiblesses de l’élève sans bouton manuel.

### Important
Il a déjà existé une logique où les catégories sous 70% revenaient plus souvent.
Toute amélioration future doit :
- conserver cette idée
- éviter les répétitions trop visibles
- rester naturelle pour l’élève
- ne pas ajouter de bouton “s’entraîner sur mes lacunes” sauf demande explicite

---

## Feedback élève
Le feedback doit être :
- court
- lisible
- motivant
- pédagogique
- non culpabilisant

Éviter :
- messages trop longs
- jargon technique
- surcharge visuelle

Le feedback doit idéalement inclure :
- message global
- points forts
- temps moyen
- objectif simple
- éventuellement points faibles si utile et lisible

---

## Quand on me demande une modification
Toujours répondre en respectant ce format mental :

1. identifier la zone exacte concernée
2. ne modifier que cette zone
3. garder la logique métier existante
4. proposer la correction la plus simple possible
5. éviter toute exploration inutile du projet

---

## Si une correction semble nécessiter beaucoup de lecture
D’abord :
- expliquer quelles fonctions précises doivent être inspectées
- éviter de lire des zones non liées
- ne pas partir en analyse globale sans nécessité

---

## Nettoyage
Quand une fonctionnalité ou un bug est résolu :
- retirer les logs de debug
- ne pas toucher au comportement fonctionnel
- ne pas faire de refactor juste “parce que le code peut être plus beau”

---

## Priorité produit
En cas d’hésitation, prioriser :
1. stabilité
2. cohérence pédagogique
3. lisibilité
4. performance
5. design

---

## Consigne finale
Si une demande utilisateur est locale, fais une modification locale.
Si une demande utilisateur est pédagogique, respecte strictement les niveaux et timers définis ici.
Si quelque chose fonctionne déjà en réel, ne le casse pas.