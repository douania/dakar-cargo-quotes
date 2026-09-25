// MULTI-LOT-TERMINAL-1 — LOCAL validation only (GO CTO 2026-09-25).
// Target: an offline Docker PostgreSQL (network none, no published port) holding a
// schema-only restore plus the repository migrations, in a template database. Every run
// works on a throw-away copy of that template; only synthetic rows are written.
// Usage: node scripts/lot-confirmations-local-validation.mjs <container> <template-db>
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';

const [container, template] = process.argv.slice(2);
assert(container && /^dcq-[a-z0-9-]+$/.test(container), 'Explicit local dcq-* container required');
assert(template && /^[a-z0-9_]+_base$/.test(template), 'Explicit *_base template database required');
const inspection = JSON.parse(spawnSync('docker', ['inspect', container], { encoding: 'utf8' }).stdout)[0];
assert.equal(inspection.HostConfig.NetworkMode, 'none', 'Container must be offline');
assert.equal(Object.keys(inspection.HostConfig.PortBindings || {}).length, 0, 'No published port allowed');

const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
const migration = fs.readFileSync('supabase/migrations/20260925120000_quote_lot_confirmations.sql', 'utf8');
const rollback = fs.readFileSync('supabase/rollbacks/20260925120000_quote_lot_confirmations.sql', 'utf8');
const fixture = fs.readFileSync('supabase/tests/quote_lot_confirmations.sql', 'utf8');
const padFixtures = ['pad_group_confirmations', 'pad_weight_basis', 'pad_weight_reconciliation_full']
  .map((name) => [name, fs.readFileSync(`supabase/tests/${name}.sql`, 'utf8')]);

function psql(database, input, { user = 'postgres', expectError } = {}) {
  const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', user, '-d', database,
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse'], { input, encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 });
  if (expectError) {
    assert.notEqual(r.status, 0, `Expected refusal ${expectError}`);
    assert((r.stderr || '').includes(expectError), `Expected ${expectError}, got: ${(r.stderr || '').trim().slice(0, 300)}`);
    return '';
  }
  if (r.status !== 0) throw new Error(`Local SQL failed: ${(r.stderr || '').trim().slice(0, 500)}`);
  return `${r.stdout}\n${r.stderr}`.trim();
}
const admin = (sql) => psql('postgres', sql, { user: 'supabase_admin' });
const fresh = (name) => {
  assert(/^mlt1_[a-z0-9_]+$/.test(name));
  admin(`drop database if exists ${name};`);
  admin(`create database ${name} owner postgres template ${template};`);
  return name;
};
const drop = (name) => admin(`drop database if exists ${name};`);
const apply = (db, sql) => psql(db, sql);
const acknowledged = rollback.replace('begin;', "begin;\nset local dcq.lot_rollback_ack='REVIEWED_LOT_ROLLBACK';");
const scalar = (db, sql) => psql(db, sql).split('\n')[0];

// Synthetic dossier with two distinct lines and a selected v3 scenario, committed.
const seed = `
insert into auth.users(id,email) values('00000000-0000-4000-8000-00000000a001','lot-seed@example.invalid');
insert into public.email_threads(id,subject_normalized,client_email) values('00000000-0000-4000-8000-00000000b001','SYNTHETIC','lot-seed@example.invalid');
insert into public.quote_cases(id,thread_id,status) values('00000000-0000-4000-8000-00000000c001','00000000-0000-4000-8000-00000000b001','READY_TO_PRICE');
select public.replace_quote_request_lines('00000000-0000-4000-8000-00000000c001','[
 {"line_index":1,"line_label":"Lot A","source_excerpt":"Synthetic A","segment_text":"Seg A","extracted_facts_json":[{"key":"cargo.containers","value":[{"type":"40HC","quantity":2}]}]},
 {"line_index":2,"line_label":"Lot B","source_excerpt":"Synthetic B","segment_text":"Seg B","extracted_facts_json":[{"key":"cargo.containers","value":[{"type":"20DV","quantity":1}]}]}]');
select public.manage_quote_scenario('00000000-0000-4000-8000-00000000c001','select','00000000-0000-4000-8000-00000000a001','seed-select-0001',repeat('b',64),
 p_scenario_id=>(public.manage_quote_scenario('00000000-0000-4000-8000-00000000c001','create','00000000-0000-4000-8000-00000000a001','seed-create-0001',repeat('a',64),
  p_title=>'SYNTHETIC',p_scope_snapshot=>'{"schema_version":3,"transport_mode":"MARITIME","movement_direction":"IMPORT","terminal_operation_mode":null,"cargo_units":[
   {"unit_ref":"a","unit_kind":"CONTAINER","equipment_code":"40hc","packaging":"unknown","quantity":2,"gross_weight_kg":18000,"chargeable_weight_kg":null,"volume_dm3":null,"temperature_control_required":false,"temperature_setpoint_celsius":null,"classification_status":"unknown","destination_ref":null,"dangerous_goods":null,"required_attachment_status":"not_required","ownership":"SOC","un_number":null,"imo_class":null,"weight_basis":"per_unit","scenario_basis":"Synthetic A"},
   {"unit_ref":"b","unit_kind":"CONTAINER","equipment_code":"20dv","packaging":"unknown","quantity":1,"gross_weight_kg":12000,"chargeable_weight_kg":null,"volume_dm3":null,"temperature_control_required":false,"temperature_setpoint_celsius":null,"classification_status":"unknown","destination_ref":null,"dangerous_goods":null,"required_attachment_status":"not_required","ownership":"SOC","un_number":null,"imo_class":null,"weight_basis":"per_unit","scenario_basis":"Synthetic B"}],
   "pad_choices":[{"unit_ref":"a","category":"T02","basis":"Synthetic"},{"unit_ref":"b","category":"T03","basis":"Synthetic"}]}'::jsonb)->>'scenario_id')::uuid);`;
const CASE = '00000000-0000-4000-8000-00000000c001', ACTOR = '00000000-0000-4000-8000-00000000a001';
const bind = (unit, index, key) => `select public.record_lot_confirmation('${CASE}','${ACTOR}',jsonb_build_object(
 'unit_ref','${unit}','decision_kind','line_binding','action','confirm',
 'line_fingerprint',(select l->>'fingerprint' from jsonb_array_elements(public.read_lot_confirmation_context('${CASE}')->'lines') l where (l->>'line_index')::int=${index}),
 'terminal_mode',null,'source_reference','Synthetic operator check','expected_context_hash',public.read_lot_confirmation_context('${CASE}')->>'context_hash',
 'expected_head_id',null,'idempotency_key','${key}'))->>'id';`;

const results = [];
function step(name, fn) { fn(); results.push(name); console.log(`PASS ${name}`); }

try {
  step('migration + synthetic fixtures (new registry, PAD suites unchanged)', () => {
    const db = fresh('mlt1_cycle');
    apply(db, migration);
    assert.match(psql(db, fixture), /PASS LOT registry/);
    for (const [name, sql] of padFixtures) assert.match(psql(db, sql), /PASS|_PASS/, name);
  });

  step('rollback refused without acknowledgement', () => {
    psql('mlt1_cycle', rollback, { expectError: 'LOT_ROLLBACK_ACK_REQUIRED' });
  });

  step('rollback with decisions: registry archived, functions removed, PAD writer multi-lot refusal restored', () => {
    const db = 'mlt1_cycle';
    psql(db, seed);
    const id = scalar(db, bind('a', 1, '00000000-0000-4000-8000-0000000000d1'));
    assert.match(id, /^[0-9a-f-]{36}$/);
    psql(db, acknowledged);
    assert.equal(scalar(db, `select count(*) from pg_proc where proname in ('read_lot_confirmation_context','record_lot_confirmation','complete_lot_pricing','quote_request_line_fingerprint');`), '0');
    assert.equal(scalar(db, `select to_regclass('public.quote_lot_confirmations') is null;`), 't');
    const archived = scalar(db, `select relname from pg_class where relname like 'quote_lot_confirmations_archived_%' and relkind='r';`);
    assert.match(archived, /^quote_lot_confirmations_archived_\d{14}$/);
    assert.equal(scalar(db, `select count(*) from public.${archived} where id='${id}';`), '1');
    assert.equal(scalar(db, `select has_table_privilege('authenticated','public.${archived}','SELECT');`), 'f');
    // Unchanged PAD writer again refuses any multi-lot confirmation.
    psql(db, `select public.record_pad_group_confirmation('${CASE}','${ACTOR}',jsonb_build_object('unit_ref','a','action','confirm','category','T02',
      'source_reference','Synthetic','weight_source_reference','Synthetic','expected_context_hash',public.read_pad_group_context('${CASE}')->>'context_hash',
      'expected_head_id',null,'idempotency_key',gen_random_uuid()));`, { expectError: 'PAD_GROUP_SCOPE_UNSUPPORTED' });
  });

  step('redelivery after rollback: empty registry, archived decision never reactivated', () => {
    const db = 'mlt1_cycle';
    apply(db, migration);
    assert.equal(scalar(db, `select jsonb_array_length(public.read_lot_confirmation_context('${CASE}')->'heads');`), '0');
    assert.equal(scalar(db, `select count(*) from public.quote_lot_confirmations;`), '0');
    assert.equal(scalar(db, `select count(*) from pg_class where relname like 'quote_lot_confirmations_archived_%' and relkind='r';`), '1');
  });

  step('rollback on an empty registry drops it; reapplication succeeds', () => {
    const db = 'mlt1_cycle';
    psql(db, acknowledged);
    assert.equal(scalar(db, `select to_regclass('public.quote_lot_confirmations') is null;`), 't');
    apply(db, migration);
    assert.match(psql(db, fixture), /PASS LOT registry/);
    drop(db);
  });
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
}

// Two genuinely overlapping sessions on committed synthetic rows.
async function concurrency() {
  const db = fresh('mlt1_conc');
  apply(db, migration);
  psql(db, seed);
  scalar(db, bind('a', 1, '00000000-0000-4000-8000-0000000000e1'));
  const ctx = JSON.parse(scalar(db, `select public.read_lot_confirmation_context('${CASE}')::text;`));
  psql(db, `insert into public.pricing_runs(id,case_id,run_number,status,created_by,inputs_json,facts_snapshot)
    values('00000000-0000-4000-8000-0000000000f1','${CASE}',1,'running','${ACTOR}','{}','[]');`);
  const q = (s) => `'${s.replaceAll("'", "''")}'`;
  const complete = `select public.complete_lot_pricing('${CASE}','00000000-0000-4000-8000-0000000000f1',${q(ctx.context_hash)},
    ${q(JSON.stringify(ctx.pad_heads))}::jsonb,${q(JSON.stringify(ctx.heads))}::jsonb,null,
    '{"status":"success","tariff_lines":[],"total_ht":5,"total_ttc":5,"currency":"XOF","completed_at":"2026-09-25T12:00:00Z","duration_ms":1}'::jsonb);`;
  // Session A: records a decision and keeps its transaction (and the dossier lock) open.
  const a = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1'], { env });
  let aOut = ''; a.stdout.on('data', (d) => { aOut += d; }); a.stderr.on('data', (d) => { aOut += d; });
  a.stdin.write(`begin;\n${bind('b', 2, '00000000-0000-4000-8000-0000000000e2')}\nselect 'A_RECORDED';\n`);
  await waitFor(() => aOut.includes('A_RECORDED'), 'session A decision');
  // Session B: the run completion starts while A holds the lock.
  const b = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse'], { env });
  let bOut = ''; b.stdout.on('data', (d) => { bOut += d; }); b.stderr.on('data', (d) => { bOut += d; });
  const bDone = new Promise((resolve) => b.on('close', resolve));
  b.stdin.end(`${complete}\n`);
  await waitFor(() => scalar(db, `select count(*) from pg_stat_activity where datname='${db}' and wait_event_type='Lock' and query like '%complete_lot_pricing%';`) === '1', 'session B waiting on the dossier lock');
  a.stdin.end('commit;\n');
  await new Promise((resolve) => a.on('close', resolve));
  await bDone;
  assert(bOut.includes('LOT_CONTEXT_CHANGED'), `B must be refused after A commits: ${bOut.slice(0, 300)}`);
  assert.equal(scalar(db, `select status from public.pricing_runs where id='00000000-0000-4000-8000-0000000000f1';`), 'running');
  // Reverse order: a completion holding the lock first succeeds; the later decision then waits and is recorded.
  const ctx2 = JSON.parse(scalar(db, `select public.read_lot_confirmation_context('${CASE}')::text;`));
  const complete2 = complete.replace(q(JSON.stringify(ctx.heads)), q(JSON.stringify(ctx2.heads)));
  psql(db, complete2);
  assert.equal(scalar(db, `select total_ht from public.pricing_runs where id='00000000-0000-4000-8000-0000000000f1';`), '5');
  drop(db);
}
async function waitFor(check, label) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise((r) => setTimeout(r, 200)); }
  throw new Error(`Timeout waiting for ${label}`);
}

if (!process.exitCode) {
  try { await concurrency(); console.log('PASS real concurrency: waiting completion refused after concurrent decision; reverse order completes'); }
  catch (error) { console.error(`FAIL concurrency: ${error.message}`); process.exitCode = 1; }
}

// Real overlap between the TRUE line writer (replace_quote_request_lines, lock `qrl_`) and the
// run completion (complete_lot_pricing, lock `pad_group:`). The locks differ, so each outcome must
// be either a refusal or a run recorded on a context that was current at its own reading.
async function lineRewriteConcurrency() {
  const db = fresh('mlt1_conc_lines');
  apply(db, migration);
  psql(db, seed);
  scalar(db, bind('a', 1, '00000000-0000-4000-8000-0000000000e3'));
  const lines = scalar(db, `select jsonb_agg(jsonb_build_object('line_index',line_index,'line_label',line_label,'source_excerpt',source_excerpt,
    'segment_text',segment_text,'extracted_facts_json',extracted_facts_json) order by line_index)::text from public.quote_request_lines where case_id='${CASE}';`);
  const q = (s) => `'${s.replaceAll("'", "''")}'`;
  const rewrite = `select public.replace_quote_request_lines('${CASE}', ${q(lines)}::jsonb);`;
  const run = (n) => { const id = `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
    psql(db, `insert into public.pricing_runs(id,case_id,run_number,status,created_by,inputs_json,facts_snapshot) values('${id}','${CASE}',${10 + n},'running','${ACTOR}','{}','[]');`); return id; };
  const completion = (id, ctx) => `select public.complete_lot_pricing('${CASE}','${id}',${q(ctx.context_hash)},${q(JSON.stringify(ctx.pad_heads))}::jsonb,
    ${q(JSON.stringify(ctx.heads))}::jsonb,null,'{"status":"success","tariff_lines":[],"total_ht":9,"total_ttc":9,"currency":"XOF","completed_at":"2026-09-25T12:00:00Z","duration_ms":1}'::jsonb);`;
  const context = () => JSON.parse(scalar(db, `select public.read_lot_confirmation_context('${CASE}')::text;`));
  const status = (id) => scalar(db, `select status from public.pricing_runs where id='${id}';`);
  const session = () => {
    const p = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse'], { env });
    const s = { out: '', done: new Promise((r) => p.on('close', r)), write: (x) => p.stdin.write(x), end: (x) => p.stdin.end(x) };
    p.stdout.on('data', (d) => { s.out += d; }); p.stderr.on('data', (d) => { s.out += d; });
    return s;
  };

  // T1: completion validated and still open; the rewrite commits; then the completion commits.
  let ctx = context(); let id = run(1);
  const a = session(); a.write(`begin;\n${completion(id, ctx)}\nselect 'A_CHECKED';\n`);
  await waitFor(() => a.out.includes('A_CHECKED'), 'T1 completion checked');
  psql(db, rewrite); // not blocked: different lock, no row conflict
  const afterRewrite = context().context_hash;
  a.end('commit;\n'); await a.done;
  assert.notEqual(afterRewrite, ctx.context_hash);
  assert.equal(status(id), 'success'); // recorded on the context it read (serial order: completion, then rewrite)
  assert.equal(context().heads.find((h) => h.unit_ref === 'a').context_hash, ctx.context_hash); // decision now stale
  // T2: rewrite open (uncommitted); completion on the committed context succeeds; rewrite commits after.
  ctx = context(); id = run(2);
  const b = session(); b.write(`begin;\n${rewrite}\nselect 'B_WRITTEN';\n`);
  await waitFor(() => b.out.includes('B_WRITTEN'), 'T2 rewrite written');
  psql(db, completion(id, ctx)); // not blocked by the uncommitted rewrite (MVCC, distinct locks)
  assert.equal(status(id), 'success');
  b.end('commit;\n'); await b.done;
  assert.notEqual(context().context_hash, ctx.context_hash);
  // T3: rewrite committed before the completion reads: refused, run untouched.
  ctx = context(); id = run(3);
  psql(db, rewrite);
  psql(db, completion(id, ctx), { expectError: 'LOT_CONTEXT_CHANGED' });
  assert.equal(status(id), 'running');
  // T4: rewrite committed AFTER the wrapper's check (S1) but before the PAD finalizer's reading
  // (S2): the finalizer, reached with the pre-rewrite context, refuses on its own reading.
  ctx = context(); id = run(4);
  psql(db, rewrite);
  psql(db, `select public.complete_pad_weight_pricing('${CASE}','${id}',${q(ctx.context_hash)},${q(JSON.stringify(ctx.pad_heads))}::jsonb,
    '{"status":"success","tariff_lines":[],"total_ht":9,"total_ttc":9,"currency":"XOF","completed_at":"2026-09-25T12:00:00Z","duration_ms":1}'::jsonb,null);`,
    { expectError: 'PAD_CONTEXT_CHANGED' });
  assert.equal(status(id), 'running');
  drop(db);
}
if (!process.exitCode) {
  try { await lineRewriteConcurrency(); console.log('PASS real concurrency with replace_quote_request_lines: T1/T2 recorded on the context they read, T3 refused, T4 finalizer re-validates'); }
  catch (error) { console.error(`FAIL line rewrite concurrency: ${error.message}`); process.exitCode = 1; }
}
