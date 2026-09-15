// Explicit LOCAL fixture: private archive stays in an offline Docker container.
// No database rows or credentials are printed. No filesystem writes or Cloud calls.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const container='dcq-pad-v3-full-20260915', database=process.argv[4]||'pad_v3_full';
assert(/^pad_v3_full(?:_[a-z0-9]+)?$/.test(database),'Only dedicated local test databases allowed');
const prior=process.argv[3];
assert(prior && path.isAbsolute(prior),'Explicit prior reviewed preparation directory required');
const read=p=>fs.readFileSync(p,'utf8');
const old=p=>read(path.join(prior,p));
const q=s=>"'"+s.replaceAll("'","''")+"'";
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const steps=[];
function sql(s,expected){
 const r=spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse'],
   {input:'SET search_path=public,extensions; SET client_min_messages=warning;\n'+s,encoding:'utf8',maxBuffer:16*1024*1024});
 if(expected){assert.notEqual(r.status,0);assert((r.stderr||'').includes(expected),'Expected refusal absent');return;}
 if(r.status!==0) { const error=new Error('Local SQL failed'); error.code=(r.stderr||'').match(/ERROR:\s+([A-Z][A-Z0-9_]+)/)?.[1]||'LOCAL_SQL_FAILED'; throw error; }
 return r.stdout.trim();
}
const json=s=>JSON.parse(sql(s));
const inspection=JSON.parse(spawnSync('docker',['inspect',container],{encoding:'utf8'}).stdout)[0];
assert.equal(inspection.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(inspection.HostConfig.PortBindings||{}).length,0);
assert(inspection.HostConfig.Tmpfs['/var/lib/postgresql/data']);
assert.equal(inspection.Mounts.find(m=>m.Destination==='/backup.dump').RW,false);
const fingerprintSql=`CREATE TEMP TABLE v3_fingerprints(schema_name text,table_name text,row_count bigint,digest text);
DO $hash$ DECLARE t record; BEGIN
 FOR t IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p') LOOP
 EXECUTE format('INSERT INTO v3_fingerprints SELECT %L,%L,count(*),md5(coalesce(string_agg(s, chr(10) ORDER BY s), '''')) FROM (SELECT to_jsonb(x)::text s FROM %I.%I x) a',t.nspname,t.relname,t.nspname,t.relname);
 END LOOP;
END $hash$;
SELECT jsonb_build_object('tables',count(*),'rows',sum(row_count),'digest',md5(jsonb_agg(to_jsonb(t) ORDER BY schema_name,table_name)::text)) FROM v3_fingerprints t;`;
const dataBefore=json(fingerprintSql);
const ledgerCount=()=>Number(sql('SELECT count(*) FROM supabase_migrations.schema_migrations;'));
const ledgerHash=()=>sql('SELECT md5(jsonb_agg(to_jsonb(l) ORDER BY version)::text) FROM supabase_migrations.schema_migrations l;');
const catalog=()=>json(`SELECT jsonb_agg(jsonb_build_object('oid',oid,'name',proname,'definition',pg_get_functiondef(oid),'owner',proowner,'acl',proacl::text,'config',proconfig,'security_definer',prosecdef,'volatility',provolatile,'parallel',proparallel,'comment',obj_description(oid,'pg_proc')) ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'quote_scenario_%';`);
const protections=()=>json(`SELECT jsonb_build_object('policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='public'), 'rls',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text) ORDER BY c.oid) FROM pg_class c WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p')));`);
try {
 if(process.argv[2]==='prepare'){
  assert.equal(ledgerCount(),198);
  assert.deepEqual(json(old('export-restore-verify.sql')),JSON.parse(old('export-restore-results-20260915.json')).local);
  const saved=JSON.parse(old('catalog-v1-before-E0ter.json')).result.rows[0].report;
  const actual=json(old('preflight-3-v2.sql'));
  const normalize=c=>c.map(({oid,owner,...rest})=>rest).sort((a,b)=>a.signature.localeCompare(b.signature));
  assert.equal(actual.ok,true);assert.deepEqual(normalize(actual.catalog),normalize(saved.catalog));
  assert.deepEqual([...actual.checks].sort((a,b)=>a.name.localeCompare(b.name)),[...saved.checks].sort((a,b)=>a.name.localeCompare(b.name)));
  const ack=(s,name,value)=>{assert.equal((s.match(/^BEGIN;$/gm)||[]).length,1);return s.replace(/^BEGIN;$/m,'BEGIN;\nSET LOCAL '+name+'='+q(value)+';');};
  for(const [name,setting,value] of [['option-b-execution-DRAFT.sql','dcq.option_b_ack','REVIEWED_OPTION_B_EXECUTION_NOT_HISTORICAL_PROOF'],['execution-E1-DRAFT.sql','dcq.e_ack','REVIEWED_SCENARIO_E_20260915'],['execution-E2-DRAFT.sql','dcq.e_ack','REVIEWED_SCENARIO_E_20260915']]){
   sql(ack(old(name),setting,value));assert.deepEqual(json(fingerprintSql),dataBefore);steps.push({name,ledger:ledgerCount(),sourceSha256:sha(old(name))});
  }
  let e3=old('execution-E3-DRAFT.sql');
  const pairs=[[q(JSON.stringify(saved.catalog))+'::jsonb',q(JSON.stringify(actual.catalog))+'::jsonb'],
   ["report->'checks' IS DISTINCT FROM ("+q(JSON.stringify(saved.checks))+'::jsonb)',"report->'checks' IS DISTINCT FROM ("+q(JSON.stringify(actual.checks))+'::jsonb)'],
   ['IS DISTINCT FROM ('+q(saved.catalog.find(x=>x.signature==='quote_scenario_scope_violation(jsonb)').oid)+')','IS DISTINCT FROM ('+q(actual.catalog.find(x=>x.signature==='quote_scenario_scope_violation(jsonb)').oid)+')']];
  for(const [from,to] of pairs){assert.equal(e3.split(from).length,2);e3=e3.replace(from,()=>to);}
  sql(ack(e3,'dcq.e_ack','REVIEWED_SCENARIO_E_20260915'));assert.equal(ledgerCount(),202);assert.deepEqual(json(fingerprintSql),dataBefore);
  steps.push({name:'E3',ledger:202,localOidAdaptationOnly:true,sourceSha256:sha(old('execution-E3-DRAFT.sql'))});
 } else if(process.argv[2]==='validate') {
  assert.equal(ledgerCount(),202,'Use a freshly prepared restore, never redeliver a rolled-back version');
  const baselineCatalog=catalog(),baselineProtections=protections();
  const migration=read('supabase/migrations/20260915150000_scenario_pad_v3.sql');
  assert.equal((migration.match(/^commit;$/gm)||[]).length,1);
  sql(migration.replace(/^commit;$/m,()=>`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20260915150000','scenario_pad_v3',ARRAY[${q(migration)}]);\ncommit;`));
  const entry=baselineCatalog.find(p=>p.name==='quote_scenario_scope_violation');
  const actual=catalog().find(p=>p.name===entry.name);
  assert.deepEqual({...actual,definition:entry.definition},entry);
  sql(migration);assert.equal(ledgerCount(),203);assert.deepEqual(protections(),baselineProtections);assert.deepEqual(json(fingerprintSql),dataBefore);
  steps.push({name:'migration/replay',status:'PASS',ledger:203,allDataUnchanged:true});
  sql(read('supabase/tests/scenario_pad_v3.sql').split('\\endif')[1]);
  const fixture=read('supabase/tests/scenario_pad_v3_full.sql');
  assert.equal((fixture.match(/^begin;$/gm)||[]).length,1);assert.equal((fixture.match(/^rollback;$/gm)||[]).length,1);
  const fixtureBody=fixture.replace(/^begin;\r?\n/m,'').replace(/^rollback;$/m,'');
  sql(fixture);assert.deepEqual(json(fingerprintSql),dataBefore);
  steps.push({name:'real RPCs and permissions on full restored schema',status:'PASS',allDataUnchanged:true});
  // Test-derived pins exercise the mechanism ONLY; not reviewed Cloud deployment pins.
  const pins=json("SELECT jsonb_build_object('entry',encode(sha256(convert_to(pg_get_functiondef('public.quote_scenario_scope_violation(jsonb)'::regprocedure),'UTF8')),'hex'),'helper',encode(sha256(convert_to(pg_get_functiondef('public.quote_scenario_scope_v2_violation(jsonb)'::regprocedure),'UTF8')),'hex'));");
  const rollback=read('supabase/rollbacks/20260915150000_scenario_pad_v3.sql');
  const settings=`SET dcq.pad_v3_rollback_ack='REVIEWED_PAD_V3_ROLLBACK'; SET dcq.pad_v3_scope_sha256=${q(pins.entry)}; SET dcq.pad_v3_helper_sha256=${q(pins.helper)};\n`;
  const beforeRollback=ledgerHash(), v3Catalog=catalog();
  sql(rollback,'PAD_V3_ROLLBACK_ACK_REQUIRED');
  sql(settings+"SET dcq.pad_v3_scope_sha256='wrong';\n"+rollback,'PAD_V3_ROLLBACK_CATALOG_DRIFT');
  sql(settings+"SET dcq.pad_v3_helper_sha256='wrong';\n"+rollback,'PAD_V3_ROLLBACK_CATALOG_DRIFT');
  sql(settings+rollback.replace(/^begin;$/m,()=>'begin;\n'+fixtureBody),'PAD_V3_ROWS_PRESENT');
  assert.equal(ledgerHash(),beforeRollback);assert.deepEqual(catalog(),v3Catalog);assert.deepEqual(json(fingerprintSql),dataBefore);
  steps.push({name:'rollback refused without ACK, on drift and with v3 rows',status:'PASS',atomicity:true});
  sql(settings+rollback);assert.deepEqual(catalog(),baselineCatalog);assert.deepEqual(protections(),baselineProtections);assert.equal(ledgerHash(),beforeRollback);assert.deepEqual(json(fingerprintSql),dataBefore);
  steps.push({name:'rollback at zero v3',status:'PASS',catalogExactlyRestored:true,ledgerRetained:203,allDataUnchanged:true});
 } else throw new Error('Use prepare or validate');
 console.log(JSON.stringify({status:'PASS_LOCAL_ONLY',phase:process.argv[2],container,dataBefore,steps,limits:['archive from 2026-09-15 09:27, not fresh Cloud state','No HTTP/Auth session or Lovable acceptance test','No Cloud writes','No data rows emitted']},null,2));
} catch(e) {console.error(JSON.stringify({status:'FAIL_LOCAL_ONLY',error:e.code||e.name,location:e.stack?.split('\n').find(s=>s.includes('scenario-pad-v3-integration.mjs:')),steps}));process.exitCode=1;}
