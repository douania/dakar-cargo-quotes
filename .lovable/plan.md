# Onglet « Marchandise » — simplification (présentation seule)

## Constat (écran actuel, mode guidé)
L'onglet empile deux gros blocs repliables et une dizaine de sous-blocs :
- « Informations à vérifier » : chiffres (complétude, faits, questions), bouton Actualiser, zone « Actions cargo canonique », « Outils avancés » (cargo canonique, synchro, intent), bouton « Comprendre le périmètre », panneau de compréhension, alertes des questions ouvertes, clarifications client, hypothèses, demande consolidée.
- « Bases de la marchandise » : lots, groupes/catégories PAD, aide à la classification, variantes et historique.
Résultat : trop de boutons au même niveau, textes d'aide répétés, et l'opérateur ne voit pas par où commencer.

## Organisation cible : trois étapes numérotées, une action à la fois
```text
Marchandise
 [Résumé en une ligne : lots · poids · catégories · X points à vérifier]

 1. Ce qu'il faut compléter        (ouvert seulement s'il y a des questions)
    - questions bloquantes puis non bloquantes, un champ + « Enregistrer » chacune
    - un seul bouton secondaire : « Préparer les questions au client »
    - suivi des clarifications client en liste compacte
 2. Lots et catégories portuaires  (ouvert par défaut)
    - panneaux lots + groupes PAD existants, inchangés
    - « Aide à la classification » repliée juste dessous
 3. Estimation et variantes         (replié)
    - variantes, choix de l'estimation, historique

 Détails et outils (replié, en bas)
    - chiffres du dossier, Actualiser, Comprendre le périmètre,
      compréhension de la demande, hypothèses, demande consolidée,
      outils avancés (cargo canonique, synchro, intent) et leurs boutons
```

## Règles
- Une étape n'affiche qu'un bouton principal ; les autres actions sont secondaires ou dans « Détails et outils ».
- Un seul texte d'aide court par étape ; suppression des doublons (ex. « Les estimations restent consultables dans Devis », avertissement répété sur l'estimation).
- L'étape 1 disparaît quand il n'y a rien à compléter, remplacée par « Rien à compléter ».
- Présentation précédente (bascule existante) inchangée.

## Hors périmètre
Aucune modification de calcul, faits, questions, enregistrements, pricing automatique, fonctions serveur, base, Auth/RLS, ni des panneaux PAD/lots eux-mêmes (déplacement et libellés seulement). Pas de changement des autres onglets.

## Détails techniques
- Fichier : `src/pages/CaseView.tsx` uniquement (bloc TabsContent « marchandise », lignes ~1684–2162), plus test `cockpit-layout.test.tsx` si ancres/libellés affectés.
- Mêmes instances de composants, simple réordonnancement JSX ; ancres conservées (`section-data`, `section-scenarios`, `section-scenario-variants`, `section-stay-assumptions`, `gap-review-*`) et mapping SECTION_TAB inchangé ; les fonctions d'ouverture ouvrent aussi le nouveau bloc parent.
- Portails `cargo-canonical-action` / `cargo-legacy-sync-action` déplacés dans « Détails et outils ».
- Contrôles : typecheck, Vitest ciblé puis complet (baseline LocalTransportEstimateFields connue), lint:baseline, build, capture 1280/375 px.
- Gouvernance : exige un GO explicite pour ce lot ; rollback = revert du commit unique.
