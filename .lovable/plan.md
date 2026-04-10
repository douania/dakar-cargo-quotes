

# P1-B — Clôture partenaire backendisée

## Problème
`closeRequest` dans `useExternalRequests.ts` faisait un `update` front direct + timeline best-effort silencieuse.
Seul flux de mutation EQ1 non backendisé.

## Correctif appliqué
- Nouvelle edge function `close-external-quote-request` (requireUser, verify_jwt=false)
- Préconditions backend : request existe + case_id match, idempotent si closed, 409 si proposed facts restants
- Pas de whitelist de statuts — tout statut non-closed est clôturable
- Timeline NON-SILENT : si l'insert timeline échoue, la fonction retourne 500 (pas de best-effort silencieux)
- Hook `useExternalRequests.ts` : closeRequest remplacé par `supabase.functions.invoke`
- Invalidations existantes réutilisées via `invalidateAll()`

## Blast radius
- 1 edge function créée : `supabase/functions/close-external-quote-request/index.ts`
- 1 ligne ajoutée : `supabase/config.toml`
- ~40 lignes modifiées : `src/hooks/useExternalRequests.ts`
- Docs : `MASTER_CONTEXT.md`, `SECURITY_CONTRACT.md`
- Aucune migration DB
- P0-A/P0-B/P0-C/P1-A non impactés
