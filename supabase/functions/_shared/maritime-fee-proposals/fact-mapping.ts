import type { MaritimeFeeInput, MonetaryAmount } from './engine.ts';

// ---------------------------------------------------------------------------
// Mapping read-only quote_facts -> MaritimeFeeInput (si case_id fourni)
// ---------------------------------------------------------------------------

export interface FactRow {
  fact_key?: string | null;
  value_text?: string | number | null;
  value_number?: number | null;
  value_json?: unknown;
}

function indexFacts(facts: FactRow[]): Map<string, FactRow> {
  const m = new Map<string, FactRow>();
  for (const f of facts ?? []) {
    if (f && typeof f.fact_key === "string") m.set(f.fact_key, f);
  }
  return m;
}

function factText(m: Map<string, FactRow>, key: string): string | null {
  const f = m.get(key);
  if (!f) return null;
  const raw = f.value_text ?? f.value_json ?? f.value_number ?? null;
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s.length ? s : null;
}

function factNumber(m: Map<string, FactRow>, key: string): number | null {
  const f = m.get(key);
  if (!f) return null;
  const raw = f.value_number ?? f.value_text ?? f.value_json ?? null;
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Mappe un `quote_cases.request_type` métier vers l'operation_type attendu par le
 * moteur B1 (IMPORT / EXPORT / TRANSIT). FONCTION PURE.
 *
 * Règle d'or (doctrine B2) : aucune devinette. Un request_type non reconnu => null,
 * ce qui laisse le moteur produire un warning « périmètre non IMPORT ».
 */
export function resolveOperationTypeFromRequestType(
  requestType: string | null | undefined,
): "IMPORT" | "EXPORT" | "TRANSIT" | null {
  const rt = String(requestType ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
  if (!rt) return null;

  // IMPORT maritime explicite uniquement. AIR/ROAD/MULTIMODAL restent hors du
  // périmètre de ce lecteur : MULTIMODAL ne permet pas de prouver à lui seul
  // qu'un segment maritime est applicable.
  if (
    rt === "SEA_FCL_IMPORT" ||
    rt === "SEA_LCL_IMPORT" ||
    rt === "SEA_BREAKBULK_IMPORT"
  ) {
    return "IMPORT";
  }
  // EXPORT_* (toutes déclinaisons).
  if (rt.startsWith("EXPORT_")) return "EXPORT";
  // Transit / transbordement.
  if (rt === "TRANSIT" || rt === "TRANSSHIPMENT" || rt === "TRANSBORDEMENT") {
    return "TRANSIT";
  }
  // Non reconnu : ne pas deviner.
  return null;
}

/**
 * Construit un `MaritimeFeeInput` à partir des faits d'un dossier. FONCTION PURE.
 *
 * Règle d'or (doctrine B2) : si un mapping est incertain, NE PAS DEVINER — laisser
 * null et laisser le moteur produire missing_confirmation / warnings.
 */
export function mapFactsToMaritimeInput(
  requestType: string | null | undefined,
  facts: FactRow[],
): MaritimeFeeInput {
  const m = indexFacts(facts);

  // operation_type : depuis quote_cases.request_type via mapping strict ; sinon null.
  const operation_type = resolveOperationTypeFromRequestType(requestType);

  // cargo_mode : déduit UNIQUEMENT depuis un fait conteneur évident ou depuis le
  // request_type maritime breakbulk explicite. RoRo/ConRo restent à confirmer si
  // aucun conteneur n'est présent : le type de terminal ne suffit pas à déduire
  // la colonne PAD applicable.
  const normalizedRequestType = String(requestType ?? "").trim().toUpperCase();
  const cargo_mode = factText(m, "cargo.containers") !== null
    ? "CONTENEUR"
    : normalizedRequestType === "SEA_BREAKBULK_IMPORT"
    ? "CONVENTIONNEL"
    : null;

  // carrier : carrier.name
  const carrier = factText(m, "carrier.name");

  // pad_category : cargo.pad_category ou pricing.pad_category
  const pad_category = factText(m, "cargo.pad_category") ??
    factText(m, "pricing.pad_category");

  // tonnage : cargo.weight_kg / 1000 (uniquement si poids > 0).
  const weightKg = factNumber(m, "cargo.weight_kg");
  const tonnage = weightKg !== null && weightKg > 0 ? weightKg / 1000 : null;

  // seafreight : cargo.freight_cost + cargo.freight_currency
  const freightCost = factNumber(m, "cargo.freight_cost");
  const freightCurrency = factText(m, "cargo.freight_currency");
  const seafreight: MonetaryAmount | null =
    freightCost !== null && freightCost > 0 && freightCurrency
      ? { value: freightCost, currency: freightCurrency }
      : null;

  // usdToXofRate : uniquement si un fait EXPLICITE existe. Aucun fait de taux
  // fiable n'est garanti dans quote_facts -> on ne devine pas : null. Le moteur
  // signalera missing usd_exchange_rate si nécessaire.
  const usdToXofRate = null;

  return {
    operation_type,
    cargo_mode,
    carrier,
    pad_category,
    tonnage,
    seafreight,
    usdToXofRate,
  };
}
