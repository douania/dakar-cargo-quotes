# Plan courant

## Lot 0 sécurisé — runtime accepté partiellement (3/4)

### Lot 0-A : runtime appliqué ✅
- `supabase/config.toml` : 3 entrées ajoutées (`backfill-case-documents`, `healthz`, `upsert-exchange-rate`)
- `src/pages/CaseView.tsx` : `QUOTED_VERSIONED` ajouté au guard principal auto-pricing
- `supabase/functions/generate-response/index.ts` : `created_by: userId` ajouté à l'insert `email_drafts`

### SEC-001 : Git hygiene manuelle ouverte ❌ (hors Lovable)
- `.gitignore` ne contient toujours pas `.env`
- Correction impossible côté Lovable (fichier read-only)
- Inscrit dans `docs/DEFERRED_BACKLOG.md` sous **SEC-001**
- Action requise hors Lovable : édition GitHub directe ou commit local

**Conditions de clôture SEC-001** :
1. `.gitignore` contient `.env`, `.env.local`, `.env.*.local`
2. `git ls-files .env` retourne vide
3. Si `.env` a été poussé : rotation des clés effectuée

---

## Statut Lot 0
**Non clôturé** : runtime 3/4 validé, sécurité Git ouverte (SEC-001).

## Garde-fous
- Aucune autre action runtime à exécuter
- Ne pas ouvrir **Lot 1 — TO_CONFIRM export 0 XOF** tant que SEC-001 n'est pas traité ou explicitement accepté comme risque temporaire
- Ne pas créer de "Lot 0-B" Lovable : la correction est manuelle hors plateforme
