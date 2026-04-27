# EDGE-BUILD-DENO-DEPS-001 — Correctif résolution npm Deno Edge Functions

> Diagnostic et correctif chirurgical pour les erreurs de résolution de dépendances npm
> dans le runtime Deno des Supabase Edge Functions. Ce diagnostic est **strictement séparé**
> de `INFRA-PUBLISH-VITE-ENV-001` (problème frontend / injection variables `VITE_*`).
> Les deux blocages peuvent coexister dans le pipeline Lovable mais ont des causes
> racines indépendantes.

## 1. Métadonnées

| Champ | Valeur |
|-------|--------|
| ID | `EDGE-BUILD-DENO-DEPS-001` |
| Date | 2026-04-27 UTC |
| Catégorie | Infrastructure / Edge Functions / Deno runtime |
| Statut | `correctif_minimal_applique_verification_en_cours` |
| Sujet lié (mais distinct) | `INFRA-PUBLISH-VITE-ENV-001` |

## 2. Symptôme observé

Logs Lovable pendant le build / déploiement Edge Functions :

- `npm:@supabase/realtime-js@2.104.1` introuvable
  (dépendance transitive de `jsr:@supabase/supabase-js@2`)
- `npm:pdfjs-dist@4.4.168` introuvable
  (utilisé dans 3 fonctions : `analyze-attachments`, `parse-document`, `backfill-case-documents`)

Suggestion remontée par Deno lui-même dans les logs :
> "list the dependencies in `deno.json` / `package.json`, or enable `nodeModulesDir: auto`"

## 3. Audit du repo (lecture seule)

| Vérification | Résultat |
|--------------|----------|
| `deno.json` racine | absent |
| `supabase/deno.json` | absent |
| `supabase/functions/deno.json` | absent (avant correctif) |
| `deno.json` par fonction | absent |
| Specifier Supabase utilisé | `jsr:@supabase/supabase-js@2` (homogène, ~30 fonctions) |
| Specifier `npm:` directs | uniquement `npm:pdfjs-dist@4.4.168/legacy/build/pdf.mjs` (3 fonctions) |
| Imports `npm:@supabase/...` directs | aucun |

Conclusion audit : aucun fichier de configuration Deno n'existait, donc le runtime n'avait
aucun mécanisme de résolution `node_modules` pour les dépendances `npm:` (ni directes,
ni transitives via `jsr:`).

## 4. Correctif appliqué (chirurgical)

**Fichier créé** : `supabase/functions/deno.json`

**Contenu exact** :
```json
{
  "nodeModulesDir": "auto"
}
```

**Aucune autre modification** :
- pas de modification `src/`
- pas de modification `client.ts`
- pas de modification `guard.ts`
- pas de modification `.env`
- pas de modification `supabase/config.toml`
- pas de modification d'imports Supabase
- pas de remplacement `pdfjs-dist` par `unpdf`
- pas de migration SQL
- pas de RLS
- pas de refactor logique métier

## 5. Justification du choix `nodeModulesDir: "auto"`

- Option officiellement documentée par Deno pour résoudre les dépendances npm
  (directes et transitives) en matérialisant un `node_modules/` à la volée.
- Suggestion explicite remontée par les logs Deno eux-mêmes.
- N'affecte que le runtime Edge Functions, totalement isolé du frontend.
- Réversible : suppression du fichier suffit pour revenir à l'état antérieur.

## 6. Choix global vs par fonction (forme retenue)

Supabase documente **deux formes possibles** :

1. **`supabase/functions/deno.json` global** : plus simple, recommandé en
   développement local. Comportement de déploiement Lovable à confirmer.
2. **`supabase/functions/<nom>/deno.json` par fonction** : recommandé par
   Supabase pour le déploiement, isole les dépendances par fonction.

**Forme retenue ici** : la forme **globale** uniquement, parce que c'est le
correctif le plus minimal possible (1 seul fichier créé). Si Lovable / Supabase
n'applique pas le `deno.json` global au déploiement, basculer alors vers la
forme par fonction (plan B documenté ci-dessous).

## 7. Procédure de vérification post-correctif

À exécuter après application du correctif :

1. Redéployer les 3 fonctions consommatrices de `npm:pdfjs-dist` :
   - `analyze-attachments`
   - `parse-document`
   - `backfill-case-documents`
2. Lire les logs de chacune pour vérifier la disparition de :
   - `npm:pdfjs-dist@4.4.168` introuvable
   - `npm:@supabase/realtime-js@2.104.1` introuvable
3. Tester un appel sanity check sur une fonction non-PDF (ex. `healthz`)
   pour confirmer que le runtime n'est pas régressé globalement.
4. Re-capturer le bundle publish frontend et vérifier l'injection des
   variables `VITE_*`. **Cette vérification n'a aucun lien causal avec le
   correctif Deno** ; elle sert uniquement à confirmer ou infirmer si les
   deux problèmes étaient liés dans le pipeline Lovable.

## 8. Séparation explicite avec INFRA-PUBLISH-VITE-ENV-001

| Aspect | EDGE-BUILD-DENO-DEPS-001 | INFRA-PUBLISH-VITE-ENV-001 |
|--------|--------------------------|----------------------------|
| Couche | Backend / Edge Functions Deno runtime | Frontend / build Vite |
| Cause racine | Pas de config Deno pour résoudre npm | Variables `VITE_*` non injectées au build publish Lovable |
| Variables concernées | `npm:pdfjs-dist`, `npm:@supabase/realtime-js` (transitif) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Correctif | `supabase/functions/deno.json` (en cours) | Escalade support Lovable (message préparé) |
| Indépendance | Indépendants au plan technique. Hypothèse à vérifier : un échec build Edge pourrait empêcher Lovable de finaliser le pipeline, ce qui bloquerait également l'injection frontend. À confirmer empiriquement. |

## 9. Plan B (si correctif global non appliqué par Lovable)

Ne **pas improviser**. Présenter un nouveau plan validable avec création
ciblée de :
- `supabase/functions/analyze-attachments/deno.json`
- `supabase/functions/parse-document/deno.json`
- `supabase/functions/backfill-case-documents/deno.json`

Contenu identique : `{"nodeModulesDir": "auto"}`.

## 10. Garde-fous gouvernance

- Une seule création de fichier applicatif : `supabase/functions/deno.json`.
- Une seule création de fichier documentaire : ce fichier d'audit.
- Aucune modification d'aucun autre fichier du repo.
- Réversibilité totale : `rm supabase/functions/deno.json` restaure l'état antérieur.
