# MAP-6 — Action explicite "Propager au dossier" — Design

> **Statut** : `📋 MAP-6 DESIGN DRAFT — awaiting CTO review`
> **Type de lot** : Document de spécification **only** (design-only)
> **Date** : 2026-05-14
> **Branche** : `work`
> **Verdict cible** : `MAP_6_DESIGN_READY`

---

## 1. Contexte & arbitrage CTO appliqué

MAP-5B est clos et accepté (`MAP_5B_OPERATOR_ACTIONS_DEPLOYED_VALIDATED_ACCEPTED`, V10 inclus). MAP-5B couvre `accept` / `reject` sur `commodity_classification_candidates` **sans aucune propagation downstream**. MAP-6 introduit l'écriture contrôlée d'un fait validé dans `quote_facts` après acceptation opérateur, **via une action explicite séparée**.

Décisions CTO actées :

- **Accept ≠ propagation.** L'action `accept` (MAP-5B) reste strictement isolée à `commodity_classification_candidates`. Aucune écriture `quote_facts` au clic Accept.
- **Propager au dossier = action explicite séparée**, déclenchée par un bouton dédié dans CaseView, disponible uniquement pour un candidat `status='accepted' AND is_current=true`.
- **Acceptation définitive, rollback manuel.** Une fois propagé, le fait devient courant. Un rejet ultérieur du candidat n'a aucun effet sur `quote_facts`. Correction = `set-case-fact` manuel (whitelist existante) ou lot futur dédié.
- **Aucun run-pricing automatique.**
- **Aucune écriture `cargo.*` automatique** hors whitelist explicite.
- **Idempotence stricte** + replay/recovery guard + audit `evidence` + timeline.
- **MAPPING-TAX-CHAIN-0 reste ouvert** au moins jusqu'à MAP-7.

---

## 2. Périmètre strict — interdictions absolues (MAP-6 design)

- ❌ Aucune Edge Function créée ou modifiée.
- ❌ Aucune modification `update-commodity-classification-candidate` (MAP-5B figé).
- ❌ Aucune modification `set-case-fact`, ni de sa whitelist.
- ❌ Aucune migration, aucune DB write, aucun changement RLS / trigger / RPC.
- ❌ Aucune modification `run-pricing`, `quotation-engine`, `recommend-pad-category`, `get-pad-nst-suggestions`, `build-case-puzzle`.
- ❌ Aucune modification `src/`, `supabase/config.toml`.
- ❌ Aucun appel `supabase--curl_edge_functions`, aucun seed, aucun test E2E.
- ❌ Aucune clôture `MAPPING-TAX-CHAIN-0`.
- ❌ Aucune modification `MAP-5B-GLOBAL`.

Diff réel attendu **dans ce lot** : 2 fichiers documentaires uniquement.

| Fichier | Action |
|---|---|
| `docs/tariff-collection/pad/MAP_6_PROPAGATE_TO_FACTS_DESIGN.md` | **Création** (le présent document) |
| `docs/DEFERRED_BACKLOG.md` | **Modification ciblée** (entrée MAP-6-DESIGN + ligne 5 "Dernière mise à jour") |

---

## 3. Spécification fonctionnelle MAP-6-EXEC

### 3.1 Surface d'invocation

- **Nouvelle Edge Function dédiée** : `propagate-classification-candidate-to-facts`.
- **Pattern auth** : identique MAP-4 / MAP-5B — `SUPABASE_ANON_KEY` + header `Authorization` du caller, `supabase.auth.getUser()`. **Aucun `service_role`.**
- `verify_jwt = false` + auth code-side.
- POST only, OPTIONS preflight, autres méthodes → 405.

La séparation des deux Edge Functions garantit qu'un opérateur peut accepter sans propager, et que chaque appel produit un audit distinct.

### 3.2 Body schema (Zod, descriptif)

```ts
{
  candidate_id: uuid,
  case_id: uuid,
  idempotency_key: string (8..128),
  target_fact_key?: enum(WHITELIST §3.4) // optionnel — sinon résolu par §3.4
}
```

### 3.3 Préconditions vérifiées (fail-fast)

| # | Check | Code HTTP |
|---|---|---|
| 1 | Auth présente + valide (`getUser`) | 401 `unauthorized` |
| 2 | Body Zod valide | 400 `invalid_input` |
| 3 | Pré-check write — `rpc('has_case_write_access', { _case_id })` retourne `true` | 403 `forbidden` (`rls_write_denied`) |
| 4 | Candidat existe et appartient au `case_id` (RLS read) | 404 `candidate_not_found` |
| 5 | `candidate.status = 'accepted'` | 409 `state_conflict` (`expected_accepted`) |
| 6 | `candidate.is_current = true` | 409 `state_conflict` (`not_current`) |
| 7 | `candidate_kind` mappable §3.4 | 400 `unmapped_candidate_kind` |

### 3.4 Whitelist `candidate_kind → fact_key` (stricte, MAP-only)

Reprend MAP-3 §5. **Ces clés sont des pivots MAP nouveaux**, pas nécessairement les facts consommés par le runtime `run-pricing` actuel. Aucun effet pricing immédiat garanti — voir §3.12.

| `candidate_kind` | `fact_key` cible | `fact_category` | Notes |
|---|---|---|---|
| `cn8` | `commodity.cn_code` | `cargo` | strict 8 digits |
| `hs6` | `commodity.hs_code` | `cargo` | `value_json.scheme = 'hs6'` |
| `hs10_uemoa` | `commodity.hs_code` | `cargo` | `value_json.scheme = 'hs10_uemoa'` |
| `nhm` | `commodity.nhm_code` | `cargo` | |
| `nst2007` | `commodity.nst_code` | `cargo` | |
| `nstr` | `commodity.nstr_code` | `cargo` | audit/migration |
| `pad_category` | `pricing.pad_category` | `pricing` | pivot MAP — **distinct** de `cargo.pad_category` consommé par `run-pricing` |
| `pad_label` | — | — | **Non propagé** — exige conversion préalable. → 400 `unmapped_candidate_kind` |

> Toute extension de cette whitelist exige un amendement formel et un nouveau lot.

**Note d'isolement runtime (correction CTO #4)** :
- MAP-6 écrit des **pivots MAP** (`commodity.cn_code`, `commodity.hs_code`, `commodity.nhm_code`, `commodity.nst_code`, `commodity.nstr_code`, `pricing.pad_category`).
- Le runtime `run-pricing` actuel consomme historiquement `cargo.pad_category`, `cargo.pad_rate_fcfa_per_ton`, `cargo.hs_code` (whitelist `set-case-fact`).
- **Conséquence** : la propagation MAP-6 d'un `pricing.pad_category` n'aura **aucun effet** sur le `run-pricing` actuel sauf branchement explicite ultérieur (lot MAP-7 / MAP-8).
- Pour `cargo.hs_code`, la collision est explicitement assumée : MAP-6 écrit la **même clé** que `set-case-fact`, donc `run-pricing` la verra. C'est le seul fact_key MAP-6 ayant un effet runtime potentiel immédiat.
- `MAPPING-TAX-CHAIN-0` reste **ouvert** : MAP-6 ne le clôt pas.

**Note d'alignement runtime (correction CTO #2 — `set-case-fact`)** :

Le RPC `supersede_fact` est appelé aujourd'hui :
- `set-case-fact` : `p_source_type = 'manual_input'`
- `validate-partner-fact` : `p_source_type = 'partner_response'`

Aucune valeur `'operator'` n'est attestée dans le runtime existant. **MAP-6-EXEC utilisera `p_source_type = 'manual_input'`** (valeur déjà en production, sémantique cohérente : opérateur en posture de saisie manuelle validée). L'origine MAP-6 est tracée dans `value_json` et `source_excerpt`. Toute bascule vers `'operator'` exige un précheck explicite des contraintes DB sur `quote_facts.source_type` et un GO CTO séparé.

### 3.5 Logique d'écriture — appel du wrapper RPC dédié (post-correction Option C)

> ⚠️ **Correction CTO Option C (cf. `MAP_6_RPC_WRAPPER_DESIGN.md`).** L'Edge Function n'appelle **plus** `supersede_fact` directement, et n'utilise **plus** le service role. Elle appelle un **wrapper RPC dédié** `public.propagate_classification_candidate_to_fact(p_candidate_id, p_idempotency_key)` qui :
> - dérive `case_id` depuis le candidat (jamais paramètre) ;
> - exécute `has_case_write_access` après chargement candidat ;
> - applique la whitelist §3.4 (incluant `hs10_uemoa`) côté DB ;
> - appelle `supersede_fact` en interne, sous SECURITY DEFINER ;
> - écrit `candidate.evidence` et `case_timeline_events` **dans la même transaction** que la supersession ;
> - retourne un payload `jsonb` typé (pas de `RAISE` métier).
>
> **Aucun GRANT EXECUTE n'est posé sur `public.supersede_fact` à `authenticated`** — seul le wrapper est exposé. Voir `MAP_6_RPC_WRAPPER_DESIGN.md` pour la spécification complète du wrapper.

Séquence Edge Function :

1. Validation Zod du body (`candidate_id`, `idempotency_key` ; `case_id` **n'est plus accepté en paramètre**).
2. Appel unique :
   ```ts
   const { data, error } = await supabase.rpc(
     'propagate_classification_candidate_to_fact',
     { p_candidate_id: candidate_id, p_idempotency_key: idempotency_key }
   );
   ```
3. Mapping du retour wrapper → réponse HTTP (cf. §3.11) :
   - `{ ok:true, idempotent:false }` → 200 succès
   - `{ ok:true, idempotent:true, replay_source }` → 200 idempotent
   - `{ ok:false, code:'rls_write_denied' }` → 403
   - `{ ok:false, code:'candidate_not_found' }` → 404
   - `{ ok:false, code:'candidate_not_accepted' | 'candidate_not_current' | 'idempotency_conflict' }` → 409
   - `{ ok:false, code:'candidate_kind_not_whitelisted' | 'pad_label_forbidden' }` → 422
   - `{ ok:false, code:'invalid_input' }` → 400
   - `error` PostgREST `42501` (permission denied) → 500 `internal_error` (ne devrait pas arriver si grants posés correctement)

> Toutes les étapes critiques (supersede_fact + UPDATE candidate.evidence + INSERT case_timeline_events) sont **atomiques dans la transaction RPC du wrapper**. L'EF ne fait **plus** de best-effort hors transaction.

### 3.6 Idempotence stricte + replay/recovery guard (désormais porté par le wrapper RPC)

> ⚠️ **Post-correction Option C.** Les 3 niveaux de protection décrits ci-dessous sont **désormais entièrement implémentés dans le wrapper RPC** `public.propagate_classification_candidate_to_fact` (voir `MAP_6_RPC_WRAPPER_DESIGN.md` §3.4 étapes 8, 9, 10), pas côté Edge Function. L'EF se contente d'appeler le wrapper.

Trois niveaux de protection contre la divergence d'état entre `quote_facts` et `commodity_classification_candidates` :

**Niveau A — wrapper, evidence (clé exigée)** :
Si `candidate.evidence.propagated_fact_id` présent **ET** `candidate.evidence.propagation_idempotency_key === p_idempotency_key` → retour `{ ok:true, idempotent:true, replay_source:'evidence' }` sans appel `supersede_fact`. Si `propagated_fact_id` présent avec une **autre** clé, ce n'est PAS un replay : c'est traité comme une re-propagation explicite (Niveau C).

**Niveau B — wrapper, quote_facts (sans filtre `is_current`)** :
SELECT dans `quote_facts` filtré par `case_id`, `fact_key`, `value_json->>'candidate_id'`, `value_json->>'propagation_idempotency_key'`, **sans filtre `is_current=true`**. Un fact superseded entre-temps doit toujours être détecté pour empêcher tout double-propagation. Si trouvé → réparation `evidence` puis retour `{ ok:true, idempotent:true, replay_source:'quote_facts' }`.

**Niveau B' — wrapper, détection conflit clé idempotence** :
SELECT vérifiant qu'aucun **autre** candidat sur le même `case_id` n'utilise déjà cette `propagation_idempotency_key`. Si trouvé → `{ ok:false, code:'idempotency_conflict' }`.

**Niveau C — DB native (supersede_fact)** :
`supersede_fact` reste nativement idempotent par advisory lock + supersession. Un appel avec une `idempotency_key` **différente** (re-propagation volontaire) produit un nouveau fact courant, l'ancien `is_current=false` — sémantique métier acceptée.

> Le replay guard et la transactionnalité étant désormais portés par le wrapper, les états transitoires `evidence_repair_pending` du modèle d'origine **n'existent plus**. L'EF ne renvoie jamais cet état.

### 3.7 Aucun rollback automatique

- `update-commodity-classification-candidate action=reject` sur un candidat **déjà propagé** : aucun effet sur `quote_facts`. Le fact reste `is_current=true`.
- Correction opérateur :
  - Voie 1 : `set-case-fact` (whitelist actuelle = `cargo.hs_code`, `cargo.pad_category`, `cargo.pad_rate_fcfa_per_ton`). Pour les autres pivots MAP (`commodity.cn_code`, `commodity.nhm_code`, `commodity.nst_code`, `commodity.nstr_code`, `pricing.pad_category`), un lot futur dédié sera nécessaire.
  - Voie 2 : nouvelle propagation MAP-6 avec un autre candidat → supersession native.

### 3.8 Aucun déclencheur run-pricing

L'Edge Function n'invoque **jamais** `run-pricing`, `build-case-puzzle`, ni aucune autre EF. Aucun trigger DB nouveau. Aucun listener.

### 3.9 RLS & sécurité — pré-check `has_case_write_access`

Avant tout appel RPC, l'EF exécute :

```ts
const { data: writable, error } = await supabase
  .rpc('has_case_write_access', { _case_id: case_id });
if (error || !writable) {
  return json({ error: 'forbidden', reason: 'rls_write_denied' }, 403);
}
```

Cela aligne MAP-6 sur le comportement V10 démontré (non-owner → 403 sans modification DB).

### 3.10 Précheck RPC permission obligatoire (correction CTO #3)

**Décision CTO : Option C retenue — wrapper RPC dédié.** Voir document complet `MAP_6_RPC_WRAPPER_DESIGN.md`.

Le précheck RP3 a été exécuté et conclu **NEGATIF** : `authenticated` n'a pas `EXECUTE` sur `public.supersede_fact`. Plutôt que de poser ce GRANT direct (Option A), qui exposerait à `authenticated` une RPC `SECURITY DEFINER` générique sans `has_case_write_access` ni whitelist `fact_key` ni contrôle `source_type` (faille d'écriture sur `quote_facts`), MAP-6 introduit un **wrapper RPC dédié** :

- `public.propagate_classification_candidate_to_fact(p_candidate_id uuid, p_idempotency_key text) RETURNS jsonb`
- `SECURITY DEFINER`, borné métier (RLS check, whitelist §3.4, source_type forcé à `manual_input`).
- **Seul le wrapper est `GRANT EXECUTE` à `authenticated`.**
- **`public.supersede_fact` reste non-grantée à `authenticated`.**
- Le wrapper appelle `supersede_fact` en interne, dans la **même transaction** que l'UPDATE `candidate.evidence` et l'INSERT `case_timeline_events` — atomicité native, plus de best-effort hors transaction.

Préchecks toujours obligatoires en lot **MAP-6-EXEC-MIGRATION** (avant le déploiement EF) :

| # | Précheck | Méthode | Attendu |
|---|---|---|---|
| RP1 | Signature `public.supersede_fact` | `pg_proc` | Inchangée vs `MASTER_CONTEXT.md` |
| RP2 | `prosecdef = true` | `pg_proc` | `true` |
| RP3' | Wrapper créé + `GRANT EXECUTE` ciblé wrapper uniquement | `routine_privileges` | Wrapper apparaît, `supersede_fact` reste **vide** pour `authenticated` |
| RP4 | Test live wrapper sous JWT owner | RPC direct + EF | `{ ok:true, idempotent:false }` |
| RP5 | Test live wrapper sous JWT non-owner | RPC direct + EF | `{ ok:false, code:'rls_write_denied' }`, aucune écriture DB |
| RP6 | Test négatif `supersede_fact` non-grantée | `has_function_privilege('authenticated', 'public.supersede_fact(...)', 'EXECUTE')` | `false` |

> Aucune Option A (GRANT direct) ni Option B (service_role) n'est exécutée. Option C est la seule voie autorisée.

### 3.11 Réponses HTTP normalisées (post-Option C)

L'EF mappe le retour `jsonb` du wrapper :

| Status | Body | Cas |
|---|---|---|
| 200 | `{ ok: true, idempotent: false, fact_id, fact_key, candidate_id }` | Propagation effective |
| 200 | `{ ok: true, idempotent: true, fact_id, fact_key, candidate_id, replay_source: 'evidence' \| 'quote_facts' }` | Replay |
| 400 | `{ error: 'invalid_input', details }` | Body Zod invalide ou wrapper `code:'invalid_input'` |
| 401 | `{ error: 'unauthorized', reason }` | Auth manquante / invalide (code-side EF, RPC jamais atteinte) |
| 403 | `{ error: 'forbidden', reason: 'rls_write_denied' }` | Wrapper `code:'rls_write_denied'` |
| 404 | `{ error: 'candidate_not_found' }` | Wrapper `code:'candidate_not_found'` |
| 409 | `{ error: 'state_conflict', reason: 'candidate_not_accepted' \| 'candidate_not_current' \| 'idempotency_conflict', details }` | Wrapper `code` correspondant |
| 422 | `{ error: 'unmapped_candidate_kind' \| 'pad_label_forbidden', candidate_kind }` | Wrapper `code:'candidate_kind_not_whitelisted'` ou `'pad_label_forbidden'` |
| 405 | `{ error: 'method_not_allowed' }` | Hors POST/OPTIONS |
| 500 | `{ error: 'internal_error' }` | Échec inattendu (panne RPC, contrainte DB inattendue, `42501` permission denied imprévue) |

> L'état `evidence_repair_pending` du modèle d'origine **disparaît** : la transaction wrapper rend l'écriture `evidence` atomique avec la supersession.

### 3.12 Effet pricing — clarification explicite

| `fact_key` propagé | Effet runtime `run-pricing` immédiat |
|---|---|
| `commodity.cn_code` | **Aucun** (pas consommé par le runtime actuel) |
| `commodity.hs_code` | **Potentiel** — `run-pricing` lit `cargo.hs_code`. Comme MAP-6 écrit `commodity.hs_code` et **non** `cargo.hs_code`, l'effet est nul. Si une future itération veut un effet, MAP-6 devrait dual-écrire ou un lot dédié devrait brancher `commodity.hs_code` côté runtime. |
| `commodity.nhm_code` / `nst_code` / `nstr_code` | **Aucun** |
| `pricing.pad_category` | **Aucun** — `run-pricing` lit `cargo.pad_category`, distinct |

**Conclusion** : MAP-6 est un pas vers la chaîne MAP cible. **Aucun effet pricing immédiat n'est garanti.** `MAPPING-TAX-CHAIN-0` reste explicitement **ouvert**.

### 3.13 UI (spec only, pas implémentée en MAP-6)

Bouton "Propager au dossier" dans `CommodityClassificationCandidatesPanel` à côté de chaque candidat `accepted, is_current=true`. Conditions d'affichage :
- `candidate.status === 'accepted' && candidate.is_current === true`
- Pas déjà propagé pour cet `idempotency_key` (vérifié via `evidence.propagated_fact_id`).

États : Idle → Confirm dialog (warn : "Aucun rollback automatique") → Loading → Success/Error toast.

Implémentation = lot **MAP-6-EXEC-UI**, séparé.

---

## 4. Tests prescriptifs (pour MAP-6-EXEC, **aucun PASS déclaré ici**)

| # | Scénario | Attendu |
|---|---|---|
| T1 | Owner propage candidat `accepted, is_current=true` | 200, fact créé, `value_json.candidate_id` + `value_json.propagation_idempotency_key` présents, `evidence.propagated_fact_id` rempli |
| T2 | Replay même `idempotency_key` (Niveau A) | 200 idempotent, count `quote_facts` inchangé |
| T3 | Replay même `idempotency_key` après simulation crash UPDATE candidate (Niveau B) | 200 idempotent `recovered:true`, fact retrouvé via `value_json`, evidence réparée |
| T4 | Replay nouveau `idempotency_key` (re-propagation) | 200 non-idempotent, nouveau fact courant, ancien `is_current=false` |
| T5 | Candidat `status='suggested'` | 409 `state_conflict` (`expected_accepted`) |
| T6 | Candidat `status='accepted', is_current=false` | 409 `state_conflict` (`not_current`) |
| T7 | Candidat `candidate_kind='pad_label'` | 422 `pad_label_forbidden` |
| T8 | User authentifié non owner ni assigned | 403 `rls_write_denied` (wrapper §3.4 étape 5, sans modification DB) |
| T9 | User non authentifié (Edge Function) | 401 `unauthorized` (auth code-side EF, RPC jamais atteinte) |
| T10 | Rejet ultérieur du candidat | `quote_facts` inchangé |
| T11 | Aucun `pricing_runs` créé/modifié post-T1 | Confirmé read DB |
| T12 | **Test négatif `supersede_fact` non-grantée** : `has_function_privilege('authenticated', 'public.supersede_fact(...)', 'EXECUTE')` | `false` (correction Option C — supersede_fact reste non exposée) |
| T13 | **Auth/grants matrix** (3 sous-cas) | |
| T13a | Appel via Edge Function MAP-6 sans JWT | **401** côté Edge (auth code-side, RPC jamais atteinte) |
| T13b | Appel direct PostgREST en `anon` (sans JWT user) sur la RPC wrapper | Refus PostgREST par **absence de GRANT EXECUTE pour `anon`** (`permission denied for function`). Pas de retour métier `rls_write_denied`. |
| T13c | Appel `authenticated` non-owner / non-assigned sur la RPC wrapper | `{ ok:false, code:'rls_write_denied' }`, aucune modification DB |
| T14 | Timeline contient `CCC_PROPAGATED_TO_FACTS` avec `dedupe_key` correct dans `case_timeline_events` | Confirmé read DB |
| T15 | `quote_facts.source_type = 'manual_input'` | Confirmé read DB |
| T16 | Aucune écriture sur `cargo.pad_category`, `cargo.pad_rate_fcfa_per_ton` | Confirmé read DB (isolation pivots MAP) |

Seed test obligatoire pour T8 / T13c : user secondaire authentifié non-owner / non-assigned (pattern V10) + rollback seed obligatoire après test + suppression user manuelle.

---

## 5. Critères GO / NO-GO

### GO (`MAP_6_DESIGN_READY` → ouverture MAP-6-EXEC autorisée après revue CTO)

- Whitelist §3.4 acceptée par CTO.
- Choix "appel direct `supersede_fact` sans modifier `set-case-fact` et sans service_role" accepté.
- Doctrine "acceptation définitive, rollback manuel" confirmée.
- Replay/recovery guard §3.6 (Niveau A + B) accepté comme palliatif à l'absence de transaction globale.
- `p_source_type = 'manual_input'` accepté.
- Précheck RPC permission §3.10 accepté comme bloquant pré-EXEC.
- Aucun trigger downstream pricing autorisé.

### NO-GO

| Cause | Verdict |
|---|---|
| Refus whitelist §3.4 | `MAP_6_DESIGN_BLOCKED_WHITELIST` |
| Refus appel direct sans service_role | `MAP_6_DESIGN_BLOCKED_AUTH_MODEL` |
| Demande de transaction globale Edge sans RPC wrapper | `MAP_6_DESIGN_BLOCKED_TRANSACTION_MODEL` |
| Demande rollback automatique sur reject | `MAP_6_DESIGN_BLOCKED_ROLLBACK_DOCTRINE` |
| Demande propagation au sein de `update-commodity-classification-candidate` | `MAP_6_DESIGN_BLOCKED_MAP5B_RECOVERY` |
| Demande auto-trigger pricing | `MAP_6_DESIGN_BLOCKED_PRICING_GUARD` |
| Précheck RP3 (grants `authenticated`) NO-GO découvert avant EXEC | `MAP_6_EXEC_BLOCKED_RPC_PERMISSION` (en MAP-6-EXEC, pas ici) |

---

## 6. Séquence post-MAP-6 (rappel)

1. **MAP-6-EXEC** (lot séparé, GO CTO requis) : prechecks RP1–RP3 → si OK, création EF `propagate-classification-candidate-to-facts` + tests Deno + RP4/RP5 live + seed/rollback. Verdict cible : `MAP_6_EXEC_VALIDATED`.
2. **MAP-6-EXEC-UI** (lot séparé, GO CTO requis) : bouton CaseView + hook + invalidations.
3. **MAP-7** : activation partielle (`OFFICIAL_EXACT_CODE_SINGLE_PAD`).
4. **MAP-8** : extension IA / Web HS, operator-in-the-loop strict.

`MAPPING-TAX-CHAIN-0` reste **ouvert** au moins jusqu'à MAP-7.

---

## 7. Diff attendu (rappel — mis à jour post-Option C)

```text
A docs/tariff-collection/pad/MAP_6_PROPAGATE_TO_FACTS_DESIGN.md  (lot original)
A docs/tariff-collection/pad/MAP_6_RPC_WRAPPER_DESIGN.md         (lot Option C)
M docs/tariff-collection/pad/MAP_6_PROPAGATE_TO_FACTS_DESIGN.md  (patch §3.5/§3.6/§3.10/§3.11/§4)
M docs/DEFERRED_BACKLOG.md
```

**Interdictions renforcées (post-Option C)** :
- Aucun `GRANT EXECUTE` sur `public.supersede_fact` à `authenticated`.
- Aucun `case_id` accepté en paramètre RPC ou EF (toujours dérivé du candidat dans le wrapper).
- Aucun `service_role` côté Edge.

**Aucun autre fichier touché.**

---

## 8. Verdict du présent lot

`MAP_6_DESIGN_READY`

> Aucune Edge Function créée, aucune migration, aucune DB write, aucune UI, aucun appel à `run-pricing`. Implémentation conditionnée à un GO CTO séparé ouvrant `MAP-6-EXEC` après prechecks RP1–RP3.

---

## 9. Références

- `docs/tariff-collection/pad/MAP_3_SCHEMA_DESIGN_COMMODITY_CLASSIFICATION_CANDIDATES.md`
- `docs/tariff-collection/pad/MAP_3B_MIGRATION_PLAN.md`
- `docs/tariff-collection/pad/MAP_3B_EXECUTION_PLAN.md`
- `docs/SECURITY_CONTRACT.md`
- `docs/MASTER_CONTEXT.md` (RPC `supersede_fact`, doctrine manual data protection)
- `docs/DEFERRED_BACKLOG.md` (MAP-5B-GLOBAL, MAP-5C, MAP-6 deferred)
- `supabase/functions/set-case-fact/index.ts` (whitelist actuelle, `p_source_type='manual_input'`)
- `supabase/functions/validate-partner-fact/index.ts` (`p_source_type='partner_response'`)
- `supabase/functions/update-commodity-classification-candidate/index.ts` (MAP-5B figé)

---

**Fin du document MAP-6 — design only.**
