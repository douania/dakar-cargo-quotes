/** Display only. Never use this text in a request, stored value or provenance check. */
export function sourcePresentation(original: string) {
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const hash = "[0-9a-f]{64}";
  const technical = new RegExp(`\\b(?:${uuid}|${hash})\\b`, "i").test(original);
  if (!technical) return { text: original, technical: false };
  const text = original
    .replace(new RegExp(`\\be-?mail\\s+${uuid}\\b`, "gi"), "e-mail de référence")
    .replace(new RegExp(`\\b(?:SHA-?256|empreinte)\\s*:?\\s*${hash}\\b`, "gi"), "")
    .replace(new RegExp(`\\b${uuid}\\b`, "gi"), "référence interne")
    .replace(new RegExp(`\\b${hash}\\b`, "gi"), "référence de contrôle")
    .replace(/(?:;\s*){2,}/g, "; ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/\s+([;,.])/g, "$1")
    .replace(/^[\s;,]+|[\s;,]+$/g, "")
    .trim();
  return { text: text || "Référence technique disponible", technical: true };
}
