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
import { operatorFact, seedCase, snapshot, TWO_LINES } from "./fixture.ts";

const baseline = Deno.args.includes("--baseline");
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

if (baseline) {
  // Base commit: the circular block the exception removes.
  const id = await newCase();
  const { result, state } = await build(id, TWO_LINES);
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
let b = await build(A, TWO_LINES);
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
assertEquals((await snapshot(A)).status, "PRICED_DRAFT");
ok("D run-pricing (real handler + quotation-engine + price-service-lines): success, PAD 3600 lot 1 / 1800 lot 2, PRICED_DRAFT");

// ── E. Re-analysis: lines rewritten, every decision stale, nothing re-associated ──
b = await build(A, TWO_LINES);
assertEquals(b.state.lines, 2);
run = await price(A);
assertEquals(run.json.pricing_blockers, ["MULTI_LOT_BLOCKED"]);
assert(run.json.blocked_lots.every((l: { blockers: string[] }) => l.blockers.includes("LOT_CONFIRMATION_STALE") || l.blockers.includes("PAD_GROUP_CONFIRMATION_REQUIRED")), JSON.stringify(run.json));
ok("E re-analysis: decisions stale, run-pricing blocked per lot, no silent re-association");

// ── F. Multi → mono → multi ──
b = await build(A, null);
assertEquals(b.state.lines, 0);
assert(b.state.blocking.includes(TERMINAL), JSON.stringify(b.state));
run = await price(A);
assertEquals(run.status, 400);
ok("F1 multi → mono: lines cleared, dossier terminal gap blocking again, run-pricing refused");
b = await build(A, TWO_LINES);
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
b = await build(G, TWO_LINES);
failingRpcs.delete("replace_quote_request_lines");
assertEquals([b.result.quote_request_lines_stored, b.state.lines, b.state.status], [0, 0, "NEED_INFO"]);
for (const k of [TERMINAL, PAD]) assert(b.state.blocking.includes(k), `${k} ${JSON.stringify(b.state)}`);
// Pre-existing, out of lot: the P0 gap `request.multi_lot_unresolved` uses gap_category "request",
// refused by quote_gaps_gap_category_check; NEED_INFO is still forced by the same P0 guard.
assertEquals((await price(G)).status, 400);
ok("G persistence failure: not eligible, dossier terminal + PAD gaps blocking, NEED_INFO, run-pricing refused");

// ── H. Other blocking gaps preserved in multi-lot ──
const H = await newCase({ description: false });
b = await build(H, TWO_LINES);
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
