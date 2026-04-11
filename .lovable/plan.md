

# P2-A — Consolidation widgets secondaires partenaires

## Problème
`PartnerRequestsSummary` et `PartnerCollectionReadinessCard` maintenaient chacun
des requêtes Supabase indépendantes dupliquant largement les signaux déjà
calculés par `useCockpitState`. Risque de drift croissant (constantes locales,
compteurs divergents, logiques parallèles).

## Diagnostic confirmé
- `PartnerRequestsSummary` : query propre sur `external_quote_requests` +
  `external_quote_response_facts` (count head) — 100 % redondant
- `PartnerCollectionReadinessCard` : query propre + set local
  `RESPONSE_PHASE_STATUSES` incluant `closed` (drift vs constante partagée) +
  calcul de verdict local
- `CommunicationSummaryCard` / `PartnerRequestsDetailView` : besoins plus
  détaillés → hors périmètre (P2-B)

## Correctif appliqué

### useCockpitState étendu (4 champs, 1 query ajustée)
- `partner_name` ajouté au select `external_quote_requests`
- Query facts : `count head` → `select request_id` filtré `proposed`
  (permet groupage par request_id)
- Nouveaux champs exposés :
  - `sentConfirmedPartnerRequests`
  - `selectedPartnerName`
  - `exploitablePartnerRequests`
  - `collectionVerdict`
  - `pendingFactsByRequestId`

### cockpitStatusConstants enrichi
- Type `CollectionVerdict` exporté
- Fonction pure `computeCollectionVerdict(requests, pendingFactsByRequestId)`
  - `closed` traité comme exploitable terminal, PAS ajouté à `RESPONSE_PHASE_STATUSES`
  - Sémantique explicite dans le code

### PartnerRequestsSummary migré
- Query interne supprimée
- Consomme `useCockpitState` (React Query déduplique la clé)
- Libellé "En phase réponse" (≡ `responsePhaseRequests`) au lieu de
  l'ancien "Réponses reçues" pour refléter le calcul réel

### PartnerCollectionReadinessCard migré
- Query interne supprimée
- Set local `RESPONSE_PHASE_STATUSES` supprimé (drift éliminé)
- Consomme verdict + exploitable + selectedPartnerName de `useCockpitState`

## Garde-fous respectés
1. `RESPONSE_PHASE_STATUSES` non modifié — `closed` reste explicitement
   traité dans `computeCollectionVerdict`, pas glissé dans le set
2. Compteur renommé : "En phase réponse" reflète exactement
   `responsePhaseRequests` (= demandes dont le status ∈ RESPONSE_PHASE_STATUSES)

## Blast radius
- 0 edge function modifiée
- 0 migration DB
- 2 widgets simplifiés (queries locales supprimées)
- 1 hook étendu (4 champs, 1 query ajustée)
- 1 module constants enrichi (type + helper pur)
- P0-A/P0-B/P0-C/P1-A/P1-B/P1-C non impactés
