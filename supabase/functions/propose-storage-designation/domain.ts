export type Row = Record<string, unknown>;
export const normalize = (v: unknown) => typeof v === "string" ? v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : "";
export const redact = (v: string) => v.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[adresse masquée]").replace(/https?:\/\/\S+/gi, "[lien masqué]");
/** Only the target's own evidence may rule out furniture; neighbouring lots are not evidence of its nature. */
export function storageContext(unit: Row): Row {
  return Object.fromEntries(["unit_ref", "equipment_code", "quantity", "ownership", "gross_weight_kg", "weight_basis", "un_number", "imo_class", "dangerous_goods", "scenario_basis"].map(key =>
    [key, typeof unit[key] === "string" ? redact(String(unit[key]).slice(0, 1000)) : unit[key] ?? null]));
}
export function compatibleStorageCatalog(unit: Row, catalog: Row[]): Row[] {
  const text = normalize(unit.scenario_basis);
  const electrical = normalize(unit.un_number).replace(/ /g, "") === "un3536" || /\b(bess|batteries|battery|batterie|accumulateurs|transformers|transformateurs)\b/.test(text) || /\b(energy storage|stockage d energie)\b/.test(text);
  return electrical ? catalog.filter(d => {
    const label = normalize(d.designation_label);
    if (/\b(mobilier|meubles?|placards?|furniture|wardrobes?)\b/.test(label)) return false;
    // A generic cupboard label is not evidence of an electrical cabinet designation.
    return !/\b(armoires?|cabinets?)\b/.test(label) || /\b(electri\w*|batter\w*|accumulateurs?|energy|energie|bess)\b/.test(label);
  }) : catalog;
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
