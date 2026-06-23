/**
 * CLIENT-REPLY-LANGUAGE-INVARIANT-2 — Détection de langue client (pur, testable).
 *
 * Helpers extraits depuis generate-reply-draft/index.ts pour être testables
 * sans déclencher serve(). Aucune dépendance DB/réseau/I-O.
 *
 * Garde-fous :
 *   - fonctions pures, en mémoire ;
 *   - ne lèvent JAMAIS ; tout échec retombe sur l'entrée d'origine ;
 *   - normalizeTextForLanguageDetection ne corrompt pas un texte normal :
 *     seul un corps MIME/base64 brut est décodé, via extractPlainTextFromMime.
 */

import { extractPlainTextFromMime } from "./email-text-extraction.ts";

/**
 * Détection heuristique FR/EN par marqueurs.
 *
 * Comportement conservé à l'identique (transitaire francophone-first) :
 * en cas d'égalité stricte (y compris en === 0 && fr === 0), retombe sur "fr".
 * Le correctif du bug base64 vient de la normalisation préalable de l'entrée
 * (voir normalizeTextForLanguageDetection), pas d'un changement de ce tie-break.
 */
export function detectLanguage(text: string): "fr" | "en" {
  const lower = text.toLowerCase();
  let fr = 0;
  let en = 0;
  // French indicators
  if (lower.includes("bonjour")) fr++;
  if (lower.includes("cordialement")) fr++;
  if (lower.includes("merci")) fr++;
  if (lower.includes(" vous ")) fr++;
  if (lower.includes(" nous ")) fr++;
  if (lower.includes(" des ")) fr++;
  if (lower.includes(" les ")) fr++;
  if (lower.includes(" pour ")) fr++;
  if (lower.includes("cotation")) fr++;
  if (lower.includes("marchandise")) fr++;
  // English indicators
  if (lower.includes("dear ")) en++;
  if (lower.includes("regards")) en++;
  if (lower.includes("please")) en++;
  if (lower.includes("thank you")) en++;
  if (lower.includes(" the ")) en++;
  if (lower.includes(" is ")) en++;
  if (lower.includes(" are ")) en++;
  if (lower.includes("freight")) en++;
  if (lower.includes("shipment")) en++;
  if (lower.includes("quotation")) en++;
  return en > fr ? "en" : "fr";
}

/**
 * Normalise défensivement un texte avant détection de langue.
 *
 * - Texte normal (prose, sujet) → retourné inchangé.
 * - Corps MIME / base64 brut (ex: "QzAg...") → segment décodé en UTF-8 sûr,
 *   ce qui restaure les marqueurs ("Dear", "please", "Carrier", "CMA CGM",
 *   "DDP") invisibles tant que le corps reste encodé.
 * - Décodage illisible / vide → fallback sur la valeur d'origine.
 *
 * S'appuie sur extractPlainTextFromMime (helper pur déjà éprouvé), qui ne
 * tente le décodage base64 que si le début ressemble vraiment à du base64
 * (≥40 caractères de l'alphabet base64 contigus, sans espace ni ponctuation) :
 * un texte normal n'est donc jamais décodé par erreur.
 */
export function normalizeTextForLanguageDetection(value: string): string {
  if (!value) return value;
  try {
    const extracted = extractPlainTextFromMime(value);
    // Fallback si l'extraction ne produit rien d'exploitable.
    if (extracted && extracted.trim().length > 0) return extracted;
    return value;
  } catch {
    return value;
  }
}
