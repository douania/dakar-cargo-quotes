// Native PostgreSQL, fictitious users only; no network, host mounts or published ports.
const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path');
const repo=path.resolve(__dirname,'../..'),args=process.platform==='win32'?['--context','desktop-linux']:[],results=[];let container;
const docker=(a,input)=>cp.execFileSync('docker',[...args,...a],{input,encoding:'utf8',windowsHide:true,timeout:20000});
const sql=s=>docker(['exec','-i',container,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'],s).trim();
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,u=id(1),u2=id(2),u3=id(3),u4=id(4),c=id(10),run=id(20),v=id(30),r1=id(40),r2=id(41);
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
 CREATE TABLE quote_cases(id uuid PRIMARY KEY,created_by uuid,assigned_to uuid,status text,updated_at timestamptz,request_type text DEFAULT 'AIR_IMPORT');
 CREATE TABLE pricing_runs(id uuid PRIMARY KEY,case_id uuid,status text,run_number integer);
 CREATE TABLE quote_facts(id uuid PRIMARY KEY,case_id uuid REFERENCES quote_cases(id),value text,fact_key text DEFAULT 'cargo.description',is_current boolean DEFAULT true);
 CREATE TABLE quote_request_lines(id uuid PRIMARY KEY,case_id uuid REFERENCES quote_cases(id));
 CREATE TABLE air_handling_selections(id uuid PRIMARY KEY,case_id uuid,version integer);
 CREATE FUNCTION air_handling_context_hash(uuid) RETURNS text LANGUAGE sql STABLE SET search_path=public AS $$SELECT md5(COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY id)::text FROM quote_facts f WHERE case_id=$1),''))$$;
 CREATE TABLE quotation_versions(id uuid PRIMARY KEY,case_id uuid,pricing_run_id uuid,version_number integer,status text,is_selected boolean,snapshot jsonb NOT NULL,created_by uuid,created_at timestamptz DEFAULT now(),source_kind text DEFAULT 'canonical',UNIQUE(case_id,version_number));
 CREATE UNIQUE INDEX uq_qv_selected_per_case ON quotation_versions(case_id) WHERE is_selected;
 CREATE TABLE quotation_version_lines(id uuid DEFAULT gen_random_uuid(),quotation_version_id uuid,line_order integer,service_code text,description text,quantity numeric,unit_price numeric NOT NULL,amount numeric NOT NULL,currency text,breakdown jsonb);
 CREATE TABLE case_timeline_events(id uuid DEFAULT gen_random_uuid(),case_id uuid,event_type text,event_data jsonb,actor_type text,actor_user_id uuid);
 INSERT INTO auth.users VALUES('${u}',NULL),('${u2}',NULL),('${u3}',NULL),('${u4}',now()+interval '1 day');
 INSERT INTO app_roles VALUES('${u}','workspace_operator'),('${u2}','workspace_operator'),('${u4}','workspace_operator');
 INSERT INTO quote_cases(id,created_by,assigned_to,status,updated_at) VALUES('${c}','${u}',NULL,'QUOTED_VERSIONED',now());
 INSERT INTO quote_facts(id,case_id,value) VALUES('${id(69)}','${c}','documentary');
 INSERT INTO pricing_runs VALUES('${run}','${c}','success',1);
 GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;`);
 const security=fs.readFileSync(path.join(repo,'supabase/migrations/20261007120000_internal_workspace_access.sql'),'utf8').split('-- RESTRICTIVE')[0];sql(security+'\nCOMMIT;');
 const airSql=fs.readFileSync(path.join(repo,'supabase/migrations/20261016110000_air_handling_profiles.sql'),'utf8');
 sql(airSql.slice(airSql.indexOf('CREATE FUNCTION public.air_handling_context_hash'),airSql.indexOf('CREATE FUNCTION public.air_handling_read')).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'));
 sql(fs.readFileSync(path.join(repo,'supabase/migrations/20261017120000_commercial_revisions.sql'),'utf8'));
 sql(fs.readFileSync(path.join(repo,'supabase/migrations/20261017123000_commercial_selection_lock.sql'),'utf8'));
 const accessSource=fs.readFileSync(path.join(repo,'supabase/migrations/20261007120000_internal_workspace_access.sql'),'utf8');
 sql(accessSource.slice(accessSource.indexOf('CREATE OR REPLACE FUNCTION public.select_quotation_version'),accessSource.indexOf('-- Locks d’analyse')<0?accessSource.indexOf('-- Locks d\'analyse'):accessSource.indexOf('-- Locks d’analyse')));
 const snapshot={meta:{pricing_run_id:run},totals:{currency:'XOF',subtotal_before_sodatra_vat:100,honoraires_ht:100,honoraires_tva:18,total_payable:118},raw_lines:[{label:'Honoraires',amount:100,bloc:'honoraires',currency:'XOF'}],lines:[{description:'Honoraires',amount:100}]};
 sql(`INSERT INTO quotation_versions(id,case_id,pricing_run_id,version_number,status,is_selected,snapshot,created_by) VALUES('${v}','${c}','${run}',1,'draft',true,${j(snapshot)},'${u}');`);
 let ctx=JSON.parse(sql(settings()+`SELECT commercial_source_context('${c}','${v}')`));
 const draft={case_id:c,source_version_id:v,source_snapshot:snapshot,lines:[{id:'source:0'}],events:[]};
 const request=[{operation_id:id(90),action:{type:'edit',reason:'Fictitious commercial decision',amount:150}}];
 const save=(id,parent=null,operations=request,context=ctx,actor=u)=>`SELECT commercial_store('${id}','${c}','${v}',${parent?q(parent):'NULL'},'${actor}',${q(context.source_hash)},${q(context.context_hash)},${j(operations)},${j(draft)});`;
 check('Real workspace admission predicates: absent role, banned account, member non-owner refused',()=>{
  refused(settings('authenticated',u3)+`SELECT commercial_read('${c}');`,/forbidden/);
  refused(settings('authenticated',u4)+`SELECT commercial_read('${c}');`,/forbidden/);
  refused(settings()+save(r1,null,request,ctx,u2),/forbidden/);
  refused(settings()+save(r1,null,request,ctx,u3),/forbidden/);
  refused(settings()+save(r1,null,request,ctx,u4),/forbidden/);
 });
 check('Anonymous/client RPC writes and direct inserts denied; shared admitted reads retained',()=>{
  refused(settings('anon')+`SET ROLE anon;SELECT commercial_read('${c}');`,/permission denied/);
  refused(settings('authenticated')+`SET ROLE authenticated;`+save(r1),/permission denied/);
  refused(settings('authenticated')+`SET ROLE authenticated;INSERT INTO quote_commercial_revisions(id) VALUES('${r1}');`,/permission denied/);
  assert.equal(JSON.parse(sql(settings('authenticated',u2)+`SET ROLE authenticated;SELECT commercial_read('${c}');`)).can_write,false);
 });
 check('Save and exact replay preserve ID, actor, source, one row; divergent replay rejected',()=>{
  const first=JSON.parse(sql(settings()+save(r1))),second=JSON.parse(sql(settings()+save(r1)));assert.equal(first.id,second.id);assert.equal(first.created_by,u);assert.deepEqual(first.draft.source_snapshot,snapshot);
  refused(settings()+save(r1,null,[{different:true}]),/replay mismatch/);
  assert.equal(sql('SELECT count(*) FROM quote_commercial_revisions'),'1');
 });
 check('Append-only history and stale parent/context reject without mutation',()=>{
  refused(`UPDATE quote_commercial_revisions SET draft='{}' WHERE id='${r1}';`,/Append-only/);
  refused(`DELETE FROM quote_commercial_revisions WHERE id='${r1}';`,/Append-only/);
  refused(settings()+save(r2),/revision changed/);
  refused(settings()+save(r2,r1,request,{...ctx,context_hash:'stale'}),/context changed/);
 });
 const a=session('commercial_a',`BEGIN;${save(r2,r1)}SELECT pg_sleep(1.4);COMMIT;`);await wait('commercial_a','sleep');
 const b=session('commercial_b',save(id(42),r1));await wait('commercial_b','lock');
 const both=await Promise.all([a,b]);assert.equal(both[0].code,0);assert.notEqual(both[1].code,0);assert.match(both[1].stderr,/revision changed/);
 results.push({name:'Actual overlapping saves: one winner, one exact parent-CAS refusal with identical source context',status:'PASS'});
 const saveHeld=session('commercial_save_held',`BEGIN;${save(id(44),r2)}SELECT pg_sleep(1.2);ROLLBACK;`);await wait('commercial_save_held','sleep');
 const writer=session('commercial_fact_writer',`UPDATE quote_facts SET value='concurrent' WHERE id='${id(69)}';`);await wait('commercial_fact_writer','lock');
 const held=await Promise.all([saveHeld,writer]);assert(held.every(s=>s.code===0));assert.equal(sql(`SELECT count(*) FROM quote_commercial_revisions WHERE id='${id(44)}'`),'0');
 sql(`UPDATE quote_facts SET value='documentary' WHERE id='${id(69)}';`);
 results.push({name:'Source UPDATE really blocks behind save; rolled-back save leaves no revision',status:'PASS'});
 const clientSnapshot={meta:{commercial_revision_id:r2,commercial_source_version_id:v},totals:{total_ht:150,total_payable:177,currency:'XOF'},lines:[{service_code:'FEES',description:'Fictitious client fee',unit_price:150,amount:150,source:{type:'OPERATOR_ESTIMATE'}},{service_code:'UNKNOWN',description:'Unknown duty',unit_price:null,amount:null,source:{type:'TO_CONFIRM'}}]};
 const version=(snap=clientSnapshot)=>`SELECT commercial_create_version('${r2}','${u}',${j(snap)});`;
 check('Failure during version line insert rolls back selection, snapshot, lines, status and event',()=>{
  sql('ALTER TABLE quotation_version_lines ADD CONSTRAINT test_fault CHECK(amount<100);');
  refused(settings()+version(),/test_fault/);
  assert.equal(sql('SELECT count(*) FROM quotation_versions'),'1');assert.equal(sql(`SELECT is_selected FROM quotation_versions WHERE id='${v}'`),'t');assert.equal(sql('SELECT count(*) FROM quotation_version_lines'),'0');assert.equal(sql('SELECT count(*) FROM case_timeline_events'),'0');
  sql('ALTER TABLE quotation_version_lines DROP CONSTRAINT test_fault;');
 });
 const va=session('commercial_va',`BEGIN;${version()}SELECT pg_sleep(1.4);COMMIT;`);await wait('commercial_va','sleep');const vb=session('commercial_vb',version());await wait('commercial_vb','lock');const versions=await Promise.all([va,vb]);assert(versions.every(v=>v.code===0));const saved=JSON.parse(versions[0].stdout.trim().split('\n').find(s=>s.startsWith('{'))),replayed=JSON.parse(versions[1].stdout.trim().split('\n').find(s=>s.startsWith('{')));assert.equal(saved.version_id,replayed.version_id);assert.equal(replayed.idempotent,true);results.push({name:'Concurrent version requests converge to one atomic version and event',status:'PASS'});
 check('Unknown amount remains NULL; previous source and selected count preserved',()=>{
  assert.equal(sql(`SELECT amount IS NULL FROM quotation_version_lines WHERE service_code='UNKNOWN'`),'t');
  assert.equal(sql('SELECT count(*) FROM quotation_versions WHERE is_selected'),'1');assert.equal(sql('SELECT count(*) FROM case_timeline_events'),'1');
  assert.deepEqual(JSON.parse(sql(`SELECT snapshot FROM quotation_versions WHERE id='${v}'`)),snapshot);
  sql(`GRANT UPDATE,SELECT ON quotation_versions TO authenticated;`);
  sql(settings('authenticated')+`SET ROLE authenticated;BEGIN;UPDATE quotation_versions SET is_selected=false WHERE id='${saved.version_id}';UPDATE quotation_versions SET is_selected=true WHERE id='${v}';COMMIT;`);
  sql(settings('authenticated')+`SET ROLE authenticated;BEGIN;UPDATE quotation_versions SET is_selected=false WHERE id='${v}';UPDATE quotation_versions SET is_selected=true WHERE id='${saved.version_id}';COMMIT;`);
  refused(settings()+`UPDATE quotation_versions SET snapshot='{}' WHERE id='${saved.version_id}';`,/Immutable/);
  refused(settings()+`DELETE FROM quotation_versions WHERE id='${saved.version_id}';`,/Immutable/);
  sql('GRANT INSERT,UPDATE,DELETE,SELECT ON quotation_version_lines TO authenticated;');
  refused(settings('authenticated')+`SET ROLE authenticated;INSERT INTO quotation_version_lines(quotation_version_id,amount) VALUES('${saved.version_id}',999);`,/Immutable/);
  refused(settings('authenticated')+`SET ROLE authenticated;UPDATE quotation_version_lines SET amount=999 WHERE quotation_version_id='${saved.version_id}';`,/Immutable/);
  refused(settings()+`DELETE FROM quotation_version_lines WHERE quotation_version_id='${saved.version_id}';`,/Immutable/);
 });
 check('RLS read stops immediately after admission loss; no client writes to ledger',()=>{
  sql(`DELETE FROM app_roles WHERE user_id='${u2}';`);
  assert.equal(sql(settings('authenticated',u2)+'SET ROLE authenticated;SELECT count(*) FROM quote_commercial_revisions;'),'0');
  assert.equal(sql(settings('authenticated',u)+'SET ROLE authenticated;SELECT count(*) FROM quote_commercial_revisions;'),'2');
 });
 const heldSelection=session('commercial_selection_save',`BEGIN;${save(id(45),r2)}SELECT pg_sleep(1.2);ROLLBACK;`);await wait('commercial_selection_save','sleep');
 const selection=session('commercial_selection_rpc',settings('authenticated')+`SELECT select_quotation_version('${v}','${c}');`);await wait('commercial_selection_rpc','lock');
 const selected=await Promise.all([heldSelection,selection]);assert(selected.every(s=>s.code===0));
 assert.equal(sql(`SELECT is_selected FROM quotation_versions WHERE id='${v}'`),'t');
 sql(settings('authenticated')+`SELECT select_quotation_version('${saved.version_id}','${c}');`);
 results.push({name:'Existing authenticated selection RPC serializes behind commercial save without changing historical snapshots',status:'PASS'});
 check('Sent cases and new facts/run block new saves; idempotent old replay does not mutate',()=>{
  sql(`UPDATE quote_cases SET status='SENT' WHERE id='${c}';`);refused(settings()+save(id(43),r2),/Case locked/);
  sql(`UPDATE quote_cases SET status='QUOTED_VERSIONED' WHERE id='${c}';INSERT INTO quote_facts(id,case_id,value) VALUES('${id(70)}','${c}','new fact');`);refused(settings()+save(id(43),r2),/context changed/);
  sql(`INSERT INTO pricing_runs VALUES('${id(21)}','${c}','success',2);`);refused(settings('authenticated')+`SELECT commercial_read('${c}');`,/Pricing source changed/);
  assert.equal(JSON.parse(sql(settings()+save(r1))).id,r1);
 });
 console.log(JSON.stringify({status:'PASS',postgres:sql('SHOW server_version'),groups:results,isolation:{network:'none',ports:0,host_mounts:0},auth:'Actual existing admission/case predicates; local JWT claim functions only, no real account'},null,2));
}catch(error){console.error(error.stack||error);process.exitCode=1;}finally{if(container)docker(['rm','--force',container]);}})();
