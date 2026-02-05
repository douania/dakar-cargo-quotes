

## Plan: Migration JSR Globale — Correction Erreurs esm.sh

### Contexte
L'erreur de build actuelle est causée par `esm.sh` qui retourne des erreurs 500, empêchant le déploiement des Edge Functions :
```
Import 'https://esm.sh/@supabase/supabase-js@2.95.0' failed: 500 Internal Server Error
at file:///dev-server/supabase/functions/_shared/supabase.ts:1:30
```

### Changement Technique
**Remplacement unique dans tous les fichiers concernés :**

| Avant | Après |
|-------|-------|
| `import { createClient } from "https://esm.sh/@supabase/supabase-js@2";` | `import { createClient } from "jsr:@supabase/supabase-js@2";` |

### Fichiers à Modifier

**Fichier critique (cause racine) :**
- `supabase/functions/_shared/supabase.ts`

**Autres fichiers utilisant l'import direct :**
- `supabase/functions/hs-lookup/index.ts`
- `supabase/functions/market-surveillance/index.ts`
- `supabase/functions/learn-from-contact/index.ts`

### Règles Strictes
- Aucune modification de logique métier
- Aucun refactoring
- Aucun changement de version
- Uniquement remplacement d'import

### Résultat Attendu
- Build des Edge Functions réussi
- Fin des erreurs "Failed to fetch" côté UI
- Page `/quotation/...` fonctionnelle

