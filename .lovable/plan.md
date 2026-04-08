# COCKPIT-7C — Verdict de complétude avant pricing : DONE ✅

## Composant `PricingReadinessCard.tsx`
- 2 queries : `external_quote_requests` + `external_quote_response_facts`
- Verdict 4 niveaux : Prêt / Provisoire / Incomplet / Neutre
- Logique corrigée : Incomplet = demandes lancées mais aucune réponse/fait exploitable
- Résumé compact : `x/y clôturées · n fait(s) à valider`
- Placement au-dessus de PricingLaunchPanel

## Blast radius
| Fichier | Nature |
|---------|--------|
| `PricingReadinessCard.tsx` | Nouveau composant |
| `CaseView.tsx` | +import + rendu |
| `.lovable/plan.md` | Plan actif |
| `docs/DEFERRED_BACKLOG.md` | Entrée ajoutée |
