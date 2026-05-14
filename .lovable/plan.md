# MAP-6-SECURITY-GRANTS-FIX — Patch ciblé GRANT/REVOKE (DB-only)

Statut : `MAP_6_EXEC_BLOCKED_SECURITY_GRANT_ACCEPTED`. Lot séparé strict. Aucun T1-T14, aucun seed, aucun passage à `MAP-6-EXEC-EF` avant succès de ce lot.

## 1. Périmètre strict

Inclus :
- Une migration unique DB-only avec 3 instructions GRANT/REVOKE.
- Validation post-migration via `has_function_privilege` (psql).
- Validation PostgREST réelle anon + JWT authenticated réel sur `/rpc/supersede_fact` et `/rpc/propagate_classification_candidate_to_fact`.
- Vérification non-régression structurelle des 3 Edge Functions appelantes (revue de code seulement, pas d'invocation).

Exclus (interdits) :
- Aucune modification de `supersede_fact` ou du wrapper.
- Aucun changement dans `src/`.
- Aucune Edge Function modifiée.
- Aucun `supabase/config.toml`.
- Aucun `run-pricing`.
- Aucun seed, aucun T1-T14, aucun user Auth de test.
- Aucune action sur `service_role`.

## 2. Pré-vérification appelants (déjà faite, lecture seule)

Recherche `supersede_fact` dans `supabase/functions/` :

| Edge Function | Client utilisé pour `rpc('supersede_fact', ...)` | Impact REVOKE authenticated/anon |
|---|---|---|
| `build-case-puzzle/index.ts` | `serviceClient` (`SUPABASE_SERVICE_ROLE_KEY`) | aucun |
| `set-case-fact/index.ts` | `svc` (`SUPABASE_SERVICE_ROLE_KEY`) | aucun |
| `validate-partner-fact/index.ts` | `serviceClient` (`SUPABASE_SERVICE_ROLE_KEY`) | aucun |

Aucun appelant `authenticated` ou `anon` direct côté front (`src/`) — `supersede_fact` n'apparaît qu'en `types.ts` généré. Donc le REVOKE est sûr structurellement.

## 3. Migration cible (à appliquer après GO)

```sql
-- Révoquer EXECUTE sur supersede_fact pour tout sauf service_role + postgres
REVOKE EXECUTE ON FUNCTION public.supersede_fact(
  uuid, text, text, text, numeric, jsonb, timestamptz, text, uuid, uuid, text, numeric
) FROM PUBLIC, anon, authenticated;

-- Verrouiller wrapper : pas d'anon, authenticated seulement
REVOKE EXECUTE ON FUNCTION public.propagate_classification_candidate_to_fact(
  uuid, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.propagate_classification_candidate_to_fact(
  uuid, text
) TO authenticated;
```

Aucune autre instruction. Aucun trigger, aucun seed, aucun ALTER FUNCTION.

## 4. Validation post-migration — niveau privilèges

```sql
SELECT
  has_function_privilege('authenticated',
    'public.propagate_classification_candidate_to_fact(uuid,text)', 'EXECUTE') AS wrapper_authenticated,
  has_function_privilege('anon',
    'public.propagate_classification_candidate_to_fact(uuid,text)', 'EXECUTE') AS wrapper_anon,
  has_function_privilege('service_role',
    'public.propagate_classification_candidate_to_fact(uuid,text)', 'EXECUTE') AS wrapper_service_role,
  has_function_privilege('authenticated',
    'public.supersede_fact(uuid,text,text,text,numeric,jsonb,timestamptz,text,uuid,uuid,text,numeric)', 'EXECUTE') AS supersede_authenticated,
  has_function_privilege('anon',
    'public.supersede_fact(uuid,text,text,text,numeric,jsonb,timestamptz,text,uuid,uuid,text,numeric)', 'EXECUTE') AS supersede_anon,
  has_function_privilege('service_role',
    'public.supersede_fact(uuid,text,text,text,numeric,jsonb,timestamptz,text,uuid,uuid,text,numeric)', 'EXECUTE') AS supersede_service_role;
```

Attendu :
- `wrapper_authenticated = true`
- `wrapper_anon = false`
- `wrapper_service_role = true`
- `supersede_authenticated = false`
- `supersede_anon = false`
- `supersede_service_role = true`

Inspection complémentaire `pg_proc.proacl` pour confirmer absence de `anon=X` et `authenticated=X` sur `supersede_fact`, et pour le wrapper absence de `anon=X`.

## 5. Validation post-migration — PostgREST réel

Quatre appels `curl` directs sur l'URL Supabase REST :

| # | Cible | En-têtes | Attendu |
|---|---|---|---|
| P1 | `POST /rest/v1/rpc/supersede_fact` | `apikey: <anon>` (pas de Authorization) | refus PostgREST (`401`/`permission denied for function supersede_fact`) |
| P2 | `POST /rest/v1/rpc/supersede_fact` | `Authorization: Bearer <jwt authenticated réel>` | refus PostgREST (`permission denied for function supersede_fact`) |
| P3 | `POST /rest/v1/rpc/propagate_classification_candidate_to_fact` | `apikey: <anon>` | refus PostgREST (`permission denied for function`) |
| P4 | `POST /rest/v1/rpc/propagate_classification_candidate_to_fact` | `Authorization: Bearer <jwt authenticated réel>` (avec `p_candidate_id` aléatoire) | callable (**pas** de refus de droits) — réponse métier `{ ok:false, code:'candidate_not_found' }` ou équivalent |

JWT authenticated obtenu uniquement via :
- création éphémère d'un user Auth réel sandbox ;
- `signInWithPassword` ;
- récupération du JWT de session ;
- suppression du user immédiatement après les 4 appels.

Aucun JWT forgé, aucun `SUPABASE_JWT_SECRET`.

## 6. Critères de succès / blocage

GO `MAP_6_SECURITY_GRANTS_FIX_DONE` si **tous** les 6 booléens §4 et **tous** les 4 résultats §5 sont conformes.

Sinon verdicts possibles :
- `MAP_6_SECURITY_GRANTS_FIX_BLOCKED_PRIVS` : has_function_privilege incorrect.
- `MAP_6_SECURITY_GRANTS_FIX_BLOCKED_POSTGREST` : un appel REST refusé alors qu'il devrait passer (P4) ou autorisé alors qu'il devrait refuser (P1/P2/P3).
- `MAP_6_SECURITY_GRANTS_FIX_BLOCKED_AUTH_TEST` : impossibilité de créer/signer le user éphémère.

En cas de blocage, **aucun rollback automatique de la migration** (les REVOKE/GRANT sont déjà l'état cible) — escalade CTO pour décision.

## 7. Séquence d'exécution après GO CTO

1. Recevoir `GO MAP-6-SECURITY-GRANTS-FIX`.
2. Lancer la migration §3.
3. Exécuter §4 et logger les 6 booléens.
4. Si §4 OK : créer user Auth éphémère, exécuter P1-P4, supprimer user.
5. Rapporter au CTO : diff réel migration + sortie §4 + sortie §5 + verdict.
6. En cas de succès, mettre à jour `docs/DEFERRED_BACKLOG.md` (entrée `MAP-6-SECURITY-GRANTS-FIX` → done) et signaler que `MAP-6-EXEC-MIGRATION` peut reprendre sur T1-T14.

## 8. Garde-fous

STOP immédiat si :
- la migration tente de toucher autre chose que les 3 instructions §3 ;
- une révocation atteint `service_role` ;
- détection d'un appelant `authenticated` direct de `supersede_fact` côté front (re-scan `src/` avant migration) ;
- impossibilité de produire un JWT authenticated réel (pas de fallback JWT forgé).

## 9. Verdict attendu

`MAP_6_SECURITY_GRANTS_FIX_DONE` puis réouverture de `MAP-6-EXEC-MIGRATION` pour T1-T14.

---

**Aucune action lancée.** En attente de `GO MAP-6-SECURITY-GRANTS-FIX` explicite.
