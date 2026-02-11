

# Phase V4.1.3 — Debloquer la transition READY_TO_PRICE

## Diagnostic

Le dossier `4f2baa5b` reste bloque en `FACTS_PARTIAL` malgre 0 blocking gaps et 8 facts valides.

**Cause racine** : dans `build-case-puzzle` (ligne 992-1019), le code fait un `return` premature des qu'il y a **un seul** `factError`, meme non-critique. Deux facts echouent a cause de categories invalides :

- `carrier.name` avec categorie `carrier` (pas dans la liste autorisee)
- `survey.required` avec categorie `survey` (pas dans la liste autorisee)

Categories autorisees actuellement : `cargo`, `routing`, `timing`, `pricing`, `documents`, `contacts`, `other`, `service`, `regulatory`.

Ces erreurs sont marquees `isCritical: false`, mais le code bloque quand meme la progression du dossier et retourne `FACTS_PARTIAL` sans jamais atteindre la logique de gap-checking et de transition de statut.

## Solution en deux volets

### Volet 1 : Migration base de donnees

Ajouter les categories manquantes au check constraint `quote_facts_fact_category_check` :

```sql
ALTER TABLE quote_facts DROP CONSTRAINT quote_facts_fact_category_check;
ALTER TABLE quote_facts ADD CONSTRAINT quote_facts_fact_category_check
  CHECK (fact_category IN (
    'cargo', 'routing', 'timing', 'pricing', 'documents',
    'contacts', 'other', 'service', 'regulatory',
    'carrier', 'survey'
  ));
```

Cela permet a `carrier.name` et `survey.required` d'etre inseres sans erreur.

### Volet 2 : Patch build-case-puzzle (securite)

Modifier la logique de blocage (lignes 992-1019) pour ne bloquer que sur les erreurs **critiques**, pas les erreurs non-critiques :

**Avant** (comportement actuel) :
```typescript
if (factErrors.length > 0) {
  // ... early return FACTS_PARTIAL (TOUJOURS)
}
```

**Apres** (comportement corrige) :
```typescript
if (factErrors.length > 0) {
  const criticalErrors = factErrors.filter(e => e.isCritical);
  console.error(`${factErrors.length} fact errors ...`);

  // Only block on CRITICAL errors, not all errors
  if (criticalErrors.length > 0) {
    // ... early return FACTS_PARTIAL
  }
  // Non-critical errors: log and continue to gap analysis
}
```

### Impact

| Element | Modification |
|---|---|
| Migration SQL | 1 migration (drop + recreate constraint) |
| build-case-puzzle | ~5 lignes modifiees (condition if) |
| Autres fichiers | Zero changement |
| Frontend | Zero modification |

### Validation E2E

1. Appliquer la migration (ajout categories `carrier`, `survey`)
2. Redeployer `build-case-puzzle`
3. Relancer "Analyser la demande" sur le dossier `4f2baa5b`
4. Verifier que le statut passe a `READY_TO_PRICE`
5. Continuer le workflow : valider decisions, debloquer pricing, lancer pricing
6. Verifier que le patch V4.1.2 (city-to-zone) resout le tarif transport

