/**
 * P0-E — Normalisation pricing_run → VersionSnapshot (helper pur).
 *
 * Formes réellement produites par run-pricing (contrat vérifié) :
 * - facts_snapshot : TABLEAU de { key, value_text, value_number, value_json, ... }
 *   (run-pricing étape 7, clés canoniques quote_facts : routing.origin_port,
 *   routing.destination_city, cargo.weight_kg, contacts.client_email, ...) ;
 * - inputs_json : PricingInputs camelCase (originPort, originAirport,
 *   finalDestination, incoterm, containers, cargoWeight EN TONNES,
 *   cargoVolume, clientEmail, clientCompany, ...) ;
 * - outputs_json : client { email, company } et routing { origin, destination,
 *   incoterm } déjà résolus par run-pricing ;
 * - tariff_lines / lots[].lines : lignes canonicalisées avec unitPrice
 *   (camelCase), quantity, amount — canonicalizeLine n'ajoute que le bloc
 *   `canonical`, il ne renomme pas les clés de prix.
 *
 * L'ancien writer lisait facts_snapshot comme un objet snake_case et
 * line.unit_price || line.rate → client/route vides et prix unitaires à 0.
 *
 * Priorité des sources (déterministe, du plus au moins autoritaire) :
 * 1. outputs_json.client / outputs_json.routing (résolution faite par run-pricing) ;
 * 2. inputs_json camelCase (forme actuelle) ;
 * 3. facts_snapshot tableau (miroir de buildPricingInputs, y compris kg → tonnes) ;
 * 4. formes legacy snake_case, dans l'ordre exact de l'ancien writer
 *    (routing : inputs puis facts-objet ; client : facts-objet puis inputs).
 *
 * Les zéros numériques valides sont préservés (chaînes ?? sur nombre fini,
 * jamais de ||). Aucun recalcul commercial : amount n'est jamais recalculé ;
 * le seul dérivé admis est unit_price = amount / quantity quand AUCUN prix
 * unitaire explicite n'existe et quantity > 0.
 *
 * Module isolé (sans Deno.serve, sans import jsr/supabase) pour tests unitaires.
 */

type AnyRecord = Record<string, unknown>;

export interface SnapshotInputsBlock {
  origin: string | null;
  destination: string | null;
  incoterm: string | null;
  containers: unknown[];
  cargo_weight: number | null;
  cargo_volume: number | null;
}

export interface SnapshotClientBlock {
  email: string | null;
  company: string | null;
}

export interface NormalizedLinePricing {
  quantity: number;
  unit_price: number;
  amount: number;
}

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** string/number non vide → string trimmée ; sinon null (jamais de "" ni 0 avalé par ||). */
function toTrimmedString(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** nombre fini (0 inclus) ou chaîne numérique → number ; sinon null. */
function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Lit un fact du facts_snapshot TABLEAU par clé canonique.
 * Sélection de valeur identique à buildPricingInputs :
 * value_json ?? value_number ?? value_text.
 */
function factValue(factsSnapshot: unknown, key: string): unknown {
  if (!Array.isArray(factsSnapshot)) return undefined;
  const row = factsSnapshot.find(
    (r: unknown): r is AnyRecord =>
      isRecord(r) && (r.key === key || r.fact_key === key),
  );
  if (!row) return undefined;
  return row.value_json ?? row.value_number ?? row.value_text;
}

/** Miroir du parse défensif V4.1.5 (JSON double-encodé accepté). */
function toContainersArray(v: unknown): unknown[] | null {
  let parsed = v;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  return Array.isArray(parsed) ? parsed : null;
}

export function resolveSnapshotInputs(
  inputsJson: unknown,
  factsSnapshot: unknown,
  outputsJson: unknown,
): SnapshotInputsBlock {
  const inp: AnyRecord = isRecord(inputsJson) ? inputsJson : {};
  const legacyFacts: AnyRecord = isRecord(factsSnapshot) ? factsSnapshot : {};
  const outputs: AnyRecord = isRecord(outputsJson) ? outputsJson : {};
  const routing: AnyRecord = isRecord(outputs.routing) ? outputs.routing : {};

  const origin = toTrimmedString(routing.origin) ??
    toTrimmedString(inp.originPort) ??
    toTrimmedString(inp.originAirport) ??
    toTrimmedString(factValue(factsSnapshot, "routing.origin_port")) ??
    toTrimmedString(factValue(factsSnapshot, "routing.origin_airport")) ??
    toTrimmedString(inp.origin) ??
    toTrimmedString(legacyFacts.origin);

  // finalDestination absorbe déjà le fallback P8 (destination_port/airport)
  // côté run-pricing ; les entrées port/airport restent pour les runs pré-P8.
  const destination = toTrimmedString(routing.destination) ??
    toTrimmedString(inp.finalDestination) ??
    toTrimmedString(inp.destinationPort) ??
    toTrimmedString(inp.destinationAirport) ??
    toTrimmedString(factValue(factsSnapshot, "routing.destination_city")) ??
    toTrimmedString(factValue(factsSnapshot, "routing.destination_port")) ??
    toTrimmedString(factValue(factsSnapshot, "routing.destination_airport")) ??
    toTrimmedString(inp.destination) ??
    toTrimmedString(legacyFacts.destination);

  const incoterm = toTrimmedString(routing.incoterm) ??
    toTrimmedString(inp.incoterm) ??
    toTrimmedString(factValue(factsSnapshot, "routing.incoterm")) ??
    toTrimmedString(legacyFacts.incoterm);

  const containers = toContainersArray(inp.containers) ??
    toContainersArray(factValue(factsSnapshot, "cargo.containers")) ??
    toContainersArray(legacyFacts.containers) ??
    [];

  // inputs_json.cargoWeight est en TONNES ; le fact cargo.weight_kg est en kg
  // → même conversion /1000 que buildPricingInputs. Les formes legacy sont
  // reprises telles quelles (aucune unité fiable à leur appliquer).
  const factWeightKg = toFiniteNumber(
    factValue(factsSnapshot, "cargo.weight_kg"),
  );
  const cargo_weight = toFiniteNumber(inp.cargoWeight) ??
    (factWeightKg !== null ? factWeightKg / 1000 : null) ??
    toFiniteNumber(inp.cargo_weight) ??
    toFiniteNumber(legacyFacts.cargo_weight);

  const cargo_volume = toFiniteNumber(inp.cargoVolume) ??
    toFiniteNumber(factValue(factsSnapshot, "cargo.volume_cbm")) ??
    toFiniteNumber(inp.cargo_volume) ??
    toFiniteNumber(legacyFacts.cargo_volume);

  return {
    origin: origin ?? null,
    destination: destination ?? null,
    incoterm: incoterm ?? null,
    containers,
    cargo_weight: cargo_weight ?? null,
    cargo_volume: cargo_volume ?? null,
  };
}

export function resolveSnapshotClient(
  inputsJson: unknown,
  factsSnapshot: unknown,
  outputsJson: unknown,
): SnapshotClientBlock {
  const inp: AnyRecord = isRecord(inputsJson) ? inputsJson : {};
  const legacyFacts: AnyRecord = isRecord(factsSnapshot) ? factsSnapshot : {};
  const outputs: AnyRecord = isRecord(outputsJson) ? outputsJson : {};
  const client: AnyRecord = isRecord(outputs.client) ? outputs.client : {};

  const email = toTrimmedString(client.email) ??
    toTrimmedString(inp.clientEmail) ??
    toTrimmedString(factValue(factsSnapshot, "contacts.client_email")) ??
    toTrimmedString(legacyFacts.client_email) ??
    toTrimmedString(inp.client_email);

  const company = toTrimmedString(client.company) ??
    toTrimmedString(inp.clientCompany) ??
    toTrimmedString(factValue(factsSnapshot, "contacts.client_company")) ??
    toTrimmedString(legacyFacts.client_company) ??
    toTrimmedString(inp.client_company);

  return { email: email ?? null, company: company ?? null };
}

/**
 * Prix d'une ligne tarifaire sans altération commerciale :
 * - unit_price : unitPrice (forme actuelle) > unit_price > rate, zéro explicite
 *   préservé ; fallback amount/quantity UNIQUEMENT si aucun prix unitaire
 *   explicite et quantity > 0 ;
 * - quantity : préservée telle quelle (0 inclus), défaut 1 seulement si absente ;
 * - amount : amount > total (legacy), jamais recalculé, zéro explicite préservé.
 */
export function normalizeLinePricing(line: unknown): NormalizedLinePricing {
  const src: AnyRecord = isRecord(line) ? line : {};

  const quantity = toFiniteNumber(src.quantity) ?? 1;
  const amount = toFiniteNumber(src.amount) ?? toFiniteNumber(src.total) ?? 0;

  const explicitUnitPrice = toFiniteNumber(src.unitPrice) ??
    toFiniteNumber(src.unit_price) ??
    toFiniteNumber(src.rate);

  let unit_price: number;
  if (explicitUnitPrice !== null) {
    unit_price = explicitUnitPrice;
  } else if (quantity > 0) {
    unit_price = amount / quantity;
  } else {
    unit_price = 0;
  }

  return { quantity, unit_price, amount };
}
