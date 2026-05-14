
# MAP-6-RPC-WRAPPER-DESIGN v3 — Plan documentaire final

Verdict CTO : `MAP_6_RPC_WRAPPER_DESIGN_V2_APPROVED_WITH_MINOR_FIXES`. Les 3 corrections finales sont intégrées ci-dessous.

**Lot design-only.** Aucun code, aucune migration, aucun GRANT, aucune DB write, aucun src/, aucune Edge Function, aucun config.toml, aucun run-pricing, aucun GRANT direct sur `public.supersede_fact`. `MAPPING-TAX-CHAIN-0` reste ouvert.

---

## Diff autorisé (3 fichiers documentaires)

| Fichier | Action |
|---|---|
| `docs/tariff-collection/pad/MAP_6_RPC_WRAPPER_DESIGN.md` | **Création** |
| `docs/tariff-collection/pad/MAP_6_PROPAGATE_TO_FACTS_DESIGN.md` | **Patch ciblé** §3.5 + §3.10 + §6 + §7 |
| `docs/DEFERRED_BACKLOG.md` | **Ajout entrée** `MAP-6-RPC-WRAPPER-DESIGN` + ligne 5 |

---

## Document `MAP_6_RPC_WRAPPER_DESIGN.md` — contenu

### 1. Contexte et décision Option C

- Préchecks RP1 OK, RP2 OK (`prosecdef=true`), **RP3 KO** : pas de `GRANT EXECUTE` `authenticated` sur `public.supersede_fact`.
- **Option A rejetée** : `supersede_fact` est `SECURITY DEFINER` générique, sans `has_case_write_access`, sans whitelist `fact_key`, sans contrôle `source_type`. Un GRANT direct ouvrirait une RPC arbitraire.
- **Option C retenue** : wrapper RPC dédié, borné métier, **seul exposé** à `authenticated`. `supersede_fact` reste non-grantée.

### 2. Signature

```sql
public.propagate_classification_candidate_to_fact(
  p_candidate_id     uuid,
  p_idempotency_key  text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
```

`case_id` jamais paramètre — toujours dérivé du candidat.

### 3. Format de retour normalisé

La RPC retourne **toujours** un `jsonb` typé. `RAISE` réservé aux erreurs inattendues (panne interne, contrainte DB).

- Succès : `{ "ok": true, "fact_id": "...", "candidate_id": "...", "fact_key": "...", "idempotent": false }`
- Replay : `{ "ok": true, ..., "idempotent": true, "replay_source": "evidence|quote_facts" }`
- Erreur métier : `{ "ok": false, "code": "<code>", "details": { ... } }`

Codes erreur métier : `invalid_input`, `candidate_not_found`, `rls_write_denied`, `candidate_not_accepted`, `candidate_not_current`, `candidate_kind_not_whitelisted`, `pad_label_forbidden`, `idempotency_conflict`.

Mapping HTTP côté Edge : `rls_write_denied`→403, `candidate_not_found`→404, conflits/non-current/idempotency_conflict→409, whitelist→422, `invalid_input`→400.

### 4. Logique interne — ordre strict

```text
1. Validation entrée
   - p_candidate_id NOT NULL, p_idempotency_key NOT NULL longueur 8..128
   - Sinon → return { ok:false, code:'invalid_input' }

2. Lock idempotent par candidat
   - PERFORM pg_advisory_xact_lock(hashtext('map6_propagate_'||p_candidate_id::text))

3. SELECT candidat FOR UPDATE
   - SELECT id, case_id, candidate_kind, candidate_value, status, is_current,
            evidence, confidence
     FROM commodity_classification_candidates
     WHERE id = p_candidate_id
     FOR UPDATE
   - Si non trouvé → return { ok:false, code:'candidate_not_found' }

4. Extraire v_case_id depuis le candidat (jamais paramètre)

5. RLS write check (APRÈS chargement)
   - IF NOT public.has_case_write_access(v_case_id) THEN
       return { ok:false, code:'rls_write_denied' }
     END IF

6. État candidat
   - status='accepted' sinon → { ok:false, code:'candidate_not_accepted',
                                 details:{ current_status } }
   - is_current=true sinon  → { ok:false, code:'candidate_not_current' }

7. Whitelist candidate_kind → fact_key (incluant hs10_uemoa)
   - cn8         → commodity.cn_code      (cargo)
   - hs6         → commodity.hs_code      (cargo) value_json.scheme='hs6'
   - hs10_uemoa  → commodity.hs_code      (cargo) value_json.scheme='hs10_uemoa'
   - nhm         → commodity.nhm_code     (cargo)
   - nst2007     → commodity.nst_code     (cargo)
   - nstr        → commodity.nstr_code    (cargo)
   - pad_category→ pricing.pad_category   (pricing)
   - pad_label   → return { ok:false, code:'pad_label_forbidden' }
   - autre       → return { ok:false, code:'candidate_kind_not_whitelisted',
                            details:{ candidate_kind } }

8. Idempotence Niveau A — evidence (clé exigée)
   - IF evidence ? 'propagated_fact_id'
       AND evidence->>'propagation_idempotency_key' = p_idempotency_key THEN
       return { ok:true, fact_id, candidate_id, fact_key,
                idempotent:true, replay_source:'evidence' }
     END IF
   - propagated_fact_id seul (autre clé) NE déclenche PAS idempotent.
     La re-propagation explicite avec nouvelle clé suit §11.

9. Replay guard Niveau B — quote_facts (sans filtre is_current)
   - SELECT id INTO v_existing_fact_id
     FROM quote_facts
     WHERE case_id = v_case_id
       AND fact_key = v_fact_key
       AND value_json->>'candidate_id' = p_candidate_id::text
       AND value_json->>'propagation_idempotency_key' = p_idempotency_key
     LIMIT 1
   - IF FOUND THEN
       UPDATE commodity_classification_candidates
       SET evidence = COALESCE(evidence,'{}'::jsonb) || jsonb_build_object(
             'propagated_fact_id', v_existing_fact_id,
             'propagated_at', now(),
             'propagation_idempotency_key', p_idempotency_key)
       WHERE id = p_candidate_id;
       return { ok:true, fact_id:v_existing_fact_id, ...,
                idempotent:true, replay_source:'quote_facts' }
     END IF
   - Pas de filtre is_current=true : un fact superseded entre-temps doit
     toujours être détecté pour empêcher tout double-propagation.

10. Détection conflit clé idempotence (autre candidat)
    - SELECT 1 FROM quote_facts
      WHERE case_id = v_case_id
        AND value_json->>'propagation_idempotency_key' = p_idempotency_key
        AND value_json->>'candidate_id' <> p_candidate_id::text
      LIMIT 1
    - IF FOUND THEN return { ok:false, code:'idempotency_conflict' }

11. Appel interne supersede_fact (sous SECURITY DEFINER)
    - SELECT public.supersede_fact(
        p_case_id        := v_case_id,
        p_fact_key       := v_fact_key,
        p_fact_category  := v_fact_category,
        p_value_text     := v_candidate_value,
        p_value_json     := jsonb_build_object(
                              'origin','MAP-6',
                              'propagated_from','commodity_classification_candidates',
                              'candidate_id', p_candidate_id,
                              'propagation_idempotency_key', p_idempotency_key,
                              'operator_validated', true,
                              'scheme', v_scheme  -- null sauf hs6/hs10_uemoa
                            ),
        p_source_type    := 'manual_input',
        p_source_excerpt := '[MAP-6] propagate candidate '||p_candidate_id::text,
        p_confidence     := 1.0
      )
      INTO v_new_fact_id;
    -- Note (correction finale #1) : supersede_fact RETURNS uuid, donc
    -- on utilise SELECT ... INTO. Pas de RETURNING id sur un appel de fonction.

12. Update candidate.evidence (même transaction RPC)
    - UPDATE commodity_classification_candidates
      SET evidence = COALESCE(evidence,'{}'::jsonb) || jsonb_build_object(
            'propagated_fact_id', v_new_fact_id,
            'propagated_at', now(),
            'propagation_idempotency_key', p_idempotency_key)
      WHERE id = p_candidate_id;
    - Aucun changement de status / is_current.

13. Timeline event — case_timeline_events (cible explicite)
    - INSERT INTO public.case_timeline_events (case_id, event_type, actor_type,
        actor_user_id, event_data)
      VALUES (
        v_case_id,
        'manual_action',
        'operator',
        auth.uid(),
        jsonb_build_object(
          'action_code',  'CCC_PROPAGATED_TO_FACTS',
          'dedupe_key',   'ccc_propagate:'||p_candidate_id::text||':'||p_idempotency_key,
          'candidate_id', p_candidate_id,
          'fact_key',     v_fact_key,
          'fact_id',      v_new_fact_id,
          'status',       'done'
        )
      );

14. Retour final
    - return { ok:true, fact_id:v_new_fact_id, candidate_id, fact_key,
               idempotent:false }

15. Aucun appel run-pricing, aucun side-effect pricing_runs.
```

### 5. Sécurité

- `GRANT EXECUTE ON FUNCTION public.propagate_classification_candidate_to_fact(uuid, text) TO authenticated` — uniquement sur ce wrapper, à appliquer en lot **MAP-6-EXEC-MIGRATION** (pas ici).
- **`supersede_fact` reste non-grantée à `authenticated`**.
- `case_id` jamais paramètre.
- `SECURITY DEFINER` justifié : appel interne `supersede_fact` (DEFINER) + écriture `commodity_classification_candidates.evidence` + `case_timeline_events`. Contrôle métier porté par `has_case_write_access` après chargement candidat.
- Aucun `service_role` côté Edge.

### 6. Tests prescriptifs (à exécuter en MAP-6-EXEC-MIGRATION)

- T1 — candidat `accepted+current+cn8` → fact créé, evidence mise à jour, timeline event inséré.
- T2 — replay Niveau A : 2e appel même clé après évidence remplie → `idempotent:true, replay_source:'evidence'`.
- T3 — replay Niveau B : evidence vidée manuellement, 2e appel même clé → `idempotent:true, replay_source:'quote_facts'`, evidence réparée.
- T3bis — replay Niveau B après supersession : fact d'origine `is_current=false`, 2e appel même clé → toujours `idempotent:true` (correction is_current vérifiée).
- T4 — RLS : caller authentifié non-owner/non-assigned → `{ ok:false, code:'rls_write_denied' }`, aucune écriture DB.
- **T5 — état : candidat `suggested` → `candidate_not_accepted`** (correction finale #2 : statut réel `suggested`, pas `proposed`).
- T6 — état : candidat `accepted, is_current=false` → `candidate_not_current`.
- T7 — whitelist : `pad_label` → `pad_label_forbidden`.
- T7bis — whitelist : `hs10_uemoa` → fact créé avec `value_json.scheme='hs10_uemoa'`.
- T8 — whitelist : kind inconnu → `candidate_kind_not_whitelisted`.
- T9 — conflit clé idempotence sur autre candidat → `idempotency_conflict`.
- T10 — re-propagation explicite : nouvelle `idempotency_key`, même candidat → nouveau fact courant, ancien `is_current=false`.
- T11 — isolation : aucun `pricing_runs` créé/modifié.
- T12 — grants : `authenticated` peut exécuter wrapper, **ne peut PAS exécuter `supersede_fact`** (test négatif explicite via `has_function_privilege`).
- **T13 — auth/grants matrix** (correction finale #3, reformulée) :
  - **T13a** : appel via Edge Function MAP-6 sans JWT → **401** côté Edge (auth code-side, jamais d'atteinte DB).
  - **T13b** : appel direct PostgREST en `anon` (sans JWT user) sur la RPC wrapper → refus PostgREST par **absence de GRANT EXECUTE pour `anon`** (`permission denied for function`). Aucun retour métier `rls_write_denied`.
  - **T13c** : appel `authenticated` non-owner / non-assigned sur la RPC wrapper → `{ ok:false, code:'rls_write_denied' }` (pas de modification DB, conforme §4 étape 5).
- T14 — timeline : `case_timeline_events` contient `action_code='CCC_PROPAGATED_TO_FACTS'` avec `dedupe_key`.

### 7. Séquence post-design

1. **MAP-6-RPC-WRAPPER-DESIGN** — ce lot. Verdict cible : `MAP_6_RPC_WRAPPER_DESIGN_READY`.
2. **MAP-6-EXEC-MIGRATION** (GO CTO) — migration création wrapper + GRANT ciblé wrapper uniquement + tests T1–T14.
3. **MAP-6-EXEC-EF** (GO CTO) — Edge Function `propagate-classification-candidate-to-facts` appelant uniquement le wrapper.
4. **MAP-6-EXEC-UI** (GO CTO) — bouton "Propager au dossier" dans `CaseView`.
5. **MAP-7**, **MAP-8** — inchangés. `MAPPING-TAX-CHAIN-0` reste ouvert.

---

## Patch ciblé `MAP_6_PROPAGATE_TO_FACTS_DESIGN.md`

- **§3.5** (Logique d'écriture Edge) : remplacer appel direct `supersede_fact` par `rpc('propagate_classification_candidate_to_fact', { p_candidate_id, p_idempotency_key })`. Le `case_id` n'est plus passé à l'EF — dérivé dans le wrapper. L'EF mappe le retour JSONB → réponse HTTP.
- **§3.10** (Précheck RPC permission) : remplacer recommandation Option A par **Option C retenue**, renvoi vers `MAP_6_RPC_WRAPPER_DESIGN.md`. Aucun GRANT EXECUTE sur `public.supersede_fact` à `authenticated`.
- **§6** (Tests) : ajouter référence T12 (négatif GRANT supersede_fact) et T13 reformulée (matrice auth/grants en 3 sous-cas).
- **§7** (Interdictions) : ajouter "Aucun GRANT EXECUTE sur `public.supersede_fact`" + "Aucun `case_id` accepté en paramètre RPC ou EF".

---

## Entrée `DEFERRED_BACKLOG.md`

```
### MAP-6-RPC-WRAPPER-DESIGN — wrapper RPC dédié (sécurité)
ID : MAP-6-RPC-WRAPPER-DESIGN
Catégorie : tariff-collection / sécurité RPC
Statut : design-ready
Priorité : haute (bloque MAP-6-EXEC)
Phase d'origine : MAP-6
Date : 2026-05-14
Déclencheur de réouverture : GO CTO MAP-6-EXEC-MIGRATION
Recommandation : implémenter le wrapper avant toute exposition write côté
                 authenticated. Aucun GRANT direct sur supersede_fact.
```

Mise à jour ligne 5 "Dernière mise à jour" : ajout mention `MAP-6-RPC-WRAPPER-DESIGN`.

---

## Verdict attendu après exécution

`MAP_6_RPC_WRAPPER_DESIGN_READY`
