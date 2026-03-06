/**
 * P0-A — Deterministic client-resolvable gap policy
 * 
 * Whitelist of gap keys that can be resolved by asking the client.
 * No AI logic here — purely deterministic mapping.
 */

export const CLIENT_RESOLVABLE_GAP_KEYS = new Set<string>([
  "cargo.description",
  "cargo.value",
  "cargo.currency",
  "cargo.weight",
  "cargo.volume",
  "routing.origin_port",
  "routing.destination_port",
  "routing.transport_mode",
  "goods.hs_code",
  "goods.quantity",
]);

export function isClientResolvableGap(gapKey: string): boolean {
  return CLIENT_RESOLVABLE_GAP_KEYS.has(gapKey);
}

const GAP_QUESTION_MAP: Record<string, string> = {
  "cargo.description": "Pouvez-vous préciser la désignation exacte de la marchandise ?",
  "cargo.value": "Quelle est la valeur commerciale totale de la marchandise ?",
  "cargo.currency": "Dans quelle devise est exprimée la valeur de la marchandise ?",
  "cargo.weight": "Quel est le poids total brut de la marchandise ?",
  "cargo.volume": "Quel est le volume total de la marchandise (m³) ?",
  "routing.origin_port": "Quel est le port ou aéroport de départ ?",
  "routing.destination_port": "Quel est le port ou aéroport de destination ?",
  "routing.transport_mode": "Le transport se fait-il par avion, par mer ou par route ?",
  "goods.hs_code": "Disposez-vous du code douanier (HS code) de la marchandise ?",
  "goods.quantity": "Quelle est la quantité exacte de la marchandise ?",
};

/**
 * Build deterministic French questions from a list of gaps.
 * Input gap_keys are sorted and deduplicated for stable output.
 */
export function buildClientQuestionsFromGaps(
  gaps: Array<{ gap_key: string }>
): string[] {
  const uniqueKeys = [...new Set(gaps.map((g) => g.gap_key))].sort();
  const questions: string[] = [];

  for (const key of uniqueKeys) {
    const q = GAP_QUESTION_MAP[key];
    if (q) questions.push(q);
  }

  return questions;
}

/**
 * Normalize gap keys: sort + deduplicate.
 * Used for stable dedupe_key generation.
 */
export function normalizeGapKeys(keys: string[]): string[] {
  return [...new Set(keys)].sort();
}
