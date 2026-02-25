

# Plan : 2 micro-hardenings CTO post-revue P2

Deux corrections chirurgicales identifiees dans la revue CTO. Aucun changement de logique metier.

## Hardening A — items selector robuste (build-case-puzzle)

**Fichier** : `supabase/functions/build-case-puzzle/index.ts`  
**Ligne 1164**

Actuellement :
```typescript
const items = extractedInfo.items || extractedInfo.articles || extractedInfo.lignes;
```

Probleme : si `extractedInfo.items` est un objet truthy non-tableau (ex: `{}`), le fallback vers `articles`/`lignes` ne se declenche pas, et `Array.isArray(items)` echoue silencieusement → aucun article extrait.

Correction :
```typescript
const items = Array.isArray(extractedInfo.items) ? extractedInfo.items
  : Array.isArray((extractedInfo as any).articles) ? (extractedInfo as any).articles
  : Array.isArray((extractedInfo as any).lignes) ? (extractedInfo as any).lignes
  : [];
```

## Hardening B — rejeter les tableaux imbriques (set-case-fact)

**Fichier** : `supabase/functions/set-case-fact/index.ts`  
**Ligne 112**

Actuellement :
```typescript
if (!item || typeof item !== 'object') {
```

Probleme : `Array.isArray([])` retourne `true` et `typeof [] === 'object'` → un element `[]` passe le test.

Correction :
```typescript
if (!item || typeof item !== 'object' || Array.isArray(item)) {
```

## Resume

| Fichier | Ligne | Modification |
|---------|-------|-------------|
| `build-case-puzzle/index.ts` | 1164 | Cascade `Array.isArray` au lieu de `||` truthy |
| `set-case-fact/index.ts` | 112 | Ajouter `|| Array.isArray(item)` |

Deux changements d'une ligne chacun. Zero impact sur la logique metier ou la compatibilite moteur.

