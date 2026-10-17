// Isolated native PostgreSQL; fictitious actors, no host mounts/network/published ports.
const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path');
const repo=path.resolve(__dirname,'../..'),args=process.platform==='win32'?['--context','desktop-linux']:[],results=[];let container;
const docker=(a,input)=>cp.execFileSync('docker',[...args,...a],{input,encoding:'utf8',windowsHide:true,timeout:25000});
const sql=s=>docker(['exec','-i',container,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'],s).trim();
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,u=id(1),u2=id(2),u3=id(3),u4=id(4),c=id(10),thread=id(11),attachment=id(12),run=id(13),r1=id(20),r2=id(21);
const q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';
const settings=(role='service_role',user=u)=>`SET request.jwt.claim.role=${q(role)};SET request.jwt.claim.sub=${q(user)};`;
function check(name,f){f();results.push({name,status:'PASS'});}
function refused(s,pattern){let error;try{sql(s);}catch(e){error=String(e.stderr||e.message);}assert(error,'Unexpected SQL success');assert.match(error,pattern);}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function session(name,body){const p=cp.spawn('docker',[...args,'exec','-i',container,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',d=>stdout+=d);p.stderr.on('data',d=>stderr+=d);const done=new Promise(resolve=>p.on('close',code=>resolve({code,stdout,stderr})));p.stdin.end(settings()+`SET application_name=${q(name)};`+body);return done;}
async function wait(name,kind){for(let i=0;i<60;i++){const values=JSON.parse(sql(`SELECT COALESCE(json_agg(json_build_object('type',wait_event_type,'wait',wait_event)),'[]') FROM pg_stat_activity WHERE application_name=${q(name)}`));if(values.some(v=>kind==='sleep'?v.wait==='PgSleep':v.type==='Lock'))return;await delay(70);}throw Error('No actual overlap '+name);}
(async()=>{try{
 container=docker(['run','--detach','--rm','--pull=never','--network','none','--tmpfs','/var/lib/postgresql/data:rw,nosuid,size=256m','--tmpfs','/var/run/postgresql:rw,nosuid,size=16m','--env','POSTGRES_HOST_AUTH_METHOD=trust','postgres:15-alpine','postgres','-c','listen_addresses=']).trim();
 for(let i=0;i<40;i++){try{sql('SELECT 1');break;}catch(e){if(i===39)throw e;await delay(150);}}
 const isolation=JSON.parse(docker(['inspect',container,'--format','{{json .HostConfig}}']));assert.equal(isolation.NetworkMode,'none');assert(!isolation.Binds?.length);assert(!Object.keys(isolation.PortBindings||{}).length);
 sql(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,banned_until timestamptz);
 CREATE TABLE app_roles(user_id uuid,role text,CONSTRAINT app_roles_role_check CHECK(role IN('role_admin','workspace_operator')));
 CREATE TABLE quote_cases(id uuid PRIMARY KEY,created_by uuid,assigned_to uuid,status text,request_type text,thread_id uuid);
 CREATE TABLE quote_facts(id uuid PRIMARY KEY,case_id uuid REFERENCES quote_cases(id),fact_key text,value_text text,value_number numeric,value_json jsonb,is_current boolean DEFAULT true);
 CREATE TABLE quote_request_lines(id uuid PRIMARY KEY,case_id uuid REFERENCES quote_cases(id));
 CREATE TABLE emails(id uuid PRIMARY KEY,thread_ref uuid);CREATE TABLE email_attachments(id uuid PRIMARY KEY,email_id uuid REFERENCES emails(id),filename text,extracted_data jsonb);
 CREATE TABLE hs_codes(code_normalized text PRIMARY KEY,tax_profile_status text,tax_evidence jsonb);
 CREATE TABLE customs_regimes(code text PRIMARY KEY,is_active boolean);
 CREATE TABLE pricing_runs(id uuid PRIMARY KEY,case_id uuid,created_by uuid,engine_request jsonb,engine_response jsonb,outputs_json jsonb,status text);
 CREATE TABLE case_timeline_events(id uuid DEFAULT gen_random_uuid(),case_id uuid,event_type text,event_data jsonb,actor_type text,actor_user_id uuid);
 INSERT INTO auth.users VALUES('${u}',NULL),('${u2}',NULL),('${u3}',NULL),('${u4}',now()+interval '1 day');
 INSERT INTO app_roles VALUES('${u}','workspace_operator'),('${u2}','workspace_operator'),('${u4}','workspace_operator');
 INSERT INTO quote_cases VALUES('${c}','${u}',NULL,'QUOTED_VERSIONED','AIR_IMPORT','${thread}');
 INSERT INTO quote_facts(id,case_id,fact_key,value_text) VALUES('${id(30)}','${c}','service.package','AIR_IMPORT_DDP'),('${id(31)}','${c}','routing.incoterm','DDP');
 INSERT INTO emails VALUES('${id(32)}','${thread}');INSERT INTO email_attachments VALUES('${attachment}','${id(32)}','SYNTHETIC.pdf','{"extracted_info":{"hs_code":"3004.9099","payment_terms":"FOC"}}');
 INSERT INTO hs_codes VALUES('3004909000','unknown',NULL);INSERT INTO customs_regimes VALUES('TEST',true);
 GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;`);
 const security=fs.readFileSync(path.join(repo,'supabase/migrations/20261007120000_internal_workspace_access.sql'),'utf8').split('-- RESTRICTIVE')[0];sql(security+'\nCOMMIT;');
 const commercial=fs.readFileSync(path.join(repo,'supabase/migrations/20261017120000_commercial_revisions.sql'),'utf8');
 for(const name of ['commercial_actor_guard','commercial_immutable']){const match=commercial.match(new RegExp('CREATE FUNCTION public\\.'+name+'\\([\\s\\S]*?END; \\$\\$;'));assert(match,name);sql(match[0]);}
 sql(fs.readFileSync(path.join(repo,'supabase/migrations/20261017160000_customs_basis.sql'),'utf8'));
 const decision={source_attachment_ids:[attachment],caf_xof:100000,valuation_basis:'SYNTHETIC operator retained CAF and FX evidence',hs_digits:'3004909000',regime_code:'TEST',exemptions_reviewed:true,commitment:'estimated',note:'SYNTHETIC private note'};
 const read=()=>JSON.parse(sql(settings('authenticated')+`SELECT customs_basis_read('${c}');`));
 let state=read();const oldFacts=sql('SELECT md5(jsonb_agg(to_jsonb(f) ORDER BY id)::text) FROM quote_facts f');
 const save=(id,parent=null,d=decision,hash=state.context_hash,actor=u)=>`SELECT customs_basis_store('${actor}','${c}','${id}',${parent?q(parent):'NULL'},${q(hash)},${j(d)});`;
 check('Existing admission/ownership and client ACL preserved',()=>{
  for(const actor of [u3,u4])refused(settings('authenticated',actor)+`SELECT customs_basis_read('${c}');`,/forbidden/);
  for(const actor of [u2,u3,u4])refused(settings()+save(r1,null,decision,state.context_hash,actor),/forbidden/);
  refused(settings('anon')+`SET ROLE anon;SELECT customs_basis_read('${c}');`,/permission denied/);
  refused(settings('authenticated')+`SET ROLE authenticated;`+save(r1),/permission denied/);
  refused(settings('authenticated')+`SET ROLE authenticated;INSERT INTO quote_customs_basis(id) VALUES('${r1}');`,/permission denied/);
 });
 check('Atomic adoption, actor trace and exact replay append only once, without fact promotion',()=>{
  const row=JSON.parse(sql(settings()+save(r1)));assert.equal(row.created_by,u);assert.equal(row.revision,1);
  assert.deepEqual(JSON.parse(sql(settings()+save(r1))),row);assert.equal(sql('SELECT count(*) FROM quote_customs_basis'),'1');assert.equal(sql("SELECT count(*) FROM case_timeline_events WHERE event_type='customs_basis_adopted'"),'1');
  assert.equal(sql('SELECT md5(jsonb_agg(to_jsonb(f) ORDER BY id)::text) FROM quote_facts f'),oldFacts);
  refused(settings()+save(r1,null,{...decision,caf_xof:1}),/replay mismatch/);
 });
 check('Closed SQL shape, nulls, negative/unknown money and cross-case sources are refused without mutation',()=>{
  for(const bad of [{...decision,actor_id:u},{...decision,caf_xof:null},{...decision,caf_xof:-1},{...decision,hs_digits:null},{...decision,commitment:null},{...decision,source_attachment_ids:[id(99)]},{...decision,source_attachment_ids:[attachment,attachment]}])refused(settings()+save(id(40),r1,bad),/Invalid|source/);
  assert.equal(sql('SELECT count(*) FROM quote_customs_basis'),'1');
 });
 check('Stale parent and changed document/profile/fact contexts cannot be adopted or calculated',()=>{
  refused(settings()+save(r2,null),/decision changed/);
  sql(`UPDATE email_attachments SET filename='SYNTHETIC-changed.pdf' WHERE id='${attachment}'`);refused(settings()+save(r2,r1),/sources changed/);
  refused(settings()+`SELECT customs_basis_get('${u}','${c}','${r1}');`,/sources changed/);
  assert.equal(JSON.parse(sql(settings()+save(r1))).id,r1); // exact old replay still succeeds
  state=read();sql(settings()+save(r2,r1));
  refused(settings()+`SELECT customs_basis_get('${u}','${c}','${r1}');`,/decision changed/);
 });
 check('Append-only ledger cannot be updated/deleted; failed timeline insert rolls back adoption',()=>{
  refused(`UPDATE quote_customs_basis SET decision='{}' WHERE id='${r1}'`,/Append-only/);refused(`DELETE FROM quote_customs_basis WHERE id='${r1}'`,/Append-only/);
  sql("ALTER TABLE case_timeline_events ADD CONSTRAINT synthetic_timeline_failure CHECK(event_type<>'customs_basis_adopted') NOT VALID");
  refused(settings()+save(id(41),r2),/synthetic_timeline_failure/);assert.equal(sql('SELECT count(*) FROM quote_customs_basis'),'2');sql('ALTER TABLE case_timeline_events DROP CONSTRAINT synthetic_timeline_failure');
 });
 const held=session('customs-save-held',`BEGIN;${save(id(42),r2)}SELECT pg_sleep(1.4);COMMIT;`);await wait('customs-save-held','sleep');
 const competing=session('customs-save-competing',save(id(43),r2));await wait('customs-save-competing','lock');
 assert.equal((await held).code,0);const conflict=await competing;assert.notEqual(conflict.code,0);assert.match(conflict.stderr,/decision changed/);results.push({name:'Actual overlapping CAS adopters serialize; loser rejected',status:'PASS'});
 const h=JSON.parse(sql(settings()+`SELECT customs_basis_get('${u}','${c}','${id(42)}')`)).head;
 const basis={schema_version:1,...h,assessment:{eligible:true},sources:[]};
 const request={customs_basis_ref:{id:h.id,caseId:c},customs_basis:basis};const response={customs_basis:basis};
 check('Pricing completion pins identical request/response/output proof atomically and protects legacy rows',()=>{
  sql(`INSERT INTO pricing_runs VALUES('${run}','${c}','${u}',${j(request)},${j(response)},'{}','running');`);
  sql(settings()+`UPDATE pricing_runs SET outputs_json=${j({customs_basis:basis})},status='success' WHERE id='${run}';`);
  refused(settings()+`UPDATE pricing_runs SET outputs_json=${j({customs_basis:{...basis,decision:{...decision,caf_xof:1}}})} WHERE id='${run}';`,/Immutable/);
  for(const column of ['outputs_json','engine_request','engine_response'])refused(settings()+`UPDATE pricing_runs SET ${column}='{}' WHERE id='${run}';`,/Immutable/);
  sql(`INSERT INTO pricing_runs VALUES('${id(14)}','${c}','${u}','{}','{}','{"legacy":true}','success');`);
 });
 const finishing=session('customs-finish-held',`BEGIN;UPDATE pricing_runs SET outputs_json=${j({customs_basis:basis})} WHERE id='${run}';SELECT pg_sleep(1.4);COMMIT;`);await wait('customs-finish-held','sleep');
 const sourceUpdate=session('customs-source-change',`UPDATE hs_codes SET tax_profile_status='verified' WHERE code_normalized='3004909000';`);await wait('customs-source-change','lock');
 assert.equal((await finishing).code,0);assert.equal((await sourceUpdate).code,0);
 refused(settings()+`UPDATE pricing_runs SET outputs_json=${j({customs_basis:basis})} WHERE id='${run}';`,/sources changed/);
 assert.equal(sql(`SELECT outputs_json->>'legacy' FROM pricing_runs WHERE id='${id(14)}'`),'true');results.push({name:'Source edits serialize behind successful completion; later stale completion refused, legacy untouched',status:'PASS'});
 check('Locked/sent case refuses new adoption and banned actor cannot read retained basis',()=>{
  state=read();sql(`UPDATE quote_cases SET status='SENT' WHERE id='${c}';`);refused(settings()+save(id(44),id(42)),/Case locked/);
  sql(`UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${u}';`);refused(settings()+`SELECT customs_basis_get('${u}','${c}','${h.id}')`,/forbidden/);
 });
 console.log(JSON.stringify({status:'PASS',postgres:sql('SHOW server_version'),groups:results,isolation:{network:'none',ports:0,host_mounts:0},auth:'Actual admission and ownership predicates; fictitious local JWT claim functions, no real account'},null,2));
}catch(error){console.error(error.stack||error);process.exitCode=1;}finally{if(container)docker(['rm','--force',container]);}})();
