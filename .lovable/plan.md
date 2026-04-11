


# P2-B — Previews détaillés cohérents

## Problème
`CommunicationSummaryCard` effectuait 3 queries parallèles dont 2 counts
purement redondants avec `useCockpitState`. `PartnerRequestsDetailView`
redéfinissait localement `RESPONSE_PHASE_STATUSES` avec `closed` inclus,
reproduisant le même drift corrigé en P2-A pour `ReadinessCard`.

## Diagnostic confirmé
- `CommunicationSummaryCard` : query `external_quote_response_facts` count
  (= `pendingPartnerFacts`) + query `client_gap_requests` count
  (= `openClientGaps`) — 100 % redondant
- `PartnerRequestsDetailView` L46-52 : set local avec `closed` inclus,
  divergence avec la constante partagée `cockpitStatusConstants.ts`

## Correctif appliqué

### CommunicationSummaryCard migré
- 2 queries count supprimées (facts + client gaps)
- Consomme `useCockpitState(caseId)` pour `pendingPartnerFacts`,
  `openClientGaps`, `openPartnerRequests`
- Mini-query locale conservée, strictement bornée :
  - colonnes : `id, partner_name, status, purpose`
  - filtre : `status != closed`
  - `limit(4)` pour borner le preview
- `purpose` NON ajouté à `useCockpitState` (contrat synthétique préservé)

### PartnerRequestsDetailView corrigé
- Set local `RESPONSE_PHASE_STATUSES` supprimé (5 statuts dont `closed`)
- Import de `RESPONSE_PHASE_STATUSES` depuis `cockpitStatusConstants.ts`
- `isExploitable` corrigé :
  - `closed` → `return true` (état terminal exploitable)
  - sinon → `RESPONSE_PHASE_STATUSES.has(status) && proposedFacts === 0`
- Aligné avec `computeCollectionVerdict` de P2-A

### Option retenue : B (pas de hook commun)
Les deux composants ont des besoins de colonnes trop différents pour
justifier un hook partagé. Seul le drift de constante a été corrigé.

## Garde-fous respectés
1. `RESPONSE_PHASE_STATUSES` non modifié — `closed` traité explicitement
2. `useCockpitState` non élargi — `purpose` reste hors contrat
3. Mini-query preview bornée à 4 rows et colonnes minimales

## Blast radius
- 0 edge function modifiée
- 0 migration DB
- 1 widget simplifié (2 queries supprimées) : CommunicationSummaryCard
- 1 drift corrigé : PartnerRequestsDetailView
- useCockpitState inchangé
- P0-A/P0-B/P0-C/P1-A/P1-B/P1-C/P2-A non impactés
