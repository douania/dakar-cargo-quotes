

# Phase 15.7 Batch 2 — Robust AI JSON Parsing (5 fichiers)

Remplacer les 5 dernières occurrences `jsonMatch + JSON.parse` sur contenu IA par `extractAndParseJSON` avec `maxLogChars: 500`.

## Fichier 1: `supabase/functions/learn-from-contact/index.ts`

### Import (L3)
Ajouter `import { extractAndParseJSON } from "../_shared/json-parser.ts";` après `requireUser`.

### Parsing (L162-166)
Remplacer le bloc `jsonMatch + JSON.parse` par `extractAndParseJSON<any>(contentResult || "", { label: "learn-from-contact", expectRoot: "object", maxLogChars: 500 })`. Catch existant conservé (fallback `{ extractions: [], summary: contentResult }`).

## Fichier 2: `supabase/functions/learn-from-expert/index.ts`

### Import (L3)
Ajouter `import { extractAndParseJSON } from "../_shared/json-parser.ts";` après `requireUser`.

### Parsing (L242-245)
Remplacer par `extractAndParseJSON<any>(contentResult || "", { label: "learn-from-expert", expectRoot: "object", maxLogChars: 500 })`. Catch existant conservé (rethrow `"Impossible de parser la réponse IA"`).

## Fichier 3: `supabase/functions/market-surveillance/index.ts`

### Import (L3)
Ajouter `import { extractAndParseJSON } from "../_shared/json-parser.ts";` après `requireUser`.

### Parsing (L157-161)
Remplacer par `extractAndParseJSON<any>(analysisContent || "", { label: "market-surveillance", expectRoot: "object", maxLogChars: 500 })` puis `detections = parsed.detections || []`. Catch existant conservé (`detections` reste `[]`).

## Fichier 4: `supabase/functions/qualify-quotation-minimal/index.ts`

### Import (L19-20)
Ajouter `import { extractAndParseJSON } from "../_shared/json-parser.ts";` après `corsHeaders`.

### Parsing (L289-294)
Remplacer `jsonMatch` + `JSON.parse` par `extractAndParseJSON<QualifyMinimalResult>(aiContent || "", { label: "qualify-quotation-minimal", expectRoot: "object", maxLogChars: 500 })`.

### Supprimer log brut (L297)
Supprimer `console.error('AI content:', aiContent);`. Fallback existant (construction depuis `existingGaps`) inchangé.

## Fichier 5: `supabase/functions/suggest-decisions/index.ts`

### Import (L23-24)
Ajouter `import { extractAndParseJSON } from "../_shared/json-parser.ts";` après `corsHeaders`.

### parseAIOptions (L202-211)
Remplacer par un `try { parsed = extractAndParseJSON<any>(...) } catch { return createFallbackOptions(decisionType) }` avec label dynamique `suggest-decisions:${decisionType}`. Logique de validation post-parse (min 2 options, confidence enum, etc.) inchangée.

## Aucun autre fichier modifié.

