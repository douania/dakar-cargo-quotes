

# Fix : Ajouter READY_TO_PRICE dans les statuts autorisés de run-pricing

## Diagnostic

L'erreur 400 est explicite :

```text
current_status: "READY_TO_PRICE"
allowed_statuses: ["ACK_READY_FOR_PRICING", "PRICED_DRAFT", "HUMAN_REVIEW", "QUOTED_VERSIONED", "SENT"]
```

Le statut `READY_TO_PRICE` a ete introduit par `build-case-puzzle` mais jamais ajoute a la whitelist de `run-pricing`.

## Correction

**Fichier** : `supabase/functions/run-pricing/index.ts`

Ajouter `"READY_TO_PRICE"` dans le tableau `pricingAllowedStatuses` (ligne 100) :

```text
const pricingAllowedStatuses = [
  "READY_TO_PRICE",
  "ACK_READY_FOR_PRICING",
  "PRICED_DRAFT",
  "HUMAN_REVIEW",
  "QUOTED_VERSIONED",
  "SENT",
];
```

## Impact

- 1 ligne ajoutee, zero risque de regression
- Les deux chemins (`READY_TO_PRICE` via puzzle et `ACK_READY_FOR_PRICING` via decisions manuelles) seront acceptes
- Deploiement automatique apres modification

