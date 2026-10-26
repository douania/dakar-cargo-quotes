/** Total explicitly declared in the current text intake; no sum or per-item inference. */
const MAX_WEIGHT_KG = 100_000_000; // Existing set-intake-facts-batch contract.
const TOTAL_PREFIX = /\b(?:poids\s+(?:(?:brut|net)\s+)?total|total\s+(?:gross\s+)?weight)\s*[:=]?\s*$/i;
const TOTAL_CUE = /\b(?:poids\s+(?:(?:brut|net)\s+)?total|total\s+(?:gross\s+)?weight)\b/i;
const TOTAL_SUFFIX = /^\s+(?:au\s+total|in\s+total)\b/i;
const UNSAFE_SCOPE = /\b(?:tare|capacit[ée]|environ|approximativement|approx|entre|ou|maximum|minimum|jusqu|net|par|each|per|about|approximately|capacity|tolerance|tol[ée]rance|pas|not|moins|plus|below|above|less|more|roughly)\b|[~≈±<>≤≥]/i;

export function mergeDeclaredIntakeWeight(
  text: string,
  analysis: Record<string, unknown> | null,
): { analysis: Record<string, unknown> | null; ambiguous: boolean } {
  const values: number[] = [];
  let ambiguous = false;
  // Periods inside numbers stay in the clause, then ambiguous numeric formats
  // are rejected below. No unrelated sentence can qualify a weight as total.
  for (const clause of text.split(/[;!?\n]|\.(?!\d)/)) {
    const matches = [...clause.matchAll(/([+−-]?\d[\d\s\u00a0\u202f.,]*?)\s*(kgs?|kilogrammes?|kilograms?|tonnes?|t)\b/gi)];
    let qualified = false;
    for (const match of matches) {
      const start = match.index!;
      const before = clause.slice(0, start);
      const after = clause.slice(start + match[0].length);
      if (!TOTAL_PREFIX.test(before) && !TOTAL_SUFFIX.test(after)) continue;
      qualified = true;
      const raw = match[1].trim();
      // A plain integer or groups of exactly three digits, optionally followed
      // by 1-2 decimal digits. 5.000 / 5,000 have two plausible readings.
      if (!/^(?:(?:au\s+total|in\s+total))?$/i.test(after.trim())
        || UNSAFE_SCOPE.test(clause) || /\d\s*[-–—/]\s*\d/.test(clause)
        || !/^(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,]\d{1,2})?$/.test(raw)) {
        ambiguous = true;
        continue;
      }
      const numeric = Number(raw.replace(/[ \u00a0\u202f]/g, '').replace(',', '.'));
      const kg = numeric * (/^(?:t|tonne)/i.test(match[2]) ? 1000 : 1);
      if (!Number.isFinite(kg) || kg <= 0 || kg > MAX_WEIGHT_KG) ambiguous = true;
      else values.push(kg);
    }
    // An explicit but unparsed total must not fall back to a documentary value.
    if ((!qualified && TOTAL_CUE.test(clause)) || (qualified && matches.length > 1)) ambiguous = true;
  }
  if (new Set(values).size > 1) ambiguous = true;
  if (ambiguous) {
    if (!analysis) return { analysis: null, ambiguous: true };
    const withoutWeight = { ...analysis };
    delete withoutWeight.weight_kg;
    return { analysis: withoutWeight, ambiguous: true };
  }
  return {
    analysis: values.length ? { ...analysis, weight_kg: values[0] } : analysis,
    ambiguous: false,
  };
}
