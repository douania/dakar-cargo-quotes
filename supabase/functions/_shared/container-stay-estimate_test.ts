import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CONTAINER_STAY_KEY, stayBasisError, resolveStayGroup, calculateStayTiers, assessDpwStorageFranchise } from "./container-stay-estimate.ts";
import { buildScenarioOverlay, buildPricingInputs, computeScenarioTotals, applyScenarioContainerTerminalLines, resolveScenarioContainerTerminal } from "../run-scenario-pricing/domain.ts";
import { resolveScenarioCargo } from "./scenario-cargo.ts";
const unit = (over: Record<string, unknown> = {}) => ({ unit_ref: "lot-1", unit_kind: "CONTAINER", equipment_code: "40HQ", quantity: 3,
  ownership: "COC", dangerous_goods: false, temperature_control_required: false, gross_weight_kg: 10000, weight_basis: "per_unit",
  volume_dm3: null, un_number: null, imo_class: null, scenario_basis: "Synthetic stay", destination_ref: null, ...over });
const basis = (days = 12) => ({ schema_version: 1, source: "Synthetic calendar-day counting convention from discharge to gate-out", verified_on: "2026-09-16",
  groups: [{ unit_ref: "lot-1", equipment_code: "40HQ", quantity: 3, ownership: "COC" as const, storage_days: days as number | null, demurrage_days: days as number | null, provider: "DPW" as const }] });
const tiers = () => [
  { day_from: 11, day_to: 20, rate_per_day: "38050", currency: "XOF", evidence_level: "official", source_document: "Synthetic schedule" },
  { day_from: 21, day_to: null, rate_per_day: "45920", currency: "XOF", evidence_level: "official", source_document: "Synthetic schedule" },
];
const storage = () => [{ provider: "DPW", container_type: "40HC", cargo_type: "FCL", is_active: true, effective_date: "2025-01-01", expiry_date: null, free_days: 10, rate_per_day: 12000 }];
Deno.test("stay: franchise, first paid day, inclusive boundaries, multiple groups and SQL numeric strings", () => {
  for (const [days, expected] of [[10, 0], [11, 38050 * 3], [20, 38050 * 30], [21, (38050 * 10 + 45920) * 3], [22, (38050 * 10 + 45920 * 2) * 3]]) {
    assertEquals(calculateStayTiers(tiers(), 10, days, 3).amount, expected);
  }
  const before = JSON.stringify(tiers()); calculateStayTiers(tiers().reverse(), 10, 22, 3); assertEquals(JSON.stringify(tiers()), before);
});
for (const [name, change] of Object.entries({
  gap: (t: ReturnType<typeof tiers>) => { t[1].day_from = 22; }, overlap: (t: ReturnType<typeof tiers>) => { t[1].day_from = 20; },
  unproven: (t: ReturnType<typeof tiers>) => { t[1].evidence_level = "observed"; }, foreign: (t: ReturnType<typeof tiers>) => { t[1].currency = "EUR"; },
  blank: (t: ReturnType<typeof tiers>) => { t[1].rate_per_day = ""; }, negative: (t: ReturnType<typeof tiers>) => { t[1].rate_per_day = "-1"; },
  noSource: (t: ReturnType<typeof tiers>) => { t[1].source_document = ""; }, noEnd: (t: ReturnType<typeof tiers>) => { t.pop(); },
})) Deno.test(`stay: rejects ${name} even inside franchise`, () => { const t = tiers(); change(t); assertEquals(calculateStayTiers(t, 10, 9, 3).amount, null); });
Deno.test("stay: empty, fractional, negative, overflow quantities and duration rejected", () => {
  for (const [free, days, count] of [[null, 10, 3], [10, 0, 3], [10, 1.5, 3], [10, -1, 3], [10, 3661, 3], [10, 10, 0], [10, 10, 1e9]] as const) assertEquals(calculateStayTiers(tiers(), free, days, count).amount, null);
  assertEquals(calculateStayTiers([], 10, 9, 3).amount, null);
});
Deno.test("stay: exact identity, casing only, no mutation, future/source/malformed refusals", () => {
  const b = basis(); const before = JSON.stringify(b);
  assert(resolveStayGroup(b, unit({ equipment_code: "40hq" }), "2026-09-16").group);
  for (const change of [{ quantity: 4 }, { ownership: "SOC" }, { equipment_code: "40GP" }, { unit_ref: "lot-2" }]) assertEquals(resolveStayGroup(b, unit(change), "2026-09-16").group, null);
  assertEquals(resolveStayGroup(b, unit(), "2026-09-15").group, null);
  for (const bad of [null, { ...b, groups: [null] }, { ...b, source: "" }, { ...b, rate: 5 }, { ...b, groups: [...b.groups, ...b.groups] }]) assert(stayBasisError(bad));
  assertEquals(JSON.stringify(b), before);
});
Deno.test("storage: exact DPW dry local franchise only; never consumes unverified daily amounts", () => {
  const g = basis(10).groups[0];
  assertEquals(assessDpwStorageFranchise(storage(), g, unit(), "2026-09-16").amount, 0);
  assertEquals(assessDpwStorageFranchise(storage(), { ...g, storage_days: 11 }, unit(), "2026-09-16").amount, null);
  for (const rows of [[], [...storage(), ...storage()], [{ ...storage()[0], provider: "PAD" }], [{ ...storage()[0], free_days: 15 }]]) assertEquals(assessDpwStorageFranchise(rows, g, unit(), "2026-09-16").amount, null);
  for (const u of [unit({ dangerous_goods: true }), unit({ dangerous_goods: null }), unit({ temperature_control_required: true })]) assertEquals(assessDpwStorageFranchise(storage(), g, u, "2026-09-16").amount, null);
});
Deno.test("stay: linked assumption only, never promoted fact or firm total", () => {
  const a = { id: "a", status: "active", assumed_fact_key: CONTAINER_STAY_KEY, assumed_value_type: "json", assumed_value: basis() };
  const overlay = buildScenarioOverlay([], [a]); assertEquals(overlay.blockers, []);
  assertEquals(buildPricingInputs(overlay.facts).containerStayEstimate, basis());
  assertEquals(buildPricingInputs([{ id: "f", fact_key: CONTAINER_STAY_KEY, value_json: basis(), source_type: "email" }]).containerStayEstimate, undefined);
  const total = computeScenarioTotals([{ amount: 228300, currency: "XOF", source: { type: "CALCULATED", confidence: 1, firm_eligible: false } }], new Set());
  assertEquals(total.firm_total_ht, 0); assertEquals(total.indicative_total_ht, 228300);
});
const prior = Deno.env.get("QUOTATION_ENGINE_DISABLE_SERVE"); Deno.env.set("QUOTATION_ENGINE_DISABLE_SERVE", "1");
const { generateQuotationLines } = await import("../quotation-engine/index.ts");
if (prior === undefined) Deno.env.delete("QUOTATION_ENGINE_DISABLE_SERVE"); else Deno.env.set("QUOTATION_ENGINE_DISABLE_SERVE", prior);
function db() {
  return { from(table: string) { let rows: Record<string, unknown>[] = table === "warehouse_franchise" ? storage() : table === "demurrage_rates" ? [
    { id: "r", carrier: "CMA_CGM", container_type: "40HC", is_active: true, free_days_import: 10, effective_date: "2025-01-01", expiry_date: null },
  ] : table === "demurrage_tiers" ? tiers().map((r, i) => ({ ...r, tier_order: i + 1, demurrage_rate_id: "r" })) : [];
  let single = false;
  const q = { select() { return q; }, eq(k: string, v: unknown) { rows = rows.filter(r => r[k] === v); return q; }, in(k: string, v: unknown[]) { rows = rows.filter(r => v.includes(r[k])); return q; },
    ilike() { return q; }, or() { return q; }, order() { return q; }, limit() { return q; }, gte() { return q; }, lte() { return q; }, not() { return q; },
    maybeSingle() { single = true; return q; }, single() { single = true; return q; }, then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null, count: rows.length }).then(resolve); } }; return q; } };
}
function request(days = 12) {
  const context = { schema_version: 2 as const, cargo_units: [unit(), unit({ unit_ref: "lot-2", ownership: "SOC" })] };
  return { finalDestination: "Dakar", cargoType: "FCL", transportMode: "maritime" as const, incoterm: "DAP", carrier: "CMA_CGM", containers: resolveScenarioCargo(context).containers,
    scenarioCargoContext: context, scenarioPricingMode: "DAP_SERVICES_ONLY" as const,
    scenarioStay: { basis: basis(days), movement_direction: "IMPORT", destination_country: "SN", discharge_port: "DAKAR", terminal_mode: null as string | null } };
}
Deno.test("storage estimate: selected code, total/per-unit weight, preserved indicative result, no other group leak", async () => {
  const req = request(12);
  Object.assign(req.scenarioStay.basis.groups[0], { storage_p1_code: "412" });
  const before = JSON.stringify(req);
  let out = await generateQuotationLines(db(), req);
  let lines = out.lines.filter(l => l.category === "Magasinage");
  assertEquals(lines.map(l => l.amount), [11820, null]);
  assertEquals(lines[0].source.firm_eligible, false);
  assertEquals(lines[0].stay_information?.tiers.map(t => [t.from, t.to]), [[11, 25], [26, 40], [41, null]]);
  assertEquals(lines[0].stay_information?.example?.amount, 11820);
  assertEquals(lines[1].stay_information?.example, null);
  assert(lines[0].notes?.includes("P1 observé"));
  const kept = applyScenarioContainerTerminalLines(lines.map(l => ({ ...l })), { eligible: true, annexUncertain: true, blockers: [], reservations: [], effectiveMode: null });
  assertEquals(kept.map(l => l.amount), [11820, null]);
  assertEquals(computeScenarioTotals(kept, new Set()).firm_total_ht, 0);
  assertEquals(JSON.stringify(req), before);
  req.scenarioCargoContext.cargo_units[0].weight_basis = "total";
  out = await generateQuotationLines(db(), req);
  lines = out.lines.filter(l => l.category === "Magasinage");
  assertEquals(lines[0].amount, 3940);
  req.scenarioCargoContext.cargo_units[0].weight_basis = "unknown";
  assertEquals((await generateQuotationLines(db(), req)).lines.find(l => l.category === "Magasinage")?.amount, null);
});
Deno.test("storage estimate: invalid/unsupported codes and DG are not priced", async () => {
  for (const code of ["420", "421", "999", "519"]) {
    const b = basis(); Object.assign(b.groups[0], { storage_p1_code: code }); assert(stayBasisError(b));
  }
  const req = request(12); Object.assign(req.scenarioStay.basis.groups[0], { storage_p1_code: "414" });
  let out = await generateQuotationLines(db(), req);
  assertEquals(out.lines.find(l => l.category === "Magasinage")?.amount, 23640);
  assert(out.lines.find(l => l.category === "Magasinage")?.notes?.includes("à corroborer"));
  req.scenarioCargoContext.cargo_units[0].dangerous_goods = true;
  assertEquals((await generateQuotationLines(db(), req)).lines.find(l => l.category === "Magasinage")?.amount, null);
});
Deno.test("stay: real engine per COC group, SOC excluded, storage untouched beyond franchise", async () => {
  const req = request(); const before = JSON.stringify(req); const out = await generateQuotationLines(db(), req);
  const dem = out.lines.filter(l => l.category === "Surestaries"); assertEquals(dem.length, 1); assertEquals(dem[0].amount, 228300);
  assertEquals(dem[0].source.firm_eligible, false); assertEquals(dem[0].source.type, "CALCULATED");
  assertEquals(out.lines.filter(l => l.category === "Magasinage").map(l => l.amount), [null, null]);
  assertEquals(JSON.stringify(req), before);
});
Deno.test("stay: storage zero only explicitly qualified group, other terminal fees not unlocked", async () => {
  const out = await generateQuotationLines(db(), request(10));
  const lines = out.lines.filter(l => l.category === "Magasinage"); assertEquals(lines.map(l => l.amount), [0, null]);
  const guarded = applyScenarioContainerTerminalLines([...lines.map(l => ({ ...l })), { category: "Terminal DPW", amount: 999, id: "other" }], { eligible: true, annexUncertain: true, blockers: [], reservations: [], effectiveMode: null });
  assertEquals(guarded.map(l => l.amount), [0, null, null]);
  assertEquals(guarded[1].notes, lines[1].notes);
});
Deno.test("stay: wrong direction/country/port and changed group never price", async () => {
  for (const over of [{ movement_direction: "TRANSIT" }, { destination_country: "ML" }, { discharge_port: "ABIDJAN" }]) {
    const req = request(10); Object.assign(req.scenarioStay, over); const out = await generateQuotationLines(db(), req);
    assert(out.lines.filter(l => ["Surestaries", "Magasinage"].includes(l.category)).every(l => l.amount === null));
  }
  const req = request(10); req.scenarioStay.terminal_mode = "RORO";
  assert((await generateQuotationLines(db(), req)).lines.filter(l => l.category === "Magasinage").every(l => l.amount === null));
  const transit = request(10); transit.finalDestination = "Bamako";
  assert((await generateQuotationLines(db(), transit)).lines.filter(l => ["Magasinage", "Surestaries"].includes(l.category)).every(l => l.amount === null));
});
Deno.test("stay: independent durations, no recycling of missing terminal/carrier duration", async () => {
  const req = request(); req.scenarioStay.basis.groups[0].storage_days = 8;
  let out = await generateQuotationLines(db(), req);
  assertEquals(out.lines.find(l => l.category === "Surestaries")?.amount, 228300);
  assertEquals(out.lines.find(l => l.category === "Magasinage")?.amount, 0);
  req.scenarioStay.basis.groups[0].storage_days = null;
  out = await generateQuotationLines(db(), req);
  assertEquals(out.lines.find(l => l.category === "Magasinage")?.amount, null);
  assertEquals(out.lines.find(l => l.category === "Magasinage")?.stay_information?.free_days, 10);
  req.scenarioStay.basis.groups[0].storage_days = 8; req.scenarioStay.basis.groups[0].demurrage_days = null;
  out = await generateQuotationLines(db(), req);
  assertEquals(out.lines.find(l => l.category === "Surestaries")?.amount, null);
  assertEquals(out.lines.find(l => l.category === "Magasinage")?.amount, 0);
});
Deno.test("stay: canonical RORO/CONRO fact survives missing scenario mode, cannot yield DPW zero", async () => {
  for (const mode of ["RORO", "CONRO"]) {
    const req = request(8);
    const policy = resolveScenarioContainerTerminal({ schema_version: 2, transport_mode: "MARITIME", movement_direction: "IMPORT", terminal_operation_mode: null, cargo_units: req.scenarioCargoContext.cargo_units }, [
      { id: "port", fact_key: "routing.destination_port", value_text: "DAKAR" }, { id: "terminal", fact_key: "routing.terminal_operation_mode", value_text: mode },
    ], ["DTHC"]);
    assertEquals(policy.effectiveMode, mode);
    req.scenarioStay.terminal_mode = policy.effectiveMode;
    const out = await generateQuotationLines(db(), req);
    assert(out.lines.filter(l => l.category === "Magasinage").every(l => l.amount === null));
  }
});
