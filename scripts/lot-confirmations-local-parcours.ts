// MULTI-LOT-TERMINAL-1 — LOCAL end-to-end path (GO CTO 2026-09-25).
// Real SQL (offline Docker PostgreSQL, throw-away copy of a *_base template, synthetic rows only)
// driven through the real shared TypeScript modules used by run-pricing and the Edge functions:
// two distinct lots confirmed → per-lot requirements met → PAD line per lot → valid completion;
// then unbound lines, re-analysis, indiscernible lines, revocation race and double counting.
// Not exercised: HTTP handlers, quotation-engine, authentication, Lovable/Cloud.
// Usage: deno run --allow-run --allow-read --allow-env scripts/lot-confirmations-local-parcours.ts <container> <template>
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadLotConfirmationState } from "../supabase/functions/_shared/lot-confirmation-store.ts";
import { evaluateLotRequirements, lotBindingForLine, lotPadEmissionValid, lotPadScopeIssues, withConfirmedLotTerminalMode } from "../supabase/functions/_shared/lot-confirmation.ts";
import { loadPadGroupState, padGroupScopeRequired } from "../supabase/functions/_shared/pad-group-store.ts";
import { TERMINAL_OPERATION_MODE_FACT_KEY } from "../supabase/functions/_shared/terminal-operation-mode.ts";
import { resolveEffectiveServiceKeys } from "../supabase/functions/_shared/service-scope.ts";
import { computeCommercialTotals } from "../supabase/functions/run-pricing/commercial-totals.ts";

Deno.env.set("RUN_PRICING_DISABLE_SERVE", "1");
const { canonicalizeLine, confirmedPadLineInput, resolveTerminalBlockersForLot } = await import("../supabase/functions/run-pricing/index.ts") as {
  canonicalizeLine: (l: unknown, c: { origin_layer: string }) => Record<string, unknown>;
  confirmedPadLineInput: (l: unknown, r: unknown) => Record<string, unknown>;
  resolveTerminalBlockersForLot: (p: { lotExtractedFacts: Array<{ key?: string; value?: unknown }>; effectiveServiceKeys: string[] }) => string[];
};

const [container, template] = Deno.args;
assert(/^dcq-[a-z0-9-]+$/.test(container ?? "") && /^[a-z0-9_]+_base$/.test(template ?? ""), "container and *_base template required");
const inspect = JSON.parse(new TextDecoder().decode((await new Deno.Command("docker", { args: ["inspect", container] }).output()).stdout))[0];
assertEquals(inspect.HostConfig.NetworkMode, "none"); assertEquals(Object.keys(inspect.HostConfig.PortBindings ?? {}).length, 0);
const DB = "mlt1_parcours";

async function psql(sql: string, database = DB, user = "postgres"): Promise<string> {
  const child = new Deno.Command("docker", { args: ["exec", "-i", container, "psql", "-X", "-qAt", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=terse"],
    stdin: "piped", stdout: "piped", stderr: "piped", env: { MSYS_NO_PATHCONV: "1" } }).spawn();
  const w = child.stdin.getWriter(); await w.write(new TextEncoder().encode(sql)); await w.close();
  const out = await child.output();
  const stderr = new TextDecoder().decode(out.stderr);
  if (!out.success) throw new Error(stderr.match(/ERROR:\s+(\S+)/)?.[1] ?? stderr.slice(0, 300));
  return new TextDecoder().decode(out.stdout).trim();
}
const q = (v: unknown) => v === null || v === undefined ? "NULL" : `'${(typeof v === "string" ? v : JSON.stringify(v)).replaceAll("'", "''")}'`;

/** Structural client used by the shared modules: rpc() and the tariff read of the PAD store. */
const client = {
  async rpc(name: string, args: Record<string, unknown>) {
    assert(/^[a-z_]+$/.test(name));
    const call = `public.${name}(${Object.entries(args).map(([k, v]) => `${k} => ${q(v)}`).join(", ")})`;
    try {
      if (name === "complete_lot_pricing") { await psql(`select ${call};`); return { data: null, error: null }; }
      return { data: JSON.parse(await psql(`select coalesce(to_jsonb(${call}), 'null'::jsonb)::text;`)), error: null };
    } catch (error) { return { data: null, error: { message: (error as Error).message } }; }
  },
  from(table: string) {
    assertEquals(table, "port_tariffs");
    const filters: string[] = []; let columns = "*";
    const chain = {
      select(cols: string) { columns = cols; return chain; },
      eq(k: string, v: unknown) { filters.push(`${k} = ${q(v)}`); return chain; },
      async limit(n: number) {
        const where = filters.length ? `where ${filters.join(" and ")}` : "";
        const data = JSON.parse(await psql(`select coalesce(json_agg(t), '[]')::text from (select ${columns} from public.port_tariffs ${where} order by id limit ${n}) t;`));
        const count = Number(await psql(`select count(*) from public.port_tariffs ${where};`));
        return { data: data.map((r: Record<string, unknown>) => ({ ...r, id: String(r.id), amount: Number(r.amount) })), error: null, count };
      },
    };
    return chain;
  },
};

const CASE = "00000000-0000-4000-8000-0000000c0001", ACTOR = "00000000-0000-4000-8000-0000000a0001";
const lines = [
  { line_index: 1, line_label: "Lot conteneurs A", request_type_hint: "SEA_FCL_IMPORT", source_excerpt: "Synthetic excerpt A", segment_text: "Synthetic segment A",
    extracted_facts_json: [{ key: "cargo.containers", value: [{ type: "40HC", quantity: 2 }] }, { key: "cargo.weight_kg", value: 36000 }] },
  { line_index: 2, line_label: "Lot conteneurs B", request_type_hint: "SEA_FCL_IMPORT", source_excerpt: "Synthetic excerpt B", segment_text: "Synthetic segment B",
    extracted_facts_json: [{ key: "cargo.containers", value: [{ type: "20DV", quantity: 1 }] }, { key: "cargo.weight_kg", value: 12000 }] },
];
const unit = (ref: string, eq: string, qty: number, kg: number) => ({ unit_ref: ref, unit_kind: "CONTAINER", equipment_code: eq, packaging: "unknown", quantity: qty,
  gross_weight_kg: kg, chargeable_weight_kg: null, volume_dm3: null, temperature_control_required: false, temperature_setpoint_celsius: null,
  classification_status: "unknown", destination_ref: null, dangerous_goods: null, required_attachment_status: "not_required", ownership: "SOC",
  un_number: null, imo_class: null, weight_basis: "per_unit", scenario_basis: `Synthetic lot ${ref}` });
const scope = { schema_version: 3, transport_mode: "MARITIME", movement_direction: "IMPORT", terminal_operation_mode: null,
  cargo_units: [unit("a", "40hc", 2, 18000), unit("b", "20dv", 1, 12000)],
  pad_choices: [{ unit_ref: "a", category: "T02", basis: "Synthetic" }, { unit_ref: "b", category: "T03", basis: "Synthetic" }] };
const ok = (label: string) => console.log(`PASS ${label}`);
const record = async (req: Record<string, unknown>) => {
  const r = await client.rpc("record_lot_confirmation", { p_case_id: CASE, p_actor: ACTOR, p_request: { line_fingerprint: null, terminal_mode: null,
    expected_head_id: null, idempotency_key: crypto.randomUUID(), source_reference: "Synthetic operator source", ...req } });
  if (r.error) throw new Error(r.error.message); return r.data as Record<string, unknown>;
};
const padConfirm = async (unitRef: string, category: string, context_hash: string) => {
  const r = await client.rpc("record_pad_group_confirmation", { p_case_id: CASE, p_actor: ACTOR, p_request: { unit_ref: unitRef, action: "confirm",
    category, source_reference: "Synthetic PAD source", weight_source_reference: "Synthetic weight source", expected_context_hash: context_hash,
    expected_head_id: null, idempotency_key: crypto.randomUUID() } });
  if (r.error) throw new Error(r.error.message);
};

/** What run-pricing's multi-lot preparation computes for the current request lines. */
async function prepareRun() {
  const registry = await loadLotConfirmationState(client, CASE);
  const pad = await loadPadGroupState(client, CASE);
  const keys = resolveEffectiveServiceKeys("DAP_PROJECT_IMPORT", { add: [], remove: [] });
  const lots = registry.context.lines.map(line => {
    const padGroupsRequired = padGroupScopeRequired([], keys) && pad.mode === "groups";
    const req = evaluateLotRequirements({ resolution: registry.resolution, lineId: line.id, terminalRequired: true, padGroupsRequired,
      padReady: pad.ready, padLines: pad.lines });
    const terminal = resolveTerminalBlockersForLot({ lotExtractedFacts: withConfirmedLotTerminalMode(line.extracted_facts as Array<{ key?: string; value?: unknown }>, req.terminalMode),
      effectiveServiceKeys: keys });
    const blockers = [...terminal, ...(padGroupsRequired && !req.padLine ? ["PAD_GROUP_CONFIRMATION_REQUIRED"] : []), ...(terminal.length || !req.padLine ? req.diagnostics : [])];
    return { lot_index: line.line_index, line, req, blockers, padGroupsRequired };
  });
  const scopeIssues = lotPadScopeIssues(pad.ready ? pad.lines : [], lots.map(l => ({ lot_index: l.lot_index,
    unit_ref: lotBindingForLine(registry.resolution, l.line.id)?.unit_ref ?? null, padInScope: l.padGroupsRequired })));
  for (const l of lots) l.blockers.push(...(scopeIssues.get(l.lot_index) ?? []));
  return { registry, pad, lots };
}
async function newRun(n: number) {
  const id = crypto.randomUUID();
  await psql(`insert into public.pricing_runs(id,case_id,run_number,status,created_by,inputs_json,facts_snapshot) values(${q(id)},${q(CASE)},${n},'running',${q(ACTOR)},'{}','[]');`);
  return id;
}
async function complete(run: string, prep: Awaited<ReturnType<typeof prepareRun>>, emitted: unknown[], total: number) {
  return await client.rpc("complete_lot_pricing", { p_case_id: CASE, p_run_id: run, p_context_hash: prep.registry.context.context_hash,
    p_pad_heads: prep.registry.context.pad_heads, p_lot_heads: prep.registry.context.heads, p_weight_head_id: prep.registry.context.weight_head_id,
    p_result: { status: "success", tariff_lines: emitted, total_ht: total, total_ttc: total, currency: "XOF", completed_at: new Date().toISOString(), duration_ms: 1 } });
}

try {
  await psql(`drop database if exists ${DB};`, "postgres", "supabase_admin");
  await psql(`create database ${DB} owner postgres template ${template};`, "postgres", "supabase_admin");
  await psql(await Deno.readTextFile("supabase/migrations/20260925120000_quote_lot_confirmations.sql"));
  await psql(`insert into auth.users(id,email) values(${q(ACTOR)},'lot-parcours@example.invalid');
insert into public.email_threads(id,subject_normalized,client_email) values('00000000-0000-4000-8000-0000000b0001','SYNTHETIC','lot-parcours@example.invalid');
insert into public.quote_cases(id,thread_id,status) values(${q(CASE)},'00000000-0000-4000-8000-0000000b0001','READY_TO_PRICE');
insert into public.quote_facts(case_id,fact_key,fact_category,value_text,source_type,is_current) values(${q(CASE)},'service.package','service','DAP_PROJECT_IMPORT','manual_input',true);
insert into public.port_tariffs(id,provider,category,operation_type,classification,cargo_type,amount,unit,source_document,effective_date,expiry_date,is_active,evidence_level) values
 (gen_random_uuid(),'PAD','DROIT_PASSAGE','IMPORT','T02','CONTENEUR',100,'per_tonne','Synthetic PAD tariff T02','2020-01-01',null,true,'official'),
 (gen_random_uuid(),'PAD','DROIT_PASSAGE','IMPORT','T03','CONTENEUR',150,'per_tonne','Synthetic PAD tariff T03','2020-01-01',null,true,'official');
select public.replace_quote_request_lines(${q(CASE)}, ${q(lines)}::jsonb);
select public.manage_quote_scenario(${q(CASE)},'select',${q(ACTOR)},'parcours-select-01',repeat('b',64),
  p_scenario_id=>(public.manage_quote_scenario(${q(CASE)},'create',${q(ACTOR)},'parcours-create-01',repeat('a',64),p_title=>'SYNTHETIC',p_scope_snapshot=>${q(scope)}::jsonb)->>'scenario_id')::uuid);`);

  // 1. Nothing confirmed: every lot is blocked with a precise reason; no line is assigned.
  let prep = await prepareRun();
  assertEquals(prep.lots.map(l => l.blockers.includes("TERMINAL_OPERATION_MODE_REQUIRED") && l.blockers.includes("LOT_LINE_UNBOUND")), [true, true]);
  // The dossier-level terminal fact never satisfies a lot.
  await psql(`insert into public.quote_facts(case_id,fact_key,fact_category,value_text,source_type,is_current) values(${q(CASE)},'${TERMINAL_OPERATION_MODE_FACT_KEY}','routing','LOLO','manual_input',true);`);
  prep = await prepareRun();
  assertEquals(prep.lots.every(l => l.blockers.includes("TERMINAL_OPERATION_MODE_REQUIRED")), true);
  ok("unconfirmed lots blocked; global terminal fact never lent to a lot");

  // 2. Two distinct lots confirmed: binding, terminal mode, PAD category.
  const ctx = prep.registry.context;
  const fp = (i: number) => ctx.lines.find(l => l.line_index === i)!.fingerprint;
  await record({ unit_ref: "a", decision_kind: "line_binding", action: "confirm", line_fingerprint: fp(1), expected_context_hash: ctx.context_hash });
  await record({ unit_ref: "b", decision_kind: "line_binding", action: "confirm", line_fingerprint: fp(2), expected_context_hash: ctx.context_hash });
  await record({ unit_ref: "a", decision_kind: "terminal_mode", action: "confirm", terminal_mode: "LOLO", expected_context_hash: ctx.context_hash });
  const termB = await record({ unit_ref: "b", decision_kind: "terminal_mode", action: "confirm", terminal_mode: "LOLO", expected_context_hash: ctx.context_hash });
  await padConfirm("a", "T02", ctx.context_hash); await padConfirm("b", "T03", ctx.context_hash);
  prep = await prepareRun();
  assertEquals(prep.pad.ready, true, JSON.stringify(prep.pad.issues));
  assertEquals(prep.lots.map(l => l.blockers), [[], []]);
  assertEquals(prep.lots.map(l => `${l.req.unit_ref}:${l.req.terminalMode}:${l.req.padLine?.amount}`), ["a:LOLO:3600", "b:LOLO:1800"]);
  ok("two distinct lots confirmed → access to pricing, each lot with its own mode and PAD line");

  // 3. Emission and completion: one PAD line per decision in its lot, counted once.
  const emitted = prep.lots.map(l => ({ ...canonicalizeLine(confirmedPadLineInput(l.req.padLine, null), { origin_layer: "enrichment_pad" }), lot_index: l.lot_index }));
  const lotUnits = new Map(prep.lots.map(l => [l.lot_index, l.req.unit_ref!] as [number, string]));
  assertEquals(lotPadEmissionValid(prep.pad.lines, emitted, lotUnits), true);
  assertEquals(lotPadEmissionValid(prep.pad.lines, [...emitted, emitted[0]], lotUnits), false);
  const total = prep.lots.reduce((s, l, i) => s + computeCommercialTotals({ engineTotals: { dap: 0, ddp: 0 }, lines: [emitted[i]] }).totalHt, 0);
  assertEquals(total, 5400);
  const run1 = await newRun(1);
  const done = await complete(run1, prep, emitted, total);
  assertEquals(done.error, null);
  assertEquals(await psql(`select status||':'||total_ht from public.pricing_runs where id=${q(run1)};`), "success:5400");
  ok("PAD lines assigned per lot, no double counting, valid completion (5400 XOF synthetic)");

  // 4. A revocation between the run's reading and its completion invalidates the completion.
  const run2 = await newRun(2);
  await record({ unit_ref: "b", decision_kind: "terminal_mode", action: "revoke", expected_context_hash: ctx.context_hash, expected_head_id: termB.id });
  assert((await complete(run2, prep, emitted, total)).error?.message.includes("LOT_CONTEXT_CHANGED"));
  assertEquals(await psql(`select status from public.pricing_runs where id=${q(run2)};`), "running");
  assertEquals((await prepareRun()).lots.map(l => l.blockers.length > 0), [false, true]);
  ok("revocation before completion: run not recorded, revoked lot blocked again");

  // 5. Re-analysis with identical lines: every decision stale, nothing re-associated.
  await psql(`select public.replace_quote_request_lines(${q(CASE)}, ${q(lines)}::jsonb);`);
  prep = await prepareRun();
  assertEquals(prep.pad.ready, false);
  assertEquals(prep.lots.every(l => l.blockers.includes("LOT_CONFIRMATION_STALE") || l.blockers.includes("TERMINAL_OPERATION_MODE_REQUIRED")), true);
  assertEquals(prep.registry.resolution.bindings, []);
  ok("re-analysis: all confirmations stale, old values kept, no silent re-association");

  // 6. Indiscernible lines: assignment refused, lots stay blocked.
  await psql(`select public.replace_quote_request_lines(${q(CASE)}, ${q([lines[0], { ...lines[0], line_index: 2 }])}::jsonb);`);
  prep = await prepareRun();
  const heads = prep.registry.context.heads.filter(h => h.decision_kind === "line_binding");
  let refused = "";
  try { await record({ unit_ref: "a", decision_kind: "line_binding", action: "confirm", line_fingerprint: prep.registry.context.lines[0].fingerprint,
    expected_context_hash: prep.registry.context.context_hash, expected_head_id: heads.find(h => h.unit_ref === "a")!.id }); }
  catch (error) { refused = (error as Error).message; }
  assertEquals(refused, "LOT_LINE_AMBIGUOUS");
  assertEquals(prep.lots.every(l => l.blockers.includes("LOT_LINE_AMBIGUOUS")), true);
  ok("indiscernible lines: binding refused, clarification required");
} catch (error) {
  console.error(`FAIL ${(error as Error).stack ?? error}`);
  Deno.exitCode = 1;
} finally {
  await psql(`drop database if exists ${DB};`, "postgres", "supabase_admin").catch(() => {});
}
