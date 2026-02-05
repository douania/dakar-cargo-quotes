

## Plan Phase 14 FINAL — Observabilité & Résilience Edge Functions

### ✅ IMPLÉMENTÉ

| Composant | Statut |
|-----------|--------|
| Patch CORS (`_shared/cors.ts`) | ✅ Déployé |
| Helper `_shared/runtime.ts` | ✅ Créé |
| Table `runtime_events` (append-only) | ✅ Migrée |
| Table `rate_limit_buckets` | ✅ Migrée |
| RPC `upsert_rate_limit_bucket` | ✅ Créée |
| Triggers append-only | ✅ Actifs |
| healthz endpoint | ✅ Déployé et testé |
| Patch commit-decision | ✅ Déployé |
| Patch generate-response | ✅ Déployé |
| Patch generate-case-outputs | ✅ Déployé |
| Patch generate-quotation | ✅ Déployé |
| Patch generate-quotation-pdf | ✅ Déployé |
| UI useDecisionSupport (retry 3x) | ✅ Patché |
| UI emailService (correlation) | ✅ Patché |
| UI QuotationPdfExport (retry 1x) | ✅ Patché |

### Corrections CTO intégrées (toutes)

| Point | Problème | Correction |
|-------|----------|------------|
| **#1 RLS runtime_events** | Policy `TO service_role` inutile | `REVOKE ALL` + accès service role uniquement |
| **#2 admin_select** | `auth.users.raw_user_meta_data` dangereux | Supprimé - lecture via service role uniquement |
| **#3 UI Retry** | Retry sans garantie idempotence | `commit-decision` retry OK, autres `MAX_RETRIES=1` |
| **#4 CORS** | `x-correlation-id` absent | Ajout dans `_shared/cors.ts` |
| **#5 meta bornage** | Risque PII/payload énorme | Limite 1KB dans helper |
| **#6 Append-only** | Convention, pas contrainte DB | Triggers BEFORE UPDATE/DELETE |
| **#7 Rate limit race** | SELECT puis INSERT = race condition | UPSERT atomique avec RETURNING |

---

### Rollback

| Composant | Action |
|-----------|--------|
| Triggers append-only | `DROP TRIGGER` |
| Tables | `REVOKE INSERT` (données conservées) |
| Rate limit | Désactiver check dans helper |
| UI retry | Revenir sans retry |
