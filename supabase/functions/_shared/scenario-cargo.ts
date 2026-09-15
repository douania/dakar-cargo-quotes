/** Scenario-only cargo contract. No database I/O, no client evidence invented. */
import { normalizeDthcContainerType, resolveContainerProfile } from "./dpw-dthc-tariff.ts";
import { normalizeImdgClass, normalizeUnNumber } from "./imo-classification.ts";
import { resolveImoFromUn } from "./imo-un-resolution.ts";

export const SCENARIO_CARGO_V2_KEYS = [
  "ownership", "un_number", "imo_class", "weight_basis", "scenario_basis",
] as const;

/** Called in addition to the unchanged closed v1 structural validator. */
export function scenarioCargoV2Violation(u: Record<string, unknown>): string | null {
  if (u.dangerous_goods !== null && typeof u.dangerous_goods !== "boolean") return "dangerous_goods";
  if (![null, "SOC", "COC"].includes(u.ownership as string | null)) return "ownership";
  if (typeof u.weight_basis !== "string" || !["total", "per_unit", "unknown"].includes(u.weight_basis)) return "weight_basis";
  if (typeof u.scenario_basis !== "string" || u.scenario_basis.length > 500) return "scenario_basis";
  if (u.un_number !== null && (typeof u.un_number !== "string" || normalizeUnNumber(u.un_number) !== u.un_number)) return "un_number";
  if (u.imo_class !== null && (typeof u.imo_class !== "string" || normalizeImdgClass(u.imo_class) !== u.imo_class)) return "imo_class";
  // Unknown remains unknown: a number alone must not silently declare a group DG.
  if (u.dangerous_goods !== true && (u.un_number !== null || u.imo_class !== null)) return "danger_classification_conflict";
  return null;
}

/** Projection is for validation only. Never persist or price this projection. */
export function scenarioCargoV1ValidationShape(u: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...u, dangerous_goods: u.dangerous_goods === true };
  for (const key of SCENARIO_CARGO_V2_KEYS) delete result[key];
  return result;
}

export interface ScenarioCargoContainer extends Record<string, unknown> {
  unit_ref: string;
  type: string;
  quantity: number;
  coc_soc: "SOC" | "COC";
}
export interface ScenarioCargoRow {
  unitRef: string;
  dangerous: boolean | null;
  unNumber: string | null;
  imoClass: string | null;
  classification: ReturnType<typeof resolveImoFromUn>;
  basis: string;
  weightPerContainerKg: number | null;
}
export interface ScenarioCargoContext {
  schema_version: 2;
  cargo_units: Record<string, unknown>[];
}

/** Only explicit scenario groups supply cargo; global cargo facts are not patched. */
export function resolveScenarioCargo(context: ScenarioCargoContext) {
  const blockers: string[] = [];
  const reservations: Record<string, unknown>[] = [];
  const containers: ScenarioCargoContainer[] = [];
  const rows: ScenarioCargoRow[] = [];
  let weightKg = 0;
  let volumeDm3 = 0;
  let weightKnown = true;
  let volumeKnown = true;
  const refs = new Set<string>();
  if (context?.schema_version !== 2 || !Array.isArray(context.cargo_units) ||
    context.cargo_units.length < 1 || context.cargo_units.length > 12) {
    return { blockers: ["SCENARIO_CARGO_CONTEXT_INVALID"], reservations, containers, rows, cargoWeight: undefined, cargoVolume: undefined };
  }
  for (const u of context.cargo_units) {
    const ref = String(u?.unit_ref ?? "");
    if (!u || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(ref) || refs.has(ref) ||
      scenarioCargoV2Violation(u) || !Number.isSafeInteger(u.quantity) || Number(u.quantity) < 1 || Number(u.quantity) > 1e12) {
      blockers.push(`SCENARIO_CARGO_GROUP_INVALID:${ref}`);
      continue;
    }
    refs.add(ref);
    const type = normalizeDthcContainerType(u.equipment_code);
    if (u.unit_kind !== "CONTAINER" || !resolveContainerProfile(type)) blockers.push(`SCENARIO_CONTAINER_TYPE_REQUIRED:${ref}`);
    if (u.ownership !== "SOC" && u.ownership !== "COC") blockers.push(`SCENARIO_OWNERSHIP_REQUIRED:${ref}`);
    if (!String(u.scenario_basis).trim()) blockers.push(`SCENARIO_BASIS_REQUIRED:${ref}`);
    const classification = resolveImoFromUn(u.un_number, u.imo_class);
    if (["INVALID", "CONFLICT"].includes(classification.status)) blockers.push(`SCENARIO_IMO_CONFLICT:${ref}`);
    const dangerous = u.dangerous_goods as boolean | null;
    if (dangerous === null || (dangerous && !["DERIVED", "CONFIRMED"].includes(classification.status))) {
      reservations.push({ code: dangerous === null ? "SCENARIO_DG_UNKNOWN" : "SCENARIO_IMO_INCOMPLETE", source: "scenario_cargo", unit_ref: ref,
        message: `Lot ${ref} : ${dangerous === null ? 'danger inconnu, DTHC à confirmer' : classification.message}` });
    }
    for (const key of ["gross_weight_kg", "volume_dm3"] as const) {
      if (u[key] !== null && (!Number.isSafeInteger(u[key]) || Number(u[key]) < 0 || Number(u[key]) > 1e12)) blockers.push(`SCENARIO_MEASURE_INVALID:${ref}:${key}`);
    }
    if (u.gross_weight_kg === null || u.weight_basis === "unknown") weightKnown = false;
    else weightKg += Number(u.gross_weight_kg) * (u.weight_basis === "per_unit" ? Number(u.quantity) : 1);
    if (u.volume_dm3 === null) volumeKnown = false;
    else volumeDm3 += Number(u.volume_dm3);
    containers.push({ unit_ref: ref, type, quantity: Number(u.quantity), coc_soc: u.ownership as "SOC" | "COC" });
    rows.push({ unitRef: ref, dangerous, unNumber: classification.unNumber, imoClass: classification.imdgClass, classification, basis: String(u.scenario_basis),
      weightPerContainerKg: u.gross_weight_kg === null || u.weight_basis === "unknown" ? null : Number(u.gross_weight_kg) / (u.weight_basis === "total" ? Number(u.quantity) : 1) });
    reservations.push({ code: "SCENARIO_CARGO_GROUP_ASSUMPTION", source: "scenario_cargo", unit_ref: ref,
      message: `Lot ${ref} : hypothèse ${u.quantity} × ${type} ${u.ownership ?? 'propriété inconnue'} ; danger ${dangerous === null ? 'inconnu' : dangerous ? 'oui' : 'non'} ; poids ${u.gross_weight_kg ?? 'inconnu'} kg (${u.weight_basis}). ${classification.message} Justification opérateur : ${u.scenario_basis}` });
  }
  if (!Number.isSafeInteger(weightKg) || weightKg > 1e12 || !Number.isSafeInteger(volumeDm3) || volumeDm3 > 1e12) blockers.push("SCENARIO_MEASURE_OVERFLOW");
  if (!weightKnown) reservations.push({ code: "SCENARIO_WEIGHT_UNKNOWN", source: "scenario_cargo", message: "Poids total inconnu : aucune somme partielle utilisée comme poids du chargement." });
  reservations.push({ code: "SCENARIO_CARGO_ASSUMPTIONS", source: "scenario_cargo", message: "Périmètre de simulation saisi par l’opérateur, non promu en faits client. Tous les montants restent indicatifs." });
  reservations.push({ code: "SCENARIO_OWNERSHIP_NOT_PRICED", source: "scenario_cargo", message: "Propriété SOC/COC conservée comme hypothèse, sans ajustement tarifaire SOC/COC dans cette version. Les frais dépendant de cette propriété restent à vérifier ; aucune exonération ni majoration déduite." });
  return { blockers, reservations, containers, rows, cargoWeight: weightKnown ? weightKg / 1000 : undefined, cargoVolume: volumeKnown ? volumeDm3 / 1000 : undefined };
}

/** Recompute at the engine boundary and match by stable reference, not position. */
export function assertScenarioCargoContext(context: ScenarioCargoContext, containers: Array<{ unit_ref?: string; type: string; quantity: number; coc_soc?: string }>) {
  const plan = resolveScenarioCargo(context);
  if (plan.blockers.length || containers.length !== plan.containers.length || new Set(containers.map(c => c.unit_ref)).size !== containers.length ||
    containers.some(c => !plan.containers.some(p => p.unit_ref === c.unit_ref && p.type === c.type && p.quantity === c.quantity && p.coc_soc === c.coc_soc))) {
    throw new Error("SCENARIO_CARGO_CONTEXT_INVALID");
  }
  return plan;
}
