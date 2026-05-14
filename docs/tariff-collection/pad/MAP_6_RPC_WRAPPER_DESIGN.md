# MAP-6-RPC-WRAPPER — Wrapper RPC dédié `propagate_classification_candidate_to_fact` — Design

> **Statut** : `📋 MAP-6 RPC WRAPPER DESIGN DRAFT — awaiting CTO review`
> **Type de lot** : Document de spécification **only** (design-only)
> **Date** : 2026-05-14
> **Branche** : `work`
> **Verdict cible** : `MAP_6_RPC_WRAPPER_DESIGN_READY`
> **Supersede** : §3.10 du document `MAP_6_PROPAGATE_TO_FACTS_DESIGN.md` (Option A → Option C)

---

## 1. Contexte & décision Option C

Préchecks exécutés sur `public.supersede_fact` :

| # | Précheck | Résultat |
|---|---|---|
| RP1 | Signature `pg_proc` | ✅ 11 paramètres, `RETURNS uuid` |
| RP2 | `prosecdef = true` (SECURITY DEFINER) | ✅ |
| RP3 | `GRANT EXECUTE` à `authenticated` (`information_schema.routine_privileges`) | ❌ **vide** — aucun grant explicite |

**Verdict initial** : `MAP_6_EXEC_BLOCKED_RPC_PERMISSION`.

**Option A rejetée par CTO** (`MAP_6_EXEC_OPTION_C_REQUIRED_NO_RAW_GRANT_ON_SUPERSEDE_FACT`) :
- `supersede_fact` est `SECURITY DEFINER` **générique** : pas de `has_case_write_access`, pas de whitelist `fact_key`, pas de contrôle `source_type`, pas de borne sur `p_value_json`.
- Un GRANT EXECUTE direct exposerait à tout `authenticated` une RPC capable de superseder n'importe quel fact, pour n'importe quel case, avec n'importe quel `source_type`. Faille d'écriture sur `quote_facts`.

**Option C retenue** : créer un wrapper RPC dédié, borné métier, **seul exposé** à `authenticated`. `supersede_fact` reste **non-grantée** à `authenticated`.

---

## 2. Périmètre strict — interdictions absolues (présent lot design)

- ❌ Aucune migration, aucun GRANT exécuté.
- ❌ Aucun code applicatif (`src/`, Edge Function).
- ❌ Aucune modification `supabase/config.toml`.
- ❌ Aucune DB write.
- ❌ Aucun GRANT direct sur `public.supersede_fact`.
- ❌ Aucune modification `update-commodity-classification-candidate`, `set-case-fact`, `run-pricing`.
- ❌ Aucune clôture `MAPPING-TAX-CHAIN-0`.

Diff attendu : 3 fichiers documentaires.

| Fichier | Action |
|---|---|
| `docs/tariff-collection/pad/MAP_6_RPC_WRAPPER_DESIGN.md` | **Création** (présent document) |
| `docs/tariff-collection/pad/MAP_6_PROPAGATE_TO_FACTS_DESIGN.md` | **Patch ciblé** §3.5, §3.10, §6 (tests), §7 (interdictions) |
| `docs/DEFERRED_BACKLOG.md` | **Ajout entrée** `MAP-6-RPC-WRAPPER-DESIGN` + ligne 5 |

---

## 3. Spécification du wrapper RPC

### 3.1 Signature

```sql
public.propagate_classification_candidate_to_fact(
  p_candidate_id     uuid,
  p_idempotency_key  text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
```

> `case_id` n'est **jamais** un paramètre d'entrée — toujours dérivé du candidat **après** chargement.

### 3.2 Format de retour normalisé

La RPC retourne **toujours** un `jsonb` typé. `RAISE` réservé aux erreurs **inattendues** (panne interne, contrainte DB inattendue) — pas pour les erreurs métier attendues.

**Succès** :
```json
{ "ok": true, "fact_id": "<uuid>", "candidate_id": "<uuid>", "fact_key": "<key>", "idempotent": false }
```

**Replay / idempotent** :
```json
{ "ok": true, "fact_id": "<uuid>", "candidate_id": "<uuid>", "fact_key": "<key>", "idempotent": true, "replay_source": "evidence|quote_facts" }
```

**Erreur métier** :
```json
{ "ok": false, "code": "<error_code>", "details": { ... } }
```

Codes erreur métier (jamais via `RAISE`) :

| Code | Sens |
|---|---|
| `invalid_input` | `p_candidate_id` ou `p_idempotency_key` manquant/invalide (longueur 8..128) |
| `candidate_not_found` | UUID inexistant |
| `rls_write_denied` | `has_case_write_access(case_id)` = false |
| `candidate_not_accepted` | `status ≠ 'accepted'` |
| `candidate_not_current` | `is_current = false` |
| `candidate_kind_not_whitelisted` | `candidate_kind` hors §3.4 |
| `pad_label_forbidden` | `candidate_kind = 'pad_label'` (refus explicite) |
| `idempotency_conflict` | Même `idempotency_key` déjà utilisée pour un autre `candidate_id` sur le même `case_id` |

Mapping HTTP côté Edge Function MAP-6 :
- `rls_write_denied` → 403
- `candidate_not_found` → 404
- `candidate_not_accepted` / `candidate_not_current` / `idempotency_conflict` → 409
- `candidate_kind_not_whitelisted` / `pad_label_forbidden` → 422
- `invalid_input` → 400

### 3.3 Whitelist `candidate_kind → fact_key` (incluant `hs10_uemoa`)

| `candidate_kind` | `fact_key` | `fact_category` | `value_json.scheme` |
|---|---|---|---|
| `cn8` | `commodity.cn_code` | `cargo` | — |
| `hs6` | `commodity.hs_code` | `cargo` | `'hs6'` |
| `hs10_uemoa` | `commodity.hs_code` | `cargo` | `'hs10_uemoa'` |
| `nhm` | `commodity.nhm_code` | `cargo` | — |
| `nst2007` | `commodity.nst_code` | `cargo` | — |
| `nstr` | `commodity.nstr_code` | `cargo` | — |
| `pad_category` | `pricing.pad_category` | `pricing` | — |
| `pad_label` | — | — | **refus** → `pad_label_forbidden` |
| autre | — | — | **refus** → `candidate_kind_not_whitelisted` |

### 3.4 Logique interne — ordre strict

`case_id` n'est **jamais** un paramètre. Il est dérivé du candidat **après** chargement, **avant** le RLS check.

```text
1. Validation entrée
   - p_candidate_id NOT NULL
   - p_idempotency_key NOT NULL et longueur 8..128
   - Sinon → return { ok:false, code:'invalid_input' }

2. Lock idempotent par candidat
   - PERFORM pg_advisory_xact_lock(
       hashtext('map6_propagate_' || p_candidate_id::text)
     );

3. Charger candidat avec verrou ligne
   - SELECT id, case_id, candidate_kind, candidate_value, status, is_current,
            evidence, confidence
       INTO v_candidate
     FROM commodity_classification_candidates
     WHERE id = p_candidate_id
     FOR UPDATE;
   - IF NOT FOUND THEN return { ok:false, code:'candidate_not_found' };

4. Extraire v_case_id depuis le candidat (jamais paramètre)
   - v_case_id := v_candidate.case_id;

5. RLS write check (APRÈS chargement)
   - IF NOT public.has_case_write_access(v_case_id) THEN
       return { ok:false, code:'rls_write_denied' };
     END IF;

6. État candidat
   - IF v_candidate.status <> 'accepted' THEN
       return { ok:false, code:'candidate_not_accepted',
                details: jsonb_build_object('current_status', v_candidate.status) };
     END IF;
   - IF v_candidate.is_current = false THEN
       return { ok:false, code:'candidate_not_current' };
     END IF;

7. Whitelist candidate_kind → (v_fact_key, v_fact_category, v_scheme)
   - cn8         → commodity.cn_code   / cargo   / NULL
   - hs6         → commodity.hs_code   / cargo   / 'hs6'
   - hs10_uemoa  → commodity.hs_code   / cargo   / 'hs10_uemoa'
   - nhm         → commodity.nhm_code  / cargo   / NULL
   - nst2007     → commodity.nst_code  / cargo   / NULL
   - nstr        → commodity.nstr_code / cargo   / NULL
   - pad_category→ pricing.pad_category/ pricing / NULL
   - pad_label   → return { ok:false, code:'pad_label_forbidden' }
   - autre       → return { ok:false, code:'candidate_kind_not_whitelisted',
                            details: jsonb_build_object('candidate_kind', ...) }

8. Idempotence Niveau A — evidence (clé exigée)
   - IF v_candidate.evidence ? 'propagated_fact_id'
        AND v_candidate.evidence->>'propagation_idempotency_key' = p_idempotency_key THEN
       return jsonb_build_object(
         'ok', true,
         'fact_id', (v_candidate.evidence->>'propagated_fact_id')::uuid,
         'candidate_id', p_candidate_id,
         'fact_key', v_fact_key,
         'idempotent', true,
         'replay_source', 'evidence'
       );
     END IF;
   -- Note : evidence.propagated_fact_id seul (avec une AUTRE clé) NE déclenche
   -- PAS idempotent. La re-propagation explicite avec une nouvelle clé suit
   -- l'étape 11 (sémantique métier de re-propagation, pas replay).

9. Replay guard Niveau B — quote_facts (sans filtre is_current)
   - SELECT id INTO v_existing_fact_id
     FROM quote_facts
     WHERE case_id = v_case_id
       AND fact_key = v_fact_key
       AND value_json->>'candidate_id' = p_candidate_id::text
       AND value_json->>'propagation_idempotency_key' = p_idempotency_key
     LIMIT 1;
   - IF FOUND THEN
       -- Réparation evidence best-effort
       UPDATE commodity_classification_candidates
       SET evidence = COALESCE(evidence, '{}'::jsonb) || jsonb_build_object(
             'propagated_fact_id', v_existing_fact_id,
             'propagated_at', now(),
             'propagation_idempotency_key', p_idempotency_key
           )
       WHERE id = p_candidate_id;
       return jsonb_build_object(
         'ok', true,
         'fact_id', v_existing_fact_id,
         'candidate_id', p_candidate_id,
         'fact_key', v_fact_key,
         'idempotent', true,
         'replay_source', 'quote_facts'
       );
     END IF;
   -- Pas de filtre is_current=true : un fact superseded entre-temps doit
   -- toujours être détecté comme replay pour empêcher tout double-propagation
   -- d'une ancienne clé idempotente.

10. Détection conflit clé idempotence (autre candidat)
    - SELECT 1 INTO v_dummy
      FROM quote_facts
      WHERE case_id = v_case_id
        AND value_json->>'propagation_idempotency_key' = p_idempotency_key
        AND value_json->>'candidate_id' <> p_candidate_id::text
      LIMIT 1;
    - IF FOUND THEN return { ok:false, code:'idempotency_conflict' };

11. Appel interne supersede_fact (SECURITY DEFINER → propriétaire)
    - SELECT public.supersede_fact(
        p_case_id        := v_case_id,
        p_fact_key       := v_fact_key,
        p_fact_category  := v_fact_category,
        p_value_text     := v_candidate.candidate_value,
        p_value_json     := jsonb_build_object(
                              'origin', 'MAP-6',
                              'propagated_from', 'commodity_classification_candidates',
                              'candidate_id', p_candidate_id,
                              'propagation_idempotency_key', p_idempotency_key,
                              'operator_validated', true,
                              'scheme', v_scheme  -- NULL sauf hs6 / hs10_uemoa
                            ),
        p_source_type    := 'manual_input',
        p_source_excerpt := '[MAP-6] propagate candidate ' || p_candidate_id::text,
        p_confidence     := 1.0
      )
      INTO v_new_fact_id;
    -- Note : supersede_fact RETURNS uuid, donc on utilise SELECT ... INTO.
    -- Pas de RETURNING id sur un appel de fonction PL/pgSQL.

12. Update candidate.evidence (même transaction RPC)
    - UPDATE commodity_classification_candidates
      SET evidence = COALESCE(evidence, '{}'::jsonb) || jsonb_build_object(
            'propagated_fact_id', v_new_fact_id,
            'propagated_at', now(),
            'propagation_idempotency_key', p_idempotency_key
          )
      WHERE id = p_candidate_id;
    - Aucun changement de status / is_current.

13. Timeline event — case_timeline_events (cible explicite)
    - INSERT INTO public.case_timeline_events (
        case_id, event_type, actor_type, actor_user_id, event_data
      ) VALUES (
        v_case_id,
        'manual_action',
        'operator',
        auth.uid(),
        jsonb_build_object(
          'action_code',  'CCC_PROPAGATED_TO_FACTS',
          'dedupe_key',   'ccc_propagate:' || p_candidate_id::text || ':' || p_idempotency_key,
          'candidate_id', p_candidate_id,
          'fact_key',     v_fact_key,
          'fact_id',      v_new_fact_id,
          'status',       'done'
        )
      );

14. Retour final
    - return jsonb_build_object(
        'ok', true,
        'fact_id', v_new_fact_id,
        'candidate_id', p_candidate_id,
        'fact_key', v_fact_key,
        'idempotent', false
      );

15. Aucun appel run-pricing, aucun side-effect pricing_runs.
```

### 3.5 Sécurité

- `GRANT EXECUTE ON FUNCTION public.propagate_classification_candidate_to_fact(uuid, text) TO authenticated;` — uniquement sur **ce wrapper**, à appliquer en lot **MAP-6-EXEC-MIGRATION** (pas dans le présent lot design).
- **`public.supersede_fact` reste non-grantée à `authenticated`** — vérification négative obligatoire (test T12).
- `case_id` jamais paramètre d'entrée.
- `SECURITY DEFINER` justifié : appel interne à `supersede_fact` (DEFINER), écriture sur `commodity_classification_candidates.evidence`, écriture `case_timeline_events`. Le contrôle d'accès métier est porté par `has_case_write_access(v_case_id)` exécuté **après** le SELECT du candidat, et **avant** tout side-effect.
- Aucun `service_role` côté Edge.

### 3.6 Atomicité

Le wrapper s'exécute dans **une seule transaction PostgreSQL** (la transaction implicite de l'appel RPC). Étapes 11, 12, 13 sont donc atomiques entre elles : soit toutes commitées, soit toutes annulées. C'est le gain principal vs le design d'origine (MAP-6 §3.5) qui exécutait `supersede_fact` + UPDATE candidate + INSERT timeline en best-effort hors transaction.

L'advisory lock étape 2 + le `FOR UPDATE` étape 3 garantissent qu'aucun appel concurrent sur le même `p_candidate_id` ne peut interleaver.

---

## 4. Edge Function MAP-6 — appel du wrapper

L'Edge Function `propagate-classification-candidate-to-facts` appelle **uniquement** ce wrapper :

```ts
const { data, error } = await supabase.rpc(
  'propagate_classification_candidate_to_fact',
  { p_candidate_id, p_idempotency_key }
);
```

L'EF :
- ne passe **plus** `case_id` (dérivé dans le wrapper) ;
- n'appelle **plus** `supersede_fact` directement ;
- n'appelle **plus** `has_case_write_access` séparément (porté par le wrapper) ;
- mappe le retour `jsonb` du wrapper vers la réponse HTTP via le mapping §3.2.

---

## 5. Tests prescriptifs (à exécuter en MAP-6-EXEC-MIGRATION)

| # | Scénario | Attendu |
|---|---|---|
| T1 | Candidat `accepted + is_current=true + cn8` (owner) | `ok:true, idempotent:false`, fact créé, evidence mise à jour, timeline event inséré |
| T2 | Replay Niveau A : 2e appel même `idempotency_key` après évidence remplie | `ok:true, idempotent:true, replay_source:'evidence'` |
| T3 | Replay Niveau B : evidence vidée manuellement, 2e appel même `idempotency_key` | `ok:true, idempotent:true, replay_source:'quote_facts'`, evidence réparée |
| T3bis | Replay Niveau B après supersession : fact d'origine `is_current=false`, 2e appel même clé | `ok:true, idempotent:true` (correction `is_current` filtre absent vérifiée) |
| T4 | RLS : caller authentifié non-owner / non-assigned | `ok:false, code:'rls_write_denied'`, **aucune écriture DB** |
| **T5** | **Candidat `status='suggested'`** | `ok:false, code:'candidate_not_accepted'` (statut réel `suggested`, pas `proposed`) |
| T6 | Candidat `status='accepted', is_current=false` | `ok:false, code:'candidate_not_current'` |
| T7 | Whitelist : `pad_label` | `ok:false, code:'pad_label_forbidden'` |
| T7bis | Whitelist : `hs10_uemoa` | fact créé avec `value_json.scheme='hs10_uemoa'` |
| T8 | Whitelist : `candidate_kind` inconnu | `ok:false, code:'candidate_kind_not_whitelisted'` |
| T9 | Conflit clé idempotence sur autre candidat (même case_id, même `idempotency_key`) | `ok:false, code:'idempotency_conflict'` |
| T10 | Re-propagation explicite : nouvelle `idempotency_key`, même candidat | `ok:true, idempotent:false`, nouveau fact courant, ancien `is_current=false` |
| T11 | Aucun `pricing_runs` créé/modifié post-T1 | Confirmé read DB |
| T12 | **Grants matrix** : `authenticated` peut exécuter wrapper, **ne peut PAS exécuter `supersede_fact`** | Test négatif explicite via `has_function_privilege('authenticated', 'public.supersede_fact(...)', 'EXECUTE')` = `false` |
| **T13** | **Auth/grants matrix** (3 sous-cas) | |
| T13a | Appel via Edge Function MAP-6 sans JWT | **401** côté Edge (auth code-side, RPC jamais atteinte) |
| T13b | Appel direct PostgREST en `anon` (sans JWT user) sur la RPC wrapper | Refus PostgREST par **absence de GRANT EXECUTE pour `anon`** (`permission denied for function`). Pas de retour métier `rls_write_denied`. |
| T13c | Appel `authenticated` non-owner / non-assigned sur la RPC wrapper | `{ ok:false, code:'rls_write_denied' }`, aucune modification DB (conforme §3.4 étape 5) |
| T14 | Timeline : `case_timeline_events` contient `action_code='CCC_PROPAGATED_TO_FACTS'` avec `dedupe_key` correct | Confirmé read DB |

Seed test obligatoire pour T4 / T13c : user secondaire authentifié non-owner / non-assigned (pattern V10) + rollback seed obligatoire après test.

---

## 6. Critères GO / NO-GO

### GO (`MAP_6_RPC_WRAPPER_DESIGN_READY` → ouverture MAP-6-EXEC-MIGRATION autorisée)

- Signature wrapper §3.1 acceptée.
- Logique §3.4 (ordre strict, lock + `FOR UPDATE` + `case_id` dérivé) acceptée.
- Whitelist §3.3 incluant `hs10_uemoa` acceptée.
- Format de retour `jsonb` §3.2 (pas de `RAISE` métier) accepté.
- Replay Niveau A/B §3.4 (clé exigée, pas de filtre `is_current`) acceptés.
- Décision : **aucun GRANT direct sur `public.supersede_fact`**.
- Aucun `service_role` côté Edge.
- Cible timeline = `case_timeline_events` avec `action_code='CCC_PROPAGATED_TO_FACTS'`.

### NO-GO

| Cause | Verdict |
|---|---|
| Demande GRANT direct sur `supersede_fact` | `MAP_6_RPC_WRAPPER_DESIGN_BLOCKED_RAW_GRANT` |
| Demande `case_id` en paramètre wrapper | `MAP_6_RPC_WRAPPER_DESIGN_BLOCKED_CASE_ID_PARAM` |
| Demande `RAISE` pour erreurs métier | `MAP_6_RPC_WRAPPER_DESIGN_BLOCKED_RAISE_MODEL` |
| Demande filtre `is_current=true` sur replay Niveau B | `MAP_6_RPC_WRAPPER_DESIGN_BLOCKED_REPLAY_MODEL` |
| Demande propagation `pad_label` | `MAP_6_RPC_WRAPPER_DESIGN_BLOCKED_WHITELIST` |

---

## 7. Séquence post-design

1. **MAP-6-RPC-WRAPPER-DESIGN** — présent lot. Verdict cible : `MAP_6_RPC_WRAPPER_DESIGN_READY`.
2. **MAP-6-EXEC-MIGRATION** (GO CTO requis) — migration création wrapper + `GRANT EXECUTE` ciblé sur le wrapper uniquement + tests T1–T14 + précheck négatif `supersede_fact` non-grantée.
3. **MAP-6-EXEC-EF** (GO CTO requis) — Edge Function `propagate-classification-candidate-to-facts` appelant **uniquement** le wrapper.
4. **MAP-6-EXEC-UI** (GO CTO requis) — bouton "Propager au dossier" dans `CommodityClassificationCandidatesPanel`.
5. **MAP-7**, **MAP-8** — inchangés.

`MAPPING-TAX-CHAIN-0` reste **ouvert** au moins jusqu'à MAP-7.

---

## 8. Verdict du présent lot

`MAP_6_RPC_WRAPPER_DESIGN_READY`

> Aucune migration, aucun GRANT, aucune DB write, aucun code, aucune Edge Function, aucune UI. Implémentation conditionnée à un GO CTO séparé ouvrant `MAP-6-EXEC-MIGRATION`.

---

## 9. Références

- `docs/tariff-collection/pad/MAP_6_PROPAGATE_TO_FACTS_DESIGN.md` (§3.10 superseded par le présent document)
- `docs/MASTER_CONTEXT.md` (RPC `supersede_fact`, doctrine manual data protection)
- `docs/SECURITY_CONTRACT.md`
- `docs/DEFERRED_BACKLOG.md` (entrée `MAP-6-RPC-WRAPPER-DESIGN`)
- `db-functions` : `public.supersede_fact`, `public.has_case_write_access`

---

**Fin du document MAP-6-RPC-WRAPPER — design only.**
