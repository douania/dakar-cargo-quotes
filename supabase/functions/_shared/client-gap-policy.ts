/**
 * P0-A — Deterministic client-resolvable gap policy
 * 
 * Whitelist of gap keys that can be resolved by asking the client.
 * No AI logic here — purely deterministic mapping.
 * 
 * P0-G: Realigned with canonical keys from build-case-puzzle.
 */

export const CLIENT_RESOLVABLE_GAP_KEYS = new Set<string>([
  "cargo.description",
  "cargo.value",
  "cargo.weight_kg",
  "cargo.volume_cbm",
  "cargo.hs_code",
  "cargo.pieces_count",
  "routing.origin_port",
  "routing.destination_port",
  "routing.destination_city",
  "routing.destination_country",
  "routing.transport_mode",
  "pricing.pad_category",
]);

export function isClientResolvableGap(gapKey: string): boolean {
  return CLIENT_RESOLVABLE_GAP_KEYS.has(gapKey);
}

const GAP_QUESTION_MAP: Record<string, string> = {
  "cargo.description": "Pouvez-vous préciser la désignation exacte de la marchandise ?",
  "cargo.value": "Quelle est la valeur commerciale totale de la marchandise ?",
  "cargo.weight_kg": "Quel est le poids total brut de la marchandise (en kg) ?",
  "cargo.volume_cbm": "Quel est le volume total de la marchandise (m³) ?",
  "cargo.hs_code": "Disposez-vous du code douanier (HS code) de la marchandise ?",
  "cargo.pieces_count": "Quelle est la quantité exacte de colis/pièces ?",
  "routing.origin_port": "Quel est le port ou aéroport de départ ?",
  "routing.destination_port": "Quel est le port ou aéroport de destination ?",
  "routing.destination_city": "Quelle est la ville de destination finale des marchandises ?",
  "routing.destination_country": "Quel est le pays de destination finale ?",
  "routing.transport_mode": "Le transport se fait-il par avion, par mer ou par route ?",
  "pricing.pad_category": "Pouvez-vous préciser la nature exacte de la marchandise ainsi que le poids brut total ? Ces informations sont nécessaires pour déterminer les droits de passage portuaires applicables.",
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
