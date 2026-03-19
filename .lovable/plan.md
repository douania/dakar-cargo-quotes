

# CL2-final A+ — Correctif v3 : 2 bugs bloquants

## Bug 1 — `claimTs` hors scope dans les catch

### BG mode (`analyzeAttachmentInBackground`, L607-952)

- **Actuel** : `const claimTs` déclaré L630 dans le `try`, référencé L950 dans le `catch`
- **Fix** : Déclarer `let claimTs: string | null = null;` avant le `try` (L608). Assigner `claimTs = new Date().toISOString()` à L630. Dans le catch, conditionner le release par `if (claimTs)`.

### Sync mode (`processAttachmentsLoop`, L1149-1721)

- **Actuel** : `const claimTs` déclaré L1178 dans le `try`, référencé L1714 dans le `catch`
- **Fix** : Déclarer `let claimTs: string | null = null;` au début du `for` body (L1150, avant le `try`). Assigner `claimTs = new Date().toISOString()` à L1178. Dans le catch L1707, conditionner le release par `if (claimTs)`.

## Bug 2 — `storePackingListKnowledge` après finalisation

### BG mode (L922-938)

- **Actuel** : L923-933 = final update `is_analyzed=true`, puis L936-938 = `storePackingListKnowledge`
- **Fix** : Déplacer le bloc `storePackingListKnowledge` (L935-938) **avant** le final update (avant L923). L'ordre devient : quotation_history → storePackingListKnowledge → final update.

### Sync mode (L1669-1705)

- **Actuel** : L1669-1683 = final update, puis L1692-1695 = `storePackingListKnowledge` (à l'intérieur du `else if (finalized)`)
- **Fix** : Extraire `storePackingListKnowledge` du bloc conditionnel `finalized` et le placer **avant** le final update (avant L1669). L'ordre correct : quotation_history → transport_rates → storePackingListKnowledge → final update.

## Résumé des 4 modifications

| Lieu | Changement |
|------|-----------|
| BG L608 | `let claimTs: string | null = null;` avant try |
| BG L935-938 → avant L923 | storePackingListKnowledge avant final update |
| BG catch L946-950 | `if (claimTs) { ... }` |
| Sync L1150 | `let claimTs: string | null = null;` avant try |
| Sync L1692-1695 → avant L1669 | storePackingListKnowledge avant final update |
| Sync catch L1710-1714 | `if (claimTs) { ... }` |

## Ce qui ne change pas

Tout le reste du fichier, migration SQL, plan.md, aucun autre fichier.

