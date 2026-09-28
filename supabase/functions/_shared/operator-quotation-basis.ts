/** Immutable commercial bases. Never promotes assumptions to client facts. */
type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const text = (v: unknown): string => v === null || v === undefined ? "non précisé" : typeof v === "object" ? JSON.stringify(v) : String(v);
// Technical evidence remains in the immutable snapshot, not in client prose.
const prose = (v: unknown): string => text(v)
  .replace(/SHA256\s+[a-f0-9]{64};?\s*/gi, "")
  .replace(/e-mail\s+[a-f0-9-]{36}/gi, "e-mail source")
  .replace(/\bper_unit\b/g, "par unité");
function assumptionText(key: unknown, value: unknown): string {
  const v = row(value);
  if (key !== "routing.local_transport_estimate") return prose(value);
  const groups = Array.isArray(v.groups) ? v.groups.map(item => {
    const g = row(item);
    return `Lot ${text(g.unit_ref)} : ${text(g.quantity)} × ${text(g.equipment_code)}, ${text(g.weight_per_container_kg)} kg par conteneur. ${g.standard_estimate_only === true ? "Estimation standard provisoire ; véhicule, tare et répartition par essieu à vérifier." : `Transport ordinaire : ${g.ordinary_transport === true ? "retenu" : "non établi"}.`} Charge utile maximale : ${text(g.max_payload_kg)} kg. ${g.unknown_danger_base_only === true ? "Danger inconnu : supplément et contraintes IMO exclus de cette base." : ""} ${prose(g.qualification_source)}`;
  }).join(" ") : "Groupes de transport non précisés.";
  return `Trajet ${text(v.origin)} → ${text(v.destination)} (${text(v.country)}) ; distance retenue ${text(v.distance_km)} km. Source de distance : ${prose(v.distance_source)}. Vérification du ${text(v.verified_on)}. ${groups}`;
}
const openPointLabels: Record<string, string> = {
  commodity_classification_unknown: "Classification de la marchandise non établie",
  customs_regime_unknown: "Régime douanier non établi",
  packaging_unknown: "Conditionnement non précisé",
  port_to_propose: "Port à préciser",
  terminal_operation_mode_unknown: "Mode de manutention au terminal non établi",
};
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
    lines.push(`Lot ${text(u.unit_ref)} : ${text(u.quantity)} × ${text(u.equipment_code ?? u.unit_kind)} ; propriété ${text(u.ownership)} ; poids déclaré ${text(u.gross_weight_kg)} kg (${u.weight_basis === "per_unit" ? "par unité" : u.weight_basis === "total" ? "total du lot" : "base de poids non précisée"}). Danger : ${u.dangerous_goods === true ? "oui" : u.dangerous_goods === false ? "non, selon base retenue" : "inconnu"} ; numéro ONU ${text(u.un_number)} ; classe IMDG ${text(u.imo_class)}. Base opérateur : ${prose(u.scenario_basis)}.`);
  }
  for (const a of b.assumptions) lines.push(`Hypothèse : ${prose(a.statement)} — valeur retenue ${assumptionText(a.assumed_fact_key, a.assumed_value)}.${a.basis ? ` Justification : ${prose(a.basis)}.` : ""}`);
  // Includes non-cargo operational assumptions (route, days, equipment, etc.).
  for (const o of b.overlay.filter(o => o.basis === "assumption")) {
    if (b.assumptions.some(a => a.assumed_fact_key === o.fact_key && JSON.stringify(a.assumed_value) === JSON.stringify(o.value))) continue;
    lines.push(`Paramètre retenu sous hypothèse : ${o.fact_key === "routing.local_transport_estimate" ? "Transport routier" : text(o.fact_key)} : ${assumptionText(o.fact_key, o.value)}.`);
  }
  for (const r of [...b.reservations, ...b.open_points]) {
    const data = row(r);
    const pointCode = text(data.reason ?? data.code);
    const ref = data.unit_ref ?? data.ref ?? (typeof data.open_point_key === "string" ? data.open_point_key.split(":")[1] : null);
    const message = data.message ?? data.statement ?? openPointLabels[pointCode] ?? data.code;
    const detail = typeof r === "string" ? prose(r) : [ref ? `Périmètre ${ref}` : null, data.service_key, message].filter(Boolean).map(prose).join(" — ") || prose(r);
    lines.push(`Réserve : ${detail}.`);
  }
  return [...new Set(lines)];
}
