

# Phase 16 -- Etape D.5 : Commit container

## Contexte

- Case ID : `d14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1`
- Status actuel : `DECISIONS_PENDING`
- `operator_decisions` actuelles : 4 (regime + routing + services + incoterm deja committes)
- Objectif : committer la decision `container` (5e et derniere sur 5) -- dernier commit avant le gate pricing

## Actions a executer (sequentielles)

### Action 1 -- Appel suggest-decisions (container)

Appeler l'Edge Function `suggest-decisions` avec :
- `case_id` = `d14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1`
- `decision_types` = `["container"]`

Extraire du JSON retourne :
- `decision_type`
- `options[]` (toutes les options avec leurs `key`, `label_fr`, `confidence_level`, `is_recommended`)
- L'option avec `is_recommended: true` = `selected_key`

### Action 2 -- Appel commit-decision

Appeler l'Edge Function `commit-decision` avec :
- `case_id` = `d14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1`
- `decision_type` = `container`
- `selected_key` = la cle de l'option recommandee (extraite a l'etape 1)
- `proposal_json` = le JSON complet de la proposal container
- `operator_notes` = null

### Action 3 -- Verification post-commit

Requetes SQL de verification :
- `SELECT status FROM quote_cases WHERE id = 'd14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1'`
- `SELECT count(*) FROM operator_decisions WHERE case_id = 'd14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1'`

### Resultats attendus

| Element | Valeur attendue |
|---------|-----------------|
| `operator_decisions` | 5 |
| `quote_cases.status` | `DECISIONS_COMPLETE` |
| Commit response `ok` | `true` |
| `remaining_decisions` | 0 |
| `all_complete` | `true` |

## Enchainement

Des que D.5 est confirme avec `DECISIONS_COMPLETE`, on peut lancer le gate pricing via `ack-pricing-ready`.

## Section technique

Meme pattern que D.1 a D.4 : `suggest-decisions` stateless (SELECT only), puis `commit-decision` via RPC `commit_decision_atomic` avec verrou transactionnel. Le 5e commit declenche la transition automatique du status vers `DECISIONS_COMPLETE`.
