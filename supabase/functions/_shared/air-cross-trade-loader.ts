import { resolveDocumentedCountry } from "./request-country.ts";
import { airCrossTradeFingerprint, type AirCrossTradeRequest, type AirEvidence, type AirFxSource, type AirPlan, type AirRateSource } from "./air-cross-trade.ts";
type Row = Record<string, unknown>;
export interface AirSourceAttestation {
  service_key: string; source_kind: "rate_card" | "partner_fact"; source_id: string;
  unit: AirRateSource["unit"]; effective_from: string; effective_to: string | null;
  origin_country: string; destination_country: string; origin_airport: string | null; destination_airport: string | null;
  required_fact_keys: string[]; included_services: AirRateSource["included_services"];
  reference: string; // operator reference proving source applicability/conditions, not a confidence score
}
export interface AirOperatorRequest { plan: AirPlan; attestations: AirSourceAttestation[]; requested_services: string[]; scope_reference: string; client_data_keys?: string[]; supersedes_scope_fact_id?: string; acknowledged_scope_fact_ids?: string[] }
export interface AirLoadedState { case: Row; facts: Row[]; request_lines: Row[]; context_hash: string; sources_hash: string;
  countries: Array<{country_code: string; country_name: string | null}>; sources: Row[]; fx: Row[]; head: Row | null; source_revisions_clear?:boolean|null; requirements?:{plan_id:string;required_fact_keys:string[];client_data_keys:string[]}|null; blocking_gaps?:Array<{gap_key:string}>;intent?:Row|null;last_pricing_run?:Row|null }
const row = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const nonempty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const numeric = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e12;
const normalized = (v: string) => v.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, " ").replace(/[-\s]+/g, " ").trim().toUpperCase();
export function readAirOperatorRequest(value: unknown): AirOperatorRequest {
  if (!row(value) || !row(value.plan) || !row(value.plan.route) || !Array.isArray(value.plan.services) ||
    !Array.isArray(value.attestations) || value.attestations.length > 30 || !Array.isArray(value.requested_services) ||
    value.requested_services.length > 20 || !value.requested_services.every(nonempty) || !nonempty(value.scope_reference)) throw new Error("Périmètre et plan opérateur requis");
  for (const a of value.attestations) {
    if (!row(a) || !["rate_card","partner_fact"].includes(String(a.source_kind)) || !nonempty(a.source_id) || !nonempty(a.service_key)) throw new Error("Identité de l’attestation incomplète");
    if (row(a) && !(value.plan.services as unknown[]).some(d=>row(d)&&d.disposition==="priced"&&d.source_id===`${a.source_kind}:${a.source_id}`)) continue;
    if (!row(a) || !["rate_card", "partner_fact"].includes(String(a.source_kind)) || !nonempty(a.source_id) || !nonempty(a.service_key) ||
      !["forfait", "voyage", "kg", "colis", "cbm"].includes(String(a.unit)) || !nonempty(a.reference) || a.reference.trim().length < 10 ||
      !nonempty(a.effective_from) || !(a.effective_to === null || nonempty(a.effective_to)) ||
      !Array.isArray(a.required_fact_keys) || !a.required_fact_keys.every(nonempty) || !Array.isArray(a.included_services) ||
      !/^[A-Z]{2}$/.test(String(a.origin_country)) || !/^[A-Z]{2}$/.test(String(a.destination_country))) throw new Error("Attestation de source incomplète");
  }
  return structuredClone(value) as unknown as AirOperatorRequest;
}
export async function mapAirSources(state: AirLoadedState, request: AirOperatorRequest): Promise<{sources: AirRateSource[]; fx: AirFxSource[]}> {
  const sources: AirRateSource[] = [];
  for (const a of request.attestations) {
    if (!request.plan.services.some(d=>d.disposition==="priced"&&d.source_id===`${a.source_kind}:${a.source_id}`)) continue;
    const candidates = state.sources.filter(s => s.kind === a.source_kind && s.id === a.source_id);
    if (candidates.length !== 1) throw new Error("Source sélectionnée absente ou ambiguë");
    const wrapped = candidates[0], raw = wrapped.row;
    if (!row(raw)) throw new Error("Source illisible");
    let value: number; let currency: string; let min: number | null = null;
    if (a.source_kind === "rate_card") {
      if (raw.status !== "active" || raw.service_key !== a.service_key || raw.container_type || !numeric(raw.value) || !nonempty(raw.currency)) throw new Error("Tarif inactif ou incompatible");
      for (const k of ["origin_country", "destination_country", "origin_airport", "destination_airport"] as const) {
        const actual = raw[k === "origin_airport" ? "origin_port" : k === "destination_airport" ? "destination_port" : k];
        const country=k.endsWith("country")&&nonempty(actual)?resolveDocumentedCountry(actual,state.countries):null;
        if(k.endsWith("country")&&nonempty(actual)&&!country)throw new Error("Pays de la source inconnu ou ambigu");
        const actualKey = k.endsWith("country") && nonempty(actual) ? country!.code : actual;
        if (nonempty(actualKey) && normalized(actualKey) !== normalized(a[k] ?? "")) throw new Error("L’attestation contredit le trajet de la source");
      }
      if (raw.unit !== a.unit) throw new Error("Unité de source contradictoire");
      if (nonempty(raw.effective_from) && Date.parse(a.effective_from) < Date.parse(raw.effective_from) || nonempty(raw.effective_to) &&
        (a.effective_to === null || Date.parse(a.effective_to) > Date.parse(raw.effective_to))) throw new Error("Période de source élargie");
      if (raw.min_charge !== null && !numeric(raw.min_charge)) throw new Error("Minimum de source illisible");
      value = raw.value; currency = raw.currency; min = raw.min_charge as number|null;
    } else {
      if (raw.case_id !== state.case.id || raw.validation_status !== "validated" || !nonempty(raw.validated_by) || !nonempty(raw.validated_at) ||
        !["cargo.origin_charges", "cargo.pickup_cost", "cargo.pre_carriage_cost", "cargo.freight_cost", "cargo.freight_rate_per_kg"].includes(String(raw.fact_key)) ||
        !numeric(raw.proposed_value_number) || !nonempty(raw.currency) || !nonempty(raw.source_excerpt) ||
        !row(wrapped.response) || !row(wrapped.request) || wrapped.response.id !== raw.response_id || wrapped.request.id !== raw.request_id ||
        wrapped.response.request_id !== raw.request_id || wrapped.request.case_id !== state.case.id || !nonempty(wrapped.response.source_email_id)) throw new Error("Preuve partenaire non validée ou hors dossier");
      // Preserve structured EQ1 meaning: a saved total is not a per-kg rate.
      const key = String(raw.fact_key);
      const compatible = key === "cargo.freight_rate_per_kg" ? a.service_key === "AIR_FREIGHT" && a.unit === "kg"
        : key === "cargo.freight_cost" ? a.service_key === "AIR_FREIGHT" && a.unit === "forfait"
        : key === "cargo.pickup_cost" ? a.service_key === "PICKUP_ORIGIN" && a.unit === "forfait"
        : key === "cargo.pre_carriage_cost" ? a.service_key === "PRE_CARRIAGE" && a.unit === "forfait"
        : a.unit === "forfait" && ["PICKUP_ORIGIN", "PRE_CARRIAGE", "AIR_HANDLING", "CUSTOMS_EXPORT"].includes(a.service_key);
      const decision = request.plan.services.find(d => d.source_id === `partner_fact:${a.source_id}` && d.service_key === a.service_key);
      if (!compatible || decision?.source_role !== "purchase" || key === "cargo.origin_charges" && a.service_key === "AIR_HANDLING" && decision.coverage !== "departure")
        throw new Error("Unité, service ou rôle contredit le fait monétaire partenaire validé");
      value = raw.proposed_value_number; currency = raw.currency;
    }
    const fingerprint = await airCrossTradeFingerprint(wrapped);
    sources.push({ id: `${a.source_kind}:${a.source_id}`, service_key: a.service_key, fingerprint, currency, unit: a.unit, value, min_charge: min,
      effective_from: a.effective_from, effective_to: a.effective_to, origin_country: a.origin_country, destination_country: a.destination_country,
      origin_airport: a.origin_airport, destination_airport: a.destination_airport, required_fact_keys: a.required_fact_keys,
      reference: a.reference, included_services: a.included_services });
  }
  const fx: AirFxSource[] = [];
  for (const raw of state.fx) {
    if (!nonempty(raw.id) || !nonempty(raw.currency_code) || !numeric(raw.rate_to_xof) || !nonempty(raw.source) || !nonempty(raw.valid_from) || !nonempty(raw.valid_until)) throw new Error("Change illisible");
    fx.push({ id: raw.id, fingerprint: await airCrossTradeFingerprint(raw), currency_code: raw.currency_code, rate_to_xof: raw.rate_to_xof,
      valid_from: raw.valid_from, valid_until: raw.valid_until, source: raw.source });
  }
  return {sources, fx};
}
export function mapAirRequest(state: AirLoadedState, operator: AirOperatorRequest): AirCrossTradeRequest {
  const facts = state.facts;
  const fact = (key: string) => { const rows = facts.filter(f => (f.fact_key ?? f.key) === key); return rows.length === 1 ? rows[0] : null; };
  const e = <T>(key: string): AirEvidence<T> | null => {
    const f = fact(key); if (!f || !nonempty(f.id)) return null;
    const value = f.value_number ?? f.value_text ?? f.value_json;
    const operatorSource = ["manual", "operator", "human", "manual_input", "operator_correction"].includes(String(f.source_type));
    const source = f.source_email_id ?? f.source_attachment_id ?? f.source_reference ?? (operatorSource ? f.id : null);
    if (!nonempty(source)) return null;
    return {value: value as T, fact_id: f.id, source_id: source, status: ["manual", "operator", "human", "manual_input", "operator_correction"].includes(String(f.source_type)) ? "operator" : /assumption|system/.test(String(f.source_type)) ? "assumed" : "explicit"};
  };
  const country = (key: string) => {
    const evidence = e<string>(key); if (!evidence || typeof evidence.value !== "string") return null;
    const country=resolveDocumentedCountry(evidence.value,state.countries);if(!country)return null;
    return {...evidence,value:country.code,source_value:evidence.value,normalization_reference:country.reference};
  };
  const mode = e<"AIR">("routing.transport_mode") ?? (String(state.case.request_type).startsWith("AIR_") ? {
    value: "AIR" as const, fact_id: `case:${state.case.id}:request_type`, source_id: String(state.case.id), status: "explicit" as const } : null);
  return {case_id: String(state.case.id), case_request_type: String(state.case.request_type), mode, origin_country: country("routing.origin_country"),
    destination_country: country("routing.destination_country"), arrival_airport: e("routing.destination_airport"), cargo_description: e("cargo.description"),
    quantities: {gross_kg: e<number>("cargo.weight_kg") ?? undefined, net_kg: e<number>("cargo.weight_net_kg") ?? undefined,
      chargeable_kg: e<number>("cargo.chargeable_weight_kg") ?? undefined, pieces: e<number>("cargo.pieces_count") ?? undefined, cbm: e<number>("cargo.volume_cbm") ?? undefined},
    facts: structuredClone(facts), requested_services: operator.requested_services, requested_services_evidence: operator.scope_reference,
    // Acceptance stays internal and explicit, even when no dangerous flag is available.
    cargo_acceptance_required: true};
}
