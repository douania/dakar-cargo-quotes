/** Recorded at selection time only; never reconstruct a saved price from today's database. */
type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const text = (v: unknown): string => typeof v === "string" ? v.trim() : "";
export type SelectedTariffReference = {
  schema_version: 1;
  table: string;
  id: string;
  validation_status: "provisional" | "unverified";
  selected_at: string;
  snapshot: Row;
};
const FIELDS = ["fee_line_id", "label", "description", "notes", "source", "source_reference", "tariff_document_id", "created_at",
  "method", "amount", "amount_20", "amount_40", "percent", "value_basis", "min_amount", "max_amount",
  "pricing_mode", "base_price", "min_price", "max_price", "value", "unit", "unit_type", "currency",
  "effective_from", "effective_to", "valid_from", "valid_to", "updated_at", "client_code", "service_key",
  "service_code", "transport_mode", "mode_scope", "direction", "shipment_type", "customs_regime_code",
  "container_family", "dangerous_goods", "weight_min_kg", "weight_max_kg", "value_min", "value_max",
  "basis", "mode", "min_value", "max_value", "min_weight_kg", "max_weight_kg", "price", "scope",
  "container_type", "corridor", "origin_port", "destination_port", "origin_country", "destination_country"];

export function selectedTariffReference(table: string, selected: unknown, selectedAt: string): SelectedTariffReference {
  const r = row(selected);
  if (!text(r.id)) throw new Error("SELECTED_TARIFF_REFERENCE_MISSING");
  const snapshot: Row = {};
  for (const key of FIELDS) {
    const v = r[key];
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) snapshot[key] = v;
  }
  // Activity/confidence do not establish contractual validation. Explicit provisional wording wins.
  const provisional = /provisoire|provisional/i.test([r.label, r.description, r.notes, r.source_reference].map(text).join(" "));
  return { schema_version: 1, table, id: text(r.id), selected_at: selectedAt,
    validation_status: provisional ? "provisional" : "unverified", snapshot };
}

export function tariffReferenceNotice(source: unknown): string | null {
  const ref = row(row(source).tariff_reference);
  if (ref.schema_version !== 1 || !text(ref.id)) return null;
  return ref.validation_status === "provisional" ? "Forfait provisoire, compris dans le total, non ferme"
    : "Tarif non validé, compris dans le total, non ferme";
}

/** Same source object passes from PSL to run to immutable version; no additional tariff lookup. */
export function partialServiceSource(line: { source: string; confidence?: number; tariff_reference?: SelectedTariffReference }, type: string): Row {
  const ref = line.tariff_reference;
  return { type, reference: ref ? `${ref.table}/${ref.id}` : "PARTIAL_DESTINATION_SERVICE",
    confidence: line.confidence ?? 0, ...(ref ? { tariff_reference: ref, firm_eligible: false } : {}) };
}
