

## Plan Phase 14 FINAL — Observabilité & Résilience Edge Functions

### ✅ IMPLÉMENTÉ (AUDIT CTO PASSÉ)

| Composant | Statut | Audit CTO |
|-----------|--------|-----------|
| Patch CORS (`_shared/cors.ts`) | ✅ Déployé | ✅ x-correlation-id ajouté |
| Helper `_shared/runtime.ts` | ✅ Corrigé | ✅ A1-A4 validés |
| Table `runtime_events` (append-only) | ✅ Migrée | ✅ Triggers actifs |
| Table `rate_limit_buckets` | ✅ Migrée | ✅ UPSERT atomique |
| RPC `upsert_rate_limit_bucket` | ✅ Sécurisée | ✅ REVOKE PUBLIC + GRANT service_role |
| Triggers append-only | ✅ Actifs | ✅ search_path=public |
| healthz endpoint | ✅ Déployé | ✅ Testé |
| Patch commit-decision | ✅ CORRIGÉ | ✅ B1-B5 validés (100% runtime contract) |
| Patch generate-response | 🔜 Prêt | En attente GO CTO |
| Patch generate-case-outputs | 🔜 Prêt | En attente GO CTO |
| Patch generate-quotation | 🔜 Prêt | En attente GO CTO |
| Patch generate-quotation-pdf | 🔜 Prêt | En attente GO CTO |
| UI useDecisionSupport (retry 3x) | ✅ Patché | ✅ Idempotent safe |
| UI emailService (correlation) | ✅ Patché | ✅ MAX_RETRIES=1 |
| UI QuotationPdfExport (retry 1x) | ✅ Patché | ✅ MAX_RETRIES=1 |

### Corrections CTO intégrées (AUDIT 2)

| Point | Problème | Correction |
|-------|----------|------------|
| **#1 RLS runtime_events** | Policy `TO service_role` inutile | `REVOKE ALL` + accès service role uniquement |
| **#2 admin_select** | `auth.users.raw_user_meta_data` dangereux | Supprimé - lecture via service role uniquement |
| **#3 UI Retry** | Retry sans garantie idempotence | `commit-decision` retry OK, autres `MAX_RETRIES=1` |
| **#4 CORS** | `x-correlation-id` absent | Ajout dans `_shared/cors.ts` |
| **#5 meta bornage** | Risque PII/payload énorme | Limite 1KB + TextEncoder (bytes réels) |
| **#6 Append-only** | Convention, pas contrainte DB | Triggers BEFORE UPDATE/DELETE + search_path |
| **#7 Rate limit race** | SELECT puis INSERT = race condition | UPSERT atomique RPC |
| **A1** | respondOk sans générique | `respondOk<T>(data: T, ...)` |
| **A2** | Record sans type | `JsonObject = Record<string, unknown>` |
| **A3** | meta non borné dans respondError | `truncateMeta(meta)` appliqué |
| **A4** | truncateMeta mesure caractères | `TextEncoder.encode().length` (bytes) |
| **B1** | Retours hétérogènes | Tous convertis respondOk/respondError |
| **B2** | Pas de runtime_events sur early returns | logRuntimeEvent avant chaque return |
| **B3** | Imports inutilisés | Retirés (structuredLog, getStatusFromErrorCode) |
| **B4** | Variable `type` undefined | Corrigé en `decision_type` |
| **B5** | Double déclaration userId | Corrigé (assignation unique) |
| **RPC Security** | EXECUTE accessible PUBLIC | REVOKE PUBLIC + GRANT service_role |

---

### Rollback

| Composant | Action |
|-----------|--------|
| Triggers append-only | `DROP TRIGGER` |
| Tables | `REVOKE INSERT` (données conservées) |
| Rate limit | Désactiver check dans helper |
| UI retry | Revenir sans retry |
