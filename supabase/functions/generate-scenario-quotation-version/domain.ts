/** Domaine pur P1-A5 : requête fermée et mapping des refus SQL. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const REQUEST_KEYS = new Set([
  "case_id",
  "scenario_id",
  "scenario_pricing_run_id",
  "expected_scope_hash",
  "idempotency_key",
]);

export interface ScenarioOutputRequest {
  case_id: string;
  scenario_id: string;
  scenario_pricing_run_id: string;
  expected_scope_hash: string;
  idempotency_key: string;
}

export type ScenarioOutputRequestValidation =
  | { ok: true; value: ScenarioOutputRequest }
  | { ok: false; message: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateScenarioOutputRequest(raw: unknown): ScenarioOutputRequestValidation {
  if (!isObject(raw)) return { ok: false, message: "Le corps doit être un objet JSON" };
  const unknown = Object.keys(raw).filter((key) => !REQUEST_KEYS.has(key));
  if (unknown.length > 0) {
    return { ok: false, message: `Champs non autorisés : ${unknown.join(", ")}` };
  }
  for (const key of ["case_id", "scenario_id", "scenario_pricing_run_id"] as const) {
    if (typeof raw[key] !== "string" || !UUID_RE.test(raw[key])) {
      return { ok: false, message: `${key} doit être un UUID` };
    }
  }
  if (typeof raw.expected_scope_hash !== "string" || !SHA256_RE.test(raw.expected_scope_hash)) {
    return { ok: false, message: "expected_scope_hash doit être un SHA-256 hexadécimal" };
  }
  if (typeof raw.idempotency_key !== "string") {
    return { ok: false, message: "idempotency_key est obligatoire" };
  }
  const key = raw.idempotency_key.trim();
  if (key.length < 8 || key.length > 128) {
    return { ok: false, message: "idempotency_key doit faire 8 à 128 caractères" };
  }
  return {
    ok: true,
    value: {
      case_id: raw.case_id as string,
      scenario_id: raw.scenario_id as string,
      scenario_pricing_run_id: raw.scenario_pricing_run_id as string,
      expected_scope_hash: raw.expected_scope_hash as string,
      idempotency_key: key,
    },
  };
}

export function mapScenarioOutputRpcError(message: string):
  | "VALIDATION_FAILED"
  | "FORBIDDEN_OWNER"
  | "CONFLICT_INVALID_STATE"
  | "UPSTREAM_DB_ERROR" {
  if (/FORBIDDEN_CROSS_CASE|FORBIDDEN_OWNER/i.test(message)) return "FORBIDDEN_OWNER";
  if (/SCENARIO_|IDEMPOTENCY_CONFLICT|CONFLICT_INVALID_STATE/i.test(message)) {
    return "CONFLICT_INVALID_STATE";
  }
  if (/VALIDATION_FAILED|NOT_FOUND/i.test(message)) return "VALIDATION_FAILED";
  return "UPSTREAM_DB_ERROR";
}
