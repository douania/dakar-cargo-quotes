import {
  assessLocalTransportWeightRule, LOCAL_TRANSPORT_CONTAINER_40,
  normalizeLocalTransportDestination, OFFICIAL_LOCAL_TRANSPORT_SOURCE_DOCUMENT,
  resolveCanonicalLocalTransportContainerType, resolveCanonicalLocalTransportDestination,
  resolveOfficialLocalTransportRate, type LocalTransportRateCandidate,
} from "./local-transport-destination.ts";
import { withLocalTransportDebours } from "./local-transport-debours.ts";

/** GO 2026-09-16: scenario estimate ONLY; neither a tariff nor a client fact.
 * The operator qualifies ordinary carriage and documents the admissible payload
 * (container AND road vehicle). No universal legal weight limit is invented.
 */
export const LOCAL_TRANSPORT_ESTIMATE_KEY = "routing.local_transport_estimate";
export const LOCAL_TRANSPORT_ESTIMATE_RULE = "SN_NORMAL_CONTAINER_KM_V1";
export interface TransportEstimateGroup {
  unit_ref: string;
  equipment_code: string;
  quantity: number;
  weight_per_container_kg: number;
  max_payload_kg: number;
  ordinary_transport: boolean;
  qualification_source: string;
}
export interface TransportEstimateBasis {
  schema_version: 1;
  origin: "Dakar Port";
  country: "SN";
  destination: string;
  distance_km: number;
  distance_source: string;
  verified_on: string;
  groups: TransportEstimateGroup[];
}
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= 1000;
const positive = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0 && x <= 1e9;
const date = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) &&
  Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
export function transportEstimateBasisError(raw: unknown): string | null {
  if (!object(raw) || raw.schema_version !== 1 || raw.origin !== "Dakar Port" || raw.country !== "SN") return "Départ Dakar Port et destination Sénégal requis.";
  if (!text(raw.destination) || !positive(raw.distance_km) || raw.distance_km <= 58 ||
    !text(raw.distance_source) || !date(raw.verified_on)) return "Distance routière supérieure à 58 km, source et date de vérification requises.";
  if (!Array.isArray(raw.groups) || !raw.groups.length || raw.groups.length > 12) return "Qualifier entre 1 et 12 lots.";
  const refs = new Set<string>();
  for (const g of raw.groups) {
    if (!object(g) || typeof g.unit_ref !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(g.unit_ref) || refs.has(g.unit_ref) ||
      !resolveCanonicalLocalTransportContainerType(g.equipment_code) || !Number.isSafeInteger(g.quantity) || !positive(g.quantity) ||
      !positive(g.weight_per_container_kg) || !positive(g.max_payload_kg) || g.weight_per_container_kg > g.max_payload_kg ||
      g.ordinary_transport !== true || !text(g.qualification_source)) return "Lot : TC sec 20/40 pieds, quantité, poids connu, charge admissible sourcée et transport ordinaire attesté requis.";
    refs.add(g.unit_ref);
  }
  return null;
}

export interface TransportEstimateInput {
  basis: unknown;
  destination: string;
  unit: Record<string, unknown>;
  clientCode?: string | null;
  asOfDate: string;
  catalogComplete: boolean;
}
/** Call only AFTER exact resolution failed, with the complete unfiltered catalog.
 * A listed destination with an unusable/ambiguous/expired rate is NOT absent.
 */
export function estimateUnlistedContainerTransport(rates: readonly LocalTransportRateCandidate[], input: TransportEstimateInput) {
  const refuse = (reason: string) => ({ line: null, reason });
  if (!input.catalogComplete) return refuse("Catalogue transport incomplet ou indisponible.");
  const invalid = transportEstimateBasisError(input.basis);
  if (invalid) return refuse(invalid);
  const basis = input.basis as TransportEstimateBasis;
  if (!date(input.asOfDate) || basis.verified_on > input.asOfDate) return refuse("Date de vérification invalide ou future.");
  const destination = normalizeLocalTransportDestination(input.destination);
  if (destination !== normalizeLocalTransportDestination(basis.destination)) return refuse("La distance ne correspond pas à la destination du calcul.");
  const canonical = resolveCanonicalLocalTransportDestination(input.destination);
  if (canonical.canonical !== null || canonical.reason !== "DESTINATION_UNKNOWN") return refuse("Destination répertoriée ou ambiguë : tarif exact requis.");
  if (rates.some(r => normalizeLocalTransportDestination(r.destination) === destination &&
    (r.client_code == null || r.client_code === input.clientCode))) return refuse("Une ligne existe pour cette destination : tarif exact à vérifier, pas de substitution kilométrique.");
  const u = input.unit;
  const g = basis.groups.find(g => g.unit_ref === u.unit_ref);
  const weight = typeof u.gross_weight_kg === "number" && typeof u.quantity === "number" && u.quantity > 0 &&
    ["total", "per_unit"].includes(String(u.weight_basis))
    ? u.gross_weight_kg / (u.weight_basis === "total" ? u.quantity : 1) : null;
  if (!g || u.unit_kind !== "CONTAINER" || u.dangerous_goods !== false || u.temperature_control_required !== false ||
    u.equipment_code !== g.equipment_code || u.quantity !== g.quantity || weight !== g.weight_per_container_kg ||
    u.destination_ref != null) return refuse("Lot non qualifié, modifié, dangereux, température dirigée ou poids inconnu : transport à confirmer.");
  const type = resolveCanonicalLocalTransportContainerType(g.equipment_code)!;
  const weightRule = assessLocalTransportWeightRule(type, weight);
  const billed40 = type === LOCAL_TRANSPORT_CONTAINER_40 || weightRule.rule === "OVER_THRESHOLD_40_RATE";
  // Pin the approved anchor: if the underlying grid changes, revalidate the
  // extrapolation. Never import a client-specific price into the general rule.
  const anchor = resolveOfficialLocalTransportRate(rates, { destination: "POUT", containerType: billed40 ? "40GP" : "20GP",
    cargoWeightPerContainerKg: 10000, clientCode: null, origin: "DAKAR PORT", cargoCategory: "DRY", asOfDate: input.asOfDate });
  if (anchor.status !== "RESOLVED" || anchor.rate.source_document !== OFFICIAL_LOCAL_TRANSPORT_SOURCE_DOCUMENT ||
    anchor.currency !== "XOF" || anchor.amount !== (billed40 ? 219480 : 135700)) return refuse("Base tarifaire de la formule absente, ambiguë ou modifiée : revalidation requise.");
  const ht = Math.round((billed40 ? 69000 : 57000) + (billed40 ? 2000 : 1000) * basis.distance_km);
  const fee = billed40 ? 1000 : 0;
  const vat = Math.round((ht + fee) * 0.18);
  const unitTtc = ht + fee + vat;
  const amount = unitTtc * g.quantity;
  if (!Number.isSafeInteger(amount)) return refuse("Montant hors capacité de calcul.");
  const notes = `Estimation kilométrique non ferme, pas un tarif réglementaire. Distance routière ${basis.distance_km} km : ${basis.distance_source}, vérifiée le ${basis.verified_on}. ` +
    `Lot ${g.unit_ref} : transport ordinaire attesté (${g.qualification_source}), charge admissible ${g.max_payload_kg} kg. ` +
    `Par conteneur : transport HT ${ht} + frais HT ${fee} + TVA fournisseur 18 % ${vat} = ${unitTtc} XOF TTC ; quantité ${g.quantity}. ` +
    `${weightRule.note ?? ""} Retour vide, attente, manutention et prestations particulières non présumés inclus. Aucune TVA SODATRA supplémentaire.`;
  return { reason: null, line: withLocalTransportDebours({
    id: `transport_km_${g.unit_ref}`, bloc: "operationnel" as const, category: "Transport",
    description: `Transport ${g.equipment_code} → ${basis.destination} — estimation kilométrique (${g.unit_ref})`,
    amount, currency: "XOF", quantity: g.quantity, unit: "TC", containerType: g.equipment_code, isEditable: false, notes,
    source: { type: "CALCULATED" as const, confidence: 0.5, reference: LOCAL_TRANSPORT_ESTIMATE_RULE,
      firm_eligible: false, unit_ref: g.unit_ref, distance_source: basis.distance_source, verified_on: basis.verified_on,
      distance_km: basis.distance_km, tariff_source: anchor.rate.source_document, billed_size: billed40 ? "40" : "20",
      transport_ht_per_container: ht, fees_ht_per_container: fee, supplier_vat_per_container: vat,
      qualification: { ...g } },
  }) };
}
