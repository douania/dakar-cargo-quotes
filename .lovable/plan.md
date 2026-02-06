

# Phase 16 -- Etape E : Pricing

## Contexte

- Case ID : `d14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1`
- Status actuel : `DECISIONS_COMPLETE`
- `operator_decisions` : 5/5 (regime, routing, services, incoterm, container)
- Objectif : debloquer le gate pricing puis lancer le moteur de calcul

## Actions a executer (sequentielles)

### Action 1 -- Gate pricing : ack-pricing-ready

Appeler l'Edge Function `ack-pricing-ready` avec :
- `case_id` = `d14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1`

Verification :
- Reponse JSON doit confirmer le deblocage
- `quote_cases.status` doit passer a `ACK_READY_FOR_PRICING`

### Action 2 -- Lancement pricing : run-pricing

Si le statut est `ACK_READY_FOR_PRICING`, appeler l'Edge Function `run-pricing` avec :
- `case_id` = `d14b1e46-eef7-48f1-9ff6-cf1d2d1b7da1`

Verification post-pricing :
- Reponse JSON avec `pricing_run_id`, `run_number`, `total_ht`, `total_ttc`, `lines_count`
- `quote_cases.status` = `PRICED_DRAFT`
- `pricing_runs` count = 1

### Action 3 -- Verification finale Phase 16

Requetes SQL :
- `SELECT status FROM quote_cases WHERE id = '...'`
- `SELECT count(*) FROM pricing_runs WHERE case_id = '...'`
- `SELECT count(*) FROM operator_decisions WHERE case_id = '...'`

### Resultats attendus

| Element | Valeur attendue |
|---------|-----------------|
| `quote_cases.status` | `PRICED_DRAFT` |
| `pricing_runs` | 1 |
| `operator_decisions` | 5 |

## Section technique

Le gate `ack-pricing-ready` verifie que les 5 decisions sont finalisees et que le statut est `DECISIONS_COMPLETE` avant de transitionner vers `ACK_READY_FOR_PRICING`. Ensuite `run-pricing` execute le moteur `quotation-engine`, stocke le snapshot des faits, les resultats tarifaires, et transitionne vers `PRICED_DRAFT`. En cas d'echec du moteur, le statut est rollback a `ACK_READY_FOR_PRICING` via le mecanisme de compensation.

