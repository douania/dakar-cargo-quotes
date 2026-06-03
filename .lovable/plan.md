# EDGE-AUTH-MATRIX-1 — Runtime Observation Plan (v2, corrigé CTO)

Mode : PLAN / observation-only. Aucun patch, commit, migration, modification Supabase/UI/Edge Function. Stop sur tout risque de mutation.

## 0. Cadre & corrections CTO intégrées

- `supabase/config.toml` (branche work) est **partiel** : il déclare `verify_jwt = false` pour `chat`, `run-pricing`, `data-query`, `healthz`, `upsert-exchange-rate`, `create-pad-v5-classification-candidate`.
- Les 5 fonctions suivantes ne sont **pas confirmées** présentes dans `config.toml` côté GitHub `work` :
  - `get-commodity-classification-candidates`
  - `get-pad-nst-suggestions`
  - `propagate-classification-candidate-to-facts`
  - `recommend-pad-category`
  - `update-commodity-classification-candidate`
  → pour celles-ci, **aucune conclusion ne sera tirée de config.toml**.
- Le flag `verify_jwt` effectif côté gateway Supabase **n'est pas inspectable directement** depuis Lovable. Verdict obtenu uniquement par **probe runtime sans Authorization** (GET/POST réel, jamais OPTIONS).
- **OPTIONS** ne sera utilisé que pour noter la conformité CORS, **jamais** pour conclure sur `verify_jwt`.

## 1. Probe runtime no-auth (verify_jwt effectif)

Outil : `supabase--curl_edge_functions` avec `headers: { Authorization: "" }` pour neutraliser l'injection auto du token de session preview.

Méthode : `POST` (ou `GET` pour healthz), body vide ou JSON minimal **non mutant** (`{}` ou `{"__probe":true}`), aucun ID réel, aucun champ valide d'écriture.

Interprétation :
- Réponse `401` avec corps Supabase gateway typique (`{"code":401,"message":"Missing authorization header"}` ou `"msg":"missing sub claim"`) → `verify_jwt = true` effectif (gateway).
- Réponse `401` avec corps **applicatif** issu de `requireUser` (ex : `{"error":"Missing authorization header"}` ou `{"error":"unauthorized","reason":"missing_authorization"}`) → `verify_jwt = false` effectif, garde-fou JWT en code.
- Réponse `200/400/405/422` → `verify_jwt = false` effectif, et la fonction a atteint sa logique sans JWT (cas attendu uniquement pour `healthz`).
- Réponse ambiguë → verdict `NOT_VERIFIABLE` ou `INFERRED_FROM_PROBE` avec note explicite.

Cibles (11) :
chat, run-pricing, data-query, healthz, upsert-exchange-rate, create-pad-v5-classification-candidate, get-commodity-classification-candidates, get-pad-nst-suggestions, propagate-classification-candidate-to-facts, recommend-pad-category, update-commodity-classification-candidate.

Note séparée CORS : un OPTIONS sera fait **seulement** pour healthz et upsert-exchange-rate à titre informatif, jamais reporté dans la colonne verdict verify_jwt.

## 2. healthz — endpoint public attendu

`GET /healthz`, `Authorization: ""`. Relever status + corps exact. Attendu : `200 { ok, db, ts, latency_ms }`, aucune donnée métier. Confirmer absence de fuite.

## 3. upsert-exchange-rate — sondes non mutantes uniquement

Deux probes, aucune ligne `exchange_rates` créée :

- (a) `POST` `Authorization: ""`, body `{}` → attendu 401 (gate `requireUser`).
- (b) `POST` authentifié via session preview (utilisateur non-admin par défaut), body **invalide** `{"currency_code":""}` ou `{"rate_to_xof":-1}` → attendu 400 **avant** tout `insert`. Objectif : démontrer que la couche métier est atteinte par un utilisateur ordinaire (audit statique : pas de check admin) sans créer de ligne.

Stop si la réponse est 200/201, signe de mutation. Aucun payload valide ne sera envoyé.

## 4. run-pricing — probe sans mutation

Risque mutation élevé (`pricing_runs`, `quote_cases.status`). Deux probes :

- (a) `POST` `Authorization: ""`, body `{}` → attendu 401.
- (b) `POST` authentifié preview, body `{"case_id":"00000000-0000-0000-0000-000000000000"}` (UUID inexistant) → attendu échec précoce 404/403/400. Observe si la lecture du case se fait via service_role (réponse `not_found` propre) ou via client utilisateur (réponse RLS `forbidden`).

Stop immédiat si toute réponse suggère qu'une étape d'écriture a été atteinte (200, `pricing_run_id`, `status` modifié, etc.). Aucun `case_id` réel utilisé. Si la sonde ne peut pas être faite sans risque → verdict `NOT_EXECUTED_MUTATION_RISK`.

## 5. Autres fonctions sensibles — probes minimalistes

Pour `chat`, `data-query`, `create-pad-v5-classification-candidate`, `get-commodity-classification-candidates`, `get-pad-nst-suggestions`, `propagate-classification-candidate-to-facts`, `recommend-pad-category`, `update-commodity-classification-candidate` :

- Une seule sonde : `POST` `Authorization: ""`, body `{}` (ou JSON malformé pour celles qui exigent un body).
- Objectif unique : observer la gate auth. Pas de second appel authentifié, pas d'ID réel, pas de payload valide.

## 6. Synthèse — format de rapport

Tableau unique :

| Fonction | Présente config.toml work ? | Méthode probe | Auth | HTTP | Corps utile (tronqué, secrets masqués) | Origine erreur (gateway / applicatif / N/A) | Mutation observée | verify_jwt effectif | Verdict |
|---|---|---|---|---|---|---|---|---|---|

Verdicts possibles : `CONFIRMED`, `CONTRADICTED`, `NOT_VERIFIABLE`, `INFERRED_FROM_PROBE`, `NOT_EXECUTED_MUTATION_RISK`.

Bloc séparé : note CORS pour healthz / upsert-exchange-rate (OPTIONS), **non utilisé** pour le verdict verify_jwt.

Bloc séparé : divergences vs audit statique EDGE-AUTH-MATRIX-1 (PARTIAL).

## 7. Garde-fous d'exécution

- Aucun payload valide capable d'écrire ; aucun ID métier réel ; aucun cleanup nécessaire.
- Stop immédiat sur 200 inattendu, sur tout indice d'écriture, sur 5xx répété.
- Aucune recommandation de refactor, aucun patch, aucun commit, aucune doc GitHub.
- Tokens et secrets masqués (`Authorization`, `apikey`, `service_role`, identifiants utilisateur si non publics).
