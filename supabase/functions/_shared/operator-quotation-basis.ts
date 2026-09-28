/** Immutable commercial bases. Never promotes assumptions to client facts. */
type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const text = (v: unknown): string => v === null || v === undefined ? "non précisé" : typeof v === "object" ? JSON.stringify(v) : String(v);
export interface OperatorQuotationBasis extends Row {
  schema_version: 1;
  title: string;
  revision_no: number;
  calculated_at: string;
  scope: Row;
  assumptions: Row[];
  overlay: Row[];
  reservations: unknown[];
  open_points: unknown[];
}

/** Absence is legacy; presence must be valid, never silently omitted. */
export function readOperatorBasis(value: unknown): OperatorQuotationBasis | null {
  if (value === undefined) return null;
  const b = row(value);
  if (b.schema_version !== 1 || typeof b.title !== "string" || !b.title.trim() ||
    !Number.isInteger(b.revision_no) || Number(b.revision_no) < 1 ||
    typeof b.calculated_at !== "string" || !Number.isFinite(Date.parse(b.calculated_at)) ||
    typeof b.source_run_id !== "string" || typeof b.scope_hash !== "string" ||
    !/^[a-f0-9]{64}$/.test(b.scope_hash) || !Array.isArray(row(b.scope).cargo_units) ||
    !Array.isArray(b.assumptions) || !Array.isArray(b.overlay) ||
    !Array.isArray(b.reservations) || !Array.isArray(b.open_points)) {
    throw new Error("OPERATOR_BASIS_INVALID: bases de cotation incomplètes");
  }
  return b as OperatorQuotationBasis;
}

export function operatorBasisText(value: unknown): string[] {
  const b = readOperatorBasis(value);
  if (!b) return [];
  const scope = b.scope;
  const lines = [
    `Bases de cotation retenues : ${b.title} — révision ${b.revision_no}. Calcul du ${b.calculated_at}.`,
    "Devis calculé sur les bases et hypothèses ci-dessous, sans confirmation préalable requise. Toute correction du client ou de l’opérateur donnera lieu à une révision et, si nécessaire, à un nouveau calcul.",
    "Les postes non chiffrés ou exclus ne sont pas gratuits. Les réserves de faisabilité et de marchandises dangereuses restent applicables.",
    `Transport : ${text(scope.transport_mode)} ; ${text(scope.movement_direction)}. Origine : ${text(row(scope.origin).location_code)} ; destination : ${text(row(scope.destination).location_code)}.`,
  ];
  for (const item of scope.cargo_units as unknown[]) {
    const u = row(item);
    lines.push(`Lot ${text(u.unit_ref)} : ${text(u.quantity)} × ${text(u.equipment_code ?? u.unit_kind)} ; propriété ${text(u.ownership)} ; poids déclaré ${text(u.gross_weight_kg)} kg (${u.weight_basis === "per_unit" ? "par unité" : u.weight_basis === "total" ? "total du lot" : "base de poids non précisée"}). Danger : ${u.dangerous_goods === true ? "oui" : u.dangerous_goods === false ? "non, selon base retenue" : "inconnu"} ; UN ${text(u.un_number)} ; classe IMDG ${text(u.imo_class)}. Base opérateur : ${text(u.scenario_basis)}.`);
  }
  for (const a of b.assumptions) lines.push(`Hypothèse : ${text(a.statement)} — valeur retenue ${text(a.assumed_value)}. Justification : ${text(a.basis)}.`);
  // Includes non-cargo operational assumptions (route, days, equipment, etc.).
  for (const o of b.overlay.filter(o => o.basis === "assumption")) {
    lines.push(`Paramètre retenu sous hypothèse : ${text(o.fact_key)} = ${text(o.value)}.`);
  }
  for (const r of [...b.reservations, ...b.open_points]) {
    const data = row(r);
    const detail = typeof r === "string" ? r : [data.unit_ref ? `Lot ${data.unit_ref}` : null, data.code, data.service_key, data.open_point_key, data.message ?? data.statement].filter(Boolean).map(text).join(" — ") || text(r);
    lines.push(`Réserve : ${detail}.`);
  }
  return lines;
}
