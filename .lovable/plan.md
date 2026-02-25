

# Plan : Forcer le deploiement et ajouter un log de debug

## Diagnostic confirme

Les logs edge function ne contiennent **aucune** trace `[cargo-value doc-regex]`. Le code est present dans le fichier `index.ts` mais la version deployee ne l'inclut pas.

Preuve : `[HS doc-regex]` fonctionne (deploye dans une version anterieure), mais le bloc cargo-value ajoute apres n'a jamais ete deploye.

## Actions

### 1. Ajouter un log de debug AVANT le check bestCandidate

A la ligne 1782 (avant la boucle), ajouter :
```typescript
console.log(`[cargo-value doc-regex] Scanning ${(caseDocuments || []).filter(d => d.extracted_text).length} documents with extracted_text`);
```

Cela permet de confirmer que le bloc est atteint et que les documents sont disponibles.

### 2. Forcer le redeploiement de l'edge function

Utiliser l'outil `supabase--deploy_edge_functions` pour forcer le deploiement de `build-case-puzzle`.

### 3. Aucun changement de logique

La logique `extractCargoValueFromText` + stacked labels fallback + injection bloc est deja correcte dans le fichier. Le seul probleme est le deploiement.

## Fichier modifie

| Fichier | Action |
|---------|--------|
| `supabase/functions/build-case-puzzle/index.ts` | Ajout d'1 ligne de log debug (ligne ~1780) |

## Resultat attendu

Apres deploiement et relance de l'analyse du dossier Taleb :
- Les logs afficheront `[cargo-value doc-regex] Scanning X documents...`
- Si l'extraction fonctionne : `cargo.value = 945995.26`, `cargo.freight_cost = 19500`
- Si l'extraction echoue : les logs montreront exactement ou ca bloque (pas de documents, pas de match, etc.)

