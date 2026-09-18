import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadPadGroupState, padGroupScopeRequired } from "./pad-group-store.ts";
import { buildMaritimeFeeConsumption } from "./maritime-fee-decisions/pricing-consumption.ts";
import type { WeightReconciliation, WeightFact } from "./pad-weight-reconciliation.ts";
const hash = "a".repeat(64);
const raw = () => ({ case_id: "case", case_status: "FACTS_PARTIAL", context_hash: hash, request_count: 1,
  scenario: { id: "scenario", scope_hash: hash, status: "draft", superseded_by_scenario_id: null, scope_snapshot: {
    schema_version: 3, transport_mode: "MARITIME", movement_direction: "IMPORT", cargo_units: [
      { unit_ref: "a", unit_kind: "CONTAINER", equipment_code: "20HQ", quantity: 2, ownership: "SOC", gross_weight_kg: 18000, weight_basis: "per_unit", scenario_basis: "Synthetic source" },
    ],
  } }, facts: [{ key: "service.package", text: "DAP_PROJECT_IMPORT" }, { key: "cargo.containers", json: [{ type: "20HQ", quantity: 2, coc_soc: "SOC" }] }],
  heads: [{ id: "decision", case_id: "case", scenario_id: "scenario", scope_hash: hash, context_hash: hash, unit_ref: "a", action: "confirm" as const, category: "T02",
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

Deno.test("reconciliation: explicit decision preserves PAD heads and replaces only extracted weight conflict", async () => {
  const base = raw();
  const fact: WeightFact = { id: "fact", number: 35000, text: null, source_type: "ai_extraction", source_email_id: "email" };
  const decision: WeightReconciliation = { id: "reconciliation", case_id: "case", context_hash: hash, confirmation_heads: base.heads,
    original_fact: fact, total_weight_kg: 36000, action: "retain", justification: "Source rechecked: 2 times 18 tonnes", reservation: "Revisable against final transport documents." };
  const data = { ...base, facts: [...base.facts, { key: "cargo.weight_kg", number: 35000 }], weight_facts: [fact], weight_reconciliation: decision };
  const state = await loadPadGroupState(db(data), "case");
  assertEquals(state.ready, true); assertEquals(state.retained_weight?.total_weight_kg, 36000);
  assertEquals(state.heads, base.heads); assertEquals(state.total, 3600); assertEquals(data.facts.at(-1), { key: "cargo.weight_kg", number: 35000 });
  for (const patch of [{ action: "revoke" }, { context_hash: "b".repeat(64) }, { case_id: "other" },
    { total_weight_kg: 35000 }, { confirmation_heads: [] }, { reservation: "" }]) {
    const bad = await loadPadGroupState(db({ ...data, weight_reconciliation: { ...decision, ...patch } }), "case");
    assertEquals(bad.ready, false); assertEquals(bad.retained_weight, null);
  }
  for (const patch of [{ source_type: "client" }, { source_email_id: "other-email" }, { number: 34000 }]) {
    assertEquals((await loadPadGroupState(db({ ...data, weight_facts: [{ ...fact, ...patch }] }), "case")).ready, false);
  }
  assertEquals((await loadPadGroupState(db({ ...data, weight_reconciliation: null }), "case")).ready, false);
  assertEquals((await loadPadGroupState(db({ ...data, facts: [{ key: "service.package", text: "DAP_PROJECT_IMPORT" }] }), "case")).ready, false);
  assertEquals((await loadPadGroupState(db({ ...data, heads: [{ ...base.heads[0], action: "revoke" }] }), "case")).ready, false);
});
