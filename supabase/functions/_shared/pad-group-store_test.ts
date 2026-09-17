import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadPadGroupState, padGroupScopeRequired } from "./pad-group-store.ts";
import { buildMaritimeFeeConsumption } from "./maritime-fee-decisions/pricing-consumption.ts";
const hash = "a".repeat(64);
const raw = () => ({ case_id: "case", case_status: "FACTS_PARTIAL", context_hash: hash, request_count: 1,
  scenario: { id: "scenario", scope_hash: hash, status: "draft", superseded_by_scenario_id: null, scope_snapshot: {
    schema_version: 3, transport_mode: "MARITIME", movement_direction: "IMPORT", cargo_units: [
      { unit_ref: "a", unit_kind: "CONTAINER", equipment_code: "20HQ", quantity: 2, ownership: "SOC", gross_weight_kg: 18000, weight_basis: "per_unit", scenario_basis: "Synthetic source" },
    ],
  } }, facts: [{ key: "service.package", text: "DAP_PROJECT_IMPORT" }, { key: "cargo.containers", json: [{ type: "20HQ", quantity: 2, coc_soc: "SOC" }] }],
  heads: [{ id: "decision", case_id: "case", scenario_id: "scenario", scope_hash: hash, context_hash: hash, unit_ref: "a", action: "confirm", category: "T02",
    total_weight_kg: 36000, source_reference: "Synthetic classification", weight_source_reference: "Synthetic weight", decided_by: "actor", created_at: "2026-09-17" }],
});
function db(data: unknown, count = 1, error: unknown = null) {
  const result = { data: [{ id: "tariff", provider: "PAD", category: "DROIT_PASSAGE", operation_type: "IMPORT", cargo_type: "CONTENEUR", classification: "T02",
    amount: 100, unit: "PER_TONNE", source_document: "Synthetic source", evidence_level: "official", effective_date: "2020-01-01", expiry_date: null, is_active: true }], error, count };
  const chain = { select: () => chain, eq: () => chain, limit: () => Promise.resolve(result) };
  return { rpc: () => Promise.resolve({ data, error: null }), from: () => chain };
}
Deno.test("group state prices confirmed source-linked weight, no global PAD fact required", async () => {
  const state = await loadPadGroupState(db(raw()), "case");
  assertEquals(state.mode, "groups"); assertEquals(state.ready, true); assertEquals(state.required, true); assertEquals(state.total, 3600);
  assertEquals(state.read_only, false);
});
Deno.test("group state refuses unavailable/truncated catalogue and cross-case context", async () => {
  await assertRejects(() => loadPadGroupState(db(raw(), 2), "case"));
  await assertRejects(() => loadPadGroupState(db(raw(), 1, {}), "case"));
  await assertRejects(() => loadPadGroupState(db(raw()), "other-case"));
});
Deno.test("group state: stale/source change, ambiguous allocation and separate request lots stay blocked", async () => {
  const stale = raw(); stale.context_hash = "b".repeat(64);
  assertEquals((await loadPadGroupState(db(stale), "case")).ready, false);
  const multi = raw(); multi.request_count = 2;
  assertEquals((await loadPadGroupState(db(multi), "case")).issues.map(i => i.code), ["PAD_REQUEST_MULTI_LOT_UNSUPPORTED"]);
  const wrong = raw(); wrong.facts = [wrong.facts[0]];
  assertEquals((await loadPadGroupState(db(wrong), "case")).issues.map(i => i.code), ["PAD_GROUP_ALLOCATION_REQUIRED"]);
});
Deno.test("locked cases readable, and legacy case keeps its existing path", async () => {
  for (const status of ["SENT", "ACCEPTED", "REJECTED", "ARCHIVED", "PRICING_RUNNING"]) {
    const locked = raw(); locked.case_status = status;
    assertEquals((await loadPadGroupState(db(locked), "case")).read_only, true);
  }
  const legacy = { ...raw(), scenario: null, heads: [] };
  assertEquals((await loadPadGroupState(db(legacy), "case")).mode, "legacy");
});
Deno.test("explicit removal PAD aligns requirement with maritime line removal; air outside PAD", () => {
  for (const key of ["PAD_DROIT_PASSAGE", "PORT_DAKAR_HANDLING"]) {
    const facts = [{ fact_key: "service.overrides", value_json: { remove: [key] } }];
    assertEquals(padGroupScopeRequired(facts, ["PORT_DAKAR_HANDLING"]), false);
    const output = buildMaritimeFeeConsumption({ decisions: [], identities: [], registryAvailable: true,
      lines: [{ category: "PAD_DROIT_PASSAGE", amount: 3600, currency: "XOF", source: { type: "OFFICIAL" },
        canonical: { service_key: "PAD_DROIT_PASSAGE", dedup_group: "PAD_DROIT_PASSAGE", origin_layer: "enrichment_pad" } }],
      removedServiceKeys: new Set([key]), carrierCode: null });
    assertEquals(output.blockers, []); assertEquals(output.lines.length, 0);
  }
  assertEquals(padGroupScopeRequired([], ["AIR_HANDLING"]), false);
});

Deno.test("confirmed pricing cannot recreate a PAD gap for a removed service", async () => {
  const source = await Deno.readTextFile(new URL("../run-pricing/index.ts", import.meta.url));
  assertEquals(source.includes('if (padRequired && padGroupState?.mode !== "groups" && !inputs.padCategory && isMaritime && inputs.cargoDescription)'), true);
});
