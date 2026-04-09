

# TARIFF-COHERENCE-1 — Correction prudente des recouvrements package / lignes moteur

## Diagnostic confirmé sur le code réel

**Fichier : `supabase/functions/run-pricing/index.ts`**

1. **Canonicalisation THC absente** — `ENGINE_CATEGORY_TO_SERVICE_KEY` (L124-134) ne contient pas `'Terminal (DPW)'` ni `'Terminal'`. Résultat : les lignes moteur THC import obtiennent `service_key = null`, `dedup_group = null`.

2. **Déduplication par couverture, pas par confiance** — La logique n'est pas un merge avec tri par confiance. C'est un mécanisme de *skip* : `inferCoveredServiceDiagnostics()` (L183) collecte les `dedup_group` des lignes moteur dans un `Set<string>`. Puis les lignes package dont le `service_key` est dans ce set sont simplement **non ajoutées**. Donc pas besoin de trier par confiance — la ligne moteur (officielle) prévaut automatiquement car elle est déjà présente et la ligne package est sautée.

3. **`DEDUP_GROUP_MAP`** (L288-307) ne contient pas `'DTHC'` → quand une ligne moteur serait canonicalisée en `service_key = 'DTHC'`, son `dedup_group` tomberait en fallback sur `'DTHC'` (L379: `DEDUP_GROUP_MAP[serviceKey] || serviceKey`). C'est suffisant pour la couverture, mais ajouter explicitement `'DTHC': 'TERMINAL_HANDLING'` dans le map est plus propre et prépare le regroupement futur.

**Fichier : `src/pages/case-view/helpers.ts`** (L47-49)

4. `DAP_PROJECT_IMPORT` whitelist contient `SEA_FREIGHT` et `DISCHARGE` — confirmé, à retirer.

## Plan d'exécution

### Étape 1 — Canonicalisation THC moteur

**Fichier** : `supabase/functions/run-pricing/index.ts` (L124-134)

Ajouter dans `ENGINE_CATEGORY_TO_SERVICE_KEY` :
```typescript
'Terminal (DPW)': 'DTHC',
'Terminal': 'DTHC',
```

**Effet** : les lignes moteur THC import reçoivent `service_key = 'DTHC'` → `dedup_group = 'DTHC'` (ou `'TERMINAL_HANDLING'` après étape 2) → `inferCoveredServiceDiagnostics` marque DTHC comme couvert → la ligne package DTHC est sautée.

### Étape 2 — Déduplication explicite DTHC uniquement

**Fichier** : `supabase/functions/run-pricing/index.ts` (L288-307)

Ajouter dans `DEDUP_GROUP_MAP` :
```typescript
'DTHC': 'TERMINAL_HANDLING',
```

**Ne PAS ajouter** `'PORT_DAKAR_HANDLING': 'TERMINAL_HANDLING'` — doctrine métier non validée.

### Étape 3 — Pas de correctif confiance nécessaire

La logique de déduplication est un *skip* (pas un merge). La ligne moteur officielle est déjà dans le résultat, la ligne package est simplement non ajoutée si couverte. Aucun correctif nécessaire.

### Étape 4 — Nettoyage whitelist DAP_PROJECT_IMPORT

**Fichier** : `src/pages/case-view/helpers.ts` (L47-49)

```typescript
DAP_PROJECT_IMPORT: new Set([
  'SURVEY', 'AGENCY', 'PORT_CHARGES', 'ON_CARRIAGE',
]),
```

### Étape 5 — PORT_DAKAR_HANDLING laissé intact

Aucune modification. Point de décision reporté.

### Étape 6 — Documentation

- `.lovable/plan.md` : clôture TARIFF-COHERENCE-1
- `docs/DEFERRED_BACKLOG.md` : dette métier PORT_DAKAR_HANDLING vs DTHC

## Fichiers impactés

| Fichier | Changement |
|---------|-----------|
| `supabase/functions/run-pricing/index.ts` | +2 entrées canonicalisation, +1 entrée dedup (~3 lignes) |
| `src/pages/case-view/helpers.ts` | Retrait SEA_FREIGHT + DISCHARGE (~1 ligne) |
| `.lovable/plan.md` | Documentation |
| `docs/DEFERRED_BACKLOG.md` | Dette métier |

Aucune migration. Aucune zone FROZEN. Aucun nouveau composant. Backward compatible.

## Résultat attendu

- La ligne package DTHC disparaît quand la ligne moteur THC import officielle est présente
- SEA_FREIGHT et DISCHARGE disparaissent des extras UI pour DAP_PROJECT_IMPORT
- PORT_DAKAR_HANDLING reste inchangé

