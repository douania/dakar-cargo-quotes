
# Audit CTO P0/P1 — Module Gestion Emails — APPLIQUÉ ✅

## Patches appliqués

### P0-A ✅ — processQuotationRequest batching complet
- **Fichier**: `src/services/emailService.ts`
- Boucle `importThread()` jusqu'à `hasMore=false`
- Garde anti-boucle infinie (max 20 itérations)
- Contrôle de progrès (si remainingUids ne diminue pas → throw)
- Agrégation de tous les emails importés avant `generate-response`

### P1-B ✅ — Recalcul metadata thread sur fil complet
- **Fichier**: `supabase/functions/import-thread/index.ts`
- Après linking, recharge tous les emails `thread_ref = threadId`
- Recalcule: email_count, first/last dates (dates non-nulles), participants (from+to+cc)
- Préserve root_message_id et is_quotation_thread

### P1-C ✅ — Index unique partiel root_message_id
- **Migration SQL**: `CREATE UNIQUE INDEX ... WHERE root_message_id IS NOT NULL`
- Ancien index non-unique conservé temporairement
- Gestion conflit 23505 dans import-thread, sync-emails, email-admin

### P1-D ✅ — Harmonisation sync-emails et email-admin
- **sync-emails**: `findExistingThread` lookup par root_message_id en priorité + barrière anti-fusion cross-root
- **sync-emails**: `upsertEmailThread` passe et stocke rootMessageId
- **email-admin/merge_threads**: skip groupes multi-root + lookup root prioritaire + barrière
- **email-admin/create_threads_from_emails**: select thread_id/message_id + dérive root + barrière

## Aucun composant FROZEN modifié
