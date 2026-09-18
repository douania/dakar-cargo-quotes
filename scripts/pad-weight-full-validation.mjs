// Local offline restored-schema validation. Never prints private database rows.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync,spawn} from 'node:child_process';
const container='dcq-pad-v3-full-20260915', database='pad_v3_full_weight';
const prior='C:/Users/DELL/AppData/Local/Temp/dcq-claude-review-20260914-cloud24/preparation-locale';
const read=p=>fs.readFileSync(p,'utf8');
const q=s=>"'"+s.replaceAll("'","''")+"'";
const inspection=JSON.parse(spawnSync('docker',['inspect',container],{encoding:'utf8'}).stdout)[0];
assert.equal(inspection.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(inspection.HostConfig.PortBindings||{}).length,0);
assert.equal(inspection.Mounts.find(m=>m.Destination==='/backup.dump').RW,false);
function sql(s){
 const r=spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse'],
 {input:'SET search_path=public,extensions;\n'+s,encoding:'utf8',maxBuffer:16*1024*1024});
 if(r.status!==0)throw new Error((r.stderr||'').split('\n').find(l=>l.includes('ERROR:'))||'LOCAL_SQL_FAILED');
 return r.stdout.trim();
}
if(process.argv[2]==='prepare'){
 assert.equal(sql('SELECT count(*) FROM supabase_migrations.schema_migrations;'),'201');
 const saved=JSON.parse(read(prior+'/catalog-v1-before-E0ter.json')).result.rows[0].report;
 const actual=JSON.parse(sql(read(prior+'/preflight-3-v2.sql')));
 const normalize=c=>c.map(({oid,owner,...x})=>x).sort((a,b)=>a.signature.localeCompare(b.signature));
 assert.equal(actual.ok,true);assert.deepEqual(normalize(actual.catalog),normalize(saved.catalog));
 let s=read(prior+'/execution-E3-DRAFT.sql');
 const pairs=[[q(JSON.stringify(saved.catalog))+'::jsonb',q(JSON.stringify(actual.catalog))+'::jsonb'],
  ["report->'checks' IS DISTINCT FROM ("+q(JSON.stringify(saved.checks))+'::jsonb)',"report->'checks' IS DISTINCT FROM ("+q(JSON.stringify(actual.checks))+'::jsonb)'],
  ['IS DISTINCT FROM ('+q(saved.catalog.find(x=>x.signature==='quote_scenario_scope_violation(jsonb)').oid)+')','IS DISTINCT FROM ('+q(actual.catalog.find(x=>x.signature==='quote_scenario_scope_violation(jsonb)').oid)+')']];
 for(const [a,b] of pairs){assert.equal(s.split(a).length,2);s=s.replace(a,()=>b);}
 sql(s.replace(/^BEGIN;$/m,"BEGIN;\nSET LOCAL dcq.e_ack='REVIEWED_SCENARIO_E_20260915';"));
 console.log('Local E3 prerequisites: PASS');
 for(const file of ['20260915150000_scenario_pad_v3.sql','20260917120000_pad_group_confirmations.sql','20260917180000_pad_weight_basis.sql']){
  sql(read('supabase/migrations/'+file));console.log('Local prerequisite '+file+': PASS');
 }
} else if(process.argv[2]==='migrate') {
 sql(read('supabase/migrations/20260918120000_pad_weight_reconciliation.sql'));
 console.log('Full-schema migration: PASS');
} else if(process.argv[2]==='test') {
 sql(read('supabase/tests/pad_weight_reconciliation_full.sql'));
 console.log('Full-schema synthetic fixture: PASS (rolled back)');
} else if(process.argv[2]==='concurrency') {
 assert.equal(sql("SELECT count(*) FROM auth.users WHERE email='weight-full@example.invalid'"),'0','Do not overwrite an existing fixture');
 const fixture=read('supabase/tests/pad_weight_reconciliation_full.sql');
 assert.equal((fixture.match(/^rollback;$/gm)||[]).length,1);
 // Keep only newly created synthetic rows in this offline disposable database
 // so two sessions can contend on the same dossier.
 sql(fixture.replace(/^begin;$/m,"begin;\nSET LOCAL dcq.weight_fixture_email='weight-full@example.invalid';").replace(/^rollback;$/m,'commit;'));
 const state=JSON.parse(sql("SELECT public.read_pad_weight_context(c.id) FROM public.quote_cases c JOIN public.email_threads t ON t.id=c.thread_id WHERE t.client_email='weight-full@example.invalid'"));
 const cid=state.case_id, head=state.weight_reconciliation.id;
 const request={action:'revoke',expected_context_hash:state.context_hash,expected_heads:state.heads.map(h=>h.id).sort(),expected_head_id:head,
  idempotency_key:crypto.randomUUID(),justification:'Synthetic concurrent revocation',reservation:'Synthetic commercial weight reserve'};
 const actor=state.weight_reconciliation.decided_by;
 const args=['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse'];
 function session(input){
  const child=spawn('docker',args);let error='';child.stderr.on('data',x=>error+=x);child.stdout.resume();
  const done=new Promise(resolve=>child.on('close',code=>resolve({code,error})));
  child.stdin.end(input);return done;
 }
 const first=session(`SET application_name='weight_race_a'; BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('pad_group:'||${q(cid)},0)); SELECT pg_sleep(3); SELECT public.record_pad_weight_reconciliation(${q(cid)},${q(actor)},${q(JSON.stringify(request))}); COMMIT;`);
 async function waitFor(query){for(let i=0;i<40;i++){if(sql(query)==='1')return;await new Promise(r=>setTimeout(r,50));}throw new Error('Expected concurrent overlap absent');}
 await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='weight_race_a' AND wait_event='PgSleep'");
 const second=session(`SET application_name='weight_race_b'; SELECT public.assert_pad_weight_head(${q(cid)},${q(head)},false);`);
 await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='weight_race_b' AND wait_event_type='Lock'");
 const [a,b]=await Promise.all([first,second]);assert.equal(a.code,0);assert.notEqual(b.code,0);assert(b.error.includes('PAD_WEIGHT_HEAD_CHANGED'));
 assert.equal(sql(`SELECT count(*) FROM public.pad_weight_reconciliations WHERE case_id=${q(cid)}`),'2');
 console.log('Overlapping sessions: revocation serialized; stale head refused PASS. Synthetic rows retained only in disposable offline DB.');
} else throw new Error('Use prepare, migrate or test');
