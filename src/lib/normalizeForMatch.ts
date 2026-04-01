/**
 * Normalizes a string for commodity designation matching.
 * Safe normalization: lowercase, trim, collapse spaces, strip accents.
 * NO naive plural stripping (too risky for V1).
 */
export function normalizeForMatch(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Extracts meaningful tokens from a normalized string.
 * Filters out tokens shorter than 3 characters.
 */
export function extractTokens(normalized: string): string[] {
  return normalized.split(" ").filter((t) => t.length >= 3);
}
