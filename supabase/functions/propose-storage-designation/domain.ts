export type Row = Record<string, unknown>;
export const normalize = (v: unknown) => typeof v === "string" ? v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : "";
export const redact = (v: string) => v.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[adresse masquée]").replace(/https?:\/\/\S+/gi, "[lien masqué]");
/** Only the target's own evidence may rule out furniture; neighbouring lots are not evidence of its nature. */
export function storageContext(unit: Row): Row {
  return Object.fromEntries(["unit_ref", "equipment_code", "quantity", "ownership", "gross_weight_kg", "weight_basis", "un_number", "imo_class", "dangerous_goods", "scenario_basis"].map(key =>
    [key, typeof unit[key] === "string" ? redact(String(unit[key]).slice(0, 1000)) : unit[key] ?? null]));
}
/** Catalogue kg notation uses grouped thousands (1,500 / 3,001).
 * No conversion of a group total into an individual parcel weight is justified here.
 * Unparsed restrictions are withheld, never treated as an unrestricted designation.
 */
export function storageWeightCompatible(unit: Row, label: unknown): boolean {
  if (typeof label !== "string") return false;
  const text = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  if (/\b(sauf|hors|exclu\w*|except\w*|colis lourds?)\b/.test(text)) return false;
  if (!/\b(kg|kgs|kilogrammes?|tonnes?|tons?|t|poids|weight)\b/.test(text)) return true;
  const weight = unit.gross_weight_kg;
  // per_unit in a scenario may mean per container, not per piece. Require the
  // joined source's explicit single-piece quantity basis and exact /unit weight.
  const piece = String(unit.scenario_basis ?? "").match(/:\s*(\d+(?:[.,]\d+)?)\s*(kg|t)\s*\/\s*(?:unit|unite)\b/i);
  if (unit.source_quantity_basis !== "one_unit_per_container" || !piece ||
    unit.weight_basis !== "per_unit" || typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0 ||
    Number(piece[1].replace(",", ".")) * (piece[2].toLowerCase() === "t" ? 1000 : 1) !== weight) return false;
  const number = "(?:\\d{1,3}(?:[, .]\\d{3})+|\\d+)";
  const suffix = "\\s*(?:kg|kgs|kilogrammes?)\\s*[.)]?\\s*$";
  const kg = (v: string) => Number(v.replace(/[, .]/g, ""));
  // A recognised suffix is not sufficient if an earlier clause carries another constraint.
  const singleRestriction = (match: RegExpMatchArray) => !/[0-9]|\b(poids|weight|kgs?|kilogrammes?|tonnes?|tons?|t|moins|plus|entre|jusqu)\b/.test(text.slice(0, match.index));
  const range = text.match(new RegExp(`\\b(plus de|de)\\s+(${number})\\s*(?:kgs?\\s*)?a\\s+(${number})${suffix}`));
  if (range) {
    if (!singleRestriction(range)) return false;
    const lower = kg(range[2]), upper = kg(range[3]);
    return lower < upper && (range[1] === "plus de" ? weight > lower : weight >= lower) && weight <= upper;
  }
  const bound = text.match(new RegExp(`\\b(plus de|moins de|jusqu a)\\s+(${number})${suffix}`));
  if (!bound || !singleRestriction(bound)) return false;
  const threshold = kg(bound[2]);
  return bound[1] === "plus de" ? weight > threshold : bound[1] === "moins de" ? weight < threshold : weight <= threshold;
}
export function compatibleStorageCatalog(unit: Row, catalog: Row[]): Row[] {
  const text = normalize(unit.scenario_basis);
  const electrical = normalize(unit.un_number).replace(/ /g, "") === "un3536" || /\b(bess|batteries|battery|batterie|accumulateurs|transformers|transformateurs)\b/.test(text) || /\b(energy storage|stockage d energie)\b/.test(text);
  return catalog.filter(d => {
    if (!storageWeightCompatible(unit, d.designation_label)) return false;
    if (!electrical) return true;
    const label = normalize(d.designation_label);
    if (/\b(mobilier|meubles?|placards?|furniture|wardrobes?)\b/.test(label)) return false;
    // A generic cupboard label is not evidence of an electrical cabinet designation.
    return !/\b(armoires?|cabinets?)\b/.test(label) || /\b(electri\w*|batter\w*|accumulateurs?|energy|energie|bess)\b/.test(label);
  });
}
export interface Candidate {
  id: string; label: string; code: string | null; unit: string; method: "alias" | "direct" | "ai";
  justification: string; applicable: boolean;
  document: string | null; evidence: string | null; effective_date: string | null;
}
export function candidate(row: Row, method: Candidate["method"], justification: string): Candidate {
  const code = typeof row.storage_code_p1 === "string" ? row.storage_code_p1 : null;
  return { id: String(row.id), label: String(row.designation_label), code, unit: String(row.unit_basis), method,
    justification, applicable: !!code && /^41[0-9]$/.test(code) && row.unit_basis === "tonne_per_day",
    document: typeof row.source_document === "string" ? row.source_document : null,
    evidence: typeof row.evidence_level === "string" ? row.evidence_level : null,
    effective_date: typeof row.effective_date === "string" ? row.effective_date : null };
}
export function exactCandidates(description: string, catalog: Row[], aliases: Row[]): Candidate[] {
  const term = normalize(description);
  if (!term) return [];
  const ids = new Set(aliases.filter(a => a.is_validated === true && normalize(a.normalized_term) === term).map(a => a.terminal_designation_id));
  const matches = catalog.filter(d => ids.has(d.id));
  return matches.length ? matches.map(d => candidate(d, "alias", "Alias validé correspondant au libellé complet du lot."))
    : catalog.filter(d => normalize(d.designation_label) === term).map(d => candidate(d, "direct", "Libellé complet identique après normalisation."));
}
/** IDs select catalogue entries; AI never supplies the label, code, unit or amount. */
export function aiCandidates(raw: unknown, catalog: Row[]): Candidate[] {
  if (!Array.isArray(raw) || raw.length > 3) return [];
  const seen = new Set(); const out: Candidate[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const v = r as Row;
    const d = catalog.find(d => d.id === v.designation_id);
    if (!d || seen.has(d.id) || typeof v.justification !== "string" || !v.justification.trim() || v.justification.length > 800) continue;
    seen.add(d.id); out.push(candidate(d, "ai", v.justification.trim()));
  }
  return out;
}
