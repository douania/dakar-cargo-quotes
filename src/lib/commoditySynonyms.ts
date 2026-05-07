/**
 * PAD-R1 — Local synonym dictionary for commodity designation matching.
 * 
 * Purpose: Expand input tokens BEFORE scoring against PAD aliases.
 * These synonyms do NOT create aliases and are NOT written to DB.
 * 
 * CTO constraints:
 * - Limited to safe, non-ambiguous terms only.
 * - Excluded for now (risk of category bias):
 *   mine → industriel, ciment → clinker, engrais → amendement, acier → metal
 * - Will be expanded after testing in PAD-R2+.
 */

const SYNONYM_MAP: Record<string, string[]> = {
  hdpe: ["plastique", "polyethylene", "pehd"],
  geomembrane: ["membrane", "liner", "lining", "revetement"],
  lining: ["revetement"],
  roll: ["rouleau"],
  rolls: ["rouleaux"],
  pvc: ["plastique", "vinyle"],
};

/**
 * Expand a list of tokens using the synonym dictionary.
 * Returns a new array containing original tokens + all matched synonyms.
 * Does not deduplicate — caller should handle if needed.
 */
export function expandTokensWithSynonyms(tokens: string[]): string[] {
  const expanded: string[] = [...tokens];
  for (const token of tokens) {
    const synonyms = SYNONYM_MAP[token];
    if (synonyms) {
      expanded.push(...synonyms);
    }
  }
  return expanded;
}
