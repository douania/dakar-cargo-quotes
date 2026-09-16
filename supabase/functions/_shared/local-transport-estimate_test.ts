import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { estimateUnlistedContainerTransport, LOCAL_TRANSPORT_ESTIMATE_KEY, transportEstimateBasisError } from "./local-transport-estimate.ts";
import { OFFICIAL_LOCAL_TRANSPORT_SOURCE_DOCUMENT, type LocalTransportRateCandidate } from "./local-transport-destination.ts";
import { buildScenarioOverlay, buildPricingInputs, computeScenarioTotals, computeRequestFingerprint } from "../run-scenario-pricing/domain.ts";
import { resolveScenarioCargo } from "./scenario-cargo.ts";
import { validateManageAssumptionPayload } from "../manage-scenario-assumption/domain.ts";

function unit(over: Record<string, unknown> = {}) {
  return { unit_ref: "lot-1", unit_kind: "CONTAINER", equipment_code: "20GP", quantity: 2,
    gross_weight_kg: 10000, weight_basis: "per_unit", dangerous_goods: false, ownership: "SOC",
    un_number: null, imo_class: null, scenario_basis: "Synthetic ordinary transport", volume_dm3: null,
    temperature_control_required: false, destination_ref: null, ...over };
}
function basis() { return { schema_version: 1 as const, origin: "Dakar Port" as const, country: "SN" as const,
  destination: "Ville non répertoriée", distance_km: 300, distance_source: "Itinéraire routier test Dakar-Ville, document transporteur",
  verified_on: "2026-09-16", groups: [{ unit_ref: "lot-1", equipment_code: "20GP", quantity: 2,
    weight_per_container_kg: 10000, max_payload_kg: 20000, ordinary_transport: true, qualification_source: "Plaque conteneur et fiche véhicule test" }] }; }
function rates(): LocalTransportRateCandidate[] { return ["20' Dry", "40' Dry"].map((ct, i) => ({
  destination: "FORFAIT ZONE 2, SEIKHOTANE ET POUT", origin: "Dakar Port", container_type: ct,
  cargo_category: "Dry", rate_amount: i ? 219480 : 135700, rate_currency: "XOF", is_active: true,
  evidence_level: "validated_internal", client_code: null, source_document: OFFICIAL_LOCAL_TRANSPORT_SOURCE_DOCUMENT,
})); }
function input() { return { basis: basis(), unit: unit(), destination: basis().destination, asOfDate: "2026-09-16", catalogComplete: true }; }

Deno.test("km: 20/40 HT, fee, VAT, TTC, quantity and explicitly non-firm (even with raised confidence)", () => {
  for (const [equipment, ht, fee, vat] of [["20GP", 357000, 0, 64260], ["40HQ", 669000, 1000, 120600]] as const) {
    const i = input(); i.unit.equipment_code = equipment; i.basis.groups[0].equipment_code = equipment;
    const result = estimateUnlistedContainerTransport(rates(), i); assert(result.line);
    assertEquals(result.line.source.transport_ht_per_container, ht);
    assertEquals(result.line.source.fees_ht_per_container, fee);
    assertEquals(result.line.source.supplier_vat_per_container, vat);
    assertEquals(result.line.amount, 2 * (ht + fee + vat));
    assertEquals(result.line.accounting.sodatra_vat_applicable, false);
    const totals = computeScenarioTotals([{ ...result.line, source: { ...result.line.source, confidence: 1 } }], new Set());
    assertEquals(totals.firm_total_ttc, 0); assertEquals(totals.indicative_total_ttc, result.line.amount);
  }
});
Deno.test("km: existing 22t rule remains a price-band rule, never a capacity qualification", () => {
  const i = input(); i.unit.gross_weight_kg = 20000; i.basis.groups[0].weight_per_container_kg = 20000;
  const result = estimateUnlistedContainerTransport(rates(), i); assert(result.line);
  assertEquals(result.line.source.billed_size, "40");
  i.basis.groups[0].max_payload_kg = 19000;
  assertEquals(estimateUnlistedContainerTransport(rates(), i).line, null);
});
for (const [name, mutate] of Object.entries({
  missing: (i: ReturnType<typeof input>) => { i.basis.distance_source = " "; },
  future: (i: ReturnType<typeof input>) => { i.basis.verified_on = "2026-09-17"; },
  invalidDate: (i: ReturnType<typeof input>) => { i.basis.verified_on = "2026-02-30"; },
  shortDistance: (i: ReturnType<typeof input>) => { i.basis.distance_km = 58; },
  negativeDistance: (i: ReturnType<typeof input>) => { i.basis.distance_km = -300; },
  nan: (i: ReturnType<typeof input>) => { i.basis.distance_km = NaN; },
  wrongRoute: (i: ReturnType<typeof input>) => { i.destination = "Autre ville"; },
  catalog: (i: ReturnType<typeof input>) => { i.catalogComplete = false; },
  dangerous: (i: ReturnType<typeof input>) => { i.unit.dangerous_goods = true; },
  unknownDanger: (i: ReturnType<typeof input>) => { Object.assign(i.unit, { dangerous_goods: null }); },
  reefer: (i: ReturnType<typeof input>) => { i.unit.temperature_control_required = true; },
  special: (i: ReturnType<typeof input>) => { i.basis.groups[0].ordinary_transport = false; },
  noCapacitySource: (i: ReturnType<typeof input>) => { i.basis.groups[0].qualification_source = ""; },
  missingWeight: (i: ReturnType<typeof input>) => { i.unit.weight_basis = "unknown"; },
  changedWeight: (i: ReturnType<typeof input>) => { i.unit.gross_weight_kg = 10001; },
  changedCount: (i: ReturnType<typeof input>) => { i.unit.quantity = 3; },
  changedUnit: (i: ReturnType<typeof input>) => { i.unit.unit_ref = "lot-2"; },
  changedEquipment: (i: ReturnType<typeof input>) => { i.unit.equipment_code = "40GP"; },
  unsupported: (i: ReturnType<typeof input>) => { i.unit.equipment_code = i.basis.groups[0].equipment_code = "20FL"; },
  fiftyFiveTonnes: (i: ReturnType<typeof input>) => { i.unit.gross_weight_kg = i.basis.groups[0].weight_per_container_kg = 55000; },
  duplicate: (i: ReturnType<typeof input>) => { i.basis.groups.push({ ...i.basis.groups[0] }); },
})) Deno.test(`km: fail closed ${name}`, () => { const i = input(); mutate(i); assertEquals(estimateUnlistedContainerTransport(rates(), i).line, null); });

Deno.test("km: every listed destination/exception and unusable new rate prevents fallback", () => {
  for (const destination of ["BIGNONA", "ZIGUINCHOR", "CAP SKIRING", "DAKAR", "THIES", "POUT"]) {
    const i = input(); i.destination = i.basis.destination = destination;
    assertEquals(estimateUnlistedContainerTransport(rates(), i).line, null);
  }
  for (const row of [{ is_active: false }, { validity_end: "2020-01-01" }, { rate_amount: null }, { evidence_level: "to_confirm" }]) {
    const listed = { ...rates()[0], destination: basis().destination, ...row };
    assertEquals(estimateUnlistedContainerTransport([...rates(), listed], input()).line, null);
  }
  for (const catalog of [[], [...rates(), rates()[0]], rates().map(r => ({ ...r, rate_amount: 1 })),
    rates().map(r => ({ ...r, client_code: "OTHER_CLIENT" }))]) {
    assertEquals(estimateUnlistedContainerTransport(catalog, input()).line, null);
  }
});
Deno.test("km: assumptions overlay and fingerprint include source/qualification, no fact mutation", async () => {
  const facts = [{ id: "city", fact_key: "routing.destination_city", value_text: basis().destination }];
  const a = { id: "a", status: "active", assumed_fact_key: LOCAL_TRANSPORT_ESTIMATE_KEY, assumed_value_type: "json", assumed_value: basis() };
  const before = JSON.stringify(facts);
  const overlay = buildScenarioOverlay(facts, [a]); assertEquals(overlay.blockers, []);
  assertEquals(buildPricingInputs(overlay.facts).localTransportEstimate, basis());
  assertEquals(buildPricingInputs([{ id: "fake", fact_key: LOCAL_TRANSPORT_ESTIMATE_KEY, value_json: basis() }]).localTransportEstimate, undefined);
  const first = await computeRequestFingerprint({ basis: a.assumed_value });
  a.assumed_value.distance_source = "Updated trace";
  assert(first !== await computeRequestFingerprint({ basis: a.assumed_value }));
  assertEquals(JSON.stringify(facts), before);
  assertEquals(transportEstimateBasisError(basis()), null);
  assertEquals(validateManageAssumptionPayload({ case_id: "11111111-1111-4111-8111-111111111111", operation: "create",
    idempotency_key: "test-transport-0001", statement: "Transport ordinaire sous hypothèse", scope_key: "case", assumption_type: "other",
    assumed_fact_key: LOCAL_TRANSPORT_ESTIMATE_KEY, assumed_value_type: "json", assumed_value: basis(), source_type: "operator_guidance" }).ok, true);
  assertEquals(buildScenarioOverlay([], [{ ...a, assumed_fact_key: "routing.destination_country", assumed_value_type: "text", assumed_value: "SN" }]).blockers, []);
});

const prior = Deno.env.get("QUOTATION_ENGINE_DISABLE_SERVE");
Deno.env.set("QUOTATION_ENGINE_DISABLE_SERVE", "1");
const { generateQuotationLines } = await import("../quotation-engine/index.ts");
if (prior === undefined) Deno.env.delete("QUOTATION_ENGINE_DISABLE_SERVE"); else Deno.env.set("QUOTATION_ENGINE_DISABLE_SERVE", prior);
function db(catalog = rates(), complete = true) {
  return { from(table: string) { let rows = table === "local_transport_rates" ? [...catalog] : []; let single = false;
    const q = { select() { return q; }, eq(k: string, v: unknown) { rows = rows.filter(r => (r as Record<string, unknown>)[k] === v); return q; },
      in(k: string, v: unknown[]) { rows = rows.filter(r => v.includes((r as Record<string, unknown>)[k])); return q; },
      ilike() { return q; }, or() { return q; }, order() { return q; }, limit() { return q; }, gte() { return q; }, lte() { return q; }, not() { return q; },
      maybeSingle() { single = true; return q; }, single() { single = true; return q; },
      then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null, count: complete ? rows.length : null }).then(resolve); } };
    return q;
  } };
}
function request() {
  const context = { schema_version: 2 as const, cargo_units: [unit()] };
  return { finalDestination: basis().destination, transportMode: "maritime" as const, incoterm: "DAP", cargoType: "FCL",
    containers: resolveScenarioCargo(context).containers, scenarioCargoContext: context, scenarioPricingMode: "DAP_SERVICES_ONLY" as const,
    includeLocalTransport: true, scenarioLocalTransport: { basis: basis(), movement_direction: "IMPORT", destination_country: "SN", discharge_port: "DAKAR" } };
}
Deno.test("km: real engine consumes estimate with exact catalog priority and no input mutation", async () => {
  const req = request(); const before = JSON.stringify(req);
  const result = await generateQuotationLines(db(), req);
  assertEquals(result.lines.filter(l => l.category === "Transport").map(l => l.amount), [842520]);
  assertEquals(JSON.stringify(req), before);
  req.finalDestination = req.scenarioLocalTransport.basis.destination = "POUT";
  const exact = await generateQuotationLines(db(), req);
  assertEquals(exact.lines.filter(l => l.category === "Transport").map(l => l.amount), [271400]);
  assert(!exact.lines.some(l => l.id.startsWith("transport_km_")));
});
Deno.test("km: engine refuses incomplete catalog, unsupported route, unknown weight and canonical mode", async () => {
  for (const change of [(r: ReturnType<typeof request>) => { r.scenarioLocalTransport.destination_country = "ML"; },
    (r: ReturnType<typeof request>) => { r.scenarioLocalTransport.discharge_port = "ABIDJAN"; },
    (r: ReturnType<typeof request>) => { r.scenarioLocalTransport.movement_direction = "TRANSIT"; },
    (r: ReturnType<typeof request>) => { r.scenarioCargoContext.cargo_units[0].weight_basis = "unknown"; },
  ]) {
    const req = request(); change(req); const result = await generateQuotationLines(db(), req);
    assertEquals(result.lines.filter(l => l.category === "Transport").map(l => l.amount), [null]);
  }
  const result = await generateQuotationLines(db(rates(), false), request());
  assertEquals(result.lines.filter(l => l.category === "Transport").map(l => l.amount), [null]);
  const req = request(); const { scenarioPricingMode: _mode, scenarioCargoContext: _context, ...canonical } = req;
  const legacy = await generateQuotationLines(db(), { ...canonical, cargoValue: 10000 });
  assert(!legacy.lines.some(l => l.id.startsWith("transport_km_")));
});
