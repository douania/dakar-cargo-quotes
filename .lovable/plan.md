

# P2-C — Garde-fou scope contractuel sur suggestions partenaires

## Problème
`PartnerSuggestionPanel` et `derivePartnerRequestScope` poussaient
systématiquement des suggestions de fret maritime dès que le dossier était
maritime, même quand le fret était hors périmètre contractuel (ex. CIF).
Le fallback de `derivePurpose` renforçait ce biais en retournant `freight_rate`
par défaut. Le signal `freight_scope` (produit par `analyze-service-scope`)
existait déjà mais n'était consommé que par `CaseUnderstandingPanel`.

## Diagnostic confirmé
- `derivePartnerRequestScope` L51 : `if (isMaritime)` → émet `freight_rate` sans vérifier le scope contractuel
- `derivePurpose` L69 : fallback → `freight_rate` systématique
- `PartnerScopeCard` : même logique, même absence de garde-fou
- Signal `freight_scope` disponible dans `case_timeline_events` (event_type = `service_scope_v1`, path `event_data.scope.freight_scope`)

## Correctif appliqué

### derivePartnerRequestScope (partnerRequestScope.ts)
- Ajout de `freightScope?: boolean | null` dans `ScopeInput`
- Garde-fou : `if (isMaritime && input.freightScope !== false)` — le bloc `freight_rate` n'est émis que si le fret est dans le scope ou inconnu (conservatif)
- Même logique pour `air_tariff`

### PartnerSuggestionPanel
- Query ajoutée : lecture du dernier `service_scope_v1` dans `case_timeline_events` (limit 1, lecture seule)
- `freightScope` passé à `derivePartnerRequestScope` et `derivePurpose`
- `derivePurpose` : tous les fallbacks vers `freight_rate` deviennent `general` quand `freightScope === false`
- Suggestions hors scope : visibles mais atténuées (opacity-60, badge "hors scope", pas de bouton "Préremplir")
- Tri : suggestions hors scope reléguées en fin de liste
- Compteur "à contacter" : exclut les suggestions hors scope

### PartnerScopeCard
- Query ajoutée : même lecture `service_scope_v1`
- `freightScope` passé à `derivePartnerRequestScope`
- Bloc "Fret maritime" n'apparaît plus quand `freightScope === false`

### Neutralité du fallback "general" — vérification exhaustive
- `PURPOSE_LABELS["general"]` → "Général" ✅
- `PURPOSE_INTRO["general"]` → "votre meilleure offre" ✅ (pas de référence fret)
- `PURPOSE_INCLUDES["general"]` → ["Détail de l'offre", "Conditions applicables", "Validité"] ✅
- `PURPOSE_OPTIONS` dans ExternalRequestsPanel → "Autre / Général" ✅
- `resolveTransportLabel` → retourne "de transport" quand purpose=general ✅
- Aucune requalification implicite en fret nulle part dans la chaîne UI/template

## Garde-fous respectés
1. `useCockpitState` non élargi
2. Aucune edge function modifiée
3. Aucune migration DB
4. Suggestions hors scope restent visibles (pas de masquage brutal)
5. Comportement conservatif : si `freightScope` est null/undefined, tout fonctionne comme avant

## Blast radius
- 3 fichiers runtime modifiés : partnerRequestScope.ts, PartnerSuggestionPanel.tsx, PartnerScopeCard.tsx
- 2 queries ajoutées (lecture seule, case_timeline_events, limit 1, staleTime 60s)
- 0 edge function
- 0 migration DB
- P0-A/P0-B/P0-C/P1-A/P1-B/P1-C/P2-A/P2-B non impactés
