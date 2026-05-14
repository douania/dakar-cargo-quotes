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

1. SELECT candidat (RLS read).
2. Vérifications §3.3.
3. **Replay/recovery guard pré-RPC (§3.6)** : recherche d'un fact déjà créé pour `(case_id, fact_key, candidate_id, propagation_idempotency_key)`. Si trouvé → réparer `candidate.evidence` (best-effort) puis retourner `200 idempotent:true`.
4. Construction du payload `supersede_fact` :
   - `p_case_id = candidate.case_id`
   - `p_fact_key = <résolu §3.4>`
   - `p_fact_category = <résolu §3.4>`
   - `p_value_text = candidate.candidate_value`
   - `p_value_json` :
     ```json
     {
       "origin": "MAP-6",
       "propagated_from": "commodity_classification_candidates",
       "candidate_id": "<candidate.id>",
       "propagation_idempotency_key": "<idempotency_key>",
       "operator_validated": true,
       "scheme": "<hs6|hs10_uemoa>"   // uniquement pour candidate_kind ∈ {hs6, hs10_uemoa}
     }
     ```
   - `p_source_type = 'manual_input'` (correction CTO #2)
   - `p_source_excerpt = '[MAP-6] propagate candidate ' || candidate.id`
   - `p_confidence = 1.0` (validation humaine).
5. Appel RPC `supersede_fact` (advisory lock interne sur `(case_id, fact_key)` → atomicité de la supersession `quote_facts`).
6. UPDATE `commodity_classification_candidates` (best-effort, hors transaction RPC) :
   - `evidence = evidence || { propagated_at, propagation_idempotency_key, propagated_fact_id }`
   - **Aucun changement de `status`** (le candidat reste `accepted`).
   - Si l'UPDATE échoue : log d'erreur, **ne pas** retourner 500 (le fact existe et le replay guard le rattrapera au prochain appel). Retourner `200 { ok: true, idempotent: false, fact_id, fact_key, candidate_id, evidence_repair_pending: true }`.
7. INSERT `case_timeline_events` (best-effort) :
   - `event_type = 'manual_action'`
   - `actor_type = 'operator'`, `actor_user_id = userId`
   - `event_data.action_code = 'CCC_PROPAGATED_TO_FACTS'`
   - `event_data.dedupe_key = 'ccc_propagate:' || candidate_id || ':' || idempotency_key`
   - `event_data.candidate_id`, `event_data.fact_key`, `event_data.fact_id`, `event_data.status = 'done'`
   - Échec → log seulement, pas de 500.
8. Réponse `200 { ok: true, idempotent: false, fact_id, fact_key, candidate_id }`.

### 3.6 Idempotence stricte + replay/recovery guard (correction CTO #1)

Trois niveaux de protection contre la divergence d'état entre `quote_facts` et `commodity_classification_candidates` :

**Niveau A — Edge candidate-side (rapide)** :
Si `candidate.evidence.propagation_idempotency_key === idempotency_key` ET `candidate.evidence.propagated_fact_id` présent → retour `200 { ok: true, idempotent: true, fact_id, fact_key }` sans appel RPC.

**Niveau B — Edge fact-side (replay guard)** — nouveau :
Avant d'appeler `supersede_fact`, exécuter une SELECT dans `quote_facts` :

```text
SELECT id FROM public.quote_facts
WHERE case_id = :case_id
  AND fact_key = :fact_key
  AND value_json->>'candidate_id' = :candidate_id
  AND value_json->>'propagation_idempotency_key' = :idempotency_key
LIMIT 1;
```

- Si la ligne existe → un précédent appel a réussi `supersede_fact` mais a échoué sur l'UPDATE candidate.evidence ou sur le timeline. **Réparer** : tenter à nouveau l'UPDATE candidate.evidence avec ce `fact_id`, puis retourner `200 idempotent:true`.
- Si la ligne n'existe pas → procéder normalement.

Ce SELECT exploite le fait que MAP-6 grave `candidate_id` + `propagation_idempotency_key` dans `value_json` (étape §3.5.4). Il garantit qu'un retry après échec partiel ne crée jamais un second fact courant pour le même couple.

**Niveau C — DB native** :
`supersede_fact` est nativement idempotent par advisory lock + supersession. Un appel concurrent avec un `idempotency_key` **différent** (re-propagation volontaire) produit un nouveau fact courant, l'ancien `is_current=false` — sémantique métier acceptée (l'opérateur souverain).

**Note** : un RPC wrapper dédié (`propagate_candidate_to_fact_atomic`) qui ferait `supersede_fact` + UPDATE candidate + INSERT timeline dans une transaction unique serait une alternative plus propre. C'est explicitement **hors périmètre MAP-6** : ce serait un lot DB séparé (`MAP-6-RPC-WRAPPER`) avec migration dédiée et GO CTO indépendant.

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

`set-case-fact` et `validate-partner-fact` appellent `supersede_fact` via un **service client** (`SUPABASE_SERVICE_ROLE_KEY`). MAP-6 propose volontairement de ne **pas** utiliser le service role et d'appeler `supersede_fact` sous l'identité caller (`SUPABASE_ANON_KEY` + JWT user). C'est cohérent avec l'isolation MAP-4 / MAP-5B mais **non vérifié runtime**.

`supersede_fact` est `SECURITY DEFINER` (cf. `db-functions`). Cela exécute le corps avec les droits du propriétaire (par défaut Supabase admin), **mais le droit d'INVOQUER** la fonction reste régi par les `GRANT EXECUTE` sur le rôle `authenticated`.

**MAP-6-EXEC précheck obligatoire — avant tout commit code** :

| # | Précheck | Méthode | Attendu pour GO |
|---|---|---|---|
| RP1 | Vérifier signature `public.supersede_fact` | `\df+ public.supersede_fact` ou `pg_proc` query | Signature inchangée vs `MASTER_CONTEXT.md` |
| RP2 | Vérifier `prosecdef = true` (SECURITY DEFINER) | `SELECT prosecdef FROM pg_proc WHERE proname='supersede_fact';` | `true` |
| RP3 | Vérifier grants EXECUTE | `SELECT grantee, privilege_type FROM information_schema.routine_privileges WHERE routine_name='supersede_fact';` | `authenticated` doit apparaître avec `EXECUTE`, sinon **STOP** |
| RP4 | Test live RPC sous JWT owner/assigned | `supabase--curl_edge_functions` après EF déployée — premier appel POST réel | 200 + fact créé |
| RP5 | Test live RPC sous JWT non-owner non-assigned | Idem avec user secondaire (pattern V10) | 403 `rls_write_denied` (pré-check `has_case_write_access` arrête avant RPC) |

**STOP conditions** :
- RP3 KO (`authenticated` n'a pas `EXECUTE`) → **`MAP_6_EXEC_BLOCKED_RPC_PERMISSION`**. Choix CTO requis :
  - Option A : ajouter un `GRANT EXECUTE ON FUNCTION public.supersede_fact(...) TO authenticated` (lot DB séparé, GO CTO).
  - Option B : revenir au modèle service_role (refonte MAP-6 — perte d'isolation, GO CTO requis).
  - Aucune des deux options n'est exécutée par MAP-6-EXEC sans GO CTO explicite.

> Ce précheck doit être exécuté **avant** tout codage UI MAP-6-EXEC-UI pour éviter une découverte tardive.

### 3.11 Réponses HTTP normalisées

| Status | Body | Cas |
|---|---|---|
| 200 | `{ ok: true, idempotent: false, fact_id, fact_key, candidate_id }` | Propagation effective |
| 200 | `{ ok: true, idempotent: true, fact_id, fact_key, candidate_id, recovered?: true }` | Replay (Niveau A ou B §3.6) |
| 200 | `{ ok: true, idempotent: false, fact_id, fact_key, candidate_id, evidence_repair_pending: true }` | RPC OK mais UPDATE candidate KO (le replay guard rattrapera) |
| 400 | `{ error: 'invalid_input', details }` | Body Zod invalide |
| 400 | `{ error: 'unmapped_candidate_kind', candidate_kind }` | §3.4 violée |
| 401 | `{ error: 'unauthorized', reason }` | Auth manquante / invalide |
| 403 | `{ error: 'forbidden', reason: 'rls_write_denied' }` | Pré-check `has_case_write_access=false` |
| 404 | `{ error: 'candidate_not_found' }` | UUID inexistant ou hors case |
| 409 | `{ error: 'state_conflict', reason, current_status }` | `status≠accepted` ou `is_current=false` |
| 405 | `{ error: 'method_not_allowed' }` | Hors POST/OPTIONS |
| 500 | `{ error: 'internal_error' }` | RPC échec inattendu (uniquement quand replay guard ne peut pas rattraper) |

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
| T7 | Candidat `candidate_kind='pad_label'` | 400 `unmapped_candidate_kind` |
| T8 | User authentifié non owner ni assigned | 403 `rls_write_denied` (pré-check, sans modification DB) |
| T9 | User non authentifié | 401 `unauthorized` |
| T10 | Rejet ultérieur du candidat | `quote_facts` inchangé |
| T11 | Aucun `pricing_runs` créé/modifié post-T1 | Confirmé read DB |
| T12 | Aucun appel sortant `run-pricing` (logs) | Confirmé via `supabase--edge_function_logs` |
| T13 | Timeline contient `CCC_PROPAGATED_TO_FACTS` avec `dedupe_key` correct | Confirmé read DB |
| T14 | `quote_facts.source_type = 'manual_input'` | Confirmé read DB (correction CTO #2) |
| T15 | Aucun écriture sur `cargo.pad_category`, `cargo.pad_rate_fcfa_per_ton` | Confirmé read DB (isolation pivots MAP) |

Seed test obligatoire pour T8 : user secondaire authentifié non-owner / non-assigned (pattern V10) + rollback seed obligatoire après test + suppression user manuelle.

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

## 7. Diff attendu du présent lot MAP-6 (design)

```text
A docs/tariff-collection/pad/MAP_6_PROPAGATE_TO_FACTS_DESIGN.md
M docs/DEFERRED_BACKLOG.md
  - ligne 5 "Dernière mise à jour" : ajout mention MAP-6-DESIGN
  - ajout "### MAP-6 — Design action propagate_to_facts" sous la section MAP
```

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
