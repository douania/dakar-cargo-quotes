# COCKPIT-5 — Clôture complète

## Phase 1 : DONE ✅
- Suggestion prudente basée sur transport mode + rôle/notes
- Badge "déjà contacté", préremplissage (name, purpose)
- Validé fonctionnellement sur dossier maritime réel

## Phase 2 : DONE ✅
- Migration: `contact_email TEXT NULL`, `service_types TEXT[] NOT NULL DEFAULT '{}'::text[]`
- `derivePurpose()` priorise `service_types`
- Icône email, préremplissage `partner_email`

---

# COCKPIT-6 — Brief intelligent + Compteurs honnêtes

## Statut : DONE ✅

### Volet A — Brief partenaire intelligent
- Query autonome `quote_facts` (routing, cargo, contacts, timing)
- `buildBriefText(facts, partnerName, purpose)` : 3-6 lignes, tolérant aux absences
- Extension `onPrefill(name, purpose, email, briefText)`
- Injection dans `purpose_detail` uniquement si vide

### Volet B — Compteurs opérationnels dans CaseActionPlan
- Badges conditionnels (affichés seulement si > 0) :
  - `draftPartnerRequests` → à préparer
  - `unsentPartnerRequests` → envois à confirmer
  - `pendingPartnerFacts` → faits à valider
  - `draftedClientGaps` → clarifications à envoyer
  - `blockingGapsCount` → gaps bloquants
- Aucune query supplémentaire, données déjà calculées

### Blast radius
| Fichier | Nature |
|---------|--------|
| `PartnerSuggestionPanel.tsx` | +1 query facts, +`buildBriefText`, signature étendue |
| `ExternalRequestsPanel.tsx` | Callback +1 param, injection `purpose_detail` si vide |
| `CaseActionPlan.tsx` | +badges compteurs conditionnels |
