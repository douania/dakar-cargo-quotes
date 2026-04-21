# Plan courant

## Lot 0 sécurisé — clôturé sur périmètre Lovable ✅

### Lot 0-A : runtime appliqué ✅
- `supabase/config.toml` : 3 entrées ajoutées (`backfill-case-documents`, `healthz`, `upsert-exchange-rate`)
- `src/pages/CaseView.tsx` : `QUOTED_VERSIONED` ajouté au guard principal auto-pricing
- `supabase/functions/generate-response/index.ts` : `created_by: userId` ajouté à l'insert `email_drafts`

### SEC-001 : Git hygiene — `closed_pending_rotation_review` ✅ (snapshot courant)
- `.gitignore` contient désormais `.env`, `.env.local`, `.env.*.local` (corrigé hors Lovable)
- `.env` n'est plus présent dans le snapshot ZIP/repo courant
- Statut : `closed_pending_rotation_review` côté snapshot Lovable

**Reste hors Lovable (condition de clôture définitive)** :
1. Audit historique Git : `git log --all --full-history -- .env`
2. Si une clé sensible a été exposée par un commit antérieur (service_role Supabase, secrets API tiers, SMTP) → rotation immédiate obligatoire
3. Si seul anon key + URL publique exposés → risque faible, rotation optionnelle
4. Documenter le résultat de l'audit pour passer à `closed`

---

## Statut Lot 0
**Clôturé sur périmètre Lovable** : runtime 4/4 validé, SEC-001 en `closed_pending_rotation_review` (audit historique + rotation conditionnelle restent à faire hors plateforme).

## Garde-fous
- Ne pas modifier `.gitignore` ni `.env` côté Lovable (gérés hors plateforme)
- Aucune autre action runtime à exécuter dans ce lot
- **Lot 1 — TO_CONFIRM export 0 XOF** : 🔓 rouvrable sur validation opérateur explicite
- Ne pas créer de "Lot 0-B" Lovable : la finalisation SEC-001 est manuelle hors plateforme
