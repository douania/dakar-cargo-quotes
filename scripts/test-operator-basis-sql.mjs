/** Offline PostgreSQL integration with synthetic data only.
 * Focused schema fixture: canonical tables and scenario pricing table use repository DDL;
 * scenario/assumption fixtures model referenced columns, not the full Cloud catalogue.
 * No host ports, volumes, credentials, Cloud or customer data.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
const container = `dcq-operator-test-${process.pid}`;
const read = p => fs.readFileSync(p, 'utf8');
const migration = read('supabase/migrations/20260928150000_operator_quotation_basis.sql');
const rollback = read('supabase/rollbacks/20260928150000_operator_quotation_basis.sql');
const q = v => "'" + String(v).replaceAll("'", "''") + "'";
const j = v => q(JSON.stringify(v)) + '::jsonb';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const caseId = id(1), userId = id(2), scenarioId = id(3), sourceId = id(4), hash = 'a'.repeat(64);
const command = ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'];
function sql(s, expected) {
  const r = spawnSync('docker', command, { input: s, encoding: 'utf8' });
  if (expected) { assert.notEqual(r.status, 0); assert(r.stderr.includes(expected), r.stderr); return; }
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}
function concurrent(s) {
  return new Promise((resolve, reject) => {
    const p = spawn('docker', command); let out = '', err = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('error', reject); p.on('close', code => code ? reject(new Error(err)) : resolve(out.trim())); p.stdin.end(s);
  });
}
function table(ddl, name) {
  const re = new RegExp(`create table (?:if not exists )?(?:public\\.)?${name} \\([\\s\\S]*?^\\);`, 'im');
  const found = ddl.match(re); assert(found, name); return found[0];
}
function call(source = sourceId, key = 'synthetic-key-A', scope = hash, scenario = scenarioId, dossier = caseId) {
  return `SELECT public.adopt_operator_quotation_basis('${dossier}','${scenario}','${source}','${scope}','${key}','${userId}');`;
}
let started = false;
try {
  const r = spawnSync('docker', ['run', '--rm', '-d', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); started = true;
  for (let i = 0; i < 60; i++) {
    if (spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres']).status === 0) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const base = read('supabase/migrations/20260201195433_678bf166-d197-4da3-9bd7-5bcb265c7f68.sql');
  sql(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE email_threads(id uuid PRIMARY KEY); CREATE TABLE emails(id uuid PRIMARY KEY); CREATE TABLE email_attachments(id uuid PRIMARY KEY);
    ${base.match(/CREATE TYPE quote_request_type[\s\S]*?\);/)[0]}
    ${base.match(/CREATE TYPE quote_case_status[\s\S]*?\);/)[0]}
    ALTER TYPE quote_case_status ADD VALUE 'QUOTED_VERSIONED';
    ${table(base, 'quote_cases')}
    ${table(base, 'quote_facts')}
    CREATE TABLE quote_gaps(id uuid PRIMARY KEY);
    ${table(base, 'pricing_runs')}
    ${table(base, 'case_timeline_events')}
    ALTER TABLE case_timeline_events DROP CONSTRAINT case_timeline_events_event_type_check;
    CREATE TABLE quote_scenarios(id uuid PRIMARY KEY, case_id uuid, scope_hash text, scope_snapshot jsonb, status text, superseded_by_scenario_id uuid, title text, revision_no int, open_points jsonb);
    CREATE TABLE quote_scenario_selections(case_id uuid, scenario_id uuid, released_at timestamptz);
    CREATE TABLE quote_scenario_assumptions(id uuid PRIMARY KEY, case_id uuid, status text, assumption_type text, assumed_fact_key text, assumed_value_type text, assumed_value jsonb, statement text, basis text, source_type text, source_refs jsonb, risk_level text);
    CREATE TABLE quote_scenario_links(scenario_id uuid, assumption_id uuid, reserve_code text, open_point_key text);
    ${table(read('supabase/migrations/20260829200000_create_scenario_pricing_p1a4.sql'), 'quote_scenario_pricing_runs')}
  `);
  sql(migration); sql(rollback); sql(migration);
  assert.equal(sql("SELECT has_function_privilege('authenticated','public.adopt_operator_quotation_basis(uuid,uuid,uuid,text,text,uuid)','EXECUTE');"), 'f');
  assert.equal(sql("SELECT has_function_privilege('anon','public.adopt_operator_quotation_basis(uuid,uuid,uuid,text,text,uuid)','EXECUTE');"), 'f');
  const scope = { cargo_units: [{ unit_ref: 'synthetic', quantity: 2 }], schema_version: 2 };
  sql(`INSERT INTO auth.users VALUES('${userId}'); INSERT INTO email_threads VALUES('${id(9)}');
    INSERT INTO quote_cases(id,thread_id,status) VALUES('${caseId}','${id(9)}','READY_TO_PRICE');
    INSERT INTO quote_scenarios VALUES('${scenarioId}','${caseId}','${hash}',${j(scope)},'draft',null,'SYNTHETIC',1,'[]');
    INSERT INTO quote_scenario_selections VALUES('${caseId}','${scenarioId}',null);
    INSERT INTO pricing_runs(case_id,run_number,inputs_json,facts_snapshot,status,total_ht) VALUES('${caseId}',1,'{}','[]','success',10);
    INSERT INTO quote_scenario_assumptions VALUES('${id(6)}','${caseId}','active','quantity','cargo.count','number','2','Synthetic quantity','Synthetic basis','operator_guidance','[]','medium');
    INSERT INTO quote_scenario_links(scenario_id,assumption_id) VALUES('${scenarioId}','${id(6)}');
    INSERT INTO quote_facts(id,case_id,fact_key,fact_category,value_text,source_type) VALUES('${id(7)}','${caseId}','routing.destination','routing','SYNTHETIC','manual_input');
    INSERT INTO quote_scenario_pricing_runs(id,case_id,scenario_id,scenario_scope_hash,run_seq,status,qualification,scenario_snapshot,inputs_json,facts_snapshot,assumptions_snapshot,overlay_json,tariff_lines,firm_total_ht,firm_total_ttc,indicative_total_ht,indicative_total_ttc,request_fingerprint,created_by)
    VALUES('${sourceId}','${caseId}','${scenarioId}','${hash}',1,'success','partial',${j(scope)},'{}',
      (SELECT jsonb_agg(to_jsonb(f)) FROM quote_facts f),(SELECT jsonb_agg(to_jsonb(a)) FROM quote_scenario_assumptions a),'[]',
      '[{"amount":100,"bloc":"honoraires"},{"amount":null,"source":{"type":"TO_CONFIRM"}}]',0,0,100,118,'${hash}','${userId}');`);
  const factsBefore = sql('SELECT jsonb_agg(to_jsonb(f)) FROM quote_facts f;');
  sql(call(sourceId, 'key-scope', 'b'.repeat(64)), 'SCENARIO_STATE_CHANGED');
  sql(`BEGIN; UPDATE quote_facts SET value_text='changed'; ${call()}`, 'SCENARIO_STATE_CHANGED');
  sql(`BEGIN; UPDATE quote_scenario_assumptions SET assumed_value='3'; ${call()}`, 'SCENARIO_STATE_CHANGED');
  sql(`BEGIN; DELETE FROM quote_scenario_links; ${call()}`, 'SCENARIO_STATE_CHANGED');
  sql(`BEGIN; INSERT INTO quote_scenario_links(scenario_id,reserve_code) VALUES('${scenarioId}','PARTNER_COST_PENDING'); ${call()}`, 'SCENARIO_STATE_CHANGED');
  sql(`BEGIN; DELETE FROM quote_scenario_selections; ${call()}`, 'SCENARIO_NOT_SELECTED');
  sql(`BEGIN; UPDATE quote_cases SET status='ARCHIVED'; ${call()}`, 'CONFLICT_INVALID_STATE');
  sql(`BEGIN; UPDATE pricing_runs SET status='running'; ${call()}`, 'CONFLICT_INVALID_STATE');
  sql(`BEGIN; INSERT INTO case_timeline_events(case_id,event_type,event_data) VALUES('${caseId}','thread_intent_v1','{"intent":{"pricing_gate":false}}'); ${call()}`, 'CONFLICT_INVALID_STATE');
  sql(call(sourceId, 'key-cross', hash, scenarioId, id(99)), 'NOT_FOUND');
  sql(`CREATE FUNCTION reject_synthetic_event() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN RAISE EXCEPTION 'SYNTHETIC_LATE_FAILURE'; END $body$;
    CREATE TRIGGER reject_synthetic_event BEFORE INSERT ON case_timeline_events FOR EACH ROW EXECUTE FUNCTION reject_synthetic_event();`);
  sql(call(), 'SYNTHETIC_LATE_FAILURE');
  assert.equal(sql('SELECT count(*) FROM pricing_runs;'), '1');
  assert.equal(sql('SELECT status FROM quote_cases;'), 'READY_TO_PRICE');
  sql('DROP TRIGGER reject_synthetic_event ON case_timeline_events; DROP FUNCTION reject_synthetic_event();');
  const results = (await Promise.all([concurrent(call()), concurrent(call())])).map(JSON.parse);
  assert.equal(results[0].pricing_run_id, results[1].pricing_run_id);
  assert.equal(results[0].run_number, 2);
  assert.equal(results.filter(r => r.idempotent_replay).length, 1);
  assert.equal(sql('SELECT count(*) FROM pricing_runs;'), '2');
  sql(call(sourceId, 'different-alias-key'), 'IDEMPOTENCY_CONFLICT');
  assert.equal(sql("SELECT total_ht::text||'/'||total_ttc::text FROM pricing_runs WHERE run_number=2;"), '100/118');
  assert.equal(sql("SELECT outputs_json #>> '{operator_basis,assumptions,0,statement}' FROM pricing_runs WHERE run_number=2;"), 'Synthetic quantity');
  assert.equal(sql('SELECT jsonb_agg(to_jsonb(f)) FROM quote_facts f;'), factsBefore);
  sql(`BEGIN; UPDATE quote_facts SET value_text='changed'; ${call()}`, 'SCENARIO_STATE_CHANGED');
  sql(`INSERT INTO quote_scenario_pricing_runs SELECT (jsonb_populate_record(null::quote_scenario_pricing_runs, to_jsonb(r)||'{"id":"${id(5)}","run_seq":2}'::jsonb)).* FROM quote_scenario_pricing_runs r WHERE id='${sourceId}';`);
  const next = JSON.parse(sql(call(id(5), 'synthetic-key-B'))); assert.equal(next.run_number, 3);
  sql(call(sourceId, 'synthetic-key-B'), 'IDEMPOTENCY_CONFLICT');
  assert.equal(sql('SELECT count(*) FROM pricing_runs;'), '3');
  sql(rollback, 'ROLLBACK_REFUSED');
  assert.equal(sql('SELECT count(*) FROM pricing_runs;'), '3');
  console.log('PASS: migration/rollback empty, ACL, stale scope/facts/assumptions/links, selection, state, intent, concurrency, #2/#3, totals, replay conflict, immutable facts, rollback refuses history. Focused synthetic schema only.');
} finally {
  if (started) spawnSync('docker', ['stop', container], { stdio: 'ignore' });
}
