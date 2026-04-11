

# P2-D Lot 1 — Modèle dérivé de scope courant

## Problème

Le cockpit n'avait pas de modèle intermédiaire centralisant l'interprétation du périmètre contractuel.
Chaque composant dérivait sa propre réponse à "quels services sont dans le scope ?" :
- PartnerSuggestionPanel lisait `service_scope_v1` via query locale
- PartnerScopeCard lisait `service_scope_v1` via query locale identique
- PricingLaunchPanel ne consultait pas le scope du tout
- PricingCommWarnings faisait 3 HEAD queries redondantes avec useCockpitState

Résultat : suggestions partenaires promouvaient le fret hors scope, PricingLaunchPanel affirmait
"Toutes les décisions sont validées" sans vérification, 3 queries réseau dupliquées.

## Architecture

### `src/lib/scopeQualification.ts` — Helper pur

```typescript
qualifyScope(input) → QualifiedScope { items, hasCriticalUnconfirmed }
```

3 catégories strictes :
- `confirmed` : scope === true ET facts structurants présents
- `unconfirmed` : scope === true mais facts manquants, OU scope === null
- `out_of_scope` : scope === false

Pas de catégorie "optional" — le repo n'a aucun signal pour la distinguer de "confirmed".

### `src/hooks/useServiceScope.ts` — Hook léger

1 query React Query (staleTime 60s) lisant le dernier `service_scope_v1`.
Remplace 2 queries dupliquées dans PartnerSuggestionPanel et PartnerScopeCard.

## Composants modifiés

### PartnerSuggestionPanel
- Consomme `useServiceScope` (supprime query locale scope)
- Consomme `useCockpitState` pour le gate de statut
- Chaque suggestion croisée avec `qualifyScope()` :
  - `confirmed` → CTA "Préremplir" actif, style normal
  - `unconfirmed` → visible, badge "provisoire", PAS de CTA engageant
  - `out_of_scope` → opacity-60, badge "hors scope", PAS de CTA, non compté
- Gate de statut : si `statusAtLeast(PRICED_DRAFT)` ET 0 partner requests → panel masqué
- Si post-pricing avec requests existantes → panel atténué (opacity-50), pas de CTA

### PartnerScopeCard
- Consomme `useServiceScope` (supprime query locale scope)
- Blocs croisés avec `qualifyScope()` :
  - `confirmed` → affichage normal
  - `unconfirmed` → badge "non confirmé"
  - `out_of_scope` → opacity-60, badge "hors périmètre"

### PricingLaunchPanel
- Consomme `useServiceScope` + `qualifyScope()`
- Description conditionnelle :
  - `hasCriticalUnconfirmed` → "Un pricing peut être lancé. Des services restent non confirmés dans le périmètre du dossier."
  - Sinon → texte existant ("Toutes les décisions sont validées...")
  - `isRerun` → texte existant inchangé
- Informatif uniquement, pas de blocage

### PricingCommWarnings
- 3 queries HEAD locales supprimées
- Consomme `useCockpitState(caseId)` → `openPartnerRequests`, `pendingPartnerFacts`, `openClientGaps`
- Rendu identique

## Règles visuelles par type de surface

| Type de surface | `out_of_scope` | `unconfirmed` |
|---|---|---|
| Information (PartnerScopeCard) | Visible mais secondaire, badge "hors périmètre" | Badge "non confirmé" |
| Promotion (PartnerSuggestionPanel) | opacity-60, badge "hors scope", pas de CTA, non compté | Visible, badge "provisoire", pas de CTA engageant |
| Central (PricingLaunchPanel) | Non utilisé pour justifier/bloquer | `hasCriticalUnconfirmed` → description ajustée, pas de blocage |

## Blast radius

- 2 nouveaux fichiers : `scopeQualification.ts`, `useServiceScope.ts`
- 4 fichiers runtime modifiés
- -5 queries réseau (2 scope + 3 HEAD)
- 0 migration DB
- 0 edge function modifiée
- 0 modification de useCockpitState

## Lot 2 (différé — après validation lot 1)

- NextActionBanner : dégrader priorité "Lancer le pricing" si `hasCriticalUnconfirmed`
- ReadyActionsPanel : même logique de dégradation

## Garde-fous respectés

1. `useCockpitState` non élargi
2. Aucune edge function modifiée
3. Aucune migration DB
4. Comportement conservatif : scope null → `unconfirmed` (pas de présomption)
5. Gate de statut respecte la doctrine opérateur souverain (informatif, pas bloquant)
