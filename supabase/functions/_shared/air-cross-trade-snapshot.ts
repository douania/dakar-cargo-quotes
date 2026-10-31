/** Immutable cross-trade basis, shared by canonical/commercial snapshots and client projection.
 * Internal source rows, purchase prices, operator reasons and IDs are NEVER projected to the client.
 */
import type { AirPlanRevision } from "./air-cross-trade.ts";
type Row = Record<string, unknown>;
const row = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
export interface AirCrossTradeBasis extends Row {
  schema_version: 1;
  request_type: "AIR_CROSS_TRADE";
  plan: AirPlanRevision;
  context_fingerprint: string;
  demand: { origin_country: string; destination_country: string; arrival_airport: string };
}
/** Legacy snapshots remain unchanged; a present malformed basis is never silently discarded. */
export function readAirCrossTradeBasis(value: unknown): AirCrossTradeBasis | null {
  if (value === null || value === undefined) return null;
  if (!row(value) || value.schema_version !== 1 || value.request_type !== "AIR_CROSS_TRADE" ||
    !row(value.plan) || typeof value.plan.id !== "string" || !value.plan.id ||
    !row(value.plan.plan) || !row(value.plan.plan.route) || !Array.isArray(value.plan.plan.services) ||
    !row(value.demand) || !Array.isArray(value.sources) || !Array.isArray(value.unresolved) || value.unresolved.length !== 0 ||
    typeof value.context_fingerprint !== "string" || value.plan.context_fingerprint !== value.context_fingerprint) throw new Error("Invalid AIR_CROSS_TRADE snapshot basis");
  const route = value.plan.plan.route;
  for (const k of ["departure_airport", "arrival_airport"]) if (typeof route[k] !== "string" || !/^[A-Z]{3}$/.test(route[k] as string)) throw new Error("Invalid saved air route");
  for (const k of ["departure_country", "arrival_country"]) if (typeof route[k] !== "string" || !/^[A-Z]{2}$/.test(route[k] as string)) throw new Error("Invalid saved air country");
  if (value.demand.arrival_airport !== route.arrival_airport || value.demand.destination_country !== route.arrival_country ||
    typeof value.demand.origin_country !== "string" || !/^[A-Z]{2}$/.test(value.demand.origin_country)) throw new Error("Saved air route contradicts demand");
  return structuredClone(value) as AirCrossTradeBasis;
}
export function airCrossTradeMissingCoverage(value: unknown, currentLines?: unknown[]): string[] {
  const basis = readAirCrossTradeBasis(value);
  if (!basis || !currentLines) return [];
  const active = new Set(currentLines.filter(row).filter(l => {
    const commercial = row(l.commercial) ? l.commercial : {};
    const source = row(l.source) ? l.source : {};
    return commercial.included !== false && source.type !== "EXCLUDED_BY_RULE" && typeof l.amount === "number" && Number.isFinite(l.amount);
  }).map(l => String(l.service_code ?? l.category ?? "")));
  for (const d of basis.plan.plan.services) if (d.disposition === "included" && active.has(d.included_in ?? "")) active.add(d.service_key);
  const required = Array.isArray(basis.requested_services) ? basis.requested_services.filter((k): k is string => typeof k === "string") : [];
  if (basis.plan.plan.route.pre_carriage === "retained" && !required.includes("PRE_CARRIAGE")) required.push("PRE_CARRIAGE");
  return required.filter(k => !active.has(k));
}
export function airCrossTradeClientBases(value: unknown, currentLines?: unknown[]): string[] {
  const basis = readAirCrossTradeBasis(value);
  if (!basis) return [];
  const route = basis.plan.plan.route;
  const missing = airCrossTradeMissingCoverage(value, currentLines);
  const bases = [`Parcours de référence${missing.length ? " (périmètre réduit)" : ""} : collecte ${basis.demand.origin_country}, départ ${route.departure_airport} (${route.departure_country}), arrivée ${route.arrival_airport} (${route.arrival_country}).`];
  if (route.pre_carriage === "retained") bases.push(missing.includes("PRE_CARRIAGE")
    ? "Préacheminement non compris dans le montant actuel."
    : `Préacheminement compris dans le périmètre retenu jusqu’à ${route.departure_airport}.`);
  if (missing.length) bases.push("Certaines prestations du parcours de référence sont retirées du devis ; le montant ne couvre pas le transport complet.");
  bases.push("Parcours et prix client retenus par l’opérateur pour cette estimation ; toute modification nécessite une nouvelle cotation.");
  return bases;
}
