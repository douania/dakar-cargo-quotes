/** Extraction outcomes are separate from successful file storage and AI analysis. */
export const EXTRACTION_CONTRACT = 1;
export type ExtractionStatus = 'extracted' | 'empty' | 'error';
export type ExtractionCode = 'OCR_NOT_CONFIGURED' | 'OCR_PROVIDER_FAILED' | 'DOCUMENT_TEXT_EMPTY' |
  'DOCUMENT_FORMAT_UNSUPPORTED' | 'DOCUMENT_READ_FAILED' | 'DOCUMENT_WRITE_FAILED' | 'DOCUMENT_CHANGED' | 'EXTRACTION_UNAVAILABLE';
export function sanitizeDocumentText(text: string): string {
  // Strip control bytes while preserving line breaks and tabs.
  // eslint-disable-next-line no-control-regex -- intentional database text sanitation
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\\u0000/g, '').trim();
}
export function hasExtractedText(value: unknown): value is string {
  if (typeof value !== 'string' || !sanitizeDocumentText(value)) return false;
  // Historical errors were persisted in extracted_text. They are retryable, never evidence.
  const legacy = new Set([
    '[Extraction echouee]', '[OCR vide]', '[PDF - extraction indisponible]',
    '[PDF détecté - extraction texte indisponible]', "[Erreur lors de l'extraction IA du PDF]",
    '[Erreur lors de la lecture du PDF]', '[Erreur lors de la lecture du fichier Excel]',
    "[Format non supporté pour l'extraction de texte]", "[Format non supporte pour l'extraction de texte]",
  ]);
  return !legacy.has(sanitizeDocumentText(value));
}
export function extractionMessage(code: ExtractionCode): string {
  switch (code) {
    case 'OCR_NOT_CONFIGURED': return "Le service de lecture des images et PDF scannés n'est pas disponible. Le fichier est conservé ; réessayez lorsque le service sera disponible.";
    case 'OCR_PROVIDER_FAILED': return "Le service de lecture n'a pas répondu correctement. Le fichier est conservé ; réessayez l'extraction.";
    case 'DOCUMENT_TEXT_EMPTY': return "Aucun texte lisible n'a été extrait. Le fichier est conservé ; réessayez ou ajoutez une version lisible.";
    case 'DOCUMENT_FORMAT_UNSUPPORTED': return "Ce format ne permet pas l'extraction de texte. Le fichier est conservé ; ajoutez une version PDF, image ou texte lisible.";
    case 'DOCUMENT_CHANGED': return "Le document a changé pendant l'extraction. Son texte précédent est conservé ; actualisez puis réessayez.";
    case 'DOCUMENT_WRITE_FAILED': return "Le texte n'a pas pu être enregistré. Le fichier et tout texte précédent sont conservés ; réessayez.";
    case 'DOCUMENT_READ_FAILED': return "Le fichier n'a pas pu être lu. Sa source est conservée ; réessayez l'extraction.";
    default: return "L'extraction n'a pas pu être confirmée. Le fichier est conservé ; réessayez après actualisation.";
  }
}
export class DocumentExtractionError extends Error {
  constructor(public code: ExtractionCode, public httpStatus = 502) { super(extractionMessage(code)); }
}
export function extractionOutcome(status: ExtractionStatus, textLength: number, persisted: boolean, code?: ExtractionCode) {
  return { status, text_length: textLength, persisted, ...(code ? { code, message: extractionMessage(code) } : {}) };
}
