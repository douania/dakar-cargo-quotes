/** Recorded cargo bases for presentation only. Never changes pricing inputs or facts.
 * Engine/PricingInputs.cargoWeight is explicitly tonnes; fact cargo.weight_kg is kg.
 * Convert only these named contracts to kg. Generic/legacy weights keep unknown units.
 * No totals are inferred, and no current dossier data repairs a saved quotation.
 */
import { readOperatorBasis } from "./operator-quotation-basis.ts";
type Row = Record<string, unknown>;
const row = (v: unknown): Row => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const list = (v: unknown): Row[] => Array.isArray(v) ? v.map(row) : [];
const text = (v: unknown): string => typeof v === "string" ? v.trim() : "";
const number = (v: unknown): number | null => (typeof v === "number" || (typeof v === "string" && /^\d+(?:\.\d+)?$/.test(v.trim()))) && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;

export type CargoWeight = { status: "known" | "missing" | "unit_unknown" | "conflict"; kg: number | null; recorded_value: number | null; source_keys: string[] };
export type CargoBasisLot = { lot_index: number; label: string; source_id: string | null; containers: Array<{ type: string; quantity: number | null }>; weight: CargoWeight };
export type QuotationCargoBasis = { schema_version: 1; source: "pricing_run" | "request_lines"; source_id: string | null; lots: CargoBasisLot[] };
const emptyWeight = (): CargoWeight => ({ status: "missing", kg: null, recorded_value: null, source_keys: [] });

function resolveWeights(candidates: Array<{ value: unknown; key: string; unit: "kg" | "t" | null; declaredUnit?: unknown }>): CargoWeight {
  const values = candidates.filter(c => c.value !== undefined && c.value !== null && c.value !== "");
  if (!values.length) return emptyWeight();
  const keys = values.map(c => c.key);
  const known: number[] = [];
  let unknown = false;
  for (const c of values) {
    const n = number(c.value);
    if (n === null || (c.declaredUnit !== undefined && c.declaredUnit !== null && text(c.declaredUnit).toLowerCase() !== c.unit)) {
      return { status: "conflict", kg: null, recorded_value: null, source_keys: keys };
    }
    if (c.unit === null) unknown = true;
    else known.push(c.unit === "t" ? n * 1000 : n);
  }
  if (unknown) return { status: known.length || values.length > 1 ? "conflict" : "unit_unknown", kg: null, recorded_value: values.length === 1 ? number(values[0].value) : null, source_keys: keys };
  if (known.some(v => !Number.isFinite(v) || Math.abs(v - known[0]) > 1e-6)) return { status: "conflict", kg: null, recorded_value: null, source_keys: keys };
  return { status: "known", kg: known[0], recorded_value: null, source_keys: keys };
}

function engineWeight(params: Row): CargoWeight {
  return resolveWeights([
    { key: "engine.cargoWeight_t", value: params.cargoWeight, unit: "t", declaredUnit: params.cargoWeightUnit },
    { key: "engine.cargo_weight", value: params.cargo_weight, unit: params.cargo_weight_unit === "kg" ? "kg" : params.cargo_weight_unit === "t" ? "t" : null, declaredUnit: params.cargo_weight_unit },
  ]);
}
function containers(value: unknown): CargoBasisLot["containers"] {
  // Extraction may retain serialized JSON or the explicit NxEQUIPMENT form.
  // Free text is never interpreted as a container quantity.
  if (typeof value === "string") {
    const serialized = value.trim();
    try { return containers(JSON.parse(serialized)); } catch { /* strict text form below */ }
    const match = /^(\d+)\s*[x×]\s*(20DV|20GP|40DV|40GP|40HC|20RF|40RF|45HC)$/i.exec(serialized);
    return match ? [{ type: match[2].toUpperCase(), quantity: number(match[1]) }] : [];
  }
  return list(value).map(c => ({ type: text(c.type), quantity: number(c.quantity) })).filter(c => c.type !== "");
}

/** Exact successful run only. Match lot indexes, never array position or global facts. */
export function buildPricingCargoBasis(value: unknown): QuotationCargoBasis | null {
  const run = row(value), engine = row(run.engine_request), output = row(run.outputs_json), inputs = row(run.inputs_json);
  // Adopted scenarios retain their dedicated operator bases, never an aggregate fake lot.
  if (readOperatorBasis(output.operator_basis)) return null;
  const multi = output.multi_lot === true || engine.mode === "multi_lot" || inputs.mode === "multi_lot";
  const outputLots = list(output.lots);
  if (multi) {
    if (!outputLots.length) return null;
    const engineLots = list(engine.lots);
    const lots = outputLots.map(l => {
      const index = number(l.lot_index);
      if (index === null || !Number.isSafeInteger(index) || index < 1 || outputLots.filter(o => number(o.lot_index) === index).length !== 1) throw new Error("CARGO_BASIS_LOT_INDEX_INVALID");
      const matches = engineLots.filter(e => number(e.lot_index) === index);
      const params = matches.length === 1 ? row(matches[0].params) : {};
      return { lot_index: index, label: text(l.label ?? l.lot_label) || `Lot ${index}`, source_id: text(run.id) || null,
        containers: containers(params.containers), weight: matches.length > 1 ? { ...emptyWeight(), status: "conflict" as const } : engineWeight(params) };
    });
    return { schema_version: 1, source: "pricing_run", source_id: text(run.id) || null, lots };
  }
  // Older runs without the recorded engine request have no engine provenance.
  if (!Object.keys(engine).length) return null;
  const params = engine;
  const weight = engineWeight(params), equipment = containers(params.containers);
  if (weight.status === "missing" && !equipment.length) return null;
  return { schema_version: 1, source: "pricing_run", source_id: text(run.id) || null, lots: [{ lot_index: 1, label: "Marchandise", source_id: text(run.id) || null, containers: equipment, weight }] };
}

/** Current request line extraction, explicitly not an operator confirmation. */
export function buildRequestCargoBasis(value: unknown): QuotationCargoBasis {
  const lines = list(value);
  const lots = lines.map(line => {
    const index = number(line.line_index);
    if (index === null || !Number.isSafeInteger(index) || index < 1 || lines.filter(l => number(l.line_index) === index).length !== 1) throw new Error("CARGO_BASIS_LOT_INDEX_INVALID");
    const facts = list(line.extracted_facts_json);
    const weightFacts = facts.filter(f => ["cargo.weight_kg", "cargo.weight_t", "cargo.weight"].includes(text(f.key)));
    const containerFacts = facts.filter(f => f.key === "cargo.containers");
    return { lot_index: index, label: text(line.line_label) || `Ligne ${index}`, source_id: text(line.id) || null,
      containers: containerFacts.length === 1 ? containers(containerFacts[0].value ?? containerFacts[0].value_json) : [],
      weight: resolveWeights(weightFacts.map(f => ({ key: text(f.key), value: f.value ?? f.value_number ?? f.value_text,
        unit: f.key === "cargo.weight_kg" ? "kg" as const : f.key === "cargo.weight_t" ? "t" as const : f.unit === "kg" ? "kg" as const : f.unit === "t" ? "t" as const : null,
        declaredUnit: f.unit }))) };
  });
  return { schema_version: 1, source: "request_lines", source_id: null, lots };
}

/** Presence must be valid. A damaged new block must never fall back to old globals. */
export function readQuotationCargoBasis(value: unknown): QuotationCargoBasis | null {
  if (value === undefined) return null;
  const b = row(value);
  const nullableText = (v: unknown) => v === null || typeof v === "string";
  if (b.schema_version !== 1 || !["pricing_run", "request_lines"].includes(String(b.source)) || !nullableText(b.source_id) || !Array.isArray(b.lots) || (b.source === "pricing_run" && !b.lots.length)) throw new Error("CARGO_BASIS_INVALID");
  const lots = list(b.lots), indexes = new Set<number>();
  for (const lot of lots) {
    const w = row(lot.weight), index = number(lot.lot_index);
    if (typeof lot.lot_index !== "number" || index === null || !Number.isSafeInteger(index) || index < 1 || indexes.has(index) || typeof lot.label !== "string" || !nullableText(lot.source_id) || !Array.isArray(lot.containers) ||
      lot.containers.some(c => { const equipment = row(c); return !text(equipment.type) || (equipment.quantity !== null && (typeof equipment.quantity !== "number" || number(equipment.quantity) === null)); }) ||
      !["known", "missing", "unit_unknown", "conflict"].includes(String(w.status)) || !Array.isArray(w.source_keys) || w.source_keys.some(k => typeof k !== "string") ||
      (w.status === "known" ? typeof w.kg !== "number" || number(w.kg) === null : w.kg !== null) ||
      (w.status === "unit_unknown" ? typeof w.recorded_value !== "number" || number(w.recorded_value) === null : w.recorded_value !== null)) throw new Error("CARGO_BASIS_INVALID");
    indexes.add(index);
  }
  return b as unknown as QuotationCargoBasis;
}

/** Shared dossier/retained-bases/client UI/PDF wording; no sum of lots. */
export function quotationCargoBasisText(value: unknown): string[] {
  const b = readQuotationCargoBasis(value);
  if (!b) return [];
  const fmt = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(n);
  return b.lots.map(lot => {
    const equipment = lot.containers.map(c => `${c.quantity === null ? "quantité non précisée" : fmt(c.quantity)} × ${c.type}`).join(" ; ");
    const w = lot.weight;
    const weight = w.status === "known" ? `poids total du lot : ${fmt(w.kg!)} kg` : w.status === "unit_unknown" ? `poids enregistré : ${fmt(w.recorded_value!)} (unité non précisée)` : w.status === "conflict" ? "poids à clarifier : valeurs ou unités contradictoires" : "poids du lot non précisé";
    return `${lot.label} : ${[equipment, weight].filter(Boolean).join(" ; ")}${b.source === "request_lines" ? " (extrait de la demande, à confirmer)" : " (base enregistrée du calcul)"}.`;
  });
}
