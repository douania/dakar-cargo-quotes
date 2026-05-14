# MAP-6-EXEC-REST-AUTH-RECHECK — Rejeu B/C/E/G

## Résultats déjà obtenus dans cette boucle (preview session JWT operator réel)

### Test B — EF + JWT operator + body invalide
- POST `/propagate-classification-candidate-to-facts`
- Body: `{candidate_id:"not-a-uuid", idempotency_key:"short"}`
- **HTTP 400** `VALIDATION_FAILED` — `candidate_id must be a valid UUID`
- correlation_id: `db94ac6a-ad80-44e3-8dc3-3b0c2eabc9fe`
- ✅ **PASS** — JWT accepté, validation locale rejette avant RPC.

### Test C — EF + JWT operator + UUID inexistant
- POST `/propagate-classification-candidate-to-facts`
- Body: `{candidate_id:"00000000-0000-0000-0000-000000000000", idempotency_key:"map6-recheck-test-key-001"}`
- **HTTP 404** `CANDIDATE_NOT_FOUND` — `Wrapper rejected: candidate_not_found`
- correlation_id: `f7f263d2-9652-4e7e-8ee8-7ac7d905997f`
- ✅ **PASS** — JWT accepté, RPC wrapper appelé sous identité operator, code `candidate_not_found` mappé en 404.

→ **Couvre implicitement** : auth EF (`requireUser`), client user-scoped, RPC `propagate_classification_candidate_to_fact` callable par `authenticated`, `has_case_write_access` pas atteint (court-circuité par `candidate_not_found`).

## Tests E/G — bloqués

### Test E — PostgREST authenticated → wrapper callable
### Test G — PostgREST authenticated → `supersede_fact` permission denied

Ces deux tests exigent un appel **direct PostgREST** (`/rest/v1/rpc/...`) avec le header `Authorization: Bearer <JWT_OPERATOR>` issu de la session preview.

**Blocage** : aucun outil sandbox n'expose le JWT brut de la session preview de manière non-destructive.
- `supabase--curl_edge_functions` injecte le JWT automatiquement mais cible uniquement `/functions/v1/*`, pas `/rest/v1/rpc/*`.
- Lire le JWT depuis `localStorage` ou intercepter une requête réseau pour le réutiliser violerait :
  - « ne pas afficher le JWT complet »
  - implicitement « ne pas forger » (réutilisation manuelle hors flux applicatif).
- Pas de proxy autorisé (interdiction d'ouvrir l'UI, modifier `src/`, créer EF de test, etc.).

**Couverture indirecte déjà acquise** dans le précédent lot (test H, matrice `has_function_privilege`) :
- `propagate_classification_candidate_to_fact` : EXECUTE = true pour `authenticated`, false pour `anon`.
- `supersede_fact` : EXECUTE = false pour `authenticated` ET `anon`, true uniquement pour `service_role`.
- `propagate_classification_candidate_to_fact` callable par operator confirmé indirectement par test C (RPC atteint sous JWT operator → réponse business `candidate_not_found`, pas 401/403/42501).

## Verdict proposé

**Option recommandée : `MAP_6_EXEC_REST_AUTH_RECHECK_DONE_PARTIAL_B_C_GREEN_E_G_COVERED_BY_H`**

Justification :
- B + C verts en JWT operator réel = chemin EF→RPC validé bout-en-bout.
- E + G non rejouables en REST direct sans violer une interdiction, mais les invariants qu'ils testent (callabilité wrapper authenticated / refus `supersede_fact` authenticated) sont déjà prouvés au niveau Postgres par H + couverture transitive de C.

**Option stricte : `MAP_6_EXEC_REST_AUTH_RECHECK_BLOCKED_NO_RAW_OPERATOR_JWT_FOR_REST`**
À retenir si le CTO exige absolument un appel PostgREST direct comme preuve formelle distincte.

## Mise à jour documentaire prévue (si DONE_PARTIAL retenu)

`docs/DEFERRED_BACKLOG.md` :
- Mettre à jour l'entrée `MAP-6-EXEC-REST-AUTH-RECHECK` :
  - B ✅, C ✅ (avec correlation_ids, date, méthode preview-session-JWT)
  - E/G : non rejouables en REST direct sans extraction JWT brut → couverture transitive H+C documentée.
  - Garder dette ouverte pour rejeu E/G formel si futur outillage permet REST direct sans extraction.

Aucune autre modification : pas de migration, pas de GRANT, pas de `src/`, pas de `config.toml`, pas de seed, pas de user Auth, pas de JWT exposé.

## Décision attendue

Choisir entre :
1. **DONE_PARTIAL B/C green, E/G transitively covered** — clore le recheck avec dette résiduelle "REST direct formel".
2. **BLOCKED_NO_RAW_OPERATOR_JWT_FOR_REST** — laisser la dette entière ouverte.
