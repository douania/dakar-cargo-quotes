

# COCKPIT-11C — Micro-correctif déduplication origin charges

## Diagnostic

La réserve mineure signalée est confirmée dans le code.

Le regex de déduplication (ligne 146) :
```
/origin charges\s+d[eé]taill[eé]s(\s*\(.*?\))?/g
```

Normalise :
- `"Origin charges détaillés (THC, manutention, documentation)"` → `"origin charges"`
- `"Origin charges détaillés au départ"` → `"origin charges au départ"` (le suffixe " au départ" n'est pas capturé)

Résultat : les deux ne sont PAS dédupliquées. Sur un dossier freight avec scope origin_charges en medium/high, le bloc principal contiendra les deux lignes — redondance visible.

## Correctif

Modifier le regex dans les deux fichiers template pour capturer aussi le suffixe " au départ" :

```typescript
s = s.replace(/origin charges\s+d[eé]taill[eé]s(\s*\(.*?\))?(\s+au départ)?/g, "origin charges");
```

## Fichiers impactés

| Fichier | Changement |
|---------|-----------|
| `src/lib/partnerEmailTemplate.ts` | 1 regex (ligne 146) |
| `supabase/functions/_shared/partner-email-template.ts` | 1 regex (même ligne) |

Aucune migration. Aucune zone FROZEN. Aucun autre fichier. Backward compatible.

