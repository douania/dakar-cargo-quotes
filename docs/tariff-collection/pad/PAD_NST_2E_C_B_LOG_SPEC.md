# PAD-NST-2E-C-B-LOG-0 — Spécification documentaire de traçabilité des recommandations PAD-NST

**Date** : 2026-05-09  
**Repo** : `douania/dakar-cargo-quotes`  
**Branche cible** : `work`  
**Phase** : PAD-NST-2E-C-B-LOG-0  
**Statut** : SPÉCIFICATION DOCUMENTAIRE — aucune migration, aucune implémentation  
**Livrable cible repo** : `docs/tariff-collection/pad/PAD_NST_2E_C_B_LOG_SPEC.md`

---

## 0. Verdict CTO

### Verdict court

**GO recommandé pour une future phase `PAD-NST-2E-C-B-LOG-1` limitée à une migration de schéma audit-log uniquement.**

**NO-GO maintenu** pour :

- toute écriture runtime ;
- tout branchement `run-pricing` ;
- toute modification `quotation-engine` ;
- toute modification `src/` ;
- toute modification de `get-pad-nst-suggestions` ;
- toute décision opérateur persistée automatiquement sans GO CTO séparé.

### Découpage recommandé

| Phase future | Objet | Verdict recommandé |
|---|---|---|
| `C-B-LOG-1` | Migration seule : table `pad_recommendation_audit_log`, index, contraintes, RLS append-only | **GO conditionnel** |
| `C-B-LOG-2` | Extension contrôlée de `get-pad-nst-suggestions` pour journaliser les recherches et suggestions émises | **NO-GO sans GO CTO séparé** |
| `C-B-LOG-3` | Edge Function dédiée pour décisions opérateur : accept/reject/modified/manual_override | **NO-GO sans GO CTO séparé** |
| `C-E` | Audit terrain basé sur les logs | **après C-B-LOG-1/2/3 selon périmètre retenu** |
| `C-C` | Branchement `run-pricing` | **NO-GO strict inchangé** |

---

## 1. Contexte verrouillé

Les éléments suivants sont considérés comme acquis pour cette spécification :

- `PAD-NST-2E-B-R3 v3` est clos : la table `pad_nst_recommendation_rules` contient 88 règles conformes.
- `PAD-NST-2E-C-B` est déployé : Edge Function `get-pad-nst-suggestions`, lecture SELECT uniquement, `requireUser`, RLS, aucun service role.
- `PAD-NST-2E-C-D` est clos côté UI opérateur sur commit `a81d807` : panneau frontend-only, sélection NST manuelle, appel explicite à C-B, suggestions affichées en `TO_CONFIRM`, bouton copier limité au presse-papiers.
- `C-C / run-pricing` reste en **NO-GO strict**.
- Aucune migration `C-B-LOG` n'existe encore.
- Le plan C-A ne contient qu'une structure indicative de `pad_recommendation_audit_log`.

Cette spécification transforme l'idée indicative C-A en contrat documentaire exploitable, sans l'implémenter.

---

## 2. Pourquoi tracer les recommandations PAD-NST

### 2.1 Objectif métier

La recommandation PAD-NST est une aide à la décision, pas une vérité tarifaire officielle. Elle peut orienter l'opérateur vers une catégorie PAD probable, mais elle ne doit pas :

- devenir `OFFICIAL` automatiquement ;
- produire un montant ;
- modifier un fait dossier ;
- créer un alias PAD ;
- influencer `total_ht` ou `total_ttc`.

La traçabilité est donc nécessaire pour distinguer clairement :

1. ce que le système a suggéré ;
2. pourquoi il l'a suggéré ;
3. quel opérateur a vu ou utilisé cette suggestion ;
4. quelle décision humaine a été prise ensuite ;
5. si la recommandation était fiable ou conflictuelle en pratique.

### 2.2 Objectif CTO / qualité

Le log doit permettre :

- l'audit terrain C-E sur 20–50 dossiers réels ;
- la mesure du taux d'acceptation/rejet par code NST et catégorie PAD ;
- l'identification des règles faibles ou ambiguës ;
- la calibration future d'un seuil de confiance ;
- la preuve que l'opérateur reste le décideur ;
- la prévention des comportements opaques avant tout branchement runtime C-C.

### 2.3 Ce que le log ne doit pas devenir

Le log ne doit pas devenir :

- une source de vérité tarifaire ;
- un mécanisme d'apprentissage automatique ;
- un substitut à `quote_facts` ;
- un moyen d'écrire dans `cargo.pad_category` ;
- un déclencheur `run-pricing` ;
- une table d'alias cachée.

---

## 3. Événements à tracer

### 3.1 Événements recommandés

| Event type | Quand | Niveau | Finalité |
|---|---|---|---|
| `recommendation_requested` | L'opérateur clique explicitement sur « Rechercher suggestions PAD » | request | Prouver qu'une recherche NST a été demandée |
| `recommendation_empty` | C-B retourne `suggestions=[]` | request | Mesurer les trous de couverture |
| `recommendation_emitted` | Une suggestion est retournée à l'UI | suggestion | Figier le snapshot exact présenté à l'opérateur |
| `recommendation_copied` | L'opérateur copie un code PAD | action UI | Signal faible d'intérêt, **pas une décision métier** |
| `operator_accepted` | L'opérateur retient explicitement la suggestion dans un futur flux dédié | decision | Mesurer l'acceptation réelle |
| `operator_rejected` | L'opérateur rejette explicitement la suggestion | decision | Identifier les règles mauvaises ou non pertinentes |
| `operator_modified` | L'opérateur retient une autre catégorie PAD que celle suggérée | decision | Identifier les règles partiellement utiles mais corrigées |
| `operator_manual_override` | L'opérateur saisit une catégorie PAD sans retenir de suggestion | decision | Mesurer la valeur réelle du système de suggestion |
| `client_info_required` | L'opérateur estime qu'il faut demander précision client | decision | Identifier les zones NST/PAD intrinsèquement ambiguës |

### 3.2 Événements à ne pas tracer

| Non-événement | Raison |
|---|---|
| Ouverture / fermeture du panneau C-D | Bruit analytique, aucune intention métier |
| Saisie dans le champ de recherche NST | Donnée volatile UI, risque de bruit et de données inutiles |
| Changement d'onglet Groupe / Division | Confort UI, pas une décision |
| Chargement de `nst_groups` / `nst_divisions` | Référentiel technique, pas une recommandation |
| Erreur réseau ponctuelle frontend | À traiter via logs techniques, pas via audit métier PAD-NST |
| Auth failure C-B | Déjà du ressort sécurité / runtime, pas du log métier recommandations |
| Affichage d'une catégorie PAD déjà saisie | Aucune recommandation affichée par-dessus décision opérateur |
| `run-pricing` | C-C est NO-GO strict ; aucun événement C-C ne doit exister à ce stade |

---

## 4. Quand logger et quand ne pas logger

### 4.1 Logger uniquement sur action explicite

Le premier événement loggable doit être le clic opérateur explicite sur la recherche de suggestions. Le panneau C-D ne doit pas journaliser passivement la navigation.

### 4.2 Logger le snapshot retourné, pas recalculer

Pour `recommendation_emitted`, le log doit enregistrer le snapshot exact retourné à l'opérateur :

- `rule_id` ;
- `nst_level` ;
- `nst_code` ;
- `pad_category` ;
- `confidence` ;
- `evidence_level` ;
- `notes` ;
- `source_document` ;
- `source_reference` ;
- `source_type = TO_CONFIRM` ;
- `requires_operator_confirmation = true`.

Le logger ne doit pas refaire son propre SELECT avec une logique différente.

### 4.3 Ne pas bloquer l'opérateur pour un log analytique

Deux niveaux de criticité doivent être distingués :

| Log | Criticité recommandée |
|---|---|
| `recommendation_requested`, `recommendation_empty`, `recommendation_emitted` | Important pour C-E. Si logging échoue dans une phase future, retour d'erreur à considérer selon arbitrage CTO. |
| `recommendation_copied` | Best-effort acceptable ; ne doit pas bloquer le copier presse-papiers. |
| Décisions opérateur futures | Non-silent recommandé : si la décision est censée être auditée, l'échec de log doit être visible. |

---

## 5. Schéma proposé — `pad_recommendation_audit_log`

> **Important** : ce schéma est une proposition documentaire. Aucune migration n'est créée dans `C-B-LOG-0`.

### 5.1 Principe de design

Le design recommandé est **append-only event log** :

- une ligne = un événement ;
- pas d'UPDATE métier ;
- pas de DELETE applicatif ;
- chaque décision opérateur future est un nouvel événement lié à une recommandation émise ;
- chaque ligne conserve le snapshot au moment de l'action.

Ce choix est préférable à un modèle « une recommandation puis UPDATE avec décision », car il évite l'effacement historique et simplifie la preuve d'audit.

### 5.2 Structure SQL indicative

```sql
-- DOCUMENTATION ONLY — NE PAS EXÉCUTER EN C-B-LOG-0

create table public.pad_recommendation_audit_log (
  id uuid primary key default gen_random_uuid(),

  -- Traçabilité temporelle et acteur
  created_at timestamptz not null default now(),
  actor_user_id uuid null,

  -- Contexte dossier
  case_id uuid null references public.quote_cases(id) on delete set null,

  -- Corrélation / idempotence
  request_id uuid not null,
  related_event_id uuid null references public.pad_recommendation_audit_log(id) on delete set null,
  dedupe_key text not null unique,

  -- Type d'événement
  event_type text not null check (
    event_type in (
      'recommendation_requested',
      'recommendation_empty',
      'recommendation_emitted',
      'recommendation_copied',
      'operator_accepted',
      'operator_rejected',
      'operator_modified',
      'operator_manual_override',
      'client_info_required'
    )
  ),

  -- Entrée NST
  nst_level text null check (nst_level in ('group', 'division')),
  nst_code text null,

  -- Snapshot recommandation
  rule_id uuid null references public.pad_nst_recommendation_rules(id) on delete set null,
  recommended_pad_category text null,
  confidence numeric null check (confidence is null or (confidence >= 0 and confidence <= 1)),
  evidence_level text null,
  notes text null,
  source_document text null,
  source_reference text null,

  -- Doctrine PAD-NST
  source_type text null check (source_type is null or source_type = 'TO_CONFIRM'),
  requires_operator_confirmation boolean not null default true,

  -- Décision opérateur future
  operator_decision text null check (
    operator_decision is null or operator_decision in (
      'accepted',
      'rejected',
      'modified',
      'manual_override',
      'client_info_required'
    )
  ),
  operator_pad_category text null,
  operator_comment text null,

  -- Payload contrôlé pour compatibilité future
  event_payload jsonb not null default '{}'::jsonb,

  constraint pad_recommendation_audit_log_requires_operator_confirmation_true
    check (requires_operator_confirmation = true)
);
```

### 5.3 Index recommandés

```sql
-- DOCUMENTATION ONLY — NE PAS EXÉCUTER EN C-B-LOG-0

create index pad_rec_audit_case_created_idx
  on public.pad_recommendation_audit_log (case_id, created_at desc);

create index pad_rec_audit_request_idx
  on public.pad_recommendation_audit_log (request_id, created_at asc);

create index pad_rec_audit_rule_idx
  on public.pad_recommendation_audit_log (rule_id)
  where rule_id is not null;

create index pad_rec_audit_nst_idx
  on public.pad_recommendation_audit_log (nst_level, nst_code, created_at desc);

create index pad_rec_audit_event_type_idx
  on public.pad_recommendation_audit_log (event_type, created_at desc);
```

### 5.4 Colonnes volontairement exclues

| Colonne exclue | Raison |
|---|---|
| `amount` | Une suggestion PAD-NST ne produit aucun montant |
| `estimated_amount` | Hors périmètre C-B/C-D ; doctrine PAD-R1B à traiter séparément si C-C futur |
| `is_official` | Toute suggestion reste `TO_CONFIRM` |
| `alias_created_id` | Création d'alias = phase PAD-R4, pas C-B-LOG |
| `pricing_run_id` | `run-pricing` NO-GO ; ne pas créer de couplage prématuré |
| `quotation_version_id` | La recommandation PAD-NST intervient avant validation tarifaire officielle |

---

## 6. Stratégie RLS recommandée

### 6.1 Modèle d'accès

Le projet fonctionne en shared authenticated operator workspace. La stratégie recommandée suit ce modèle tout en conservant une trace d'acteur.

### 6.2 Policies indicatives

```sql
-- DOCUMENTATION ONLY — NE PAS EXÉCUTER EN C-B-LOG-0

alter table public.pad_recommendation_audit_log enable row level security;

create policy "Authenticated operators can read PAD recommendation audit log"
  on public.pad_recommendation_audit_log
  for select
  to authenticated
  using (true);

create policy "Authenticated operators can insert own PAD recommendation audit log"
  on public.pad_recommendation_audit_log
  for insert
  to authenticated
  with check (actor_user_id = auth.uid());

-- Pas de policy UPDATE.
-- Pas de policy DELETE.
```

### 6.3 Actor identity

Deux options sont possibles pour `actor_user_id` :

| Option | Avantage | Risque | Recommandation |
|---|---|---|---|
| `actor_user_id` fourni par client/Edge + RLS `WITH CHECK actor_user_id = auth.uid()` | Simple, explicite | Le caller doit toujours renseigner la colonne | Acceptable |
| Trigger DB `before insert` qui force `actor_user_id = auth.uid()` | Plus robuste | Migration plus complexe, attention aux tests service role | Préférable si C-B-LOG devient critique |

Recommandation CTO : **commencer simple** en C-B-LOG-1 avec `WITH CHECK actor_user_id = auth.uid()` ; envisager un trigger uniquement si les tests montrent des erreurs d'oubli côté caller.

---

## 7. Stratégie d'idempotence / `dedupe_key`

### 7.1 Principe

Le log doit empêcher les doublons dus aux retries réseau, sans empêcher deux recherches opérateur réellement distinctes.

La clé ne doit donc pas être uniquement basée sur `case_id + nst_code`, car cela écraserait des recherches répétées légitimes à des moments différents.

### 7.2 `request_id`

Chaque clic explicite « Rechercher suggestions PAD » doit produire un `request_id` UUID stable pour cette tentative.

- Si le frontend appelle directement une fonction de log future, il génère `request_id` au clic.
- Si `get-pad-nst-suggestions` est étendue en C-B-LOG-2, elle peut accepter un `request_id` fourni par l'UI ou en générer un si absent.
- En cas de retry de la même tentative, le même `request_id` doit être réutilisé.

### 7.3 Format recommandé des `dedupe_key`

| Event type | Format indicatif |
|---|---|
| `recommendation_requested` | `pad-nst:requested:{case_id|no-case}:{request_id}:{nst_level}:{nst_code}` |
| `recommendation_empty` | `pad-nst:empty:{case_id|no-case}:{request_id}:{nst_level}:{nst_code}` |
| `recommendation_emitted` | `pad-nst:emitted:{case_id|no-case}:{request_id}:{rule_id}` |
| `recommendation_copied` | `pad-nst:copied:{case_id|no-case}:{request_id}:{rule_id}:{actor_user_id}` |
| `operator_accepted` | `pad-nst:decision:accepted:{case_id}:{request_id}:{rule_id}:{actor_user_id}` |
| `operator_rejected` | `pad-nst:decision:rejected:{case_id}:{request_id}:{rule_id}:{actor_user_id}` |
| `operator_modified` | `pad-nst:decision:modified:{case_id}:{request_id}:{rule_id}:{operator_pad_category}:{actor_user_id}` |
| `operator_manual_override` | `pad-nst:decision:manual:{case_id}:{request_id}:{operator_pad_category}:{actor_user_id}` |
| `client_info_required` | `pad-nst:decision:client-info:{case_id}:{request_id}:{nst_level}:{nst_code}:{actor_user_id}` |

### 7.4 Comportement sur conflit unique

En cas de violation `unique(dedupe_key)` :

- pour `recommendation_requested` / `emitted` / `empty` : retourner succès idempotent ;
- pour `copied` : ignorer silencieusement ou retourner succès idempotent ;
- pour décisions opérateur futures : retourner succès idempotent si payload identique, conflit explicite si payload différent.

---

## 8. Comparaison des stratégies d'implémentation future

### 8.1 Option A — Frontend direct insert

**Principe** : C-D insère directement dans `pad_recommendation_audit_log` via Supabase client utilisateur.

| Aspect | Analyse |
|---|---|
| Avantages | Simple, pas de nouvelle Edge Function, RLS native |
| Inconvénients | Validation dispersée dans le frontend, risque de payload incomplet, duplication de logique dedupe, moins fiable pour figer le snapshot exact C-B |
| Sécurité | Acceptable si RLS stricte, mais moins robuste qu'une fonction serveur |
| Idempotence | Possible via `dedupe_key`, mais le frontend doit bien générer `request_id` |
| Verdict | **Non recommandé** pour `recommendation_emitted`; éventuellement acceptable pour `recommendation_copied` best-effort |

### 8.2 Option B — Edge Function dédiée `log-pad-nst-recommendation-event`

**Principe** : créer une fonction dédiée, `requireUser`, qui valide les événements et insère en DB avec JWT utilisateur.

| Aspect | Analyse |
|---|---|
| Avantages | Validation centralisée, déduplication serveur, bonne séparation des responsabilités, utile pour décisions opérateur futures |
| Inconvénients | Nouvelle fonction, nouveau déploiement, surface de maintenance supplémentaire |
| Sécurité | Forte si `requireUser`, userClient, RLS, pas de service role |
| Idempotence | Forte : la fonction peut normaliser `dedupe_key` et gérer les conflits |
| Verdict | **Recommandé pour les décisions opérateur futures** (`accepted/rejected/modified/manual_override`) |

### 8.3 Option C — Extension de `get-pad-nst-suggestions`

**Principe** : la fonction C-B journalise elle-même `recommendation_requested`, `recommendation_empty` et `recommendation_emitted` au moment où elle retourne les suggestions.

| Aspect | Analyse |
|---|---|
| Avantages | Snapshot exact, pas de recalcul, cohérence forte entre réponse UI et audit log, meilleur point pour logs d'émission |
| Inconvénients | Modifie une fonction C-B déjà vérifiée ; nécessite GO CTO séparé ; il faut décider si l'échec de log bloque la réponse |
| Sécurité | Bonne si même pattern `requireUser` + userClient + RLS, sans service role |
| Idempotence | Forte si `request_id` est exigé ou généré côté fonction |
| Verdict | **Recommandé pour les événements de recherche et d'émission**, mais uniquement en phase `C-B-LOG-2` après migration |

### 8.4 Recommandation d'architecture

Architecture recommandée en trois temps :

```text
C-B-LOG-1  Migration seule
           table + RLS + index + contraintes

C-B-LOG-2  Extension get-pad-nst-suggestions
           logs requested / empty / emitted

C-B-LOG-3  Edge Function dédiée log-pad-nst-recommendation-event
           logs copied / accepted / rejected / modified / manual_override
```

Ne pas tout mélanger dans une seule phase.

---

## 9. Impacts futurs sur C-D

### 9.1 Impacts minimaux nécessaires

C-D devra probablement recevoir ou déduire :

- `case_id` ;
- `request_id` par recherche ;
- `related_event_id` des suggestions émises si une action opérateur future doit être liée précisément à une suggestion ;
- statut de log éventuel pour diagnostic C-E.

### 9.2 Ce qui ne doit pas changer dans C-D

Même après activation du log :

- le bouton « Copier » reste clipboard-only ;
- pas d'appel à `set-case-fact` ;
- pas de `run-pricing` ;
- pas d'écriture dans `pad_designation_aliases` ;
- pas de passage automatique en `OFFICIAL` ;
- pas de montant ;
- pas d'inclusion dans les totaux.

### 9.3 UI future possible

Une phase future pourrait ajouter une petite mention non bloquante :

```text
Recherche journalisée pour audit qualité PAD-NST.
```

Cette mention n'est pas nécessaire en C-B-LOG-1 migration.

---

## 10. Impacts futurs sur C-E

C-E doit utiliser le log pour produire des métriques terrain :

| Métrique | Source log |
|---|---|
| Nombre de recherches NST par dossier | `recommendation_requested` |
| Taux de couverture | `recommendation_emitted` vs `recommendation_empty` |
| Taux d'acceptation | `operator_accepted / recommendation_emitted` |
| Taux de rejet | `operator_rejected / recommendation_emitted` |
| Taux de modification | `operator_modified / recommendation_emitted` |
| Codes NST problématiques | group by `nst_level,nst_code` sur rejets/modifications |
| Catégories PAD souvent corrigées | `recommended_pad_category` vs `operator_pad_category` |
| Confidence réellement fiable | décision opérateur par bucket confidence |
| Familles conflictuelles P1-C | croisement `nst_code` avec dictionnaire conflits |

C-E ne doit pas s'appuyer sur impressions UI, captures d'écran ou mémoire opérateur si le log est disponible.

---

## 11. Impacts futurs sur C-C

Le log est un prérequis de gouvernance avant tout branchement `run-pricing`, mais il ne rend pas C-C acceptable à lui seul.

Avant C-C, il faudra cumulativement :

1. C-B-LOG opérationnel ;
2. C-E réalisé sur dossiers réels ;
3. seuil de confiance explicitement arbitré ;
4. conflits P1-C traités ou affichés ;
5. doctrine `TO_CONFIRM`, `amount=0`, `requires_operator_confirmation=true` maintenue ;
6. GO CTO explicite C-C.

---

## 12. Tests attendus pour C-B-LOG-1 future migration

### 12.1 Tests SQL structurels

- table créée ;
- RLS activée ;
- policies SELECT/INSERT présentes ;
- aucune policy UPDATE ;
- aucune policy DELETE ;
- unique `dedupe_key` actif ;
- contraintes `event_type`, `nst_level`, `confidence`, `source_type`, `requires_operator_confirmation` actives.

### 12.2 Tests RLS

| Test | Attendu |
|---|---|
| utilisateur authentifié SELECT | OK |
| utilisateur authentifié INSERT avec `actor_user_id=auth.uid()` | OK |
| utilisateur authentifié INSERT avec autre `actor_user_id` | refusé |
| utilisateur authentifié UPDATE | refusé |
| utilisateur authentifié DELETE | refusé |
| anon INSERT | refusé |

### 12.3 Tests d'idempotence

- deux inserts même `dedupe_key` → un seul événement ;
- retry identique → succès idempotent côté fonction future ;
- retry payload différent pour décision future → conflit explicite.

---

## 13. Exclusions strictes de C-B-LOG-0

Cette phase documentaire ne doit contenir :

- aucune migration ;
- aucune écriture DB ;
- aucune modification `src/` ;
- aucune modification `supabase/functions/` ;
- aucune modification `config.toml` ;
- aucun `run-pricing` ;
- aucun `quotation-engine` ;
- aucun C-C ;
- aucun commit/push automatique.

---

## 14. Mise à jour backlog recommandée

Mettre à jour uniquement `docs/DEFERRED_BACKLOG.md` pour indiquer :

```text
PAD-NST-2E-C-B-LOG-0 — SPEC LIVRÉE.
Aucune migration créée.
Aucune implémentation.
Aucune écriture DB.
Attente GO CTO séparé pour C-B-LOG-1 migration.
```

Ne pas marquer `PAD-NST-2E-C-B-LOG` comme déployé.

---

## 15. Références repo

| Source | Rôle |
|---|---|
| `docs/MASTER_CONTEXT.md` | Doctrine générale : assistant structurant, pas d'auto-send, pas d'auto-update facts, idempotence, shared workspace |
| `docs/SECURITY_CONTRACT.md` | Pattern `verify_jwt=false + requireUser`, shared authenticated operator workspace, classification C-B |
| `docs/DEFERRED_BACKLOG.md` | Statut NO-GO temporaire C-B-LOG, C-C NO-GO strict |
| `docs/tariff-collection/pad/PAD_NST_2E_C_A_RUNTIME_PLAN.md` | Structure indicative initiale de `pad_recommendation_audit_log` |
| `docs/tariff-collection/pad/PAD_NST_2E_C_B_VERIFICATION_REPORT.md` | Contrat C-B : SELECT only, TO_CONFIRM, no service role, no DB write |
| `docs/tariff-collection/pad/PAD_NST_2E_C_D_UI_OPERATOR_SPEC.md` | Contrat C-D : UI opérateur, suggestions TO_CONFIRM, pas d'auto-validation |
| `supabase/functions/get-pad-nst-suggestions/index.ts` | Implémentation C-B lue : POST only, validation NST, SELECT rules, réponse TO_CONFIRM |
| `src/components/case/PadNstSuggestionsPanel.tsx` | Implémentation C-D lue : frontend-only, appel explicite, clipboard-only |
| `src/components/case/padNstConstants.ts` | Implémentation C-D lue : labels, confidence tiers, conflits P1-C |

---

## 16. Conclusion

`PAD-NST-2E-C-B-LOG-0` peut être considéré comme **livré** lorsque ce document est ajouté au repo et que le backlog est mis à jour.

La suite recommandée est une phase **C-B-LOG-1 migration-only**, strictement limitée à la création de la table append-only, de ses contraintes, index et policies RLS.

Toute journalisation effective depuis C-B ou C-D doit rester bloquée jusqu'à un GO CTO séparé.
