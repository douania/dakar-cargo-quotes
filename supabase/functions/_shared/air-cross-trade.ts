/**
 * Candidate domain workflow for an AIR request between two countries outside SN.
 * No I/O, country/airport guessing, import engine, supplier-to-sale fallback or AI.
 * Local candidate only: durable/UI adapters retain the same revisions and
 * compare-and-swap contract. Cloud registration/activation needs a separate GO.
 */
import { commercialFeeTotals } from "./commercial-fee-totals.ts";

type Row = Record<string, unknown>;
export const AIR_CROSS_TRADE = "AIR_CROSS_TRADE" as const;
export const AIR_CROSS_TRADE_SERVICES = ["PICKUP_ORIGIN", "PRE_CARRIAGE", "AIR_FREIGHT"] as const;
const ALLOWED_SERVICES = new Set([...AIR_CROSS_TRADE_SERVICES, "AIR_HANDLING", "CUSTOMS_EXPORT", "BORDER_FEES", "AGENCY", "ON_CARRIAGE"]);
export interface AirEvidence<T> {
  value: T;
  fact_id: string;
  source_id: string;
  status: "explicit" | "operator" | "assumed";
  source_value?: unknown;
  normalization_reference?: string;
  kind?: "planned";
}
export interface AirCrossTradeRequest {
  case_id: string;
  mode: AirEvidence<"AIR" | "SEA" | "ROAD"> | null;
  case_request_type?: string;
  origin_country: AirEvidence<string> | null; // canonical ISO alpha-2, resolved upstream
  destination_country: AirEvidence<string> | null;
  arrival_airport: AirEvidence<string> | null;
  cargo_description: AirEvidence<string> | null;
  quantities: Partial<Record<"gross_kg" | "chargeable_kg" | "net_kg" | "pieces" | "cbm", AirEvidence<number>>>;
  facts: Row[]; // exhaustive current facts, not a lossy subset
  requested_services: string[];
  requested_services_evidence: string;
  cargo_acceptance_required: boolean | null;
}
export interface AirNeed {
  key: string;
  owner: "client" | "operator" | "tariff";
  service_key: string | null;
  reason: string;
}
export interface AirRoute {
  departure_airport: string;
  departure_country: string;
  arrival_airport: string;
  arrival_country: string;
  pre_carriage: "none" | "retained";
  routing_reference: string;
  acceptance_reference: string | null;
}
export interface AirServiceDecision {
  service_key: string;
  disposition: "priced" | "included" | "excluded" | "pending";
  reason: string;
  included_in?: string;
  source_id?: string;
  source_fingerprint?: string;
  source_role?: "purchase" | "sale";
  coverage?: "pickup" | "pre_carriage" | "air_leg" | "departure" | "arrival" | "journey";
  weight_basis?: "gross_kg" | "chargeable_kg" | "net_kg";
  service_quantity?: AirEvidence<number | null>; // explicit trip/operation count, never defaulted
  // Separate commercial decision, in XOF. Never defaulted from a supplier cost.
  client_sale?: { amount_xof: number | null; basis: "before_sodatra_vat" | "taxes_included" | "unknown"; reason: string };
  applicability_reference?: string;
  fx_id?: string;
  fx_fingerprint?: string;
}
export interface AirPlan {
  route: AirRoute;
  services: AirServiceDecision[];
}
export interface AirPlanRevision {
  id: string;
  case_id: string;
  revision: number;
  actor_id: string;
  context_fingerprint: string;
  plan: AirPlan;
}
/** Server-loaded rows. These amounts must never be trusted from an HTTP payload. */
export interface AirRateSource {
  id: string;
  service_key: string;
  fingerprint: string;
  currency: string;
  unit: "forfait" | "voyage" | "kg" | "colis" | "cbm";
  value: number;
  min_charge: number | null;
  effective_from: string;
  effective_to: string | null;
  origin_country: string;
  destination_country: string;
  origin_airport: string | null;
  destination_airport: string | null;
  // Source-specific conditions are explicit, not guessed from the default unit.
  required_fact_keys: string[];
  reference: string;
  included_services: Array<{ service_key: string; origin_country: string; destination_country: string;
    origin_airport: string | null; destination_airport: string | null; reference: string }>;
}
export interface AirFxSource {
  id: string;
  fingerprint: string;
  currency_code: string;
  rate_to_xof: number;
  valid_from: string;
  valid_until: string;
  source: string;
}
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const amount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e12;
const code = (v: unknown) => typeof v === "string" && /^[A-Z]{2}$/.test(v);
const airport = (v: unknown) => typeof v === "string" && /^[A-Z]{3}$/.test(v);
const own = <T>(e: AirEvidence<T> | null | undefined): e is AirEvidence<T> => !!e &&
  text(e.fact_id) && text(e.source_id) && ["explicit", "operator"].includes(e.status);
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
export function airCrossTradeCanonical(value: unknown): string { return JSON.stringify(canonical(value)); }
export async function airCrossTradeFingerprint(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(airCrossTradeCanonical(value)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
export function classifyAirCrossTrade(request: AirCrossTradeRequest): "eligible" | "not_applicable" | "undetermined" {
  if (!own(request.mode)) return "undetermined";
  if (request.mode.value !== "AIR") return "not_applicable";
  if (!own(request.origin_country) || !own(request.destination_country) ||
    !code(request.origin_country.value) || !code(request.destination_country.value)) return "undetermined";
  if (request.origin_country.value === "SN" || request.destination_country.value === "SN" ||
    request.origin_country.value === request.destination_country.value) return "not_applicable";
  return "eligible";
}
/** Pure CAS model. A DB adapter must implement the check and append in ONE transaction. */
export function retainAirCrossTradePlan(input: {
  history: AirPlanRevision[]; id: string; expected_id: string | null; actor_id: string;
  case_id: string; expected_context: string; actual_context: string; plan: AirPlan;
}): AirPlanRevision {
  if (![input.id, input.actor_id, input.case_id, input.expected_context].every(text)) throw new Error("Plan identity missing");
  // Authentication/admission/revocation are checked by the adapter before replay too.
  if (input.history.some(p => p.case_id !== input.case_id)) throw new Error("Cross-case history rejected");
  const previous = input.history.find(p => p.id === input.id);
  if (previous) {
    if (previous.actor_id === input.actor_id && previous.context_fingerprint === input.expected_context &&
      airCrossTradeCanonical(previous.plan) === airCrossTradeCanonical(input.plan)) return structuredClone(previous);
    throw new Error("Idempotency conflict");
  }
  const head = [...input.history].sort((a, b) => b.revision - a.revision)[0];
  if ((head?.id ?? null) !== input.expected_id || input.expected_context !== input.actual_context) throw new Error("Plan context changed");
  return { id: input.id, case_id: input.case_id, revision: (head?.revision ?? 0) + 1,
    actor_id: input.actor_id, context_fingerprint: input.actual_context, plan: structuredClone(input.plan) };
}

export function evaluateAirCrossTrade(input: {
  request: AirCrossTradeRequest; retained: AirPlanRevision | null; context_fingerprint: string;
  sources: AirRateSource[]; fx: AirFxSource[]; as_of: string;
}) {
  const { request, retained, sources, fx, as_of } = input;
  const needs: AirNeed[] = [];
  const need = (key: string, owner: AirNeed["owner"], reason: string, service_key: string | null = null) => {
    if (!needs.some(n => n.key === key && n.service_key === service_key)) needs.push({ key, owner, reason, service_key });
  };
  const classification = classifyAirCrossTrade(request);
  const lines: Row[] = [];
  const sourceSnapshots: Row[] = [];
  const reserves: string[] = [];
  // Date-only means UTC start of day; timestamps retain their explicit instant.
  const parseInstant = (value: string, end = false) => {
    if (!/^\d{4}-\d{2}-\d{2}(?:$|T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$)/.test(value)) return NaN;
    const day = value.slice(0, 10), midnight = Date.parse(`${day}T00:00:00Z`);
    if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day) return NaN;
    return Date.parse(value.length === 10 ? `${value}T${end ? "23:59:59.999" : "00:00:00"}Z` : value);
  };
  const instant = parseInstant(as_of);
  if (!Number.isFinite(instant)) throw new Error("Explicit UTC pricing instant required");
  const bound = (value: string | null, end = false) => value === null ? Infinity : parseInstant(value, end);
  const linked = (e: AirEvidence<unknown> | null | undefined, keys?: string[]) => {
    if (!own(e)) return false;
    if (keys?.includes("routing.transport_mode") && e.fact_id === `case:${request.case_id}:request_type` &&
      e.source_id === request.case_id && e.value === "AIR" && request.case_request_type?.startsWith("AIR_")) return true;
    const matches = request.facts.filter(f => f.id === e.fact_id && f.is_current !== false);
    if (matches.length !== 1) return false;
    const f = matches[0], key = String(f.fact_key ?? f.key ?? "");
    if (f.is_assumption === true || ["ai_assumption", "assumption", "system"].includes(String(f.source_type))) return false;
    const value = f.value_number ?? f.value_text ?? f.value_json ?? f.value_date;
    const actualSource = f.source_email_id ?? f.source_attachment_id ?? f.source_reference ??
      (["manual", "operator", "human", "manual_input", "operator_correction"].includes(String(f.source_type)) ? f.id : null);
    const normalizedCountry = e.source_value !== undefined && ["routing.origin_country", "routing.destination_country"].includes(key) && text(e.normalization_reference);
    if (e.source_value !== undefined && !normalizedCountry) return false;
    return (!keys || keys.includes(key)) && airCrossTradeCanonical(value) === airCrossTradeCanonical(normalizedCountry ? e.source_value : e.value) &&
      actualSource === e.source_id && (e.status !== "operator" || ["manual", "operator", "human", "manual_input", "operator_correction"].includes(String(f.source_type)));
  };
  for (const [key, e] of Object.entries({ "routing.transport_mode": request.mode, "routing.origin_country": request.origin_country,
    "routing.destination_country": request.destination_country, "routing.destination_airport": request.arrival_airport,
    "cargo.description": request.cargo_description })) {
    if (e && !linked(e, [key])) need(key, "operator", "La preuve ne correspond pas au fait courant unique ; relire la source.");
  }
  if (classification !== "eligible") need("classification", "operator", "Mode et pays documentés requis ; aucun reclassement import/transit automatique.");
  if (!text(request.case_id) || !text(input.context_fingerprint)) throw new Error("Case identity/context missing");
  if (!own(request.cargo_description) || !text(request.cargo_description.value)) need("cargo.description", "client", "Nature des marchandises nécessaire pour qualifier les prestations.");
  if (!own(request.arrival_airport) || !airport(request.arrival_airport.value)) need("routing.destination_airport", "client", "Aéroport d’arrivée demandé à préciser.");
  if (!text(request.requested_services_evidence) || !request.requested_services.length ||
    new Set(request.requested_services).size !== request.requested_services.length || request.requested_services.some(k => !ALLOWED_SERVICES.has(k))) {
    need("service.scope", "operator", "Prestations demandées et source à qualifier.");
  }
  const plan = retained?.plan;
  if (!retained || retained.case_id !== request.case_id || !text(retained.actor_id) || !text(retained.id) ||
    retained.context_fingerprint !== input.context_fingerprint) need("service.plan", "operator", "Parcours opérateur courant à retenir.");
  if (plan) {
    const r = plan.route;
    if (!r || !airport(r.departure_airport) || !code(r.departure_country) || !airport(r.arrival_airport) ||
      !code(r.arrival_country) || !text(r.routing_reference) || !["none", "retained"].includes(r.pre_carriage)) {
      need("routing.plan", "operator", "Départ et acheminement à choisir avec une référence opérationnelle.");
    } else {
      if (r.arrival_airport !== request.arrival_airport?.value || r.arrival_country !== request.destination_country?.value)
        need("routing.arrival_conflict", "operator", "L’arrivée retenue contredit la demande documentée.");
      if (r.departure_country !== request.origin_country?.value && r.pre_carriage !== "retained")
        need("routing.pre_carriage", "operator", "Acheminement vers le pays de départ non qualifié.");
      if (r.departure_country === request.origin_country?.value && r.pre_carriage === "none" &&
        request.requested_services.includes("PRE_CARRIAGE")) need("routing.pre_carriage", "operator", "Acheminement demandé à qualifier, même dans le pays d’origine.");
    }
    if (request.cargo_acceptance_required !== false && !text(r?.acceptance_reference))
      need("cargo.acceptance", "operator", "Acceptation transporteur/partenaire à qualifier ; aucune formalité présumée.");
    const segment = (k: string, raw?: string) => {
      const coverage = raw ?? ({ PICKUP_ORIGIN: "pickup", PRE_CARRIAGE: "pre_carriage", AIR_FREIGHT: "air_leg" } as Record<string, string>)[k];
      const allowed = k === "PICKUP_ORIGIN" ? coverage === "pickup" : k === "PRE_CARRIAGE" ? coverage === "pre_carriage"
        : k === "AIR_FREIGHT" ? coverage === "air_leg" : ["departure", "arrival", "journey"].includes(coverage ?? "");
      return { allowed, coverage,
        from: ["pickup", "pre_carriage", "journey"].includes(coverage ?? "") ? request.origin_country?.value : coverage === "arrival" ? r.arrival_country : r.departure_country,
        to: coverage === "pickup" ? request.origin_country?.value : ["pre_carriage", "departure"].includes(coverage ?? "") ? r.departure_country : r.arrival_country,
        from_airport: coverage === "arrival" ? r.arrival_airport : ["air_leg", "departure"].includes(coverage ?? "") ? r.departure_airport : null,
        to_airport: ["pre_carriage", "departure"].includes(coverage ?? "") ? r.departure_airport : coverage === "pickup" ? null : r.arrival_airport };
    };
    const decisions = plan.services;
    if (r.pre_carriage === "retained" && !decisions.some(d => d.service_key === "PRE_CARRIAGE" && d.disposition !== "excluded"))
      need("routing.pre_carriage_coverage", "operator", "Le préacheminement retenu doit être couvert par une prestation ou une inclusion sourcée.", "PRE_CARRIAGE");
    if (!Array.isArray(decisions) || new Set(decisions.map(d => d.service_key)).size !== decisions.length ||
      decisions.some(d => !ALLOWED_SERVICES.has(d.service_key))) throw new Error("Invalid or duplicate service decisions");
    for (const k of request.requested_services) if (!decisions.some(d => d.service_key === k)) need("service.coverage", "operator", "Prestation demandée sans décision de couverture.", k);
    for (const decision of decisions) {
      const k = decision.service_key;
      if (!text(decision.reason)) { need("service.reason", "operator", "Décision opérateur à justifier.", k); continue; }
      if (decision.disposition === "pending") {need("service.qualification", "operator", "Prestation conservée, qualification en attente.", k);continue;}
      if (decision.disposition === "included") {
        const parent = decisions.find(d => d.service_key === decision.included_in && d.disposition === "priced");
        const parentSource = sources.filter(s => s.id === parent?.source_id);
        const inclusion = parentSource.length === 1 ? parentSource[0].included_services.filter(i => i.service_key === k) : [];
        const child = segment(k, decision.coverage);
        const covered = child.allowed && inclusion.length === 1 && text(inclusion[0].reference) &&
          inclusion[0].origin_country === child.from && inclusion[0].destination_country === child.to &&
          (inclusion[0].origin_airport === null || inclusion[0].origin_airport === child.from_airport) &&
          (inclusion[0].destination_airport === null || inclusion[0].destination_airport === child.to_airport);
        if (!parent || parent === decision || !covered) need("service.inclusion", "operator", "Inclusion sans preuve source du service et du segment couverts.", k);
        else reserves.push(`${k} compris dans ${parent.service_key} : ${decision.reason}`);
        continue;
      }
      if (decision.disposition === "excluded") {
        reserves.push(`${k} exclu : ${decision.reason}`);
        if (request.requested_services.includes(k)) need("service.excluded_requested", "operator", "Prestation demandée exclue : périmètre partiel, ne pas présenter un devis complet.", k);
        continue;
      }
      if (decision.disposition !== "priced") throw new Error("Invalid service disposition");
      const matches = sources.filter(s => s.id === decision.source_id);
      const source = matches.length === 1 ? matches[0] : null;
      if (!source || source.fingerprint !== decision.source_fingerprint || !text(source.reference) ||
        !text(decision.applicability_reference) || !["purchase", "sale"].includes(decision.source_role ?? "")) {
        need("tariff.source", "tariff", "Source sélectionnée, rôle achat/vente et applicabilité à attester.", k); continue;
      }
      const scope = segment(k, decision.coverage);
      if (!scope.allowed || !plan.route || source.service_key !== k || source.origin_country !== scope.from ||
        source.destination_country !== scope.to ||
        (source.origin_airport !== null && source.origin_airport !== scope.from_airport) ||
        (source.destination_airport !== null && source.destination_airport !== scope.to_airport) ||
        !Number.isFinite(bound(source.effective_from)) || bound(source.effective_from) > instant ||
        !(bound(source.effective_to, true) >= instant)) {
        need("tariff.applicability", "tariff", "Source hors trajet, prestation ou période ; aucun meilleur-match approximatif.", k); continue;
      }
      if (!amount(source.value) || (source.min_charge !== null && !amount(source.min_charge))) throw new Error("Invalid source amount");
      const factKeys = new Set(request.facts.filter(f => f.is_current !== false &&
        [f.value_text, f.value_number, f.value_json, f.value_date].some(v => v !== null && v !== undefined &&
          (typeof v !== "string" || v.trim().length > 0) && (typeof v !== "object" || Object.keys(v).length > 0)))
        .map(f => f.fact_key ?? f.key));
      for (const key of source.required_fact_keys) if (!factKeys.has(key))
        need(key, "tariff", "Condition explicite de la source retenue à renseigner.", k);
      let quantity: number | null = null;
      if (source.unit === "forfait") quantity = 1; // selected source covers this consignment, not a guessed trip count
      else if (source.unit === "voyage") {
        const q = decision.service_quantity;
        const planned = q?.kind === "planned" && q.status === "operator" && q.source_id === retained?.id &&
          q.fact_id === `plan:${retained.id}:${k}:trips`;
        if ((linked(q) || planned) && amount(q!.value) && q!.value > 0 && Number.isInteger(q!.value)) quantity = q!.value;
        else need("tariff.trip_count", "operator", "Nombre de voyages de la prestation à retenir explicitement.", k);
      } else {
        const basis = source.unit === "kg" ? decision.weight_basis : source.unit === "colis" ? "pieces" : source.unit === "cbm" ? "cbm" : null;
        const q = basis ? request.quantities[basis] : null;
        const quantityKeys: Record<string, string[]> = { gross_kg: ["cargo.weight_kg", "cargo.gross_weight_kg"],
          chargeable_kg: ["cargo.chargeable_weight_kg"], net_kg: ["cargo.weight_net_kg", "cargo.net_weight_kg"], pieces: ["cargo.pieces_count"], cbm: ["cargo.volume_cbm"] };
        if (q && linked(q, basis ? quantityKeys[basis] : []) && amount(q.value) && q.value > 0 && (basis !== "pieces" || Number.isInteger(q.value))) quantity = q.value;
        else need(basis ? `cargo.${basis}` : "tariff.quantity_basis", "tariff", "Assiette explicite requise ; aucun poids taxable, volume ou unité inventé.", k);
      }
      let conversion = 1;
      let fxSnapshot: AirFxSource | null = null;
      if (source.currency !== "XOF") {
        const candidates = fx.filter(f => f.id === decision.fx_id);
        fxSnapshot = candidates.length === 1 ? candidates[0] : null;
        if (!fxSnapshot || fxSnapshot.fingerprint !== decision.fx_fingerprint || fxSnapshot.currency_code !== source.currency ||
          !text(fxSnapshot.source) || !Number.isFinite(bound(fxSnapshot.valid_from)) || !Number.isFinite(bound(fxSnapshot.valid_until, true)) ||
          bound(fxSnapshot.valid_from) > instant || bound(fxSnapshot.valid_until, true) < instant ||
          !amount(fxSnapshot.rate_to_xof) || fxSnapshot.rate_to_xof <= 0) {
          need("tariff.fx", "tariff", "Taux de change daté et source sélectionnés nécessaires.", k); continue;
        }
        conversion = fxSnapshot.rate_to_xof;
      }
      if (quantity === null) continue;
      const native = Math.max(quantity * source.value, source.min_charge ?? 0);
      const sourceAmountXof = Math.round(native * conversion);
      if (!amount(sourceAmountXof)) throw new Error("Source amount overflow");
      const sale = decision.client_sale;
      if (!sale || !amount(sale.amount_xof) || !text(sale.reason) || !["before_sodatra_vat", "taxes_included"].includes(sale.basis)) {
        need("commercial.sale", "operator", "Prix client et base fiscale à retenir séparément de l’achat.", k); continue;
      }
      // A rate identified as sale may be overridden only by an explicit commercial decision,
      // retained below; source_role never makes a purchase a client amount.
      const proof = { service_key: k, source: structuredClone(source), source_role: decision.source_role, coverage: decision.coverage,
        native_amount: native, source_amount_xof: sourceAmountXof, quantity, quantity_basis: source.unit === "kg" ? decision.weight_basis : source.unit,
        fx: structuredClone(fxSnapshot), applicability_reference: decision.applicability_reference, client_sale: structuredClone(sale) };
      sourceSnapshots.push(proof);
      lines.push({ service_code: k, label: k, description: k, category: k, quantity: 1,
        unit_price: sale.amount_xof, amount: sale.amount_xof, currency: "XOF",
        bloc: sale.basis === "before_sodatra_vat" ? "honoraires" : "operationnel",
        source: { type: "OPERATOR_ESTIMATE", reference: source.reference, firm_eligible: false },
        canonical: { service_key: k, origin_layer: "air_cross_trade" },
      });
    }
  }
  const pricedKeys = new Set(lines.map(l => String(l.service_code)));
  for (const d of plan?.services ?? []) if (d.disposition === "included" && !pricedKeys.has(d.included_in ?? ""))
    need("service.inclusion_unpriced", "operator", "La prestation englobante n’est pas tarifée ; couverture non établie.", d.service_key);
  const ready = needs.length === 0 && classification === "eligible" && lines.length > 0;
  const fees = lines.filter(l => l.bloc === "honoraires").reduce((s, l) => s + Number(l.amount), 0);
  const operational = lines.filter(l => l.bloc === "operationnel").reduce((s, l) => s + Number(l.amount), 0);
  const tax = commercialFeeTotals(fees + operational, fees);
  const totals = { totalHt: fees + operational, totalTtc: tax.totalPayable, subtotalBeforeSodatraVat: fees + operational,
    totalPayable: tax.totalPayable, honorairesHt: fees, honorairesTva: tax.honorairesTva, honorairesTtc: tax.honorairesTtc };
  if (!amount(totals.totalPayable)) throw new Error("Total overflow");
  const basis = { schema_version: 1, request_type: AIR_CROSS_TRADE, plan: structuredClone(retained),
    context_fingerprint: input.context_fingerprint, as_of, sources: sourceSnapshots,
    demand: { origin_country: request.origin_country?.value, destination_country: request.destination_country?.value, arrival_airport: request.arrival_airport?.value },
    country_normalization:{origin_country:structuredClone(request.origin_country),destination_country:structuredClone(request.destination_country)},
    requested_services: [...request.requested_services], requested_services_evidence: request.requested_services_evidence,
    reserves, unresolved: structuredClone(needs), cargo_quantities: structuredClone(request.quantities) };
  return { request_type: AIR_CROSS_TRADE, classification, ready_to_price: ready,
    status: ready ? "PRICED_DRAFT" : "DECISIONS_PENDING", needs,
    // No successful run can be constructed from the partial lines alone.
    pricing: ready ? { currency: "XOF", total_ht: totals.totalHt, total_ttc: totals.totalTtc,
      facts_snapshot: structuredClone(request.facts), inputs_json: { air_cross_trade: basis },
      tariff_lines: lines, tariff_sources: sourceSnapshots,
      outputs_json: { lines, air_cross_trade: basis, routing: { origin: request.origin_country?.value,
        destination: request.arrival_airport?.value, incoterm: null },
        quoteQualification: { level: "provisional", firmTotalPolicy: "all_included",
          reasons: [{ code: "AIR_CROSS_TRADE_OPERATOR_PLAN", message: "Parcours et prix client retenus par l’opérateur ; sources et réserves conservées." }] },
        totals: { currency: "XOF", ht: totals.totalHt, ttc: totals.totalTtc,
          subtotal_before_sodatra_vat: totals.subtotalBeforeSodatraVat, total_payable: totals.totalPayable,
          honoraires_ht: totals.honorairesHt, honoraires_tva: totals.honorairesTva, honoraires_ttc: totals.honorairesTtc } } } : null };
}
