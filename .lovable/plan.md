

# Relancer le pricing sur LCL 25607 (case acddafa7)

## Probleme identifie

Le case est en statut `PRICED_DRAFT` mais `run-pricing` exige strictement `ACK_READY_FOR_PRICING`. Il est impossible de relancer le pricing apres une correction sans repasser par tout le workflow.

## Correctif necessaire

### Fichier : `supabase/functions/run-pricing/index.ts` (ligne 103)

Elargir le guard FSM pour accepter le re-pricing depuis `PRICED_DRAFT` et `HUMAN_REVIEW` :

```text
// Avant (trop strict)
if (caseData.status !== "ACK_READY_FOR_PRICING") { ... }

// Apres (permet le re-pricing)
const pricingAllowedStatuses = ["ACK_READY_FOR_PRICING", "PRICED_DRAFT", "HUMAN_REVIEW"];
if (!pricingAllowedStatuses.includes(caseData.status)) { ... }
```

### Apres deploiement

Appeler `run-pricing` avec `case_id: acddafa7-11f4-4971-bd12-89d4de040cb5` pour declencher le recalcul avec :
- Conversion EUR vers FCFA (4 655 EUR x 655.957 = ~3 053 480 FCFA)
- Base TVA complete (DD + surtaxe + RS + TIN + TCI)

## Risque

Minimal. L'ajout de `PRICED_DRAFT` comme statut accepte est logique : un operateur doit pouvoir relancer le pricing apres correction des formules ou des facts. Le guard des gaps bloquants reste actif (ligne 114+).

## Resume

| Action | Detail |
|---|---|
| Modifier run-pricing FSM | Accepter PRICED_DRAFT et HUMAN_REVIEW |
| Deployer run-pricing | Automatique |
| Appeler run-pricing | case_id = acddafa7 |
| Resultat attendu | CAF ~3 053 480 FCFA, droits corriges |

