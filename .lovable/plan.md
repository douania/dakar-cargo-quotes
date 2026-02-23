
# Audit CTO P0/P1 — Module Gestion Emails — APPLIQUÉ ✅

## Patches appliqués

### P0-A ✅ — processQuotationRequest batching complet
### P1-B ✅ — Recalcul metadata thread sur fil complet
### P1-C ✅ — Index unique partiel root_message_id
### P1-D ✅ — Harmonisation sync-emails et email-admin

## Remédiation legacy threads ✅

Migration CTO-safe non destructive appliquée :
- Étape 1 : Recalcul email_count + first/last dates pour threads legacy (root_message_id IS NULL)
- Étape 2 : Safety net orphelins → email_count = 0 (pas de DELETE)

### Vérifications post-migration
- ✅ Cohérence email_count : **0 écart** (tous les threads legacy corrigés)
- ⚠️ 16 threads orphelins legacy (subject=no-subject, email_count=0, dates conservées mais first_at=NULL)
  - Aucun n'a de quote_case ni puzzle_job lié → **suppression safe possible**
- ⚠️ 16 threads orphelins ont des dates (first/last_message_at) mais aucun email lié → dates fantômes héritées

### Décision pendante
- Les 16 orphelins (all: no-subject, 0 emails, 0 dépendances) peuvent être supprimés dans une migration dédiée

## Aucun composant FROZEN modifié
