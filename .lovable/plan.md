

# Phase 16 -- Etape D.4 : Commit incoterm

## Contexte

- Case ID : `d14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1`
- Status actuel : `DECISIONS_PENDING`
- `operator_decisions` actuelles : 3 (regime + routing + services deja committes)
- Objectif : committer la decision `incoterm` (4e sur 5)

## Actions a executer (sequentielles)

### Action 1 -- Appel suggest-decisions (incoterm)

Appeler l'Edge Function `suggest-decisions` avec :
- `case_id` = `d14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1`
- `decision_types` = `["incoterm"]`

Extraire du JSON retourne :
- `decision_type`
- `options[]` (toutes les options avec leurs `key`, `label_fr`, `confidence_level`, `is_recommended`)
- L'option avec `is_recommended: true` = `selected_key`

### Action 2 -- Appel commit-decision

Appeler l'Edge Function `commit-decision` avec :
- `case_id` = `d14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1`
- `decision_type` = `incoterm`
- `selected_key` = la cle de l'option recommandee (extraite a l'etape 1)
- `proposal_json` = le JSON complet de la proposal incoterm
- `operator_notes` = null

### Action 3 -- Verification post-commit

Requetes SQL de verification :
- `SELECT status FROM quote_cases WHERE id = 'd14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1'`
- `SELECT count(*) FROM operator_decisions WHERE case_id = 'd14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1'`

### Resultats attendus

| Element | Valeur attendue |
|---------|-----------------|
| `operator_decisions` | 4 |
| `quote_cases.status` | `DECISIONS_PENDING` |
| Commit response `ok` | `true` |
| `remaining_decisions` | 1 |

## Enchainement

Des que D.4 est confirme, on lance immediatement D.5 (container) -- dernier commit avant le gate pricing.

## Section technique

Meme pattern que D.1 a D.3 : `suggest-decisions` stateless (SELECT only), puis `commit-decision` via RPC `commit_decision_atomic` avec verrou transactionnel. Le champ `proposal_json` contient le snapshot complet de la proposal pour tracabilite forensique.

