// MULTI-LOT-TERMINAL-1 — HANDLER-LEVEL local path (GO CTO 2026-09-25).
// Executes the REAL handlers: build-case-puzzle (sync), manage-lot-confirmation,
// manage-pad-group-confirmation, run-pricing, quotation-engine and price-service-lines.
// Local substitutes (declared, not production): Supabase client = psql double on an offline
// Docker PostgreSQL (schema-only restore + migrations, synthetic rows only); Lovable AI gateway
// = deterministic synthetic answers; scenario created/selected through the real SQL writer
// manage_quote_scenario (its Edge handler is not exercised).
// Usage (see run.sh in the bilan): --baseline runs only the "before" check against a checkout
// of the base commit given by DCQ_FUNCTIONS_ROOT.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ai, call, failingRpcs, loadHandlers, q, sql } from "./harness.ts";
import { operatorFact, seedCase, snapshot, TEXT_LINES, TWO_LINES } from "./fixture.ts";

const baseline = Deno.args.includes("--baseline");
// --text-containers: synthetic AI answers with the real extraction form ("2x40HC" / "1x20DV").
const LINES = Deno.args.includes("--text-containers") ? TEXT_LINES : TWO_LINES;
const rootEnv = Deno.env.get("DCQ_FUNCTIONS_ROOT");
await loadHandlers(rootEnv ? new URL(`file:///${rootEnv.replaceAll("\\", "/").replace(/\/?$/, "/")}`) : undefined);
const ok = (label: string) => console.log(`PASS ${label}`);
const TERMINAL = "routing.terminal_operation_mode", PAD = "pricing.pad_category";

async function newCase(options: { description?: boolean } = {}) {
  const id = crypto.randomUUID();
  await seedCase(id, crypto.randomUUID(), crypto.randomUUID());
  const facts: Array<[string, string, string]> = [["service.package", "service", "DAP_PROJECT_IMPORT"], ["routing.incoterm", "routing", "DAP"],
    ["routing.destination_city", "routing", "Dakar"], ["routing.transport_mode", "routing", "MARITIME"], ["routing.origin_port", "routing", "Shanghai"]];
  if (options.description !== false) facts.push(["cargo.description", "cargo", "Mobilier de bureau et pieces detachees (synthetique)"]);
  for (const [k, c, v] of facts) await operatorFact(id, k, c, v);
  return id;
}
async function build(id: string, lines: unknown[] | null) {
  ai.multiQuoteLines = lines;
  const r = await call("build-case-puzzle", { case_id: id, mode: "sync" });
  assertEquals(r.status, 200, JSON.stringify(r.json).slice(0, 400));
  return { result: r.json, state: await snapshot(id) };
}
const price = (id: string) => call("run-pricing", { case_id: id });

// Priced outputs compared WITHOUT the identifiers and timestamps proper to each dossier/run:
// services, quantities, amounts, currencies, totals, notes/reserves, sources, tariff and rule
// references, and the containers sent to the engine are all kept.
const VOLATILE = /^(id|case_id|pricing_run_id|run_id|decision_id|scenario_id|line_id|thread_id|email_id|.+_at|duration_ms|context_hash|scope_hash|idempotency_key|request_fingerprint)$/;
function normalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>)
    .filter(([k]) => !VOLATILE.test(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, normalize(x)]));
  return v;
}
async function runOutputs(runId: string) {
  return JSON.parse(await sql(`select jsonb_build_object('status',status,'total_ht',total_ht,'total_ttc',total_ttc,'currency',currency,
    'outputs',outputs_json,'lines',tariff_lines,'inputs',inputs_json,'engine_request',engine_request)::text from public.pricing_runs where id=${q(runId)};`)) as
    { status: string; lines: Array<Record<string, unknown>>; [k: string]: unknown };
}

// ── M. Mono-lot non-regression: the same synthetic dossier priced by the base and the patched
// handlers must give the same normalized output (compared outside, see MONO_OUTPUT). ──
async function monoOutput() {
  const id = await newCase();
  for (const [k, c, v] of [["routing.terminal_operation_mode", "routing", "LOLO"], ["cargo.containers", "cargo", JSON.stringify([{ type: "40HC", quantity: 2 }])],
    ["cargo.weight_kg", "cargo", "36000"], ["cargo.pad_category", "cargo", "T02"], ["cargo.pad_rate_fcfa_per_ton", "cargo", "100"]]) await operatorFact(id, k, c, v);
  const { state } = await build(id, null);
  assertEquals(state.lines, 0);
  const r = await price(id);
  assertEquals(r.status, 200, JSON.stringify(r.json).slice(0, 600));
  const out = await runOutputs(r.json.pricing_run_id);
  assertEquals(out.status, "success");
  console.log(`MONO_OUTPUT ${JSON.stringify(normalize(out))}`);
  return out;
}
if (Deno.args.includes("--mono-only")) {
  await monoOutput();
  ok("M mono-lot priced (output printed for the base/patched comparison)");
  Deno.exit(0);
}

// ── X. Out of PAD (and terminal) scope: two lots, only lot A states its containers; the dossier
// holds a DIFFERENT containers fact. Lot B must never receive lot A's nor the dossier's. ──
const OUT_OF_PAD = JSON.stringify({ add: [], remove: ["PORT_DAKAR_HANDLING", "DTHC", "PAD_DROIT_PASSAGE"] });
async function inheritanceCase(hintB: string) {
  const id = await newCase();
  await operatorFact(id, "service.overrides", "service", OUT_OF_PAD);
  await operatorFact(id, "cargo.containers", "cargo", JSON.stringify([{ type: "20DV", quantity: 3 }]));
  const lines = TWO_LINES.map((l, i) => i === 0
    ? { ...l, extracted_facts: l.extracted_facts.map(f => f.key === "cargo.containers" ? { ...f, value: "2x40HC", valueType: "text" } : f) }
    : { ...l, request_type_hint: hintB, extracted_facts: l.extracted_facts.filter(f => f.key !== "cargo.containers") });
  const built = await build(id, lines);
  const r = await price(id);
  const runs = JSON.parse(await sql(`select coalesce(jsonb_agg(jsonb_build_object('status',status,'lots',
    (select jsonb_agg(jsonb_build_object('lot',x->'lot_index','containers',x->'params'->'containers')) from jsonb_array_elements(engine_request->'lots') x))
    order by created_at),'[]')::text from public.pricing_runs where case_id=${q(id)};`));
  return { built, r, runs };
}
if (Deno.args.includes("--inheritance-probe")) {
  const { built, r, runs } = await inheritanceCase("SEA_FCL_IMPORT");
  console.log(`INHERITANCE_PROBE ${JSON.stringify({ status: built.state.status, http: r.status, blocked_lots: r.json.blocked_lots ?? null, runs })}`);
  Deno.exit(0);
}

if (baseline) {
  // Base commit: the circular block the exception removes.
  const id = await newCase();
  const { result, state } = await build(id, LINES);
  assertEquals(result.quote_request_lines_stored, 2);
  assertEquals(state.status, "NEED_INFO");
  assert(state.blocking.includes(TERMINAL) && state.blocking.includes(PAD), JSON.stringify(state));
  const run = await price(id);
  assertEquals(run.status, 400);
  ok("BASELINE f060bea: two persisted lines, dossier terminal/PAD gaps blocking, status NEED_INFO, run-pricing refused");
  Deno.exit(0);
}

// ── A. Multi-lot analysis → admissible status without dossier terminal/PAD gaps ──
const A = await newCase();
let b = await build(A, LINES);
assertEquals([b.result.quote_request_lines_stored, b.state.lines, b.state.status], [2, 2, "READY_TO_PRICE"]);
assert(!b.state.open.includes(TERMINAL) && !b.state.open.includes(PAD), JSON.stringify(b.state));
ok("A1 build: 2 lines persisted, no dossier terminal/PAD gap, READY_TO_PRICE");

// ── B. run-pricing before any decision: every lot blocked, nothing priced, status kept ──
let run = await price(A);
assertEquals(run.status, 200);
assertEquals(run.json.pricing_blockers, ["MULTI_LOT_BLOCKED"]);
for (const lot of run.json.blocked_lots) assert(lot.blockers.includes("TERMINAL_OPERATION_MODE_REQUIRED"), JSON.stringify(lot));
assertEquals((await snapshot(A)).status, "READY_TO_PRICE");
ok("B run-pricing without decisions: MULTI_LOT_BLOCKED per lot (terminal required), status unchanged");

// ── C. Operator decisions through the real Edge handlers ──
await sql(`insert into public.port_tariffs(id,provider,category,operation_type,classification,cargo_type,amount,unit,source_document,effective_date,expiry_date,is_active,evidence_level)
 select gen_random_uuid(),'PAD','DROIT_PASSAGE','IMPORT',c,'CONTENEUR',a,'per_tonne','Synthetic PAD tariff '||c,'2020-01-01',null,true,'official'
 from (values ('T02',100),('T03',150)) v(c,a) where not exists (select 1 from public.port_tariffs where source_document='Synthetic PAD tariff '||c);`);
const unit = (ref: string, eq: string, qty: number, kg: number) => ({ unit_ref: ref, unit_kind: "CONTAINER", equipment_code: eq, packaging: "unknown", quantity: qty,
  gross_weight_kg: kg, chargeable_weight_kg: null, volume_dm3: null, temperature_control_required: false, temperature_setpoint_celsius: null,
  classification_status: "unknown", destination_ref: null, dangerous_goods: null, required_attachment_status: "not_required", ownership: "SOC",
  un_number: null, imo_class: null, weight_basis: "per_unit", scenario_basis: `Synthetic lot ${ref}` });
async function selectScenario(id: string) {
  const scope = { schema_version: 3, transport_mode: "MARITIME", movement_direction: "IMPORT", terminal_operation_mode: null,
    cargo_units: [unit("a", "40hc", 2, 18000), unit("b", "20dv", 1, 12000)],
    pad_choices: [{ unit_ref: "a", category: "T02", basis: "Synthetic" }, { unit_ref: "b", category: "T03", basis: "Synthetic" }] };
  await sql(`select public.manage_quote_scenario(${q(id)},'select','00000000-0000-4000-8000-0000000a0001',${q(`select-${crypto.randomUUID()}`)},repeat('b',64),
    p_scenario_id=>(public.manage_quote_scenario(${q(id)},'create','00000000-0000-4000-8000-0000000a0001',${q(`create-${crypto.randomUUID()}`)},repeat('a',64),
    p_title=>'SYNTHETIC',p_scope_snapshot=>${q(scope)}::jsonb)->>'scenario_id')::uuid);`);
}
async function confirmAll(id: string) {
  let state = (await call("manage-lot-confirmation", { case_id: id, action: "read" })).json;
  const head = (u: string, k: string) => state.context.heads.find((h: { unit_ref: string; decision_kind: string }) => h.unit_ref === u && h.decision_kind === k)?.id ?? null;
  const fp = (i: number) => state.context.lines.find((l: { line_index: number }) => l.line_index === i).fingerprint;
  const record = async (decision: Record<string, unknown>) => {
    const r = await call("manage-lot-confirmation", { case_id: id, action: "record", decision: { line_fingerprint: null, terminal_mode: null,
      source_reference: "Courriel client synthetique", expected_context_hash: state.context.context_hash, idempotency_key: crypto.randomUUID(), ...decision } });
    assertEquals(r.status, 200, JSON.stringify(r.json)); state = r.json;
  };
  for (const [u, i] of [["a", 1], ["b", 2]] as const) await record({ unit_ref: u, decision_kind: "line_binding", action: "confirm", line_fingerprint: fp(i), expected_head_id: head(u, "line_binding") });
  for (const u of ["a", "b"]) await record({ unit_ref: u, decision_kind: "terminal_mode", action: "confirm", terminal_mode: "LOLO", expected_head_id: head(u, "terminal_mode") });
  let pad = (await call("manage-pad-group-confirmation", { case_id: id, action: "read" })).json;
  for (const [u, cat] of [["a", "T02"], ["b", "T03"]]) {
    const r = await call("manage-pad-group-confirmation", { case_id: id, action: "record", decision: { unit_ref: u, action: "confirm", category: cat,
      source_reference: "Nomenclature synthetique verifiee", weight_source_reference: "Poids du courriel client synthetique",
      expected_context_hash: pad.context.context_hash, expected_head_id: pad.all_heads.find((h: { unit_ref: string }) => h.unit_ref === u)?.id ?? null,
      idempotency_key: crypto.randomUUID() } });
    assertEquals(r.status, 200, JSON.stringify(r.json).slice(0, 300)); pad = r.json;
  }
  assertEquals(pad.ready, true, JSON.stringify(pad.issues));
  return state;
}
await selectScenario(A);
await confirmAll(A);
ok("C confirmations: bindings, LOLO per lot and PAD T02/T03 recorded through the real Edge handlers; PAD ready");

// ── D. run-pricing with the real engine: one PAD line per lot, run recorded under lock ──
run = await price(A);
assertEquals(run.status, 200, JSON.stringify(run.json).slice(0, 600));
assertEquals(run.json.mode, "multi_lot");
const runRow = JSON.parse(await sql(`select jsonb_build_object('status',status,'lines',tariff_lines)::text from public.pricing_runs where id=${q(run.json.pricing_run_id)};`));
assertEquals(runRow.status, "success");
const padLines = runRow.lines.filter((l: { category: string }) => l.category === "PAD_DROIT_PASSAGE");
assertEquals(padLines.map((l: { lot_index: number; amount: number; source: { unit_ref: string } }) => `${l.lot_index}:${l.source.unit_ref}:${l.amount}`).sort(), ["1:a:3600", "2:b:1800"]);
console.log("D tariff lines:", JSON.stringify(runRow.lines.map((l: { lot_index: number; category: string; amount: number; quantity?: number }) => [l.lot_index, l.category, l.quantity, l.amount])));
assertEquals((await snapshot(A)).status, "PRICED_DRAFT");
ok("D run-pricing (real handler + quotation-engine + price-service-lines): success, PAD 3600 lot 1 / 1800 lot 2, PRICED_DRAFT");

// ── E. Re-analysis: lines rewritten, every decision stale, nothing re-associated ──
b = await build(A, LINES);
assertEquals(b.state.lines, 2);
run = await price(A);
assertEquals(run.json.pricing_blockers, ["MULTI_LOT_BLOCKED"]);
assert(run.json.blocked_lots.every((l: { blockers: string[] }) => l.blockers.includes("LOT_CONFIRMATION_STALE") || l.blockers.includes("PAD_GROUP_CONFIRMATION_REQUIRED")), JSON.stringify(run.json));
ok("E re-analysis: decisions stale, run-pricing blocked per lot, no silent re-association");
await confirmAll(A);
run = await price(A);
assertEquals(run.status, 200, JSON.stringify(run.json).slice(0, 400));
const rerun = JSON.parse(await sql(`select jsonb_build_object('status',status,'lines',tariff_lines)::text from public.pricing_runs where id=${q(run.json.pricing_run_id)};`));
assertEquals(rerun.status, "success");
assertEquals(rerun.lines.filter((l: { category: string }) => l.category === "PAD_DROIT_PASSAGE")
  .map((l: { lot_index: number; amount: number; source: { unit_ref: string } }) => `${l.lot_index}:${l.source.unit_ref}:${l.amount}`).sort(), ["1:a:3600", "2:b:1800"]);
ok("E2 reconfirmation after re-analysis: priced again, one PAD line per lot, same amounts");

// ── F. Multi → mono → multi ──
b = await build(A, null);
assertEquals(b.state.lines, 0);
assert(b.state.blocking.includes(TERMINAL), JSON.stringify(b.state));
run = await price(A);
assertEquals(run.status, 400);
ok("F1 multi → mono: lines cleared, dossier terminal gap blocking again, run-pricing refused");
b = await build(A, LINES);
assertEquals(b.state.lines, 2);
assert(!b.state.blocking.includes(TERMINAL) && !b.state.blocking.includes(PAD), JSON.stringify(b.state));
assert(b.state.resolved_reasons.includes(`${TERMINAL}:multi_lot_per_lot_confirmation`), JSON.stringify(b.state.resolved_reasons));
await confirmAll(A);
run = await price(A);
assertEquals(run.status, 200, JSON.stringify(run.json).slice(0, 400));
ok("F2 mono → multi: dossier gaps resolved as per-lot, reconfirmation required, then priced");

// ── G. Line persistence failure: not eligible, dossier gaps and multi-lot gap kept ──
const G = await newCase();
failingRpcs.add("replace_quote_request_lines");
b = await build(G, LINES);
failingRpcs.delete("replace_quote_request_lines");
assertEquals([b.result.quote_request_lines_stored, b.state.lines, b.state.status], [0, 0, "NEED_INFO"]);
for (const k of [TERMINAL, PAD]) assert(b.state.blocking.includes(k), `${k} ${JSON.stringify(b.state)}`);
// Pre-existing, out of lot: the P0 gap `request.multi_lot_unresolved` uses gap_category "request",
// refused by quote_gaps_gap_category_check; NEED_INFO is still forced by the same P0 guard.
assertEquals((await price(G)).status, 400);
ok("G persistence failure: not eligible, dossier terminal + PAD gaps blocking, NEED_INFO, run-pricing refused");

// ── H. Other blocking gaps preserved in multi-lot ──
const H = await newCase({ description: false });
b = await build(H, LINES);
assertEquals(b.state.lines, 2);
assert(b.state.blocking.includes("cargo.description") && !b.state.blocking.includes(TERMINAL), JSON.stringify(b.state));
assertEquals(b.state.status, "NEED_INFO");
assertEquals((await price(H)).status, 400);
ok("H multi-lot with another blocking gap: gap kept, NEED_INFO, run-pricing refused");

// ── I. Mono-lot dossier unchanged ──
const I = await newCase();
b = await build(I, null);
assertEquals(b.state.lines, 0);
assert(b.state.blocking.includes(TERMINAL) && b.state.blocking.includes(PAD), JSON.stringify(b.state));
assertEquals(b.state.status, "NEED_INFO");
ok("I mono-lot: dossier terminal/PAD gaps still required (behaviour unchanged)");

// ── Q. Same business data, JSON vs strict text containers: equivalent quotes lot by lot ──
type Line = { lot_index: number; category: string; amount: number | null; containerType?: string; source?: { unit_ref?: string } };
function checkLots(out: { lines: Array<Record<string, unknown>> }, label: string) {
  const lines = out.lines as unknown as Line[];
  for (const [lot, eq, pad] of [[1, "40HC", 3600], [2, "20DV", 1800]] as const) {
    const own = lines.filter(l => l.lot_index === lot);
    for (const cat of ["Terminal (DPW)", "Transport", "Surestaries", "PAD_DROIT_PASSAGE"]) {
      assert(own.some(l => l.category === cat), `${label}: lot ${lot} misses ${cat}`);
    }
    for (const cat of ["Terminal (DPW)", "Transport"]) {
      assert(own.filter(l => l.category === cat).every(l => l.containerType === eq), `${label}: lot ${lot} ${cat} not on its own ${eq}`);
    }
    const pads = own.filter(l => l.category === "PAD_DROIT_PASSAGE");
    assertEquals(pads.map(l => l.amount), [pad], `${label}: lot ${lot} PAD`);
  }
  // Quantity and equipment actually sent to the engine for each lot (its own, never the dossier's).
  const sent = (out as unknown as { engine_request: { lots: Array<{ lot_index: number; params: { containers: Array<{ type: string; quantity: number }> } }> } })
    .engine_request.lots.map(l => [l.lot_index, l.params.containers.map(c => `${c.quantity}x${c.type}`).join("+")]);
  assertEquals(sent, [[1, "2x40HC"], [2, "1x20DV"]], `${label}: containers sent to the engine`);
  assertEquals(lines.filter(l => l.category === "PAD_DROIT_PASSAGE").length, 2, `${label}: one PAD line per decision, no cumulative line`);
  assert(lines.every(l => l.lot_index === 1 || l.lot_index === 2), `${label}: line outside the lots`);
}
async function pricedCase(lines: unknown[]) {
  const id = await newCase();
  const built = await build(id, lines);
  assertEquals(built.state.status, "READY_TO_PRICE");
  await selectScenario(id);
  await confirmAll(id);
  const r = await price(id);
  assertEquals(r.status, 200, JSON.stringify(r.json).slice(0, 400));
  return { id, out: await runOutputs(r.json.pricing_run_id) };
}
const QJ = await pricedCase(TWO_LINES), QT = await pricedCase(TEXT_LINES);
assertEquals([QJ.out.status, QT.out.status], ["success", "success"]);
checkLots(QJ.out, "json"); checkLots(QT.out, "text");
assertEquals(normalize(QT.out), normalize(QJ.out));
ok("Q1 JSON vs text containers: same services, quantities, amounts, currencies, totals and reserves per lot; Terminal, Transport, Surestaries and one PAD per lot");
for (const c of [QJ, QT]) {
  await build(c.id, c === QJ ? TWO_LINES : TEXT_LINES);
  const stale = await price(c.id);
  assertEquals(stale.json.pricing_blockers, ["MULTI_LOT_BLOCKED"]);
  await confirmAll(c.id);
  const again = await price(c.id);
  assertEquals(again.status, 200, JSON.stringify(again.json).slice(0, 400));
  c.out = await runOutputs(again.json.pricing_run_id);
}
checkLots(QJ.out, "json re-analysed"); checkLots(QT.out, "text re-analysed");
assertEquals(normalize(QT.out), normalize(QJ.out));
ok("Q2 re-analysis: both blocked while stale, then reconfirmed and priced again with equivalent quotes");

// ── V. Present but unreadable lot containers: the lot is blocked before the engine ──
const withContainers = (value: unknown, valueType = "text") => TWO_LINES.map((l, i) => i === 0 ? { ...l, extracted_facts: l.extracted_facts
  .map(f => f.key === "cargo.containers" ? { ...f, value, valueType } : f) } : l);
const runsOf = async (id: string) => JSON.parse(await sql(`select coalesce(jsonb_agg(status order by created_at),'[]')::text from public.pricing_runs where case_id=${q(id)};`));
for (const [value, valueType] of [["deux conteneurs 40HC", "text"], ["2x40HC + 1x20DV", "text"], [JSON.stringify({ type: "40HC", quantity: 2 }), "json"],
  [JSON.stringify([{ type: "40HC", quantity: 0 }]), "json"], [JSON.stringify([{ quantity: 2 }]), "json"], ["2x40HC SOC", "text"], ["[]", "json"]] as const) {
  const id = await newCase();
  await build(id, withContainers(value, valueType));
  await selectScenario(id);
  const r = await price(id);
  assertEquals(r.status, 200, JSON.stringify(r.json).slice(0, 300));
  const lot1 = r.json.blocked_lots.find((l: { lot_index: number }) => l.lot_index === 1);
  assert(lot1?.blockers.includes("LOT_CONTAINERS_UNREADABLE"), `${value}: ${JSON.stringify(r.json.blocked_lots)}`);
  const lot2 = r.json.blocked_lots.find((l: { lot_index: number }) => l.lot_index === 2);
  assert(!lot2?.blockers.includes("LOT_CONTAINERS_UNREADABLE"), `${value}: lot 2 wrongly flagged`);
  assertEquals(await runsOf(id), ["blocked"]);
}
// Two container facts on one line are ambiguous as well.
{
  const id = await newCase();
  const dup = TWO_LINES.map((l, i) => i === 0 ? { ...l, extracted_facts: [...l.extracted_facts, { key: "cargo.containers", value: "2x40HC", valueType: "text", confidence: 0.9 }] } : l);
  await build(id, dup);
  const r = await price(id);
  assert(r.json.blocked_lots.find((l: { lot_index: number }) => l.lot_index === 1)?.blockers.includes("LOT_CONTAINERS_UNREADABLE"), JSON.stringify(r.json));
}
ok("V unreadable containers (free text, several groups, JSON object, zero quantity, no type, extra word, empty list, duplicate fact): lot blocked LOT_CONTAINERS_UNREADABLE, no priced run");

// ── N. Containerised lot without its own container fact (PAD scope): blocked, never inherited ──
{
  const id = await newCase();
  const noContainers = TWO_LINES.map((l, i) => i === 0 ? { ...l, extracted_facts: l.extracted_facts.filter(f => f.key !== "cargo.containers") } : l);
  await build(id, noContainers);
  const r = await price(id);
  assertEquals(r.status, 200, JSON.stringify(r.json).slice(0, 300));
  const lot = (i: number) => r.json.blocked_lots.find((l: { lot_index: number }) => l.lot_index === i);
  assert(lot(1)?.blockers.includes("LOT_CONTAINERS_REQUIRED"), JSON.stringify(r.json.blocked_lots));
  assert(!lot(2)?.blockers.some((b: string) => b.startsWith("LOT_CONTAINERS_")), JSON.stringify(r.json.blocked_lots));
}
ok("N PAD scope, lot without cargo.containers: LOT_CONTAINERS_REQUIRED, the other lot unaffected");

// ── X. Out of PAD scope (the case PAD used to hide) ──
{
  const fcl = await inheritanceCase("SEA_FCL_IMPORT");
  assertEquals(fcl.built.state.status, "READY_TO_PRICE", JSON.stringify(fcl.built.state));
  assertEquals(fcl.r.status, 200, JSON.stringify(fcl.r.json).slice(0, 400));
  const lotB = fcl.r.json.blocked_lots?.find((l: { lot_index: number }) => l.lot_index === 2);
  assertEquals(lotB?.blockers, ["LOT_CONTAINERS_REQUIRED"], JSON.stringify(fcl.r.json.blocked_lots));
  assert(!fcl.r.json.blocked_lots.some((l: { lot_index: number }) => l.lot_index === 1), JSON.stringify(fcl.r.json.blocked_lots));
  assertEquals(fcl.runs.map((x: { status: string }) => x.status), ["blocked"]);
  ok("X1 out of PAD, FCL lot B without containers: blocked LOT_CONTAINERS_REQUIRED only, lot A clean, no priced run");
  for (const [hint, code] of [["UNKNOWN_HINT", "LOT_CONTAINERS_REQUIRED"], ["", "LOT_REQUEST_TYPE_REQUIRED"]]) {
    // A missing hint is refused earlier by the existing LOT_REQUEST_TYPE_REQUIRED guard.
    const amb = await inheritanceCase(hint);
    const b = amb.r.json.blocked_lots?.find((l: { lot_index: number }) => l.lot_index === 2);
    assert(b?.blockers.includes(code), `${hint}: ${JSON.stringify(amb.r.json).slice(0, 400)}`);
    assert(amb.runs.every((x: { status: string; lots: unknown }) => x.status !== "success" && x.lots === null), hint);
  }
  ok("X2 out of PAD, lot B with unknown or no hint: blocked (LOT_CONTAINERS_REQUIRED / existing LOT_REQUEST_TYPE_REQUIRED), nothing sent to the engine");
  const air = await inheritanceCase("AIR_IMPORT");
  assertEquals(air.r.status, 200, JSON.stringify(air.r.json).slice(0, 400));
  for (const l of air.r.json.blocked_lots ?? []) assert(!l.blockers.some((b: string) => b.startsWith("LOT_CONTAINERS_")), JSON.stringify(l));
  const sent = air.runs.flatMap((x: { lots: Array<{ lot: number; containers: unknown }> | null }) => x.lots ?? []);
  // End-to-end proof required: the run is priced and records what each lot sent to the engine.
  assertEquals(air.runs.map((x: { status: string }) => x.status), ["success"], JSON.stringify(air.r.json).slice(0, 400));
  assertEquals(sent.find((l: { lot: number }) => l.lot === 1)?.containers, [{ type: "40HC", quantity: 2, coc_soc: null }]);
  assertEquals(sent.find((l: { lot: number }) => l.lot === 2)?.containers, []);
  console.log(`X3 air run statuses: ${JSON.stringify(air.runs.map((x: { status: string }) => x.status))}, engine lots: ${JSON.stringify(sent)}`);
  ok("X3 out of PAD, explicitly non-containerised lot B (AIR_IMPORT): no container blocker; lot B sent none, lot A its own 2x40HC");
}

// ── M (patched run). Mono-lot still priced; base comparison done on MONO_OUTPUT. ──
await monoOutput();
ok("M mono-lot priced with the patched handlers");
