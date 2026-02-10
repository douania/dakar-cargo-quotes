

# Correction CTO -- Nettoyage export + tests

## Contexte

L'export `findLocalTransportRate` et le fichier de test `transport_resolver_test.ts` doivent etre retires pour eviter des problemes de bundling Supabase. Les 4 tests ont deja passe avec succes -- le fichier de test n'est plus necessaire en production.

## Actions

### Action 1 -- Retirer l'export (1 ligne)

**Fichier** : `supabase/functions/price-service-lines/index.ts`

Supprimer la ligne 1324 :

```text
export { findLocalTransportRate };
```

La fonction reste intacte et privee dans le fichier. Zero impact sur la logique de pricing.

### Action 2 -- Supprimer le fichier de test

**Fichier** : `supabase/functions/_tests/transport_resolver_test.ts`

Suppression complete. Le fichier utilise deja une copie snapshot de la fonction (pas d'import depuis index.ts), donc aucune dependance croisee.

### Action 3 -- Redeploiement

Le deploiement de `price-service-lines` sera automatique apres les modifications.

## Impact

| Element | Statut |
|---|---|
| Logique pricing | Zero modification |
| Cascade transport resolver | Intacte |
| Corrections CTO A et B | Intactes |
| Tests (deja passes 4/4) | Retires du bundle |
| Frontend | Zero modification |

## Fichiers modifies

| Fichier | Action |
|---|---|
| `supabase/functions/price-service-lines/index.ts` | Supprimer ligne 1324 (`export`) |
| `supabase/functions/_tests/transport_resolver_test.ts` | Supprimer le fichier |

