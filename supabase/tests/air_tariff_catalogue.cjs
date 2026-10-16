// Run with node supabase/tests/air_tariff_catalogue.cjs. Requires an existing local postgres:15-alpine image; never pulls, publishes ports, mounts host data or connects to Cloud.
const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict');
const path=require('node:path'),os=require('node:os');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'dcq-air-tariff-sql-')),repo=path.resolve(__dirname,'../..'),dockerArgs=process.platform==='win32'?['--context','desktop-linux']:[];let container;const results=[];
const docker=(args,input)=>cp.execFileSync('docker',[...dockerArgs,...args],{input,encoding:'utf8',windowsHide:true,timeout:20000});
const sql=s=>docker(['exec','-i',container,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d','air_fixture'],s).trim();
const uid='11111111-1111-4111-8111-111111111111',cid='22222222-2222-4222-8222-222222222222',s1='33333333-3333-4333-8333-333333333333',s2='44444444-4444-4444-8444-444444444444',run='55555555-5555-4555-8555-555555555555';
const seed='a2a50000-1016-4000-8000-000000000001',cat='a2a50000-1016-4000-8000-000000000002';
const settings=`SET test.uid='${uid}';SET test.admitted='true';SET test.admin='true';SET test.case_access='true';SET test.role='service_role';`;
const quote=x=>"'"+String(x).replaceAll("'","''")+"'",json=x=>quote(JSON.stringify(x))+'::jsonb';
const check=(name,f)=>{f();results.push({name,status:'PASS'});};
function refused(s,pattern){try{sql(settings+s);throw Error('Unexpected SQL success');}catch(e){assert.match(String(e.stderr||e.message),pattern);}}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function session(name,body){const p=cp.spawn('docker',[...dockerArgs,'exec','-i',container,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d','air_fixture'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',d=>stdout+=d);p.stderr.on('data',d=>stderr+=d);const done=new Promise(r=>p.on('close',code=>r({code,stdout,stderr})));p.stdin.end(settings+`SET application_name='${name}';`+body);return done;}
async function wait(name,kind){for(let i=0;i<40;i++){const rows=JSON.parse(sql(`SELECT COALESCE(json_agg(json_build_object('pid',pid,'type',wait_event_type,'wait',wait_event)),'[]') FROM pg_stat_activity WHERE application_name='${name}'`));if(rows.some(r=>kind==='sleep'?r.wait==='PgSleep':r.type==='Lock'))return rows;await delay(100);}throw Error('No real overlap '+name);}
(async()=>{try{
 container=docker(['run','--detach','--rm','--pull=never','--name','dcq-air-full-'+Date.now(),'--network','none','--tmpfs','/var/lib/postgresql/data:rw,nosuid,size=256m','--tmpfs','/var/run/postgresql:rw,nosuid,size=16m','--env','POSTGRES_HOST_AUTH_METHOD=trust','--env','POSTGRES_DB=air_fixture','postgres:15-alpine','postgres','-c','listen_addresses=']).trim();
 for(let i=0;i<30;i++){try{sql('SELECT 1');break;}catch(e){if(i===29)throw e;await delay(200);}}
 const isolation=JSON.parse(docker(['inspect',container,'--format','{{json .HostConfig}}']));assert.equal(isolation.NetworkMode,'none');assert(!Object.keys(isolation.PortBindings||{}).length);assert(!isolation.Binds?.length);
 const baseTemplate="CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;\n CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES('${user}');\n CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid',true),'')::uuid $$;\n CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('test.role',true) $$;\n CREATE FUNCTION public.has_workspace_access() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('test.admitted',true)='true' $$;\n CREATE FUNCTION public.has_tariff_admin_role() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('test.admin',true)='true' $$;\n CREATE FUNCTION public.has_case_write_access(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('test.case_access',true)='true' $$;\n CREATE TYPE quote_request_type AS ENUM('AIR_IMPORT');\n CREATE TABLE quote_cases(id uuid PRIMARY KEY,request_type quote_request_type,status text);\n CREATE TABLE quote_facts(id uuid PRIMARY KEY,case_id uuid,fact_key text,is_current boolean,value_number numeric,source_type text,is_validated boolean);\n CREATE TABLE quote_request_lines(id uuid PRIMARY KEY,case_id uuid,description text);\n CREATE TABLE pricing_runs(id uuid PRIMARY KEY,case_id uuid,status text,engine_request jsonb,engine_response jsonb,outputs_json jsonb,tariff_lines jsonb,total_ht numeric,total_ttc numeric,currency text,tariff_sources jsonb,completed_at timestamptz,duration_ms int);\n INSERT INTO quote_cases VALUES('${caseId}','AIR_IMPORT','NEED_INFO');\n INSERT INTO quote_facts VALUES('66666666-6666-4666-8666-666666666666','${caseId}','cargo.chargeable_weight_kg',true,64,'operator',true);\n GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role; GRANT SELECT ON quote_cases,quote_facts,quote_request_lines TO authenticated;\n SET test.uid='${user}'; SET test.admitted='true'; SET test.admin='true'; SET test.case_access='true'; SET test.role='authenticated';";
 const base=baseTemplate.replaceAll('${user}',uid).replaceAll('${caseId}',cid);sql(base);
 sql('ALTER TABLE quote_facts ADD FOREIGN KEY(case_id) REFERENCES quote_cases(id);ALTER TABLE quote_request_lines ADD FOREIGN KEY(case_id) REFERENCES quote_cases(id);ALTER TABLE pricing_runs ADD inputs_json jsonb;');
 for(const file of ['20261016110000_air_handling_profiles.sql','20261016120000_air_handling_request_type_cast.sql','20261016160000_air_tariff_catalogue.sql'])sql(fs.readFileSync(repo+'/supabase/migrations/'+file,'utf8'));
 results.push({name:'Three migrations, real PostgreSQL15 enum/FKs and full180 seed',status:'PASS'});
 const payload=JSON.parse(sql(`SELECT payload FROM air_tariff_catalogues WHERE id='${cat}'`));assert.equal(payload.entries.length,180);
 const basis={general_cargo_confirmed:true,warehouse_bracket_confirmed:true,ordinary_storage:{enabled:true,tariff_key:'storage_0',weight_fact_id:'66666666-6666-4666-8666-666666666666',billable_days:2,days_status:'confirmed',source_reference:'Synthetic documentary weight and days'}};
 const ctx=sql(`SELECT air_handling_context_hash('${cid}')`);
 const bind=(id,expected,catalog=cat,b=basis)=>`SELECT air_tariff_select('${id}','${cid}',${expected?quote(expected):'NULL'},'${catalog}',${json(b)},'Synthetic explicit source for full catalogue','${ctx}');`;
 const legacy=(id,expected)=>`SELECT air_handling_select('${id}','${cid}',${expected?quote(expected):'NULL'},'${seed}','Synthetic old profile source',true,'${ctx}');`;
 check('Anonymous, non-admitted, non-admin and non-owner writes refused',()=>{
  refused(`SET ROLE anon;SELECT air_tariff_read(NULL);`,/permission denied/);
  refused(`SET test.admitted='false';SELECT air_tariff_read(NULL);`,/Workspace admission/);
  refused(`SET test.admin='false';SELECT air_tariff_publish(gen_random_uuid(),'${cat}',${json(payload)},CURRENT_DATE,NULL,'Synthetic revision source');`,/Tariff administration/);
  refused(`SET test.case_access='false';${bind(s1,null)}`,/Case not editable/);
 });
 check('Null, malformed and duplicate entries rejected by SQL validator',()=>{
  for(const [k,v] of [['qualification',null],['unit',null],['section',null],['source',null],['code',12],['value',-1]]){const p=structuredClone(payload);p.entries[0][k]=v;assert.equal(sql(`SELECT air_tariff_payload_valid(${json(p)})`),'f',k);}
  const p=structuredClone(payload);p.entries[1].key=p.entries[0].key;assert.equal(sql(`SELECT air_tariff_payload_valid(${json(p)})`),'f');
 });
 check('Full revision saves all categories, ambiguous known rates and source provenance; idempotency and parent CAS',()=>{
  const p=structuredClone(payload);for(const section of new Set(p.entries.map(e=>e.section))){const e=p.entries.find(e=>e.section===section);e.value=123;e.condition+=' ; test edited condition';}
  const id='77777777-7777-4777-8777-777777777777',publish=`SELECT air_tariff_publish('${id}','${cat}',${json(p)},CURRENT_DATE,NULL,'Synthetic all categories revised source');`;
  sql(settings+publish);sql(settings+publish);const saved=JSON.parse(sql(`SELECT payload FROM air_tariff_catalogues WHERE id='${id}'`));assert.deepEqual(saved,p);assert.deepEqual(JSON.parse(sql(`SELECT payload FROM air_tariff_catalogues WHERE id='${cat}'`)),payload);
  refused(`SELECT air_tariff_publish(gen_random_uuid(),'${cat}',${json(payload)},CURRENT_DATE,NULL,'Synthetic stale revision source');`,/Catalogue revision changed/);
  refused(`UPDATE air_tariff_catalogues SET source_reference='changed' WHERE id='${cat}';`,/Append-only/);
 });
 check('One canonical generation, v2 read, replay and stale-CAS refusal',()=>{
  sql(settings+bind(s1,null));sql(settings+bind(s1,null));const r=JSON.parse(sql(settings+`SELECT air_tariff_read('${cid}')`));assert.equal(r.catalogue.id,cat);assert.deepEqual(r.basis,basis);assert.equal(r.selection.version,1);
  refused(bind(s2,null),/generation or context/);refused(`SELECT air_handling_read('${cid}');`,/requires current runtime/);
 });
 const catalogue=JSON.parse(sql(`SELECT to_jsonb(c) FROM air_tariff_catalogues c WHERE id='${cat}'`));
 const evidence={schema_version:2,selection_id:s1,context_hash:ctx,catalogue,basis,profile:null,components:[],supplier_tax_xof:null,supplier_ttc_xof:null,selling_amount_xof:null};
 const result={status:'success',engine_request:{},engine_response:{},outputs_json:{},tariff_lines:[{amount:null,source:{type:'TO_CONFIRM',air_handling:evidence}}],total_ht:0,total_ttc:0,currency:'XOF',tariff_sources:[],completed_at:new Date().toISOString(),duration_ms:1};
 const finish=(e=evidence,r=result)=>`SELECT air_tariff_finish('${run}','${cid}','${e.selection_id}','${e.context_hash}',${json(r)});`;
 sql(settings+`INSERT INTO pricing_runs(id,case_id,status,inputs_json) VALUES('${run}','${cid}','running',${json({airHandling:evidence})});`);
 check('Old worker without v2 inputs cannot persist a successful result',()=>refused(`UPDATE pricing_runs SET status='success',inputs_json='{}',tariff_lines='[]' WHERE id='${run}';`,/generation or context/));
 check('Altered full catalogue/bases and supplier-to-selling injection rejected',()=>{
  for(const change of ['catalogue','basis','amount']){const r=structuredClone(result);if(change==='amount')r.tariff_lines[0].amount=999;else if(change==='basis')r.tariff_lines[0].source.air_handling.basis.ordinary_storage.billable_days=3;else r.tariff_lines[0].source.air_handling.catalogue.payload.entries[0].value=999;refused(finish(evidence,r),/evidence differs/);}
 });
 check('Valid atomic finish succeeds without rewriting catalogue/selection',()=>{sql(settings+finish());assert.equal(sql(`SELECT status FROM pricing_runs WHERE id='${run}'`),'success');});
 check('v2→v1 explicit return changes canonical head and rejects stale v2 finish',()=>{
  sql(`UPDATE pricing_runs SET status='running' WHERE id='${run}';`);sql(settings+legacy(s2,s1));assert.equal(JSON.parse(sql(settings+`SELECT air_tariff_read('${cid}')`)).catalogue,null);refused(finish(),/generation or context/);
 });
 const s3='88888888-8888-4888-8888-888888888888';
 check('v1→v2 generation rejects old v1 finish',()=>{
  sql(settings+bind(s3,s2));const oldprofile=JSON.parse(sql(`SELECT to_jsonb(p) FROM air_handling_profiles p WHERE id='${seed}'`));const oldresult={...result,tariff_lines:[{amount:null,source:{type:'TO_CONFIRM',air_handling:{selection_id:s2,context_hash:ctx,profile:oldprofile}}}]};
  refused(`SELECT air_handling_finish('${run}','${cid}','${s2}','${ctx}',${json(oldresult)});`,/Handling context changed/);
 });
 evidence.selection_id=s3;result.tariff_lines[0].source.air_handling=evidence;
 sql(`UPDATE pricing_runs SET inputs_json=${json({airHandling:evidence})} WHERE id='${run}';`);
 // Real overlapping sessions, not a sequential simulation of concurrency.
 const writer=session('full-air-writer',`BEGIN;UPDATE quote_facts SET value_number=65 WHERE case_id='${cid}';SELECT pg_sleep(3);COMMIT;`);const writerWait=await wait('full-air-writer','sleep');
 const finishing=session('full-air-finish',finish());const finishingWait=await wait('full-air-finish','lock');const [w,f]=await Promise.all([writer,finishing]);assert.equal(w.code,0);assert.notEqual(f.code,0);assert.match(f.stderr,/generation or context changed/);
 results.push({name:'Concurrent existing-fact writer: finish waits then refuses changed context',status:'PASS',waits:[writerWait,finishingWait]});
 sql(`UPDATE quote_facts SET value_number=64 WHERE case_id='${cid}';CREATE FUNCTION fixture_delay()RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='success' THEN PERFORM pg_sleep(3);END IF;RETURN NEW;END;$$;CREATE TRIGGER zz_fixture_delay BEFORE UPDATE ON pricing_runs FOR EACH ROW EXECUTE FUNCTION fixture_delay();`);
 const done=session('full-air-finish-first',finish());const a=await wait('full-air-finish-first','sleep');const late=session('full-air-late-writer',`UPDATE quote_facts SET value_number=66 WHERE case_id='${cid}';`);const b=await wait('full-air-late-writer','lock');const [d,l]=await Promise.all([done,late]);assert.equal(d.code,0,d.stderr);assert.equal(l.code,0,l.stderr);
 results.push({name:'Writer after final hash blocked through successful result commit',status:'PASS',waits:[a,b]});
 const report={status:'PASS',database:sql('SELECT version()'),scope:'Synthetic accounts/data, real PostgreSQL enums/FKs/ACL/RLS and overlapping locks. Auth admission helpers stubbed; no real credentials or remote connection.',results};fs.writeFileSync(out+'/native-catalogue.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,evidence_directory:out}));
}catch(e){fs.writeFileSync(out+'/native-catalogue-failure.txt',String(e.stack)+'\n'+String(e.stderr||''));throw e;}finally{if(container){docker(['stop',container]);fs.writeFileSync(out+'/native-catalogue-cleanup.json',JSON.stringify({container_removed:true,container}));}}})();
