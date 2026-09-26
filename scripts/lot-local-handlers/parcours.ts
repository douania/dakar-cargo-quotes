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
import { ai, call, failingRpcs, functionCalls, loadHandlers, q, sql } from "./harness.ts";
import { generateDraftPdf } from "../../supabase/functions/export-quotation-version-pdf/index.ts";
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
// Every successful multi-lot run must have called price-service-lines once per lot, each call
// successful: a failing or skipped enrichment fails the bench instead of silently dropping lines.
async function price(id: string) {
  const from = functionCalls.length;
  const r = await call("run-pricing", { case_id: id });
  if (r.status === 200 && r.json?.mode === "multi_lot" && r.json?.pricing_run_id) {
    const meta = JSON.parse(await sql(`select jsonb_build_object('status',status,'lots',outputs_json->'metadata'->'lot_count')::text from public.pricing_runs where id=${q(r.json.pricing_run_id)};`));
    if (meta.status === "success") {
      const calls = functionCalls.slice(from).filter(c => c.name === "price-service-lines");
      assertEquals(calls.length, Number(meta.lots), `price-service-lines calls for ${meta.lots} priced lots`);
      for (const c of calls) assertEquals((c.response as { ok?: unknown } | undefined)?.ok, true, JSON.stringify(c.response).slice(0, 300));
    }
  }
  return r;
}

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
  const state = await confirmLots(id);
  await confirmPad(id);
  return state;
}
/** Bindings and LOLO per lot through the real Edge handler (no PAD decision). */
async function confirmLots(id: string) {
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
  return state;
}
async function confirmPad(id: string) {
  let pad = (await call("manage-pad-group-confirmation", { case_id: id, action: "read" })).json;
  for (const [u, cat] of [["a", "T02"], ["b", "T03"]]) {
    const r = await call("manage-pad-group-confirmation", { case_id: id, action: "record", decision: { unit_ref: u, action: "confirm", category: cat,
      source_reference: "Nomenclature synthetique verifiee", weight_source_reference: "Poids du courriel client synthetique",
      expected_context_hash: pad.context.context_hash, expected_head_id: pad.all_heads.find((h: { unit_ref: string }) => h.unit_ref === u)?.id ?? null,
      idempotency_key: crypto.randomUUID() } });
    assertEquals(r.status, 200, JSON.stringify(r.json).slice(0, 300)); pad = r.json;
  }
  assertEquals(pad.ready, true, JSON.stringify(pad.issues));
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

// ── W/D. Weight and DTHC data per lot (GO CTO 2026-09-26). Synthetic tariffs are seeded AFTER
// the mono-lot comparison: DTHC import STANDARD/DANGEROUS (canonical source, synthetic amounts)
// and ZONE 1 local transport 20'/40'. Out of PAD scope, DTHC and trucking kept, LOLO confirmed
// per lot. Compared: what the engine and price-service-lines each received, and the lines. ──
await sql(`insert into public.port_tariffs(id,provider,category,operation_type,classification,cargo_type,amount,unit,source_document,effective_date,expiry_date,is_active,evidence_level,surcharge_percent)
 select gen_random_uuid(),'DPW','THC','IMPORT',c,t,111000,'EVP','Arrêté ministériel n° 035532 du 28/11/2023 - JORS n° 7723 du 06/04/2024 p. 471','2024-04-06',null,true,'official',s
 from (values ('Produits standards','STANDARD',0),('Produits dangereux (IMDG classe 1-9)','DANGEROUS',50)) v(c,t,s)
 where not exists (select 1 from public.port_tariffs x where x.provider='DPW' and x.operation_type='IMPORT' and x.cargo_type=v.t and x.is_active);
insert into public.local_transport_rates(id,origin,destination,container_type,cargo_category,rate_amount,rate_currency,source_document,is_active,evidence_level)
 select gen_random_uuid(),'Dakar Port','FORFAIT ZONE 1 <18 KM',ct,'Dry',amt,'XOF','TARIFS_LIVRAISONS_CONTENEURS_20P_40P_OFFICIELS',true,'validated_internal'
 from (values ('20'' Dry',100000),('40'' Dry',150000)) v(ct,amt)
 where not exists (select 1 from public.local_transport_rates x where x.destination='FORFAIT ZONE 1 <18 KM' and x.container_type=v.ct and x.is_active);`);
const OUT_OF_PAD_KEEP_DTHC = JSON.stringify({ add: [], remove: ["PORT_DAKAR_HANDLING", "PAD_DROIT_PASSAGE"] });
async function dossierFact(id: string, key: string, category: string, value: string, numeric = false) {
  await sql(`update public.quote_facts set is_current=false where case_id=${q(id)} and fact_key=${q(key)} and is_current;
insert into public.quote_facts(case_id,fact_key,fact_category,value_text,value_number,source_type,is_current,confidence)
 values(${q(id)},${q(key)},${q(category)},${q(value)},${numeric ? Number(value) : "null"},'manual_input',true,1);`);
}
type LineSpec = { containers?: string; weight?: string; descriptions?: readonly string[] };
function wdLine(index: 1 | 2, spec: LineSpec) {
  const facts: Array<{ key: string; value: string; valueType: string; confidence: number }> = [];
  if (spec.containers !== undefined) facts.push({ key: "cargo.containers", value: spec.containers, valueType: "text", confidence: 0.95 });
  if (spec.weight !== undefined) facts.push({ key: "cargo.weight_kg", value: spec.weight, valueType: "number", confidence: 0.95 });
  for (const d of spec.descriptions ?? []) facts.push({ key: "cargo.description", value: d, valueType: "text", confidence: 0.9 });
  facts.push({ key: "routing.origin_port", value: index === 1 ? "Shanghai" : "Ningbo", valueType: "text", confidence: 0.9 });
  return { ...TWO_LINES[index - 1], extracted_facts: facts };
}
type Line = Record<string, unknown>;
async function wdCase(a: LineSpec, b: LineSpec, dossier: ReadonlyArray<readonly [string, string, string, boolean?]>, overrides = OUT_OF_PAD_KEEP_DTHC) {
  const id = await newCase();
  await dossierFact(id, "service.overrides", "service", overrides);
  for (const [k, c, v, n] of dossier) await dossierFact(id, k, c, v, n === true);
  const built = await build(id, [wdLine(1, a), wdLine(2, b)]);
  await selectScenario(id);
  await confirmLots(id);
  const from = functionCalls.length;
  const r = await price(id);
  const psl = functionCalls.slice(from).filter(c => c.name === "price-service-lines");
  const run = r.json.pricing_run_id ? await runOutputs(r.json.pricing_run_id) : null;
  // The bench fails when an expected price-service-lines call is missing or fails: a priced run
  // enriches each of its two lots through it.
  if (run?.status === "success") {
    assertEquals(psl.length, 2, "one price-service-lines call per lot expected");
    for (const c of psl) assertEquals((c.response as { ok?: unknown } | undefined)?.ok, true, JSON.stringify(c.response).slice(0, 300));
  }
  const engineLots = (run?.engine_request as { lots?: Array<{ lot_index: number; params: Record<string, unknown> }> } | undefined)?.lots ?? [];
  const ctxOf = (type: string) => psl.map(c => (c.body as { pricing_context_override?: Record<string, unknown> }).pricing_context_override)
    .find(o => o?.container_type && String(o.container_type).toUpperCase().includes(type)) ?? null;
  // Lines price-service-lines produced in the run (services the engine did not cover), and a direct
  // probe of its DTHC and TRUCKING resolution with the very context run-pricing sent for the lot.
  const pslLinesOf = (type: string) => ((psl.find(c => String((c.body as { pricing_context_override?: { container_type?: unknown } }).pricing_context_override?.container_type ?? "")
    .toUpperCase().includes(type))?.response as { data?: { priced_lines?: Line[] } } | undefined)?.data?.priced_lines ?? []);
  const pslProbe = async (type: string) => {
    const override = ctxOf(type);
    if (!override) return [];
    const res = await call("price-service-lines", { case_id: id, pricing_context_override: override, service_lines: [
      { id: "probe-dthc", service: "DTHC", unit: "evp", quantity: 1, currency: "XOF" },
      { id: "probe-trucking", service: "TRUCKING", unit: "voyage", quantity: 1, currency: "XOF" }] });
    if (!res.json?.data?.priced_lines?.length) console.log(`PSL PROBE EMPTY ${res.status} ${JSON.stringify(res.json).slice(0, 600)}`);
    return ((res.json?.data?.priced_lines ?? []) as Line[]).map(l => ({ service: l.service ?? l.id, rate: l.rate ?? null,
      quantity: l.quantity ?? l.quantity_used ?? null, note: l.explanation ?? l.notes ?? null }));
  };
  return { id, built, r, run, psl, engine: (i: number) => engineLots.find(l => l.lot_index === i)?.params ?? null, ctx: ctxOf, pslLines: pslLinesOf, pslProbe,
    lines: (i: number, cat: string) => ((run?.lines ?? []) as Line[]).filter(l => l.lot_index === i && l.category === cat) };
}
const kgLabel = (kg: number) => `${String(kg).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} kg`;
const DOSSIER_WEIGHTS = [["cargo.weight_per_container_kg", "cargo", "25000", true], ["cargo.weight_kg", "cargo", "99999", true]] as const;
const A_SPEC: LineSpec = { containers: "2x40HC", weight: "36000", descriptions: ["mobilier de bureau"] };
{
  // W1–W3: one 20' container, under / at / over 22 t tare included — the lot's own weight, never
  // the dossier's 25 000 kg per container nor its 99 999 kg total.
  for (const [kg, rule, amount] of [[12000, "≤ 22 t", 100000], [19770, "≤ 22 t", 100000], [19771, "> 22 t", 150000]] as const) {
    const c = await wdCase(A_SPEC, { containers: "1x20DV", weight: String(kg), descriptions: ["pieces detachees"] }, DOSSIER_WEIGHTS);
    assertEquals(c.run?.status, "success", JSON.stringify(c.r.json).slice(0, 500));
    assertEquals([c.engine(2)?.cargoWeight, c.engine(2)?.weightPerContainerKg, c.engine(2)?.lotWeightStrict], [kg / 1000, kg, true]);
    assertEquals([c.engine(1)?.cargoWeight, c.engine(1)?.weightPerContainerKg ?? null], [36, null]);
    const ctx20 = c.ctx("20"), ctx40 = c.ctx("40");
    assertEquals([ctx20?.weight_kg, ctx20?.weight_per_container_kg, ctx20?.lot_weight_strict], [kg, kg, true], JSON.stringify(ctx20));
    // Unit: price-service-lines receives kilograms (the engine receives tonnes), never the tonnes value.
    assert(ctx20?.weight_kg === kg && ctx20?.weight_kg !== kg / 1000 && c.engine(2)?.cargoWeight === kg / 1000, "PSL weight_kg must be kg");
    assertEquals([ctx40?.weight_kg, ctx40?.weight_per_container_kg], [36000, null], JSON.stringify(ctx40));
    const t = c.lines(2, "Transport");
    assertEquals(t.map(l => l.amount), [amount], JSON.stringify(t));
    assert(String(t[0].notes).includes(rule) && String(t[0].notes).includes(kgLabel(kg)), String(t[0].notes));
    const probe = await c.pslProbe("20");
    // Same data, same decision in price-service-lines: the TRUCKING rate equals the engine transport amount.
    assertEquals(probe.find(l => l.service === "probe-trucking")?.rate, amount, JSON.stringify(probe));
    console.log(`W ${kg} kg: psl probe lot2 ${JSON.stringify(probe)}`);
    console.log(`W ${kg} kg: engine lot2 ${JSON.stringify({ cw: c.engine(2)?.cargoWeight, wpc: c.engine(2)?.weightPerContainerKg })}, psl lot2 ${JSON.stringify({ w: ctx20?.weight_kg, wpc: ctx20?.weight_per_container_kg })}, transport ${t[0].amount} « ${t[0].notes} »; psl lot2 lines ${JSON.stringify(c.pslLines("20").map(l => [l.service ?? l.id, l.rate ?? null]))}`);
  }
  ok("W1-W3 single 20' at 12 000 / 19 770 / 19 771 kg: own weight in both paths (never 25 000 / 99 999 from the dossier); 20' rate under and at 22 t, 40' rate above");
  // W4 (no own weight, dossier weight present) and W5 (two 20' with unknown split): the lot is not
  // blocked; the 20' transport is to confirm in both paths (no 20' assumption, no average), the
  // line stays in the stored run with a null amount and its reserve, outside the total; other
  // lines are priced. Never the dossier's 25 000 / 99 999 kg.
  const firmTotal = (run: { lines: Array<Record<string, unknown>> }) => run.lines
    .filter(l => String((l.source as { type?: unknown } | undefined)?.type ?? "").toUpperCase().split(/[+:]/)[0] !== "TO_CONFIRM" && Number(l.amount) > 0)
    .reduce((s, l) => s + Number(l.amount), 0);
  const WEIGHT_UNKNOWN = "Poids de chaque conteneur 20' non établi";
  for (const [label, b, cw, w] of [["W4 no own weight", { containers: "1x20DV", descriptions: ["pieces detachees"] }, null, null],
    ["W5 2x20DV 50 000 kg", { containers: "2x20DV", weight: "50000", descriptions: ["pieces detachees"] }, 50, 50000]] as const) {
    const c = await wdCase(A_SPEC, b, DOSSIER_WEIGHTS);
    assertEquals(c.run?.status, "success", `${label}: ${JSON.stringify(c.r.json).slice(0, 400)}`);
    assertEquals([c.engine(2)?.cargoWeight ?? null, c.engine(2)?.weightPerContainerKg ?? null, c.engine(2)?.lotWeightStrict], [cw, null, true], label);
    const ctx20 = c.ctx("20");
    assertEquals([ctx20?.weight_kg ?? null, ctx20?.weight_per_container_kg ?? null, ctx20?.lot_weight_strict], [w, null, true], label);
    const t = c.lines(2, "Transport");
    assertEquals(t.map(l => [l.amount, (l.source as { type?: unknown }).type]), [[null, "TO_CONFIRM"]], `${label}: ${JSON.stringify(t)}`);
    assert(String(t[0].notes).startsWith(WEIGHT_UNKNOWN), String(t[0].notes));
    const probe = await c.pslProbe("20");
    const trucking = probe.find(l => l.service === "probe-trucking");
    assertEquals(trucking ? trucking.rate : "absent", null, JSON.stringify(probe));
    assert(String(trucking?.note).includes(WEIGHT_UNKNOWN), String(trucking?.note));
    // Stored run: the null line is not turned into 0 and the total only counts firm lines.
    assertEquals(c.run?.total_ht !== undefined ? Number(c.run?.total_ht) : null, firmTotal(c.run!), label);
    assert(c.lines(1, "Transport").every(l => Number(l.amount) > 0), `${label}: lot 1 40' transport priced`);
    console.log(`${label}: engine transport lot2 ${JSON.stringify(t.map(l => [l.amount, l.notes]))}; psl probe trucking ${JSON.stringify(trucking)}; total_ht ${c.run?.total_ht}`);
  }
  ok("W4-W5 no own weight / 20' split unknown: not blocked; transport to confirm in both paths with its reserve, null in the stored run and outside the total; never the dossier weight");
  // W6: a 40' without own weight is not concerned by the 22 t rule: still priced (40' rate).
  const w6 = await wdCase(A_SPEC, { containers: "1x40HC", descriptions: ["pieces detachees"] }, DOSSIER_WEIGHTS);
  assertEquals(w6.run?.status, "success", JSON.stringify(w6.r.json).slice(0, 400));
  assertEquals(w6.lines(2, "Transport").map(l => l.amount), [150000], JSON.stringify(w6.lines(2, "Transport")));
  const w6probe = await w6.pslProbe("40");
  assertEquals(w6probe.find(l => l.service === "probe-trucking")?.rate, 150000, JSON.stringify(w6probe));
  // W7: mixed 20' + 40' lot with its own total (split unknown): the 20' is to confirm, the 40' priced.
  const w7 = await wdCase(A_SPEC, { containers: JSON.stringify([{ type: "20DV", quantity: 1 }, { type: "40HC", quantity: 1 }]), weight: "30000", descriptions: ["pieces detachees"] }, DOSSIER_WEIGHTS);
  assertEquals(w7.run?.status, "success", JSON.stringify(w7.r.json).slice(0, 400));
  const w7t = w7.lines(2, "Transport").map(l => [l.containerType, l.amount, (l.source as { type?: unknown }).type]);
  assertEquals(w7t.sort(), [["20DV", null, "TO_CONFIRM"], ["40HC", 150000, "OFFICIAL"]].sort(), JSON.stringify(w7t));
  console.log(`W6 40' no weight: transport ${JSON.stringify(w6.lines(2, "Transport").map(l => l.amount))}; W7 mixed: ${JSON.stringify(w7t)}`);
  ok("W6-W7 40' without own weight priced; mixed 20'+40' with unknown split: 20' to confirm, 40' priced");
}
{
  // D1: a dossier DTHC family blocks every lot in DTHC scope.
  const d1 = await wdCase(A_SPEC, { containers: "1x20DV", weight: "12000", descriptions: ["pieces detachees"] }, [["pricing.dthc_family", "pricing", "STANDARD"]]);
  for (const i of [1, 2]) assert(d1.r.json.blocked_lots?.find((l: { lot_index: number }) => l.lot_index === i)?.blockers.includes("LOT_DTHC_FAMILY_REQUIRED"), JSON.stringify(d1.r.json).slice(0, 400));
  assertEquals(d1.run, null);
  ok("D1 dossier DTHC family present, lots in DTHC scope: LOT_DTHC_FAMILY_REQUIRED on each lot, no engine call");
  // D2/D3: no dossier family; the dossier designation is a validated STANDARD one. Lot 1's own
  // validated designation resolves STANDARD; lot 2's own undetermined one, an ambiguous pair of
  // designations or none stays to confirm — never the dossier's.
  const VALIDATED = "PIECES DETACHEES DE MACHINES ET APPAREILS";
  for (const [label, bDescriptions] of [["own undetermined", ["mobilier de bureau"]], ["ambiguous (two designations)", [VALIDATED, "mobilier de bureau"]], ["absent", []]] as const) {
    const d = await wdCase({ ...A_SPEC, descriptions: [VALIDATED] }, { containers: "1x20DV", weight: "12000", descriptions: bDescriptions }, [["cargo.description", "cargo", VALIDATED]]);
    assertEquals(d.run?.status, "success", JSON.stringify(d.r.json).slice(0, 400));
    const own2 = bDescriptions.length === 1 ? bDescriptions[0] : null;
    assertEquals([d.engine(1)?.cargoDescription, d.engine(2)?.cargoDescription ?? null], [VALIDATED, own2]);
    assertEquals([d.ctx("40")?.cargo_description, d.ctx("20")?.cargo_description, d.ctx("20")?.dthc_family], [VALIDATED, own2, null]);
    const t1 = d.lines(1, "Terminal (DPW)"), t2 = d.lines(2, "Terminal (DPW)");
    assertEquals(t1.map(l => l.amount), [444000], JSON.stringify(t1));
    assertEquals(t2.map(l => l.amount), [null], JSON.stringify(t2));
    assert(String(t2[0].notes).toLowerCase().includes("famille dthc non déterminable"), String(t2[0].notes));
    const p1 = await d.pslProbe("40"), p2 = await d.pslProbe("20");
    assertEquals([p1.find(l => l.service === "probe-dthc")?.rate, p2.find(l => l.service === "probe-dthc")?.rate ?? null], [444000, null], JSON.stringify([p1, p2]));
    console.log(`D ${label}: psl probe DTHC lot1 ${JSON.stringify(p1.find(l => l.service === "probe-dthc"))}, lot2 ${JSON.stringify(p2.find(l => l.service === "probe-dthc"))}`);
    console.log(`D ${label}: terminal lot1 ${t1[0].amount}, lot2 ${t2[0].amount} « ${t2[0].notes} »; psl lot2 lines ${JSON.stringify(d.pslLines("20").map(l => [l.service ?? l.id, l.rate ?? null]))}`);
  }
  ok("D2-D3 no dossier family: lot 1 own validated designation → STANDARD 4 EVP × 111 000; lot 2 own undetermined, ambiguous or absent → to confirm (dossier designation never used), same in both paths");
  // D4: dossier family DANGEROUS, lots out of DTHC scope: not blocked by the family and the
  // danger evaluation keeps it (danger guards preserved).
  const d4 = await wdCase(A_SPEC, { containers: "1x20DV", weight: "12000", descriptions: ["pieces detachees"] }, [["pricing.dthc_family", "pricing", "DANGEROUS"]],
    JSON.stringify({ add: [], remove: ["PORT_DAKAR_HANDLING", "PAD_DROIT_PASSAGE", "DTHC"] }));
  for (const l of d4.r.json.blocked_lots ?? []) assert(!l.blockers.includes("LOT_DTHC_FAMILY_REQUIRED"), JSON.stringify(l));
  console.log(`D4 out of DTHC scope, dossier DANGEROUS: blocked_lots ${JSON.stringify(d4.r.json.blocked_lots ?? null)}, engine isIMO ${JSON.stringify([d4.engine(1)?.isIMO, d4.engine(2)?.isIMO])}`);
  if (d4.run) assertEquals([d4.engine(1)?.isIMO, d4.engine(2)?.isIMO], [true, true]);
  // The dossier family feeds the danger evaluation only: it is never sent to the engine as a DTHC family.
  if (d4.run) assertEquals([d4.engine(1)?.dthcFamily ?? null, d4.engine(2)?.dthcFamily ?? null], [null, null]);
  ok("D4 lots out of DTHC scope: no family blocker; dossier DANGEROUS still drives the danger evaluation");
}

// ── CH. Chain for a service priced only by price-service-lines (no engine equivalent): function
// response → stored run → version (snapshot + stored lines) → PDF, with a known amount (AGENCY),
// an unknown amount (SURVEY, added to the scope, no tariff) and a genuine zero (EMPTY_RETURN). ──
async function pdfText(bytes: Uint8Array): Promise<string> {
  const raw = new TextDecoder("latin1").decode(bytes);
  const out: string[] = [];
  // pdf-lib FlateDecode content streams, read with their exact /Length.
  for (const m of raw.matchAll(/\/Length (\d+)\s*>>\s*stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    try {
      const text = new TextDecoder("latin1").decode(await new Response(new Blob([bytes.slice(start, start + Number(m[1]))]).stream()
        .pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
      for (const t of text.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(t[1].replace(/../g, h => String.fromCharCode(parseInt(h, 16))));
    } catch { /* not a content stream */ }
  }
  return out.join("\n");
}
{
  const withSurvey = JSON.stringify({ add: ["SURVEY"], remove: ["PORT_DAKAR_HANDLING", "PAD_DROIT_PASSAGE"] });
  const c = await wdCase(A_SPEC, { containers: "1x20DV", weight: "12000", descriptions: ["pieces detachees"] }, [], withSurvey);
  assertEquals(c.run?.status, "success", JSON.stringify(c.r.json).slice(0, 400));
  // 1. Function response: price-service-lines returns SURVEY without a rate.
  for (const call of c.psl) {
    const body = call.body as { service_lines: Array<{ id: string; service: string }> };
    const survey = body.service_lines.find(s => s.service === "SURVEY");
    assert(survey, "SURVEY sent to price-service-lines");
    const priced = ((call.response as { data?: { priced_lines?: Array<Record<string, unknown>> } }).data?.priced_lines ?? []).find(l => l.id === survey!.id);
    assertEquals(priced?.rate ?? null, null, JSON.stringify(priced));
  }
  // 2. Stored run: null + TO_CONFIRM + reserve for SURVEY (never 0), genuine 0 kept, known amount kept.
  for (const lot of [1, 2]) {
    const survey = c.lines(lot, "SURVEY"), zero = c.lines(lot, "EMPTY_RETURN"), agency = c.lines(lot, "AGENCY");
    assertEquals(survey.map(l => [l.amount, (l.source as { type?: unknown }).type]), [[null, "TO_CONFIRM"]], JSON.stringify(survey));
    assert(String((survey[0].source as { note?: unknown }).note ?? "").length > 5, JSON.stringify(survey[0]));
    assertEquals(zero.map(l => [l.amount, (l.source as { type?: unknown }).type]), [[0, "business_rule"]], JSON.stringify(zero));
    assert(agency.length === 1 && Number(agency[0].amount) > 0, JSON.stringify(agency));
  }
  const stored = JSON.parse(await sql(`select jsonb_build_object('qq',outputs_json->'quoteQualification','meta',outputs_json->'metadata','ht',total_ht,
    'lot_lines',(select jsonb_agg(l) from jsonb_array_elements(outputs_json->'lots') lot, jsonb_array_elements(lot->'lines') l where l->>'category'='SURVEY'))::text
    from public.pricing_runs where id=${q(c.r.json.pricing_run_id)};`));
  const toConfirmLines = (c.run!.lines as Array<{ source?: { type?: unknown } }>).filter(l => l.source?.type === "TO_CONFIRM").length;
  assert(toConfirmLines >= 2, "SURVEY lines counted");
  assertEquals([stored.qq?.level, stored.qq?.firmTotalPolicy, stored.meta?.to_confirm_count], ["provisional", "excludes_reserved_items", toConfirmLines], JSON.stringify(stored).slice(0, 300));
  assert(stored.qq.reasons.some((r: { code: string }) => r.code === "RATE_PENDING_CONFIRMATION"), JSON.stringify(stored.qq));
  assertEquals(stored.lot_lines.map((l: { amount: unknown }) => l.amount), [null, null], "per-lot stored lines keep null");
  // 3. Version: the real handler; snapshot and stored lines keep "to confirm" distinct from a free line.
  const v = await call("generate-quotation-version", { case_id: c.id, pricing_run_id: c.r.json.pricing_run_id });
  assertEquals(v.status, 200, JSON.stringify(v.json).slice(0, 400));
  const version = JSON.parse(await sql(`select jsonb_build_object('snap',v.snapshot,'lines',(select jsonb_agg(jsonb_build_object('code',l.service_code,'amount',l.amount,'breakdown',l.breakdown) order by l.line_order) from public.quotation_version_lines l where l.quotation_version_id=v.id))::text
    from public.quotation_versions v where v.case_id=${q(c.id)} order by v.created_at desc limit 1;`));
  const snapLines = version.snap.lines as Array<{ category: string; amount: number; source: { type?: string } }>;
  const snapSurvey = snapLines.filter(l => l.category === "SURVEY"), snapZero = snapLines.filter(l => l.category === "EMPTY_RETURN");
  assertEquals(snapSurvey.map(l => [l.amount, l.source?.type]), [[0, "TO_CONFIRM"], [0, "TO_CONFIRM"]], JSON.stringify(snapSurvey));
  assertEquals(snapZero.map(l => [l.amount, l.source?.type]), [[0, "business_rule"], [0, "business_rule"]]);
  assertEquals((version.snap.raw_lines as Array<{ category: string; amount: unknown }>).filter(l => l.category === "SURVEY").map(l => l.amount), [null, null]);
  assertEquals(version.snap.meta?.quoteQualification?.level, "provisional", JSON.stringify(version.snap.meta));
  const rows = version.lines as Array<{ code: string; amount: number; breakdown: Record<string, unknown> | null }>;
  const rowOf = (i: number) => rows[snapLines.indexOf(snapLines.filter(l => l.category === (i === 0 ? "SURVEY" : "EMPTY_RETURN"))[0])];
  assertEquals([rowOf(0).amount, rowOf(0).breakdown?.pricing_status, rowOf(0).breakdown?.amount_known], [0, "to_confirm", false]);
  assertEquals([rowOf(1).amount, rowOf(1).breakdown], [0, null]);
  // 4. PDF rendered from the stored snapshot: "À confirmer", never "0" for SURVEY; lot subtotal qualified.
  const text = await pdfText(await generateDraftPdf(version.snap, c.id));
  const pendingInSnapshot = snapLines.filter(l => l.source?.type === "TO_CONFIRM").length;
  assert((text.match(/À confirmer/g) ?? []).length >= pendingInSnapshot, `${pendingInSnapshot} lines to confirm: ${text.slice(0, 600)}`);
  // One qualified subtotal per lot; together they account for every line to confirm of the snapshot.
  const qualified = [...text.matchAll(/Sous-total hors (\d+) postes? a confirmer/g)].map(m => Number(m[1]));
  assertEquals([qualified.length, qualified.reduce((a, b) => a + b, 0)], [2, pendingInSnapshot], text.slice(0, 1200));
  assert(!/Sous-total: /.test(text), "unqualified lot subtotal");
  // The service to confirm keeps its name in each lot (label fallback of the multi-lot snapshot).
  const surveyLabel = snapSurvey[0] ? String((version.snap.raw_lines as Array<{ category: string; label?: string }>).find(l => l.category === "SURVEY")?.label ?? "") : "";
  assertEquals(surveyLabel ? text.split(surveyLabel.slice(0, 25)).length - 1 : 0, 2, `label ${surveyLabel}`);
  console.log(`CH version rows ${JSON.stringify(rows.map(r => [r.code, r.amount, r.breakdown?.pricing_status ?? null]))}; pdf excerpt ${JSON.stringify(text.split(String.fromCharCode(10)).filter(t => /confirmer|Sous-total/.test(t)).slice(0, 6))}`);
  ok("CH SURVEY only priced by price-service-lines: null + TO_CONFIRM + reserve in response, stored run (lines and lots), version snapshot and stored lines (breakdown), PDF « À confirmer » and qualified subtotal; EMPTY_RETURN stays a genuine 0; run qualified provisional");
}

// ── Z. Bench integrity: every price-service-lines call of the whole run succeeded (a failing or
// skipped enrichment must fail the bench instead of silently removing lines). ──
{
  const pslCalls = functionCalls.filter(c => c.name === "price-service-lines");
  const failed = pslCalls.filter(c => (c.response as { ok?: unknown } | undefined)?.ok !== true);
  assert(pslCalls.length > 0, "no price-service-lines call was executed");
  assertEquals(failed.map(c => JSON.stringify(c.response).slice(0, 200)), []);
  ok(`Z ${pslCalls.length} price-service-lines calls, all successful`);
}
