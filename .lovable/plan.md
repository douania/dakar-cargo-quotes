

## Diagnostic

| Élément | Valeur |
|---------|--------|
| Case ID | `ae8a1acc-9913-4bce-a1ee-9d0b6ee3af64` |
| Statut actuel | `READY_TO_PRICE` |
| Gate UI (après Patch 1) | `ACK_READY_FOR_PRICING` uniquement |
| Gate backend (après Patch 1) | `ACK_READY_FOR_PRICING` uniquement |

**Cause** : Le Patch 1 a retiré `READY_TO_PRICE` des statuts autorisés, mais les dossiers existants dans ce statut n'ont jamais transité par `ack-pricing-ready` (qui exige `DECISIONS_COMPLETE`). Résultat : impasse.

## Fix — Rétablir la compatibilité ascendante (2 fichiers, 0 migration)

### 1. `src/pages/CaseView.tsx` — ligne 1687

Accepter les deux statuts pour afficher le panel pricing :

```typescript
// AVANT
{caseData.status === 'ACK_READY_FOR_PRICING' && (

// APRÈS
{['READY_TO_PRICE', 'ACK_READY_FOR_PRICING'].includes(caseData.status) && (
```

### 2. `supabase/functions/run-pricing/index.ts` — `pricingAllowedStatuses`

Remettre `READY_TO_PRICE` dans la liste :

```typescript
const pricingAllowedStatuses = [
  "READY_TO_PRICE",           // legacy — dossiers pré-ACK
  "ACK_READY_FOR_PRICING",    // nouveau flow avec gate ACK
  "PRICED_DRAFT",
  "HUMAN_REVIEW",
  "QUOTED_VERSIONED",
  "SENT",
];
```

### Pourquoi c'est safe

- Les dossiers **nouveaux** passent par le flow complet (decisions → ACK → pricing)
- Les dossiers **existants** déjà `READY_TO_PRICE` peuvent être chiffrés sans blocage
- Zéro migration, zéro RLS, compatibilité totale

