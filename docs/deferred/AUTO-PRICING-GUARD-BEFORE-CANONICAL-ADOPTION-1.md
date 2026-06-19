# AUTO-PRICING-GUARD-BEFORE-CANONICAL-ADOPTION-1

Statut : `DEFERRED / REQUIRED_BEFORE_CANONICAL_ADOPTION_PATCH`

Priorité : `P0/P1`

Date d'inscription : 2026-06-19

Phase d'origine : `CASEVIEW-FUNCTION-CALLS-AND-FACTS-PIPELINE-AUDIT-1`

## Contexte

Les audits statiques Claude Code + Codex ont confirmé que `saveGapAnswer` dans `src/pages/CaseView.tsx` peut déclencher `run-pricing` automatiquement après résolution du dernier gap bloquant.

Cette logique existe aujourd'hui dans le workflow gaps opérateur. Elle ne concerne pas directement le preview cargo canonique tant que celui-ci reste read-only/dry-run et tant qu'une future adoption canonique écrit uniquement dans `cargo_lines` / `cargo_equipment`.

## Risque

Une future jonction naïve entre le preview cargo canonique et le workflow opérateur pourrait déclencher un pricing indirect si elle :

- réutilise `saveGapAnswer` ;
- écrit dans `quote_facts` via `set-case-fact` ;
- résout automatiquement des `quote_gaps` ;
- appelle `build-case-puzzle` avec un post-hook de pricing ;
- ajoute une logique équivalente à `allowAutoPricing=true`.

Risque actuel : `moyen` dans le workflow gaps existant.

Risque futur : `élevé` si l'adoption cargo canonique est branchée naïvement au workflow gaps/facts legacy.

## Règle CTO

Adopter le cargo canonique ne doit jamais lancer le pricing.

## Doctrine cible pour `CARGO-CANONICAL-OPERATOR-ADOPTION-1`

Le workflow sûr doit être strictement séparé :

1. Preview canonique read-only.
2. Diff opérateur entre legacy `quote_facts` et cargo canonique preview.
3. Confirmation explicite `Adopter le cargo canonique`.
4. Écriture bornée uniquement dans `cargo_lines` / `cargo_equipment` via le writer canonique.
5. Refresh UI.
6. Pricing uniquement via action séparée et explicite `Lancer le pricing`.

## Interdictions pour la future adoption canonique

- Ne pas réutiliser `saveGapAnswer`.
- Ne pas appeler `run-pricing`.
- Ne pas résoudre automatiquement des gaps.
- Ne pas écrire automatiquement dans `quote_facts`.
- Ne pas mélanger adoption cargo canonique et pricing readiness.
- Ne pas déclencher de pricing via post-hook après adoption.

## Garde-fous recommandés

Avant tout patch d'adoption canonique :

- vérifier que l'action d'adoption appelle uniquement le canonicalizer en `mode: commit` ou un wrapper dédié équivalent ;
- vérifier que la fonction appelée écrit uniquement via `write-cargo-canonical` ;
- vérifier qu'aucun appel à `set-case-fact`, `saveGapAnswer`, `run-pricing` ou résolution automatique de gaps n'est présent ;
- afficher un diff clair legacy vs canonique ;
- exiger confirmation opérateur ;
- conserver les statuts `to_confirm` quand la source demande confirmation ;
- laisser le lancement pricing à un bouton séparé.

## Décision CTO actuelle

Ne pas patcher maintenant.

Inscrire ce garde-fou comme prérequis obligatoire avant toute phase `CARGO-CANONICAL-OPERATOR-ADOPTION-1`.

## Stop conditions futures

Arrêter et demander GO CTO si :

- le patch proposé touche `saveGapAnswer` ;
- le patch proposé appelle `run-pricing` ;
- le patch proposé écrit dans `quote_facts` ;
- le patch proposé modifie `quote_gaps` ;
- le patch proposé change les conditions de pricing readiness ;
- le patch proposé dépasse 3 fichiers ;
- migration DB nécessaire ;
- RLS/Auth ou runtime Lovable concernés.

## Hors périmètre immédiat

- Aucun changement de `saveGapAnswer` maintenant.
- Aucun changement `run-pricing` maintenant.
- Aucun changement `quote_facts` / `quote_gaps` maintenant.
- Aucun changement runtime Lovable maintenant.
