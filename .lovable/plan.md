
# Correctif : total_ht doit refléter le coût global (DDP) pour le client

## Diagnostic

Le moteur quotation-engine calcule correctement deux totaux :
- `dap = 191 191 FCFA` (honoraires + operationnel + border + terminal)
- `ddp = 1 015 020 FCFA` (dap + debours/droits de douane)

Mais `run-pricing` stocke `total_ht = totals.dap` pour les incoterms non-DDP (CIF, FOB, etc.), ce qui masque les 823 829 FCFA de droits et taxes dans le total affiché.

Pour Sodatra (transitaire qui avance les droits de douane), le total pertinent est toujours le **DDP** car le client paie l'ensemble.

## Correctif propose

### Fichier : `supabase/functions/run-pricing/index.ts` (lignes 317-321)

Remplacer la logique conditionnelle DAP/DDP par un total qui inclut toujours les debours :

```text
// Avant
const isDDP = incotermUpper === "DDP";
const totalHt = isDDP
  ? (engineTotals?.ddp ?? ...)
  : (engineTotals?.dap ?? ...);

// Apres — Sodatra facture toujours honoraires + debours
const totalHt = engineTotals?.ddp
  ?? tariffLines.reduce((sum, l) => sum + (l.amount || 0), 0);
```

L'information DAP/DDP reste disponible dans `outputs_json.totals` pour l'affichage detaille (ventilation honoraires vs debours).

## Impact

| Champ | Avant | Apres |
|---|---|---|
| total_ht (pricing_runs) | 191 191 FCFA (DAP) | 1 015 020 FCFA (DDP) |
| outputs_json.totals.dap | 191 191 | 191 191 (inchange) |
| outputs_json.totals.ddp | 1 015 020 | 1 015 020 (inchange) |
| outputs_json.totals.debours | 823 829 | 823 829 (inchange) |

## Risque

Minimal. Les totaux detailles (dap, ddp, debours) restent stockes dans outputs_json pour tout besoin de ventilation. Seul le champ `total_ht` de la table `pricing_runs` change pour refleter le vrai cout client.

## Apres deploiement

Relancer le pricing sur le case acddafa7 pour obtenir le total corrige.
