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
  // COMPOSITE-CARGO-GAPS-1 — gaps de garde composites (bus + autre marchandise)
  // émis par build-case-puzzle (detectCargoConflictGuards). Sans cette entrée,
  // sync-gap-client-actions et generate-reply-draft les filtraient, et le
  // brouillon client ne demandait que HS + valeur globale.
  "cargo.pieces_count_conflict",
  "cargo.weight_total_confirmation",
  "cargo.value_conflict",
  "cargo.mixed_scope_confirmation",
]);

export function isClientResolvableGap(gapKey: string): boolean {
  return CLIENT_RESOLVABLE_GAP_KEYS.has(gapKey);
}

const GAP_QUESTION_MAP: Record<string, string> = {
  "cargo.description": "Pouvez-vous préciser la désignation exacte de la marchandise ?",
  "cargo.value": "Quelle est la valeur commerciale totale de la marchandise ?",
  "cargo.weight_kg": "Quel est le poids total brut de la marchandise (en kg) ?",
  "cargo.volume_cbm": "Quel est le volume total de la marchandise (m³) ?",
  "cargo.hs_code": "Disposez-vous du code douanier (HS code, 10 chiffres) de la marchandise ? À défaut, merci de fournir les documents permettant de le déterminer (facture commerciale, fiche technique, draft B/L).",
  "cargo.pieces_count": "Quelle est la quantité exacte de colis/pièces ?",
  "routing.origin_port": "Quel est le port ou aéroport de départ ?",
  "routing.destination_port": "Quel est le port ou aéroport de destination ?",
  "routing.destination_city": "Quelle est la ville de destination finale des marchandises ?",
  "routing.destination_country": "Quel est le pays de destination finale ?",
  "routing.transport_mode": "Le transport se fait-il par avion, par mer ou par route ?",
  "pricing.pad_category": "Pouvez-vous préciser la nature exacte de la marchandise ainsi que le poids brut total ? Ces informations sont nécessaires pour déterminer les droits de passage portuaires applicables.",
  // COMPOSITE-CARGO-GAPS-1 — questions client des gaps de garde composites.
  // Formulées sans jamais affirmer une hypothèse comme un fait : pas de nombre
  // de bus présupposé, pas de "15×40FR", pas de cotation antérieure citée comme
  // source, et le contenu d'un conteneur n'est jamais présumé identique à un autre.
  "cargo.pieces_count_conflict":
    "Concernant les bus : pouvez-vous confirmer le nombre total de bus à coter, le nombre exact de conteneurs 40'FR utilisés, et s'il s'agit bien d'un bus par 40'FR ? Merci d'indiquer, pour chaque bus, le numéro de châssis et la valeur déclarée (en précisant la devise).",
  "cargo.weight_total_confirmation":
    "Le poids dont nous disposons semble être un poids unitaire (par bus). Pouvez-vous confirmer le poids total brut de la cargaison, ou bien le poids unitaire et le nombre exact d'unités ?",
  "cargo.value_conflict":
    "Quelle est la valeur marchandise déclarée (valeur commerciale / CIF) à retenir, et dans quelle devise ? Merci de joindre la facture commerciale et la packing list. Un montant issu d'un calcul de droits et taxes ne peut pas servir de valeur déclarée.",
  "cargo.mixed_scope_confirmation":
    "Votre envoi semble combiner des bus et un ou plusieurs conteneurs additionnels. Pouvez-vous préciser le contenu exact de chaque conteneur additionnel (20' et 40') ? Pour toute marchandise autre que les bus, merci de fournir, par article : désignation, quantité, poids net/brut, valeur et devise, code HS, ainsi que la facture et la packing list, et de confirmer l'absence de marchandises dangereuses (non-DGR) pour chaque conteneur. Le contenu du conteneur 20' n'est pas présumé identique à celui du 40'. À ce stade, toute marchandise autre que les bus ne peut pas être chiffrée tant que ces informations ne sont pas fournies.",
};

const GAP_QUESTION_MAP_EN: Record<string, string> = {
  "cargo.description": "Could you please specify the exact description of the goods?",
  "cargo.value": "What is the total commercial value of the goods?",
  "cargo.weight_kg": "What is the total gross weight of the goods (in kg)?",
  "cargo.volume_cbm": "What is the total volume of the goods (CBM)?",
  "cargo.hs_code": "Do you have the customs tariff code (HS code, 10 digits) for the goods? Otherwise, please provide the documents needed to determine it (commercial invoice, technical datasheet, draft B/L).",
  "cargo.pieces_count": "What is the exact number of packages/pieces?",
  "routing.origin_port": "What is the port or airport of departure?",
  "routing.destination_port": "What is the port or airport of destination?",
  "routing.destination_city": "What is the final destination city for the goods?",
  "routing.destination_country": "What is the final destination country?",
  "routing.transport_mode": "Is the shipment by air, sea, or road?",
  "pricing.pad_category": "Could you please specify the exact nature of the goods and the total gross weight? This information is required to determine the applicable port handling charges.",
  // COMPOSITE-CARGO-GAPS-1 — EN parity for composite guard questions.
  // Same fact-safe framing as the FR map (no presumed bus count, no "15×40FR",
  // no prior quotation cited as source, container contents never presumed identical).
  "cargo.pieces_count_conflict":
    "Regarding the buses: could you confirm the total number of buses to quote, the exact number of 40'FR containers used, and whether it is one bus per 40'FR? For each bus, please provide the chassis number and the declared value (specifying the currency).",
  "cargo.weight_total_confirmation":
    "The weight we have appears to be a per-unit weight (per bus). Could you confirm the total gross cargo weight, or the unit weight and the exact number of units?",
  "cargo.value_conflict":
    "What is the declared goods value (commercial / CIF value) to use, and in which currency? Please attach the commercial invoice and the packing list. An amount taken from a duty-and-tax computation cannot be used as the declared value.",
  "cargo.mixed_scope_confirmation":
    "Your shipment appears to combine buses and one or more additional containers. Could you specify the exact contents of each additional container (20' and 40')? For any goods other than the buses, please provide, per item: description, quantity, net/gross weight, value and currency, HS code, as well as the invoice and packing list, and confirm the absence of dangerous goods (non-DGR) for each container. The contents of the 20' container are not presumed identical to those of the 40'. At this stage, any goods other than the buses cannot be priced until this information is provided.",
};

/**
 * Build deterministic questions from a list of gaps.
 * language defaults to "fr" for backward compatibility.
 * Input gap_keys are sorted and deduplicated for stable output.
 */
export function buildClientQuestionsFromGaps(
  gaps: Array<{ gap_key: string }>,
  language: "fr" | "en" = "fr"
): string[] {
  const map = language === "en" ? GAP_QUESTION_MAP_EN : GAP_QUESTION_MAP;
  const uniqueKeys = [...new Set(gaps.map((g) => g.gap_key))].sort();
  const questions: string[] = [];

  for (const key of uniqueKeys) {
    const q = map[key];
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
