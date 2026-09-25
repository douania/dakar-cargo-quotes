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
  // MULTI-LOT-TERMINAL-1: no blanket refusal any more; an unbound group stays blocked.
  assertEquals((await loadPadGroupState(dbLots(multi, lotContext([])), "case")).issues.map(i => i.code), ["LOT_BINDING_REQUIRED"]);
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

// ── MULTI-LOT-TERMINAL-1: PAD readiness in a multi-lot dossier ─────────────────
const lineA = { id: "line-a", line_index: 1, line_label: "Lot A", request_type_hint: "SEA_FCL_IMPORT", fingerprint: "c".repeat(64),
  extracted_facts: [{ key: "cargo.containers", value: [{ type: "20HQ", quantity: 2 }] }, { key: "cargo.weight_kg", value: 36000 }] };
const lineB = { ...lineA, id: "line-b", line_index: 2, line_label: "Lot B", fingerprint: "d".repeat(64) };
const binding = (created_at = "2026-09-16T10:00:00Z", patch: Record<string, unknown> = {}) => ({ id: "binding-a", case_id: "case", scenario_id: "scenario",
  scope_hash: hash, context_hash: hash, unit_ref: "a", decision_kind: "line_binding", action: "confirm", line_fingerprint: lineA.fingerprint,
  terminal_mode: null, source_reference: "Synthetic operator check", decided_by: "actor", created_at, decision_version: 1, ...patch });
const lotContext = (heads: unknown[], patch: Record<string, unknown> = {}) => ({ case_id: "case", case_status: "FACTS_PARTIAL", context_hash: hash,
  request_count: 2, scenario: raw().scenario, lines: [lineA, lineB], heads, pad_heads: [], weight_head_id: null, ...patch });
function dbLots(data: unknown, lots: unknown) {
  const base = db(data);
  return { ...base, rpc: (name: string) => Promise.resolve({ data: name === "read_lot_confirmation_context" ? lots : data, error: null }) };
}
Deno.test("multi-lot PAD: a group bound before its decision is priced from its line, not from global facts", async () => {
  const multi = { ...raw(), request_count: 2, facts: [{ key: "service.package", text: "DAP_PROJECT_IMPORT" }] }; // global containers describe no lot
  const state = await loadPadGroupState(dbLots(multi, lotContext([binding()])), "case");
  assertEquals(state.issues, []); assertEquals(state.ready, true); assertEquals(state.total, 3600);
});
Deno.test("multi-lot PAD: rebinding, line mismatch, changed context and unavailable registry stay blocked", async () => {
  const multi = { ...raw(), request_count: 2 };
  const codes = async (lots: unknown) => (await loadPadGroupState(dbLots(multi, lots), "case")).issues.map(i => i.code);
  assertEquals(await codes(lotContext([binding("2026-09-18T10:00:00Z")])), ["LOT_BINDING_CHANGED"]);
  const other = { ...lineA, extracted_facts: [{ key: "cargo.containers", value: [{ type: "40HC", quantity: 2 }] }] };
  assertEquals(await codes(lotContext([binding()], { lines: [other, lineB] })), ["LOT_PAD_ALLOCATION_MISMATCH"]);
  const heavier = { ...lineA, extracted_facts: [lineA.extracted_facts[0], { key: "cargo.weight_kg", value: 30000 }] };
  assertEquals(await codes(lotContext([binding()], { lines: [heavier, lineB] })), ["LOT_PAD_WEIGHT_MISMATCH"]);
  assertEquals(await codes(lotContext([binding()], { context_hash: "b".repeat(64) })), ["LOT_CONTEXT_CHANGED"]);
  assertEquals(await codes(lotContext([binding("2026-09-16T10:00:00Z", { action: "revoke", line_fingerprint: null })])), ["LOT_CONFIRMATION_REVOKED"]);
  const twins = { ...lineB, fingerprint: lineA.fingerprint };
  assertEquals(await codes(lotContext([binding()], { lines: [lineA, twins] })), ["LOT_LINE_AMBIGUOUS"]);
  await assertRejects(() => loadPadGroupState(dbLots(multi, null), "case"));
});
Deno.test("multi-lot PAD (B1): readiness is judged on the caller's lot snapshot, never on a second reading", async () => {
  const { loadLotConfirmationState } = await import("./lot-confirmation-store.ts");
  const multi = { ...raw(), request_count: 2 };
  // Pinned snapshot: the binding was replaced after the PAD decision.
  const pinned = await loadLotConfirmationState({ rpc: () => Promise.resolve({ data: lotContext([binding("2026-09-18T10:00:00Z")]), error: null }) }, "case");
  const calls: string[] = [];
  const base = dbLots(multi, lotContext([binding()])); // a fresh reading would look ready
  const spy = { ...base, rpc: (name: string) => { calls.push(name); return base.rpc(name); } };
  const state = await loadPadGroupState(spy, "case", pinned);
  assertEquals(state.issues.map(i => i.code), ["LOT_BINDING_CHANGED"]);
  assertEquals(state.multi_lot, true);
  assertEquals(calls.includes("read_lot_confirmation_context"), false);
  assertEquals((await loadPadGroupState(db(raw()), "case")).multi_lot, false);
});
Deno.test("multi-lot PAD gap: a decision may resolve the dossier gap when ready, never (re)open it", async () => {
  const { syncPadGroupGapAfterDecision } = await import("./pad-group-store.ts");
  const calls: string[] = [];
  const client = { rpc: (name: string) => { calls.push(name); return Promise.resolve({ data: null, error: null }); } };
  const base = await loadPadGroupState(db(raw()), "case");
  // Multi-lot, not ready: no gap write at all.
  assertEquals(await syncPadGroupGapAfterDecision(client, "case", { ...base, multi_lot: true, ready: false }), false);
  assertEquals(calls, []);
  // Multi-lot ready, or mono-lot in any state: the existing sync runs unchanged.
  assertEquals(await syncPadGroupGapAfterDecision(client, "case", { ...base, multi_lot: true, ready: true }), true);
  assertEquals(await syncPadGroupGapAfterDecision(client, "case", { ...base, multi_lot: false, ready: false }), true);
  assertEquals(calls, ["sync_pad_weight_gap", "sync_pad_weight_gap"]);
});
