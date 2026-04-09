/**
 * C1.1 — Helpers purs extraits de CaseView.tsx
 * Fonctions sans état, sans closure, sans I/O.
 */

/** Map source_type to human-readable label */
export function mapSourceType(type: string): string {
  if (["manual_input", "operator"].includes(type)) return "Opérateur";
  if (type.startsWith("ai_")) return "IA";
  if (["document_regex", "attachment_extracted"].includes(type)) return "Document";
  if (type === "hs_resolution") return "HS";
  if (type === "known_contact_match") return "Contact";
  if (type === "quotation_engine") return "Moteur";
  if (type.startsWith("email_")) return "Email";
  return type;
}

/** Contextual service filtering by transport mode */
export function isServiceRelevant(service: string, mode: string): boolean {
  if (mode.startsWith("SEA")) {
    if (service.startsWith("AIR_")) return false;
    if (service === "CUSTOMS_BAMAKO") return false;
    if (service === "BORDER_FEES") return false;
    if (service === "DISCHARGE") return false;
  }
  if (mode.startsWith("AIR")) {
    if (service.startsWith("PORT_")) return false;
    if (service === "DTHC") return false;
    if (service === "EMPTY_RETURN") return false;
    if (service === "DISCHARGE") return false;
  }
  if (mode.includes("IMPORT") && service === "CUSTOMS_EXPORT") return false;
  if (mode.includes("EXPORT") && service === "CUSTOMS_DAKAR") return false;
  return true;
}

// ────────────────────────────────────────────────────────────
// PACKAGE_COMPATIBLE_EXTRAS defines only optional/additional services
// that may still be proposed beside an already detected package.
// Included package services are filtered upstream in ServiceOverridePanel.
// ────────────────────────────────────────────────────────────
const PACKAGE_COMPATIBLE_EXTRAS: Record<string, Set<string>> = {
  EXPORT_SENEGAL: new Set([
    'PICKUP_ORIGIN', 'PRE_CARRIAGE', 'STUFFING_FACTORY', 'STUFFING_CFS',
    'EMPTY_REPO', 'SURVEY',
  ]),
  DAP_PROJECT_IMPORT: new Set([
    'SURVEY', 'AGENCY', 'PORT_CHARGES', 'ON_CARRIAGE',
  ]),
  TRANSIT_GAMBIA_ALL_IN: new Set([
    'SURVEY', 'CUSTOMS_DAKAR', 'EMPTY_RETURN', 'SEA_FREIGHT',
  ]),
  BREAKBULK_PROJECT: new Set([
    'AGENCY', 'ON_CARRIAGE', 'EMPTY_RETURN', 'PORT_CHARGES',
  ]),
  AIR_IMPORT_DAP: new Set([
    'SURVEY', 'PICKUP_ORIGIN', 'PRE_CARRIAGE', 'AIR_FREIGHT',
  ]),
  LCL_IMPORT_DAP: new Set([
    'SURVEY', 'PORT_CHARGES', 'SEA_FREIGHT',
  ]),
  TRANSIT_REGIONAL_VIA_DAKAR: new Set([
    'SURVEY', 'EMPTY_RETURN', 'SEA_FREIGHT', 'ON_CARRIAGE',
  ]),
  DAP_PROJECT_IMPORT_EXW: new Set([
    'SURVEY', 'AGENCY', 'PORT_CHARGES', 'ON_CARRIAGE', 'STUFFING_FACTORY', 'STUFFING_CFS',
  ]),
  AIR_IMPORT_EXW: new Set([
    'SURVEY', 'STUFFING_FACTORY',
  ]),
  LCL_IMPORT_EXW: new Set([
    'SURVEY', 'PORT_CHARGES', 'STUFFING_CFS',
  ]),
};

/**
 * Package-aware service compatibility check.
 * If the package is known, uses a whitelist of compatible extras.
 * Falls back to the generic isServiceRelevant() for unknown packages.
 */
export function isServiceCompatibleWithPackage(
  service: string,
  packageCode: string | null,
  mode: string,
): boolean {
  if (!packageCode || !PACKAGE_COMPATIBLE_EXTRAS[packageCode]) {
    return isServiceRelevant(service, mode);
  }
  return PACKAGE_COMPATIBLE_EXTRAS[packageCode].has(service);
}

/** Normalize a proposed fact record into a clean payload for set-case-fact */
export function toFactPayload(f: Record<string, unknown>) {
  const factKey = String(f["fact_key"] ?? "").trim();
  if (!factKey) return null;

  let valueNumber: number | null = null;
  if (typeof f["value_num"] === "number" && Number.isFinite(f["value_num"])) {
    valueNumber = f["value_num"];
  } else if (typeof f["value_number"] === "number" && Number.isFinite(f["value_number"])) {
    valueNumber = f["value_number"];
  }

  let valueText: string | null = null;
  if (valueNumber === null) {
    const vt = typeof f["value_text"] === "string" ? f["value_text"].trim() : "";
    valueText = vt || null;
  }

  const valueJson = (typeof f["value_json"] === "object" && f["value_json"] !== null && !Array.isArray(f["value_json"]))
    ? f["value_json"]
    : (Array.isArray(f["value_json"]) ? f["value_json"] : null);

  return { fact_key: factKey, value_text: valueText, value_number: valueNumber, value_json: valueJson };
}
