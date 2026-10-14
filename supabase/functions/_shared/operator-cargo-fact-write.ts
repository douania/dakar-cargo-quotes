import { CURRENCY_WHITELIST } from "./cargo-currency-codes.ts";

// Shared by the operator form and set-case-fact. No pricing or derived values.
export const OPERATOR_CARGO_FACT_KEYS = new Set([
  "cargo.dimensions", "cargo.weight_net_kg", "cargo.value_currency",
]);

export const OPERATOR_CARGO_FACT_HINTS: Record<string, string> = {
  "cargo.dimensions": "Ex. 48x36x29 cm x28 ; 44x27x24 cm x2 (unités : mm, cm ou m)",
  "cargo.weight_net_kg": "Poids net en kg, nombre positif ou nul (ex. 151)",
  "cargo.value_currency": "Devise de la valeur : XOF, EUR ou USD (CFA/FCFA admis)",
};

type FactValue = { value_text: string | null; value_number: number | null; value_json: null };
type Result = { ok: true; value: FactValue } | { ok: false; message: string };
type Write = { value_text?: unknown; value_number?: unknown; value_json?: unknown };

export function normalizeOperatorCargoFactWrite(key: string, input: Write): Result {
  const invalid = (): Result => ({ ok: false, message: OPERATOR_CARGO_FACT_HINTS[key] ?? "Fait non pris en charge" });
  if (!OPERATOR_CARGO_FACT_KEYS.has(key) || input.value_json != null) return invalid();
  if (key === "cargo.weight_net_kg") {
    if (input.value_text != null || typeof input.value_number !== "number" ||
      !Number.isFinite(input.value_number) || input.value_number < 0) return invalid();
    return { ok: true, value: { value_text: null, value_number: input.value_number, value_json: null } };
  }
  if (input.value_number != null || typeof input.value_text !== "string") return invalid();
  const text = input.value_text.trim();
  if (key === "cargo.value_currency") {
    const currency = text.toUpperCase();
    if (!CURRENCY_WHITELIST.has(currency)) return invalid();
    return { ok: true, value: { value_text: ["CFA", "FCFA"].includes(currency) ? "XOF" : currency, value_number: null, value_json: null } };
  }
  if (!text || text.length > 2000) return invalid();
  const groups = text.split(";");
  if (groups.length > 50) return invalid();
  const normalized: string[] = [];
  for (const group of groups) {
    const match = group.trim().match(/^(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)(?:\s*[x×*]\s*(\d+))?$/i);
    if (!match) return invalid();
    const sizes = match.slice(1, 4).map(n => Number(n.replace(",", ".")));
    const count = match[5] === undefined ? null : Number(match[5]);
    if (sizes.some(n => !Number.isFinite(n) || n <= 0) ||
      (count !== null && (!Number.isSafeInteger(count) || count <= 0))) return invalid();
    normalized.push(`${sizes.join("x")} ${match[4].toLowerCase()}${count === null ? "" : ` x${count}`}`);
  }
  return { ok: true, value: { value_text: normalized.join(" ; "), value_number: null, value_json: null } };
}

// null lets existing fact keys keep their established input behavior.
export function operatorCargoFactInput(key: string, raw: string): Result | null {
  if (!OPERATOR_CARGO_FACT_KEYS.has(key)) return null;
  if (key === "cargo.weight_net_kg") {
    const text = raw.trim();
    const value = /^\d+(?:[.,]\d+)?$/.test(text) ? Number(text.replace(",", ".")) : NaN;
    return normalizeOperatorCargoFactWrite(key, { value_number: value });
  }
  return normalizeOperatorCargoFactWrite(key, { value_text: raw });
}
