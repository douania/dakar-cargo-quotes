

# Plan CL2 — Attachment Analysis Layer v2

## Principe

Le fichier `analyze-attachments/index.ts` (1503 lignes) fait deja de l'analyse AI sur documents natifs (PDF en base64, Excel en texte, images). Le manque est uniquement cote **voie A** : il n'y a pas d'extraction texte brute locale pour les PDFs. Le texte brut est soit vide, soit issu de `extractedData.text_content` (sortie AI).

Le CTO demande un modele a 3 voies :
- **extracted_text** = texte brut (trace, audit, recherche)
- **extracted_data** = analyse AI structuree du document natif (interpretation metier)
- Les deux coexistent, sans que l'un remplace l'autre

## Ecarts reels a corriger

| # | Ecart | Localisation |
|---|---|---|
| A | PDFs : pas d'extraction texte brute locale (pdfjs-dist) | Background L696-778, Sync L1245-1330 |
| B | Pas de normalisation de texte | Tous les points d'ecriture extracted_text |
| C | UPDATE sans `.eq('is_analyzed', false)` | ~12 occurrences (bg + sync) |
| D | Erreurs Supabase non lues sur certains UPDATE/INSERT | Background mode L555-813 |
| E | Pas de garde anti-doublon sur quotation_history | Background L795, Sync L1382 |

## Corrections

### Patch A — Extraction PDF texte brut via pdfjs-dist

Ajouter en tete de fichier l'import pdfjs-dist (meme version que `parse-document` : `4.0.379`).

Ajouter une fonction `extractPdfText(uint8Array)` :
- `pdfjsLib.getDocument({ data, disableWorker: true })`
- Concatene texte de toutes les pages
- Si texte < 50 chars, retourne chaine vide (le flux AI natif fera le travail)

**Dans les blocs PDF** (background L696, sync L1245) — avant l'appel AI existant :
1. Tenter `extractPdfText(uint8Array)`
2. Si texte obtenu, le stocker comme `extractedText` (voie A)
3. Continuer l'appel AI normalement sur le document natif en base64 (voie B) — logique inchangee
4. `extracted_text` = texte brut pdfjs, `extracted_data` = analyse AI structuree

Le flux AI existant n'est **pas modifie** : il continue a recevoir le PDF natif en base64 et a produire `extracted_data`. Seul `extracted_text` change de source.

Pour les **images** : pas de pdfjs, `extracted_text` reste tel quel (vide ou `text_content` AI).
Pour les **Excel** : `extracted_text` recoit deja le texte tabulaire, pas de changement de source — juste normalisation.

### Patch B — normalizeText()

Fonction utilitaire :
```
function normalizeText(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
```

Appliquee a `extractedText` avant chaque ecriture `extracted_text` :
- Background final update L809-813
- Sync final update L1461-1469
- Nouveau texte PDF de Patch A

### Patch C — Garde idempotence `.eq('is_analyzed', false)`

Ajouter `.eq('is_analyzed', false)` a tous les `.update({ is_analyzed: true }).eq('id', attachment.id)` :
- Background : L555, L568, L583, L673, L809
- Sync : L1033, L1047, L1077, L1098, L1129, L1215, L1461

### Patch D — Lecture explicite `{ error }` sur UPDATE/INSERT

Dans `analyzeAttachmentInBackground` (L540-827), les `.update()` a L555, L568, L583, L673, L809 et le `.insert()` a L795 ne lisent pas `{ error }`. Corriger :
```
const { error: updateErr } = await supabase.from('email_attachments').update(...)...;
if (updateErr) console.warn('[analyze-attachments] Update failed:', updateErr.message);
```

Meme correction pour le `.select()` L785 (emails).

### Patch E — Garde anti-doublon quotation_history

Avant chaque insert `quotation_history` (background L795, sync L1382), ajouter :
```
const { data: existingQh, error: existingQhErr } = await supabase
  .from('quotation_history')
  .select('id')
  .eq('source_attachment_id', attachment.id)
  .maybeSingle();  // bg mode: une seule entree par attachment

if (existingQhErr) {
  console.warn('[analyze-attachments] quotation_history check failed:', existingQhErr.message);
}
if (existingQh) {
  console.log('[analyze-attachments] quotation_history already exists, skipping');
  // skip insert
}
```

Pour le sync mode (L1367-1396, boucle par cargoType), le check inclut aussi `.eq('cargo_type', cargoType)` car plusieurs entrees legitimes par type sont possibles.

## Fichier modifie

| Fichier | Changement |
|---|---|
| `supabase/functions/analyze-attachments/index.ts` | A + B + C + D + E |

## Ce qui n'est PAS touche

- `sync-emails` (CL1 valide)
- `email-admin` (CL1 valide)
- `parse-document`, `import-thread`
- Aucune migration SQL
- Aucun fichier front
- Logique AI existante (prompts, routing, knowledge learning) intacte — les appels AI sur documents natifs restent identiques

