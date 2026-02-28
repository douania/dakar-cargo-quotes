

# Phase 15.7 Batch 1 — Robust AI JSON Parsing (4 fichiers)

Remplacer tous les `jsonMatch + JSON.parse` sur contenu IA par `extractAndParseJSON` avec `maxLogChars: 500` partout.

## Fichier 1: `supabase/functions/analyze-attachments/index.ts`

### Import (L4)
Ajouter `import { extractAndParseJSON } from "../_shared/json-parser.ts";`

### Occurrence 1 — Excel background (L684-696)
Remplacer le bloc `jsonMatch + JSON.parse` par `extractAndParseJSON<any>(content, { label: "analyze-attachments:excel-bg", expectRoot: "object", maxLogChars: 500 })` avec fallback `{ type: "quotation_excel", raw_response: content }`.

### Occurrence 2 — Image/PDF (L764-769)
Remplacer par `extractAndParseJSON<any>(content, { label: "analyze-attachments:image-pdf", expectRoot: "object", maxLogChars: 500 })` avec fallback `{ raw_response: content }`.

### Occurrence 3 — Excel main (L1165-1181)
Réduire le log L1165 de 800→500 chars. Remplacer le parsing par `extractAndParseJSON<any>(content, { label: "analyze-attachments:excel-main", expectRoot: "object", maxLogChars: 500 })` avec même fallback.

### Occurrence 4 — Doc main (L1251-1260)
Remplacer par `extractAndParseJSON<any>(content, { label: "analyze-attachments:doc-main", expectRoot: "object", maxLogChars: 500 })` avec fallback `{ raw_response: content }` + `extractedText = content.substring(0, 500)`.

## Fichier 2: `supabase/functions/analyze-pricing-patterns/index.ts`

### Import (L3)
Ajouter `import { extractAndParseJSON } from "../_shared/json-parser.ts";`

### Parsing (L214-223)
Remplacer le bloc `jsonMatch + JSON.parse` par `extractAndParseJSON<any>(content, { label: "analyze-pricing-patterns", expectRoot: "object", maxLogChars: 500 })` avec fallback `{ raw_analysis: content }`.

## Fichier 3: `supabase/functions/build-case-puzzle/index.ts`

### Import (L7)
Ajouter `import { extractAndParseJSON } from "../_shared/json-parser.ts";`

### M3.5 multi-quote (L677-684)
Remplacer le regex code-fence + `JSON.parse` par `extractAndParseJSON<any>(rawContent, { label: "build-case-puzzle:M3.5", expectRoot: "object", maxLogChars: 500 })` avec même fallback `return null`.

### Facts extraction (L3236-3257)
Remplacer `jsonMatch + JSON.parse` par `extractAndParseJSON<any>(content, { label: "build-case-puzzle:facts", expectRoot: "object", maxLogChars: 500 })` puis `Array.isArray(parsed?.facts) ? parsed.facts : []`. Conserver le `f.valueType === "json"` inner parse inchangé. Fallback `extractFactsBasic(emails, attachments)`.

## Fichier 4: `supabase/functions/generate-case-outputs/index.ts`

### Import (L15)
Ajouter `import { extractAndParseJSON } from "../_shared/json-parser.ts";`

### Email parsing (L462-472)
Remplacer `jsonMatch + JSON.parse` par `extractAndParseJSON<any>(content, { label: "generate-case-outputs:email", expectRoot: "object", maxLogChars: 500 })`. Si `parsed?.subject || parsed?.body` → return objet. Sinon fallback `generateEmailTemplate(...)`.

## Aucun autre fichier modifié.

