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
