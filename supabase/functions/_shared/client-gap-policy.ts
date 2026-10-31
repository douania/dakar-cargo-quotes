import { readAirRequirements,AIR_CLIENT_DATA_KEYS } from "./air-cross-trade-requirements.ts";
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
  // COMPOSITE-CARGO-GAPS-1 — gaps de garde composites (bus + autre marchandise)
  // émis par build-case-puzzle (detectCargoConflictGuards). Sans cette entrée,
  // sync-gap-client-actions et generate-reply-draft les filtraient, et le
  // brouillon client ne demandait que HS + valeur globale.
  "cargo.pieces_count_conflict",
  "cargo.weight_total_confirmation",
  "cargo.value_conflict",
  "cargo.mixed_scope_confirmation",
]);

export const CLIENT_QUESTION_POLICY_VERSION = 4;

/** Only already identified blocking customer needs are included; this does not infer necessity. */
export function isRequiredClientGap(gap: { gap_key: string; is_blocking?: unknown }): boolean {
  return gap.is_blocking === true && isClientResolvableGap(gap.gap_key);
}

export interface ClientGapCaseContext {request_type?:string|null;facts?:Array<{fact_key:string;value_text?:string|null;value_json?:unknown;is_current?:boolean}>}
export function isRequiredClientGapForCase(gap:{gap_key:string;is_blocking?:unknown},context:ClientGapCaseContext):boolean {
 const cross=context.request_type==="AIR_CROSS_TRADE"||context.facts?.some(f=>f.fact_key==="service.package"&&f.value_text==="AIR_CROSS_TRADE");
 if(!cross)return isRequiredClientGap(gap);
 const requirements=readAirRequirements(context.facts??[]);
 return !!requirements&&gap.is_blocking===true&&AIR_CLIENT_DATA_KEYS.has(gap.gap_key)&&requirements.client_data_keys.includes(gap.gap_key);
}

export function isClientResolvableGap(gapKey: string): boolean {
  return CLIENT_RESOLVABLE_GAP_KEYS.has(gapKey);
}

const GAP_QUESTION_MAP: Record<string, string> = {
  "routing.destination_airport":"Quel est l’aéroport d’arrivée souhaité ?",
  "cargo.dimensions":"Quelles sont les dimensions des colis et leur unité (cm ou m), en précisant combien de colis correspondent à chaque dimension ?",
  "cargo.weight_net_kg":"Quel est le poids net total de la marchandise (en kg) ?",
  "cargo.packaging_type":"Comment la marchandise est-elle emballée ?",
  "cargo.description": "Pouvez-vous préciser la désignation exacte de la marchandise ?",
  "cargo.value": "Quelle est la valeur commerciale totale de la marchandise ?",
  "cargo.weight_kg": "Quel est le poids total brut de la marchandise (en kg) ?",
  "cargo.volume_cbm": "Quel est le volume total de la marchandise (m³) ?",
  "cargo.hs_code": "Connaissez-vous le code douanier (HS code) ? Sinon, précisez simplement la nature, la composition et l’usage de la marchandise dans votre réponse.",
  "cargo.pieces_count": "Quelle est la quantité exacte de colis/pièces ?",
  "routing.origin_port": "Quel est le port ou aéroport de départ ?",
  "routing.destination_port": "Quel est le port ou aéroport de destination ?",
  "routing.destination_city": "Quelle est la ville de destination finale des marchandises ?",
  "routing.destination_country": "Quel est le pays de destination finale ?",
  "routing.transport_mode": "Le transport se fait-il par avion, par mer ou par route ?",
  // COMPOSITE-CARGO-GAPS-1 — questions client des gaps de garde composites.
  // Formulées sans jamais affirmer une hypothèse comme un fait : pas de nombre
  // de bus présupposé, pas de "15×40FR", pas de cotation antérieure citée comme
  // source, et le contenu d'un conteneur n'est jamais présumé identique à un autre.
  "cargo.pieces_count_conflict":
    "Concernant les bus : pouvez-vous confirmer le nombre total de bus à coter, le nombre exact de conteneurs 40'FR utilisés, et s'il s'agit bien d'un bus par 40'FR ? Merci d'indiquer, pour chaque bus, le numéro de châssis et la valeur déclarée (en précisant la devise).",
  "cargo.weight_total_confirmation":
    "Pouvez-vous préciser le poids brut total, ou le poids par pièce et le nombre de pièces ?",
  "cargo.value_conflict":
    "Quelle valeur de marchandise et quelle devise faut-il retenir ? Vous pouvez répondre directement dans ce message.",
  "cargo.mixed_scope_confirmation":
    "Que contient chaque conteneur additionnel (20' et 40') ? Pour les marchandises autres que les bus, indiquez par article : désignation, quantité, poids net/brut, valeur et devise, code HS si connu, et précisez si elles sont non dangereuses (non-DGR). Vous pouvez répondre dans ce message. Le contenu du conteneur 20' n'est pas présumé identique à celui du 40'.",
};

const GAP_QUESTION_MAP_EN: Record<string, string> = {
  "routing.destination_airport":"Which arrival airport is requested?",
  "cargo.dimensions":"What are the package dimensions and their units (cm or m), and how many packages have each size?",
  "cargo.weight_net_kg":"What is the total net weight of the goods in kg?",
  "cargo.packaging_type":"How are the goods packed?",
  "cargo.description": "Could you please specify the exact description of the goods?",
  "cargo.value": "What is the total commercial value of the goods?",
  "cargo.weight_kg": "What is the total gross weight of the goods (in kg)?",
  "cargo.volume_cbm": "What is the total volume of the goods (CBM)?",
  "cargo.hs_code": "Do you know the customs tariff code (HS code)? If not, simply describe the goods, their composition and their use in your reply.",
  "cargo.pieces_count": "What is the exact number of packages/pieces?",
  "routing.origin_port": "What is the port or airport of departure?",
  "routing.destination_port": "What is the port or airport of destination?",
  "routing.destination_city": "What is the final destination city for the goods?",
  "routing.destination_country": "What is the final destination country?",
  "routing.transport_mode": "Is the shipment by air, sea, or road?",
  // COMPOSITE-CARGO-GAPS-1 — EN parity for composite guard questions.
  // Same fact-safe framing as the FR map (no presumed bus count, no "15×40FR",
  // no prior quotation cited as source, container contents never presumed identical).
  "cargo.pieces_count_conflict":
    "Regarding the buses: could you confirm the total number of buses to quote, the exact number of 40'FR containers used, and whether it is one bus per 40'FR? For each bus, please provide the chassis number and the declared value (specifying the currency).",
  "cargo.weight_total_confirmation":
    "Could you specify the total gross weight, or the weight per piece and the number of pieces?",
  "cargo.value_conflict":
    "Which goods value and currency should we use? You can reply directly in this message.",
  "cargo.mixed_scope_confirmation":
    "What does each additional container (20' and 40') contain? For goods other than the buses, give per item: description, quantity, net/gross weight, value and currency, HS code if known, and whether they are non-dangerous (non-DGR). You can reply in this message. The contents of the 20' container are not presumed identical to those of the 40'.",
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
    if (key === "cargo.weight_kg" && uniqueKeys.includes("cargo.weight_total_confirmation")) continue;
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
