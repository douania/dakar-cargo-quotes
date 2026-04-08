# COCKPIT-9 Phase 1 — Suffisance de collecte partenaire : DONE ✅

## Composant `PartnerCollectionReadinessCard.tsx`
- 2 queries : `external_quote_requests` + `external_quote_response_facts`
- Logique "exploitable" : status ∈ response phase + 0 proposed facts, ou closed
- 4 verdicts : neutral / insuffisante / en cours / suffisante
- Ligne "Offre retenue : Sélection requise" (placeholder Phase 1)
- Pas de doublon avec PricingReadinessCard (pas de ligne "Impact pricing")

## Blast radius
| Fichier | Nature |
|---------|--------|
| `PartnerCollectionReadinessCard.tsx` | Nouveau composant |
| `CaseView.tsx` | +import + rendu avant PricingReadinessCard |
| `.lovable/plan.md` | Plan actif |
| `docs/DEFERRED_BACKLOG.md` | Entrée ajoutée |
