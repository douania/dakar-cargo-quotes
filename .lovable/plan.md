

# Phase 16 -- Etape D.2 : Commit routing

## Contexte

- Case ID : `d14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1`
- Status actuel : `DECISIONS_PENDING`
- `operator_decisions` actuelles : 1 (regime deja committe)
- Objectif : committer la decision `routing` (2e sur 5)

## Actions a executer (sequentielles)

### Action 1 -- Appel suggest-decisions (routing)

Appeler l'Edge Function `suggest-decisions` avec :
- `case_id` = `d14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1`
- `decision_types` = `["routing"]`

Extraire du JSON retourne :
- `decision_type`
- `options[]` (toutes les options avec leurs `key`, `label_fr`, `confidence_level`, `is_recommended`)
- L'option avec `is_recommended: true` = `selected_key`

### Action 2 -- Appel commit-decision

Appeler l'Edge Function `commit-decision` avec :
- `case_id` = `d14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1`
- `decision_type` = `routing`
- `selected_key` = la cle de l'option recommandee (extraite a l'etape 1)
- `proposal_snapshot` = le JSON complet de la proposal routing
- `operator_notes` = null

### Action 3 -- Verification post-commit

Requetes SQL de verification :
- `SELECT status FROM quote_cases WHERE id = 'd14b1e46-...'`
- `SELECT count(*) FROM operator_decisions WHERE case_id = 'd14b1e46-...'`

### Resultats attendus

| Element | Valeur attendue |
|---------|-----------------|
| `operator_decisions` | 2 |
| `quote_cases.status` | `DECISIONS_PENDING` |
| Commit response `ok` | `true` |
| `remaining_decisions` | 3 |

## Enchainement

Des que D.2 est confirme, on lance immediatement D.3 (services).

## Section technique

Les appels utilisent le pattern d'authentification standard : JWT propage via header Authorization. `suggest-decisions` est stateless (SELECT only), `commit-decision` ecrit via la RPC `commit_decision_atomic` avec verrou transactionnel. Le `selected_key` est la valeur `key` de l'option `is_recommended: true` dans la reponse IA.

