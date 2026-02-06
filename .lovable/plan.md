

# Phase 16 -- Etape D.3 : Commit services

## Contexte

- Case ID : `d14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1`
- Status actuel : `DECISIONS_PENDING`
- `operator_decisions` actuelles : 2 (regime + routing deja committes)
- Objectif : committer la decision `services` (3e sur 5)

## Actions a executer (sequentielles)

### Action 1 -- Appel suggest-decisions (services)

Appeler l'Edge Function `suggest-decisions` avec :
- `case_id` = `d14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1`
- `decision_types` = `["services"]`

Extraire du JSON retourne :
- `decision_type`
- `options[]` (toutes les options avec leurs `key`, `label_fr`, `confidence_level`, `is_recommended`)
- L'option avec `is_recommended: true` = `selected_key`

### Action 2 -- Appel commit-decision

Appeler l'Edge Function `commit-decision` avec :
- `case_id` = `d14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1`
- `decision_type` = `services`
- `selected_key` = la cle de l'option recommandee (extraite a l'etape 1)
- `proposal_json` = le JSON complet de la proposal services
- `operator_notes` = null

Note : le champ s'appelle `proposal_json` (et non `proposal_snapshot`), conformement au contrat de l'Edge Function `commit-decision` valide lors de D.2.

### Action 3 -- Verification post-commit

Requetes SQL de verification :
- `SELECT status FROM quote_cases WHERE id = 'd14b1e46-...'`
- `SELECT count(*) FROM operator_decisions WHERE case_id = 'd14b1e46-...'`

### Resultats attendus

| Element | Valeur attendue |
|---------|-----------------|
| `operator_decisions` | 3 |
| `quote_cases.status` | `DECISIONS_PENDING` |
| Commit response `ok` | `true` |
| `remaining_decisions` | 2 |

## Enchainement

Des que D.3 est confirme, on lance immediatement D.4 (incoterm).

## Section technique

Meme pattern que D.1 et D.2 : `suggest-decisions` stateless (SELECT only), puis `commit-decision` via RPC `commit_decision_atomic` avec verrou transactionnel. Le champ `proposal_json` contient le snapshot complet de la proposal pour tracabilite forensique.

