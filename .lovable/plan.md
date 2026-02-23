
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
- Étape 3 : Suppression conditionnelle des 16 orphelins legacy (aucun email, aucun case, aucun puzzle lié)

### Vérifications post-migration
- ✅ Cohérence email_count : **0 écart**
- ✅ 16 orphelins supprimés (migration dédiée)
- ✅ Test 3 (DB) : thread root-based BR6049 vérifié (email_count=5, dates cohérentes)
- ✅ Test 6 (Santé globale) : 0 mismatch, 0 orphelins

## Aucun composant FROZEN modifié

---

# Phase C1 — Convergence Emails → Case/Puzzle ✅

## Objectif
"Traiter cette cotation" utilise désormais le même pipeline case/puzzle que la page Quotation,
au lieu de `generate-response` direct.

## Architecture

```
AVANT:
EmailSearchImport → processQuotationRequest → import-thread → generate-response → modal draft

APRÈS:
EmailSearchImport → processQuotationRequest → import-thread → ensure-quote-case → build-case-puzzle → /case/<caseId>
                                                                 (fallback: generate-response si caseId absent)
```

## Fichiers modifiés

### `src/services/emailService.ts`
- Feature flag centralisé : `USE_CASE_PIPELINE_FOR_EMAIL_QUOTATION = true`
- Après import batching : vérification thread_ref cohérence (exactement 1 distinct, sinon fallback)
- Appel `ensure-quote-case({ thread_id: threadRefId })` — thread_id = email_threads.id (UUID DB)
- Appel `build-case-puzzle({ case_id })` — synchrone, avec gestion status processing/failed
- Retour enrichi : `caseId`, `pipelineUsed`, `puzzleStatus`, `warning`
- Fallback `_legacyGenerateResponse()` uniquement si caseId absent (amendement CTO #2)
- Type `QuotationProcessResult` enrichi avec champs convergence

### `src/components/EmailSearchImport.tsx`
- Import `useNavigate` de react-router-dom
- Si `result.caseId` présent : navigation vers `/case/<caseId>` + toast
- Si pas de caseId (fallback) : ouverture modal legacy comme avant

## Amendements CTO appliqués
1. ✅ Contrat ensure-quote-case vérifié : `thread_id` = `email_threads.id` = `emails.thread_ref`
2. ✅ Fallback generate-response seulement si caseId absent
3. ✅ Support build-case-puzzle en mode processing (pas forcément sync-ready)
4. ✅ Contrôle de cohérence thread_ref distincts après import
5. ✅ Feature flag centralisé (constante exportée, rollback sans toucher la logique)

## Tests manuels à effectuer
1. Depuis Admin > Emails > Import sélectif, traiter un fil → vérifier navigation vers `/case/<caseId>`
2. Vérifier que le dossier CaseView contient les emails du fil traité
3. Relancer "Traiter cette cotation" sur le même fil → vérifier idempotence
4. Mettre `USE_CASE_PIPELINE_FOR_EMAIL_QUOTATION = false` → vérifier chemin legacy
