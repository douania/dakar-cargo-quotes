/**
 * P1-A4 — domaine pur du pricing isolé par scénario.
 *
 * Ce module ne fait aucune I/O. Il valide la requête, construit un overlay
 * éphémère à partir des faits et hypothèses déjà relus côté serveur, prépare
 * l'entrée du moteur existant et calcule des totaux volontairement
 * conservateurs. Il n'écrit jamais dans quote_facts ni dans l'état du dossier.
 */

export const SCENARIO_PRICING_RESERVE_CODES = [
  "MISSING_CARGO_VALUE",
  "MISSING_HS_CODE",
  "PAD_CATEGORY_UNRESOLVED",
  "PARTNER_COST_PENDING",
  "RATE_PENDING_CONFIRMATION",
] as const;

export type ScenarioPricingReserveCode =
  (typeof SCENARIO_PRICING_RESERVE_CODES)[number];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

const REQUEST_KEYS = new Set([
  "case_id",
  "scenario_id",
  "expected_scope_hash",
  "idempotency_key",
]);

/**
 * Seules les clés déjà consommées par le pricing canonique peuvent être
 * projetées. Une hypothèse narrative ou portant sur une clé inconnue bloque le
 * run : elle ne peut pas influencer silencieusement un prix.
 */
export const SCENARIO_PRICING_FACT_KEYS = new Set([
  "routing.origin_port",
  "routing.origin_airport",
  "routing.destination_port",
  "routing.destination_airport",
  "routing.destination_city",
  "routing.incoterm",
  "routing.terminal_operation_mode",
  "cargo.containers",
  "cargo.weight_kg",
  "cargo.volume_cbm",
  "cargo.value",
  "cargo.value_currency",
  "cargo.description",
  "cargo.hs_code",
  "cargo.articles_detail",
  "cargo.freight_cost",
  "cargo.freight_currency",
  "cargo.pad_category",
  "pricing.pad_category",
  "cargo.pad_rate_fcfa_per_ton",
  "carrier.name",
  "customs.regime_code",
  "regulatory.exemption_title",
  "service.package",
  "service.overrides",
  "client.code",
]);

export interface ScenarioPricingRequest {
  case_id: string;
  scenario_id: string;
  expected_scope_hash: string;
  idempotency_key: string;
}

export type RequestValidation =
  | { ok: true; value: ScenarioPricingRequest }
  | { ok: false; message: string };

export function validateScenarioPricingRequest(raw: unknown): RequestValidation {
  if (!isPlainObject(raw)) {
    return { ok: false, message: "Le corps doit être un objet JSON" };
  }
  const unknown = Object.keys(raw).filter((key) => !REQUEST_KEYS.has(key));
  if (unknown.length > 0) {
    return { ok: false, message: `Champs non autorisés : ${unknown.join(", ")}` };
  }
  if (typeof raw.case_id !== "string" || !UUID_RE.test(raw.case_id)) {
    return { ok: false, message: "case_id doit être un UUID" };
  }
  if (typeof raw.scenario_id !== "string" || !UUID_RE.test(raw.scenario_id)) {
    return { ok: false, message: "scenario_id doit être un UUID" };
  }
  if (
    typeof raw.expected_scope_hash !== "string" ||
    !SHA256_RE.test(raw.expected_scope_hash)
  ) {
    return { ok: false, message: "expected_scope_hash doit être un SHA-256 hexadécimal" };
  }
  if (typeof raw.idempotency_key !== "string") {
    return { ok: false, message: "idempotency_key est obligatoire" };
  }
  const idempotencyKey = raw.idempotency_key.trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return { ok: false, message: "idempotency_key doit faire 8 à 128 caractères" };
  }
  return {
    ok: true,
    value: {
      case_id: raw.case_id,
      scenario_id: raw.scenario_id,
      expected_scope_hash: raw.expected_scope_hash,
      idempotency_key: idempotencyKey,
    },
  };
}

export interface PricingFactRow {
  id: string;
  fact_key: string;
  value_text?: unknown;
  value_number?: unknown;
  value_json?: unknown;
  value_date?: unknown;
  source_type?: unknown;
  confidence?: unknown;
}

export interface PricingAssumptionRow {
  id: string;
  status: string;
  assumption_type?: unknown;
  assumed_fact_key?: unknown;
  assumed_value_type?: unknown;
  assumed_value?: unknown;
  statement?: unknown;
  basis?: unknown;
  source_type?: unknown;
  source_refs?: unknown;
  risk_level?: unknown;
}

export interface OverlayEntry {
  fact_key: string;
  basis: "fact" | "assumption";
  source_id: string;
  value_type: string;
  value: unknown;
}

export interface OverlayResult {
  ok: boolean;
  facts: PricingFactRow[];
  overlay: OverlayEntry[];
  assumptionKeys: Set<string>;
  blockers: string[];
}

export function readFactBusinessValue(fact: PricingFactRow): unknown {
  if (
    typeof fact.value_json === "string" ||
    typeof fact.value_json === "number" ||
    typeof fact.value_json === "boolean"
  ) return fact.value_json;
  if (fact.value_number !== null && fact.value_number !== undefined) return fact.value_number;
  if (fact.value_text !== null && fact.value_text !== undefined) return fact.value_text;
  if (fact.value_date !== null && fact.value_date !== undefined) return fact.value_date;
  return fact.value_json ?? null;
}

function factValueType(fact: PricingFactRow): string {
  if (fact.value_json !== null && fact.value_json !== undefined) return "json";
  if (fact.value_number !== null && fact.value_number !== undefined) return "number";
  if (fact.value_date !== null && fact.value_date !== undefined) return "date";
  return "text";
}

function assumptionAsFact(assumption: PricingAssumptionRow): PricingFactRow | null {
  const key = typeof assumption.assumed_fact_key === "string"
    ? assumption.assumed_fact_key.trim()
    : "";
  const type = assumption.assumed_value_type;
  if (!key || !SCENARIO_PRICING_FACT_KEYS.has(key)) return null;
  const row: PricingFactRow = {
    id: assumption.id,
    fact_key: key,
    source_type: "scenario_assumption",
    confidence: 0,
  };
  if (type === "number") row.value_number = assumption.assumed_value;
  else if (type === "json") row.value_json = assumption.assumed_value;
  else if (type === "date") row.value_date = assumption.assumed_value;
  else if (type === "text" || type === "boolean") row.value_text = assumption.assumed_value;
  else return null;
  return row;
}

export function buildScenarioOverlay(
  facts: PricingFactRow[],
  assumptions: PricingAssumptionRow[],
): OverlayResult {
  const blockers: string[] = [];
  const factByKey = new Map<string, PricingFactRow>();
  for (const fact of facts ?? []) {
    if (!fact || typeof fact.fact_key !== "string" || factByKey.has(fact.fact_key)) {
      blockers.push("AMBIGUOUS_CURRENT_FACTS");
      continue;
    }
    factByKey.set(fact.fact_key, { ...fact });
  }

  const assumptionByKey = new Map<string, PricingAssumptionRow>();
  for (const assumption of assumptions ?? []) {
    if (!["active", "client_confirmed"].includes(assumption.status)) {
      blockers.push("SCENARIO_ASSUMPTION_NOT_LIVE");
      continue;
    }
    const key = typeof assumption.assumed_fact_key === "string"
      ? assumption.assumed_fact_key.trim()
      : "";
    if (!key || !SCENARIO_PRICING_FACT_KEYS.has(key)) {
      blockers.push("SCENARIO_ASSUMPTION_KEY_UNSUPPORTED");
      continue;
    }
    if (assumptionByKey.has(key)) {
      blockers.push("AMBIGUOUS_ASSUMPTION_OVERLAY");
      continue;
    }
    const projected = assumptionAsFact(assumption);
    if (!projected) {
      blockers.push("SCENARIO_ASSUMPTION_VALUE_UNSUPPORTED");
      continue;
    }
    assumptionByKey.set(key, assumption);
    factByKey.set(key, projected);
  }

  const overlay: OverlayEntry[] = [];
  for (const [key, fact] of factByKey.entries()) {
    const assumption = assumptionByKey.get(key);
    overlay.push({
      fact_key: key,
      basis: assumption ? "assumption" : "fact",
      source_id: assumption?.id ?? fact.id,
      value_type: assumption && typeof assumption.assumed_value_type === "string"
        ? assumption.assumed_value_type
        : factValueType(fact),
      value: assumption?.assumed_value ?? readFactBusinessValue(fact),
    });
  }
  overlay.sort((a, b) => a.fact_key.localeCompare(b.fact_key));

  return {
    ok: blockers.length === 0,
    facts: Array.from(factByKey.values()),
    overlay,
    assumptionKeys: new Set(assumptionByKey.keys()),
    blockers: uniqueStrings(blockers),
  };
}

export interface PricingInputs {
  originPort?: string;
  originAirport?: string;
  destinationPort?: string;
  destinationAirport?: string;
  finalDestination?: string;
  incoterm?: string;
  containers?: Array<Record<string, unknown>>;
  cargoWeight?: number;
  cargoVolume?: number;
  cargoValue?: number;
  cargoValueCurrency?: string;
  cargoDescription?: string;
  carrier?: string;
  hsCode?: string;
  articlesDetail?: Array<Record<string, unknown>>;
  regimeCode?: string;
  exemptionTitle?: string;
  freightCost?: number;
  freightCurrency?: string;
  servicePackage?: string;
  clientCode?: string;
}

export function buildPricingInputs(facts: PricingFactRow[]): PricingInputs {
  const inputs: PricingInputs = {};
  for (const fact of facts ?? []) {
    const value = readFactBusinessValue(fact);
    switch (fact.fact_key) {
      case "routing.origin_port": inputs.originPort = asString(value); break;
      case "routing.origin_airport": inputs.originAirport = asString(value); break;
      case "routing.destination_port": inputs.destinationPort = asString(value); break;
      case "routing.destination_airport": inputs.destinationAirport = asString(value); break;
      case "routing.destination_city": inputs.finalDestination = asString(value); break;
      case "routing.incoterm": inputs.incoterm = asString(value); break;
      case "cargo.containers": inputs.containers = parseObjectArray(value); break;
      case "cargo.weight_kg": {
        const n = Number(value);
        if (Number.isFinite(n)) inputs.cargoWeight = n / 1000;
        break;
      }
      case "cargo.volume_cbm": inputs.cargoVolume = finiteNumber(value); break;
      case "cargo.value": inputs.cargoValue = finiteNumber(value); break;
      case "cargo.value_currency": inputs.cargoValueCurrency = asString(value); break;
      case "cargo.description": inputs.cargoDescription = asString(value); break;
      case "carrier.name": inputs.carrier = asString(value); break;
      case "cargo.hs_code": inputs.hsCode = asString(value); break;
      case "cargo.articles_detail": inputs.articlesDetail = parseObjectArray(value); break;
      case "customs.regime_code": inputs.regimeCode = asString(value); break;
      case "regulatory.exemption_title": inputs.exemptionTitle = asString(value); break;
      case "cargo.freight_cost": inputs.freightCost = finiteNumber(value); break;
      case "cargo.freight_currency": inputs.freightCurrency = asString(value); break;
      case "service.package": inputs.servicePackage = asString(value); break;
      case "client.code": inputs.clientCode = asString(value); break;
    }
  }
  if (!inputs.finalDestination) {
    inputs.finalDestination = inputs.destinationPort ?? inputs.destinationAirport;
  }
  return inputs;
}

export function buildEngineRequest(
  inputs: PricingInputs,
  transportMode: unknown,
): Record<string, unknown> {
  const normalizedMode = String(transportMode ?? "").trim().toUpperCase();
  return {
    finalDestination: inputs.finalDestination,
    originPort: inputs.originPort,
    originAirport: inputs.originAirport,
    incoterm: inputs.incoterm,
    containers: inputs.containers ?? [],
    cargoWeight: inputs.cargoWeight,
    cargoVolume: inputs.cargoVolume,
    cargoValue: inputs.cargoValue,
    cargoCurrency: inputs.cargoValueCurrency,
    cargoDescription: inputs.cargoDescription,
    carrier: inputs.carrier,
    transportMode: normalizedMode === "AIR" ? "aerien" : "maritime",
    hsCode: inputs.hsCode,
    articlesDetail: inputs.articlesDetail,
    regimeCode: inputs.regimeCode,
    freightAmount: inputs.freightCost,
    freightCurrency: inputs.freightCurrency,
    clientCode: inputs.clientCode,
  };
}

export interface ScenarioTariffLine extends Record<string, unknown> {
  amount?: unknown;
  bloc?: unknown;
  category?: unknown;
  description?: unknown;
  source?: unknown;
}

export interface ScenarioTotals {
  firm_total_ht: number;
  firm_total_ttc: number;
  indicative_total_ht: number;
  indicative_total_ttc: number;
  lines: Array<ScenarioTariffLine & {
    scenario_provenance: {
      assumption_dependent: boolean;
      dependency_keys: string[];
      firm_eligible: boolean;
    };
  }>;
}

const CUSTOMS_DEPENDENCY_KEYS = new Set([
  "cargo.value",
  "cargo.value_currency",
  "cargo.freight_cost",
  "cargo.freight_currency",
  "cargo.hs_code",
  "cargo.articles_detail",
  "customs.regime_code",
  "regulatory.exemption_title",
]);

function isCustomsLine(line: ScenarioTariffLine): boolean {
  const text = normalizeText(
    `${String(line.bloc ?? "")} ${String(line.category ?? "")} ${String(line.description ?? "")}`,
  );
  return String(line.bloc ?? "").toLowerCase() === "debours" ||
    ["douane", "droit", "taxe", "customs", "caf", "assurance", "insurance"]
      .some((token) => text.includes(token));
}

function dependencyKeysForLine(
  line: ScenarioTariffLine,
  assumptionKeys: Set<string>,
): string[] {
  if (assumptionKeys.size === 0) return [];
  const onlyCustoms = Array.from(assumptionKeys).every((key) => CUSTOMS_DEPENDENCY_KEYS.has(key));
  if (onlyCustoms && !isCustomsLine(line)) return [];
  // Toute dépendance non démontrée est considérée présente (fail-closed).
  return Array.from(assumptionKeys).sort();
}

function sourceAllowsFirm(line: ScenarioTariffLine): boolean {
  const source = isPlainObject(line.source) ? line.source : {};
  const type = normalizeText(source.type);
  if (!type || type === "to_confirm" || type === "historical_only" || type === "observed") {
    return false;
  }
  const confidence = Number(source.confidence);
  const knownFirm = [
    "official",
    "validated_internal",
    "database",
    "catalogue_sodatra",
    "dp_world_official",
    "pad_official",
  ].some((candidate) => type.includes(candidate));
  return knownFirm || (Number.isFinite(confidence) && confidence >= 0.8);
}

export function computeScenarioTotals(
  rawLines: ScenarioTariffLine[],
  assumptionKeys: Set<string>,
): ScenarioTotals {
  let firm = 0;
  let indicative = 0;
  let firmHonoraires = 0;
  let indicativeHonoraires = 0;
  const lines = (rawLines ?? []).map((line) => {
    const amount = Number(line.amount);
    const source = isPlainObject(line.source) ? line.source : {};
    const isReserve = normalizeText(source.type) === "to_confirm" || line.amount === null;
    const validAmount = Number.isFinite(amount) && amount >= 0;
    const dependencyKeys = dependencyKeysForLine(line, assumptionKeys);
    const firmEligible = validAmount && !isReserve && dependencyKeys.length === 0 && sourceAllowsFirm(line);
    const isHonoraires = normalizeText(line.bloc) === "honoraires";
    if (validAmount && !isReserve) {
      indicative += amount;
      if (isHonoraires) indicativeHonoraires += amount;
    }
    if (firmEligible) {
      firm += amount;
      if (isHonoraires) firmHonoraires += amount;
    }
    return {
      ...line,
      scenario_provenance: {
        assumption_dependent: dependencyKeys.length > 0,
        dependency_keys: dependencyKeys,
        firm_eligible: firmEligible,
      },
    };
  });
  const safeFirm = finiteNonNegative(firm);
  const safeIndicative = Math.max(safeFirm, finiteNonNegative(indicative));
  // Même doctrine que le pricing canonique : TVA SODATRA 18 % uniquement sur
  // le bloc honoraires. Les débours fournisseur restent inclus tels quels.
  const firmTtc = safeFirm + Math.round(finiteNonNegative(firmHonoraires) * 0.18);
  const indicativeTtc = safeIndicative +
    Math.round(finiteNonNegative(indicativeHonoraires) * 0.18);
  return {
    firm_total_ht: safeFirm,
    firm_total_ttc: firmTtc,
    indicative_total_ht: safeIndicative,
    indicative_total_ttc: Math.max(firmTtc, indicativeTtc),
    lines,
  };
}

export const ENGINE_CATEGORY_TO_SERVICE_KEY: Record<string, string> = {
  dthc: "DTHC",
  "terminal dpw": "DTHC",
  terminal: "DTHC",
  "retour conteneur vide": "EMPTY_RETURN",
  dedouanement: "CUSTOMS_DAKAR",
  douane: "CUSTOMS_DAKAR",
  transport: "TRUCKING",
  "transport mali": "TRUCKING",
  "frontiere mali": "BORDER_FEES",
  suivi: "AGENCY",
  administratif: "AGENCY",
};

const ENGINE_DESCRIPTION_TO_SERVICE_KEY: Array<{
  tokens: string[];
  serviceKey: string;
}> = [
  { tokens: ["suivi operationnel"], serviceKey: "AGENCY" },
  { tokens: ["ouverture de dossier"], serviceKey: "AGENCY" },
  { tokens: ["frais de documentation", "documentation"], serviceKey: "AGENCY" },
  { tokens: ["dedouanement", "douane"], serviceKey: "CUSTOMS_DAKAR" },
];

/**
 * Identifie uniquement les lignes structurelles dont le rattachement au
 * service est démontré. Une ligne inconnue (droits/taxes, PAD obligatoire,
 * etc.) reste visible : elle ne peut jamais être retirée silencieusement.
 */
export function inferScenarioLineServiceKey(
  line: ScenarioTariffLine,
): string | null {
  const canonical = isPlainObject(line.canonical) ? line.canonical : {};
  const canonicalKey = typeof canonical.service_key === "string"
    ? canonical.service_key.trim().toUpperCase()
    : "";
  if (canonicalKey) return canonicalKey;

  const categoryKey = ENGINE_CATEGORY_TO_SERVICE_KEY[normalizeText(line.category)];
  if (categoryKey) return categoryKey;

  const description = normalizeText(line.description);
  for (const mapping of ENGINE_DESCRIPTION_TO_SERVICE_KEY) {
    if (mapping.tokens.some((token) => description.includes(token))) {
      return mapping.serviceKey;
    }
  }
  return null;
}

export function applyScenarioExplicitServiceRemovals(
  lines: ScenarioTariffLine[],
  explicitlyRemoved: Set<string>,
): { keptLines: ScenarioTariffLine[]; removedLines: ScenarioTariffLine[] } {
  const keptLines: ScenarioTariffLine[] = [];
  const removedLines: ScenarioTariffLine[] = [];
  for (const line of lines ?? []) {
    const serviceKey = inferScenarioLineServiceKey(line);
    if (serviceKey && explicitlyRemoved.has(serviceKey)) removedLines.push(line);
    else keptLines.push(line);
  }
  return { keptLines, removedLines };
}

export function inferCoveredServices(lines: ScenarioTariffLine[]): Set<string> {
  const covered = new Set<string>();
  for (const line of lines ?? []) {
    const serviceKey = inferScenarioLineServiceKey(line);
    if (serviceKey) covered.add(serviceKey);
  }
  return covered;
}

export function buildMissingServiceReserveLines(
  effectiveServiceKeys: string[],
  covered: Set<string>,
): ScenarioTariffLine[] {
  // PORT_DAKAR_HANDLING est uniquement le marqueur de périmètre PAD. La ligne
  // financière attendue est PAD_DROIT_PASSAGE, jamais une manutention générique.
  const financialKeys = effectiveServiceKeys.map((key) =>
    key === "PORT_DAKAR_HANDLING" ? "PAD_DROIT_PASSAGE" : key
  );
  return uniqueStrings(financialKeys)
    .filter((key) => !covered.has(key))
    .map((key) => ({
      id: `scenario-reserve-${key.toLowerCase()}`,
      bloc: "operationnel",
      category: key,
      description: `${key} — tarif non calculé par le moteur structurel isolé`,
      amount: null,
      currency: "XOF",
      source: {
        type: "TO_CONFIRM",
        reference: "P1-A4_CATALOGUE_ENRICHMENT_NOT_CALLED",
        confidence: 0,
      },
      isEditable: false,
      notes: "Réserve explicite : price-service-lines n'est pas appelé afin de ne pas écrire dans quote_service_pricing.",
    }));
}

export function deriveQualification(params: {
  blockers: string[];
  assumptionsCount: number;
  reserveCount: number;
  openPointsCount: number;
}): "provisional" | "partial" | "blocked" {
  if (params.blockers.length > 0) return "blocked";
  if (params.reserveCount > 0 || params.openPointsCount > 0) return "partial";
  return "provisional";
}

export function buildFingerprintInput(params: {
  request: ScenarioPricingRequest;
  scopeSnapshot: unknown;
  factsSnapshot: unknown;
  assumptionsSnapshot: unknown;
  reservations: unknown;
}): Record<string, unknown> {
  return {
    schema_version: 1,
    case_id: params.request.case_id,
    scenario_id: params.request.scenario_id,
    scenario_scope_hash: params.request.expected_scope_hash,
    scope_snapshot: params.scopeSnapshot,
    facts_snapshot: params.factsSnapshot,
    assumptions_snapshot: params.assumptionsSnapshot,
    reservations: params.reservations,
  };
}

export async function computeRequestFingerprint(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function mapRpcErrorCode(message: string):
  | "FORBIDDEN_OWNER"
  | "CONFLICT_INVALID_STATE"
  | "VALIDATION_FAILED"
  | "UPSTREAM_DB_ERROR" {
  if (message.includes("FORBIDDEN_CROSS_CASE") || message.includes("FORBIDDEN_OWNER")) {
    return "FORBIDDEN_OWNER";
  }
  if (
    message.includes("IDEMPOTENCY_CONFLICT") ||
    message.includes("CONFLICT_INVALID_STATE") ||
    message.includes("SCENARIO_STATE_CHANGED")
  ) return "CONFLICT_INVALID_STATE";
  if (message.includes("VALIDATION_FAILED") || message.includes("NOT_FOUND")) {
    return "VALIDATION_FAILED";
  }
  return "UPSTREAM_DB_ERROR";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const normalized = typeof value === "string" ? value.replace(/\s/g, "").replace(/,/g, ".") : value;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}

function parseObjectArray(value: unknown): Array<Record<string, unknown>> {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return []; }
  }
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is Record<string, unknown> => isPlainObject(entry))
    : [];
}

function normalizeText(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, " ").trim().toLowerCase()
    : "";
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set((values ?? []).filter(Boolean)));
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
