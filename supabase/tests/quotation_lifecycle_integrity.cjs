// Real isolated PostgreSQL transactions, synthetic data, no host mount or exposed port.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'../..'),results=[],args=process.platform==='win32'?['--context','desktop-linux']:[];let container;
const docker=(a,input)=>cp.execFileSync('docker',[...args,...a],{input,encoding:'utf8',windowsHide:true,timeout:30000});
const sql=s=>docker(['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres'],s).trim();
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,actor=id(1),caseId=id(10),fact=id(20),run=id(30);
const q=x=>"'"+String(x).replaceAll("'","''")+"'",j=x=>q(JSON.stringify(x))+'::jsonb';
const settings=`SET request.jwt.claim.role='service_role';SET request.jwt.claim.sub='${actor}';`;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const snapshot=r=>({meta:{pricing_run_id:r},lines:[{service_code:'TEST',description:'Synthetic source',quantity:2,unit_price:100,amount:200,currency:'XOF'}],raw_lines:[],totals:{total_ht:200,total_ttc:200}});
const create=(r=run,lines=snapshot(r).lines,a=actor)=>`SELECT create_canonical_quotation_version('${caseId}','${r}','${a}',${j(snapshot(r))},${j(lines)});`;
const read=r=>JSON.parse(sql(settings+create(r)));
const check=(name,f)=>{f();results.push({name,status:'PASS'});};
const refused=(s,re)=>{let error;try{sql(s);}catch(e){error=String(e.stderr||e.message);}assert(error,'Unexpected SQL success');assert.match(error,re);};
function session(name){const p=cp.spawn('docker',[...args,'exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);const done=new Promise(resolve=>p.on('close',code=>resolve({code,out,err})));p.stdin.write(settings+`SET application_name=${q(name)};`);return{p,done,out:()=>out};}
async function waitFor(name){for(let i=0;i<120;i++){const state=sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${q(name)} AND wait_event_type='Lock';`);if(state==='1')return;await delay(40);}throw Error('No real lock overlap: '+name);}
(async()=>{try{
 container=docker(['run','--detach','--rm','--pull=never','--network','none','--tmpfs','/var/lib/postgresql/data:rw,nosuid,size=256m','--tmpfs','/var/run/postgresql:rw,nosuid,size=16m','--env','POSTGRES_HOST_AUTH_METHOD=trust','postgres:15-alpine','postgres','-c','listen_addresses=']).trim();
 for(let i=0;i<50;i++){try{sql('SELECT 1');break;}catch{if(i===49)throw Error('PostgreSQL unavailable');await delay(100);}}
 const isolation=JSON.parse(docker(['inspect',container,'--format','{{json .HostConfig}}']));assert.equal(isolation.NetworkMode,'none');assert(!isolation.Binds?.length);assert(!Object.keys(isolation.PortBindings||{}).length);
 sql(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,banned_until timestamptz);CREATE TABLE app_roles(user_id uuid,role text);
 CREATE TABLE quote_cases(id uuid PRIMARY KEY,created_by uuid,assigned_to uuid,status text,updated_at timestamptz);
 CREATE TABLE pricing_runs(id uuid PRIMARY KEY,case_id uuid,status text,run_number integer,facts_snapshot jsonb,started_at timestamptz,completed_at timestamptz);
 CREATE TABLE quote_facts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid REFERENCES quote_cases(id),fact_key text,fact_category text,value_text text,value_number numeric,value_json jsonb,value_date timestamptz,source_type text,confidence numeric,is_validated boolean,is_current boolean,source_email_id uuid,source_attachment_id uuid,source_excerpt text,updated_at timestamptz DEFAULT now(),supersedes_fact_id uuid REFERENCES quote_facts(id));
 CREATE TABLE quote_request_lines(id uuid PRIMARY KEY,case_id uuid,created_at timestamptz,updated_at timestamptz);
 CREATE TABLE air_handling_selections(id uuid PRIMARY KEY,case_id uuid,version integer);
 CREATE FUNCTION air_handling_context_hash(uuid) RETURNS text LANGUAGE sql AS $$SELECT 'synthetic'::text$$;
 CREATE TABLE quotation_versions(id uuid PRIMARY KEY,case_id uuid REFERENCES quote_cases(id),pricing_run_id uuid,version_number integer,status text,is_selected boolean,snapshot jsonb,created_by uuid,created_at timestamptz DEFAULT now(),source_kind text DEFAULT 'canonical',UNIQUE(case_id,version_number));
 CREATE UNIQUE INDEX selected ON quotation_versions(case_id) WHERE is_selected;
 CREATE TABLE quotation_version_lines(id uuid DEFAULT gen_random_uuid(),quotation_version_id uuid,line_order integer,service_code text,description text,quantity numeric NOT NULL,unit_price numeric NOT NULL,amount numeric NOT NULL,currency text,breakdown jsonb);
 CREATE TABLE case_timeline_events(id uuid DEFAULT gen_random_uuid(),case_id uuid,event_type text,event_data jsonb,actor_type text,actor_user_id uuid,related_fact_id uuid);
 CREATE FUNCTION has_case_read_access(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION has_case_write_access(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 INSERT INTO auth.users VALUES('${actor}',NULL);INSERT INTO app_roles VALUES('${actor}','workspace_operator');
 INSERT INTO quote_cases VALUES('${caseId}','${actor}',NULL,'PRICED_DRAFT',now());
 INSERT INTO quote_facts(id,case_id,fact_key,fact_category,value_number,source_type,confidence,is_validated,is_current) VALUES('${fact}','${caseId}','cargo.weight','cargo',2,'manual_input',1,true,true);
 INSERT INTO pricing_runs SELECT '${run}','${caseId}','success',1,jsonb_agg(jsonb_build_object('id',id,'key',fact_key,'category',fact_category,'value_number',value_number,'source_type',source_type,'confidence',confidence)),now(),now() FROM quote_facts;
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
 const source=name=>fs.readFileSync(path.join(repo,'supabase/migrations',name),'utf8').replaceAll('\r','');
 const promotionSource=source('20260829120000_promote_scenario_assumption_p1a3.sql');
 const extract=(text,name)=>{const start=text.toLowerCase().indexOf('create or replace function public.'+name+'(');assert(start>=0,name);const end=text.indexOf('$$;',text.indexOf('as $$',start));assert(end>start,name);return text.slice(start,end+3);};
 sql(`CREATE TABLE quote_scenarios(id uuid,case_id uuid,status text,scope_hash text,superseded_by_scenario_id uuid);
 CREATE TABLE quote_scenario_links(case_id uuid,scenario_id uuid,assumption_id uuid);
 CREATE TABLE quote_scenario_assumptions(id uuid PRIMARY KEY,case_id uuid,status text,assumed_value_type text,assumed_value jsonb,assumed_fact_key text,promoted_fact_id uuid,resolved_at timestamptz,resolved_by uuid);
 CREATE TABLE quote_fact_promotions(id uuid DEFAULT gen_random_uuid(),case_id uuid,assumption_id uuid,promoted_fact_id uuid,superseded_fact_id uuid,fact_key text,fact_category text,value_type text,promoted_value jsonb,assumption_status_before text,promotion_basis text,attested boolean,scenario_id uuid,scenario_scope_hash text,idempotency_key text,request_fingerprint text,actor_user_id uuid);`);
 for(const name of ['quote_fact_promotion_monetary_token','quote_fact_promotion_allowlist','quote_fact_promotion_violation','promote_scenario_assumption'])sql(extract(promotionSource,name));
 const supersedeSource=source('20261018150000_preserve_validated_quote_facts.sql');
 sql(supersedeSource.slice(supersedeSource.indexOf('CREATE OR REPLACE FUNCTION'),supersedeSource.lastIndexOf('COMMIT;')));
 const signatures=['supersede_fact(uuid,text,text,text,numeric,jsonb,timestamptz,text,uuid,uuid,text,numeric)','promote_scenario_assumption(uuid,uuid,uuid,text,text,text,text,boolean,text,text,jsonb,boolean,uuid,uuid,text)'];
 for(const name of signatures)sql(`REVOKE ALL ON FUNCTION public.${name} FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.${name} TO service_role;`);
 for(const name of ['20261017120000_commercial_revisions.sql','20261017123000_commercial_selection_lock.sql','20261018180000_quotation_lifecycle_integrity.sql'])sql(source(name));
 check('RPC ACL and real actor admission reject clients, unknown actor and banned actor',()=>{
  refused(`SET ROLE anon;`+create(),/permission denied/);refused(`SET ROLE authenticated;`+create(),/permission denied/);
  refused(settings+create(run,[],id(999)),/forbidden/);
  sql(`UPDATE auth.users SET banned_until=now()+interval '1 day'`);refused(settings+create(),/forbidden/);sql('UPDATE auth.users SET banned_until=NULL');
 });
 const holder=session('canonical-holder');holder.p.stdin.write(`BEGIN;SELECT 1 FROM quote_cases WHERE id='${caseId}' FOR UPDATE;SELECT 'HELD';\n`);
 for(let i=0;i<100&&!holder.out().includes('HELD');i++)await delay(30);assert(holder.out().includes('HELD'));
 const a=session('canonical-A'),b=session('canonical-B');a.p.stdin.end(create()+'\n\\q\n');b.p.stdin.end(create()+'\n\\q\n');await waitFor('canonical-A');await waitFor('canonical-B');holder.p.stdin.end('COMMIT;\n\\q\n');await holder.done;const both=await Promise.all([a.done,b.done]);both.forEach(x=>assert.equal(x.code,0,x.err));const versions=both.map(x=>JSON.parse(x.out.trim()));assert.equal(versions[0].version_id,versions[1].version_id);assert.deepEqual(versions.map(x=>x.idempotent).sort(),[false,true]);results.push({name:'Two simultaneous canonical requests converge on one committed ID',status:'PASS',actualOverlap:true});
 const first=versions[0],digest=sql(`SELECT md5(snapshot::text) FROM quotation_versions WHERE id='${first.version_id}';`);
 check('Header, numeric lines, FSM and timeline committed exactly once',()=>{assert.equal(sql('SELECT count(*) FROM quotation_versions'),'1');assert.equal(sql('SELECT count(*) FROM quotation_version_lines'),'1');assert.equal(sql('SELECT count(*) FROM case_timeline_events'),'1');assert.equal(sql('SELECT status FROM quote_cases'),'QUOTED_VERSIONED');});
 check('Legacy optional validation and partial NULL serialized as false stay comparable',()=>{sql(`UPDATE quote_facts SET is_validated=false`);sql(`SELECT assert_quotation_run_facts_current('${caseId}','${run}');`);sql(`UPDATE pricing_runs SET facts_snapshot=jsonb_set(facts_snapshot,'{0,is_validated}','false');UPDATE quote_facts SET is_validated=NULL;SELECT assert_quotation_run_facts_current('${caseId}','${run}');`);sql('UPDATE quote_facts SET is_validated=true');refused(`SELECT assert_quotation_run_facts_current('${caseId}','${run}');`,/validation changed/);sql(`UPDATE pricing_runs SET facts_snapshot=jsonb_set(facts_snapshot,'{0,is_validated}','true');`);});
 check('Changed facts before a fresh commercial read are rejected; historical replay is preserved',()=>{sql('UPDATE quote_facts SET value_number=3');refused(`SELECT commercial_source_context('${caseId}','${first.version_id}');`,/facts changed/);assert.equal(read().version_id,first.version_id);sql('UPDATE quote_facts SET value_number=2');});
 check('Missing IDs and request-line changes during a calculation cannot be attested current',()=>{refused(`BEGIN;UPDATE pricing_runs SET facts_snapshot=facts_snapshot #- '{0,id}';SELECT assert_quotation_run_facts_current('${caseId}','${run}');`,/not comparable/);sql(`UPDATE pricing_runs SET started_at=now()-interval '2 minutes',completed_at=now();INSERT INTO quote_request_lines VALUES('${id(70)}','${caseId}',now()-interval '3 minutes',now()-interval '1 minute');`);refused(`SELECT assert_quotation_run_facts_current('${caseId}','${run}');`,/Request lines changed/);sql('DELETE FROM quote_request_lines');});
 const run2=id(31);sql(`INSERT INTO pricing_runs SELECT '${run2}',case_id,status,2,facts_snapshot,now(),now() FROM pricing_runs WHERE id='${run}';`);const second=read(run2);
 check('Replay of an older run preserves the newer selection and immutable snapshot',()=>{assert.equal(read().version_id,first.version_id);assert.equal(sql('SELECT id FROM quotation_versions WHERE is_selected'),second.version_id);assert.equal(sql(`SELECT md5(snapshot::text) FROM quotation_versions WHERE id='${first.version_id}'`),digest);});
 const run3=id(32);sql(`INSERT INTO pricing_runs SELECT '${run3}',case_id,status,3,facts_snapshot,now(),now() FROM pricing_runs WHERE id='${run}';`);
 check('Line insertion error rolls back header, deselection, FSM and event without compensatory delete',()=>{const before=sql(`SELECT md5(jsonb_build_object('v',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM quotation_versions v),'c',(SELECT to_jsonb(c) FROM quote_cases c),'e',(SELECT count(*) FROM case_timeline_events))::text)`);refused(settings+create(run3,[{...snapshot(run3).lines[0],quantity:null}]),/not-null/);assert.equal(sql(`SELECT md5(jsonb_build_object('v',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM quotation_versions v),'c',(SELECT to_jsonb(c) FROM quote_cases c),'e',(SELECT count(*) FROM case_timeline_events))::text)`),before);});
 check('Timeline failure rolls back the already inserted header and lines',()=>{sql(`CREATE FUNCTION fail_test_event() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic event failure';END;$$;CREATE TRIGGER fail_test_event BEFORE INSERT ON case_timeline_events FOR EACH ROW EXECUTE FUNCTION fail_test_event();`);refused(settings+create(run3),/synthetic event failure/);assert.equal(sql('SELECT count(*) FROM quotation_versions'),'2');assert.equal(sql('SELECT count(*) FROM quotation_version_lines'),'2');assert.equal(sql('SELECT id FROM quotation_versions WHERE is_selected'),second.version_id);sql('DROP TRIGGER fail_test_event ON case_timeline_events;DROP FUNCTION fail_test_event();');});
 const mixed=session('mixed-holder');mixed.p.stdin.write(`BEGIN;SELECT 1 FROM quote_cases WHERE id='${caseId}' FOR UPDATE;SELECT 'HELD';\n`);for(let i=0;i<100&&!mixed.out().includes('HELD');i++)await delay(30);assert(mixed.out().includes('HELD'));
 const legacy=session('mixed-legacy'),modern=session('mixed-modern');legacy.p.stdin.end(`SELECT insert_quotation_version_atomic('${id(100)}','${caseId}','${run2}',100,${j(snapshot(run2))},'${actor}');\n\\q\n`);modern.p.stdin.end(create(run3)+'\n\\q\n');await waitFor('mixed-legacy');await waitFor('mixed-modern');mixed.p.stdin.end('COMMIT;\n\\q\n');await mixed.done;const overlap=await Promise.all([legacy.done,modern.done]);overlap.forEach(x=>assert.equal(x.code,0,x.err));results.push({name:'Legacy header and new canonical RPC overlap without the inverted-lock cycle',status:'PASS',actualOverlap:true,limit:'Legacy header-only atomicity and separate number reservation are unchanged'});
 const run4=id(33);sql(`INSERT INTO pricing_runs SELECT '${run4}',case_id,status,4,facts_snapshot,now(),now() FROM pricing_runs WHERE id='${run}';`);const beforeLate=sql('SELECT count(*) FROM quotation_versions');
 const late=session('late-fact-holder');late.p.stdin.write(`BEGIN;SELECT 1 FROM quote_cases WHERE id='${caseId}' FOR UPDATE;UPDATE quote_facts SET value_number=9;SELECT 'HELD';\n`);for(let i=0;i<100&&!late.out().includes('HELD');i++)await delay(30);assert(late.out().includes('HELD'));const waiter=session('late-fact-waiter');waiter.p.stdin.end(create(run4)+'\n\\q\n');await waitFor('late-fact-waiter');late.p.stdin.end('COMMIT;\n\\q\n');await late.done;const rejected=await waiter.done;assert.notEqual(rejected.code,0);assert.match(rejected.err,/facts changed/);assert.equal(sql('SELECT count(*) FROM quotation_versions'),beforeLate);results.push({name:'Fact change committed during lock wait is checked after waiting',status:'PASS',actualOverlap:true});
 sql('UPDATE quote_facts SET value_number=2');const base=read(run4),revision=id(200),context=JSON.parse(sql(`SELECT commercial_source_context('${caseId}','${base.version_id}')`));
 const draft={case_id:caseId,source_version_id:base.version_id,source_snapshot:base.snapshot,lines:[],events:[]};
 sql(settings+`SELECT commercial_store('${revision}','${caseId}','${base.version_id}',NULL,'${actor}',${q(context.source_hash)},${q(context.context_hash)},'[{}]'::jsonb,${j(draft)});`);
 const commercialSnapshot={...snapshot(run4),meta:{commercial_revision_id:revision,commercial_source_version_id:base.version_id}};
 const ch=session('commercial-mix-holder');ch.p.stdin.write(`BEGIN;SELECT 1 FROM quote_cases WHERE id='${caseId}' FOR UPDATE;SELECT 'HELD';\n`);for(let i=0;i<100&&!ch.out().includes('HELD');i++)await delay(30);assert(ch.out().includes('HELD'));
 const cc=session('commercial-mix-commit');cc.p.stdin.end(`SELECT commercial_create_version('${revision}','${actor}',${j(commercialSnapshot)});\n\\q\n`);await waitFor('commercial-mix-commit');const cl=session('commercial-mix-legacy');cl.p.stdin.end(`SELECT insert_quotation_version_atomic('${id(201)}','${caseId}','${run4}',1000,${j(snapshot(run4))},'${actor}');\n\\q\n`);await waitFor('commercial-mix-legacy');ch.p.stdin.end('COMMIT;\n\\q\n');await ch.done;const commits=await Promise.all([cc.done,cl.done]);commits.forEach(x=>assert.equal(x.code,0,x.err));assert.equal(sql(`SELECT quantity FROM quotation_version_lines l JOIN quotation_versions v ON v.id=l.quotation_version_id WHERE v.commercial_revision_id='${revision}'`),'2');results.push({name:'Commercial commit and legacy header serialize without deadlock; inherited numeric quantity persists',status:'PASS',actualOverlap:true});
 sql(`INSERT INTO quote_request_lines VALUES('${id(71)}','${caseId}',now()-interval '1 day',now()-interval '1 day');`);
 const lineHolder=session('request-line-holder');lineHolder.p.stdin.write(`BEGIN;SELECT assert_quotation_run_facts_current('${caseId}','${run4}');SELECT 'HELD';\n`);for(let i=0;i<100&&!lineHolder.out().includes('HELD');i++)await delay(30);assert(lineHolder.out().includes('HELD'));
 const lineWriter=session('request-line-writer');lineWriter.p.stdin.end(`UPDATE quote_request_lines SET updated_at=now() WHERE id='${id(71)}';\n\\q\n`);await waitFor('request-line-writer');lineHolder.p.stdin.end('COMMIT;\n\\q\n');await lineHolder.done;assert.equal((await lineWriter.done).code,0);refused(`SELECT assert_quotation_run_facts_current('${caseId}','${run4}');`,/Request lines changed/);results.push({name:'Pinned request lines block concurrent update until guard transaction commits',status:'PASS',actualOverlap:true});
 // True production fact writers, with an INSERT trigger as a test-only scheduling barrier.
 sql(`CREATE FUNCTION test_fact_gate() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF current_setting('application_name') LIKE 'fact-lock-%' THEN PERFORM pg_advisory_xact_lock(919191);END IF;RETURN NEW;END;$$;
 CREATE TRIGGER test_fact_gate BEFORE INSERT ON quote_facts FOR EACH ROW EXECUTE FUNCTION test_fact_gate();`);
 const seedFactCase=n=>{const c=id(n),f=id(n+1),r=id(n+2),h=id(n+3);sql(`INSERT INTO quote_cases VALUES('${c}','${actor}',NULL,'PRICED_DRAFT',now());
 INSERT INTO quote_facts(id,case_id,fact_key,fact_category,value_number,source_type,confidence,is_current,is_validated) VALUES('${f}','${c}','cargo.weight_kg','cargo',2,'email_body',0.8,true,false);
 INSERT INTO pricing_runs SELECT '${r}','${c}','success',1,jsonb_agg(jsonb_build_object('id',id,'key',fact_key,'category',fact_category,'value_number',value_number,'source_type',source_type)),now(),now() FROM quote_facts WHERE case_id='${c}';
 INSERT INTO quote_scenario_assumptions(id,case_id,status,assumed_value_type,assumed_value,assumed_fact_key) VALUES('${h}','${c}','active','number','3','cargo.weight_kg');`);return{c,f,r,h};};
 const canonical=x=>`SELECT create_canonical_quotation_version('${x.c}','${x.r}','${actor}',${j(snapshot(x.r))},${j(snapshot(x.r).lines)});`;
 const supersede=(x,value=3,type='manual_input')=>`SELECT supersede_fact('${x.c}','cargo.weight_kg','cargo',p_value_number:=${value},p_source_type:='${type}');`;
 const promote=x=>`SELECT promote_scenario_assumption('${x.c}','${x.h}','${actor}','test-lock-promotion','${'a'.repeat(64)}','cargo.weight_kg','operator_expertise',true,'active','number','3',false,'${x.f}');`;
 for(const kind of ['supersede','promote']){
  const x=seedFactCase(kind==='supersede'?300:310),gate=session('gate-'+kind);gate.p.stdin.write("BEGIN;SELECT pg_advisory_xact_lock(919191);SELECT 'HELD';\n");
  for(let i=0;i<100&&!gate.out().includes('HELD');i++)await delay(30);assert(gate.out().includes('HELD'));
  const writer=session('fact-lock-'+kind),creator=session('version-lock-'+kind);writer.p.stdin.end((kind==='supersede'?supersede(x):promote(x))+'\n\\q\n');await waitFor('fact-lock-'+kind);
  creator.p.stdin.end(canonical(x)+'\n\\q\n');await waitFor('version-lock-'+kind);gate.p.stdin.end('COMMIT;\n\\q\n');await gate.done;
  const [w,v]=await Promise.all([writer.done,creator.done]);assert.equal(w.code,0,w.err);assert.notEqual(v.code,0);assert.match(v.err,/facts (changed|are not comparable)/);assert.doesNotMatch(v.err,/deadlock/i);
  assert.equal(sql(`SELECT count(*) FROM quotation_versions WHERE case_id='${x.c}'`),'0');assert.equal(sql(`SELECT count(*) FROM quote_facts WHERE case_id='${x.c}'`),'2');
  assert.equal(sql(`SELECT count(*) FROM quote_facts WHERE case_id='${x.c}' AND is_current`),'1');
  results.push({name:`Real ${kind} overlaps canonical creation without a lock cycle; stale run refused atomically`,status:'PASS',actualOverlap:true});
 }
 const x=seedFactCase(320),pin=session('version-first');pin.p.stdin.write(`BEGIN;${canonical(x)}SELECT 'HELD';\n`);
 for(let i=0;i<100&&!pin.out().includes('HELD');i++)await delay(30);assert(pin.out().includes('HELD'));
 const fw=session('writer-after-version');fw.p.stdin.end(supersede(x)+'\n\\q\n');await waitFor('writer-after-version');const frozen=sql(`SELECT md5(snapshot::text) FROM quotation_versions WHERE case_id='${x.c}'`); // uncommitted row is intentionally invisible
 assert.equal(frozen,'');pin.p.stdin.end('COMMIT;\n\\q\n');assert.equal((await pin.done).code,0);assert.equal((await fw.done).code,0);
 const saved=sql(`SELECT md5(snapshot::text) FROM quotation_versions WHERE case_id='${x.c}'`);assert(saved);refused(`SELECT assert_quotation_run_facts_current('${x.c}','${x.r}');`,/facts (changed|are not comparable)/);assert.equal(sql(`SELECT md5(snapshot::text) FROM quotation_versions WHERE case_id='${x.c}'`),saved);
 results.push({name:'Canonical first, then real supersession: committed snapshot retained and source becomes stale',status:'PASS',actualOverlap:true});
 for(const heldWrite of ['canonical','supersede']){
  const target=seedFactCase(heldWrite==='canonical'?330:340),holder=session('promotion-inversion-holder-'+heldWrite);
  holder.p.stdin.write(`BEGIN;SELECT 1 FROM quote_cases WHERE id='${target.c}' FOR UPDATE;SELECT 'HELD';\n`);
  for(let i=0;i<100&&!holder.out().includes('HELD');i++)await delay(30);assert(holder.out().includes('HELD'));
  const promotion=session('promotion-inversion-waiter-'+heldWrite);promotion.p.stdin.end(promote(target)+'\n\\q\n');await waitFor('promotion-inversion-waiter-'+heldWrite);
  // Promotion must still be waiting on the case, before taking its fact/key locks.
  holder.p.stdin.end((heldWrite==='canonical'?canonical(target):supersede(target,4))+'COMMIT;\n\\q\n');const committed=await holder.done;assert.equal(committed.code,0,committed.err);
  const outcome=await promotion.done;
  if(heldWrite==='canonical'){
   assert.equal(outcome.code,0,outcome.err);assert.equal(sql(`SELECT count(*) FROM quotation_versions WHERE case_id='${target.c}'`),'1');
   refused(`SELECT assert_quotation_run_facts_current('${target.c}','${target.r}');`,/facts (changed|are not comparable)/);
  }else{
   assert.notEqual(outcome.code,0);assert.match(outcome.err,/CONFLICT_STALE_FACT/);assert.equal(sql(`SELECT count(*) FROM quote_fact_promotions WHERE case_id='${target.c}'`),'0');
   assert.equal(sql(`SELECT status FROM quote_scenario_assumptions WHERE id='${target.h}'`),'active');assert.equal(sql(`SELECT count(*) FROM quote_facts WHERE case_id='${target.c}'`),'2');
  }
  results.push({name:`Promotion waits before dependent locks while real ${heldWrite} holds the case`,status:'PASS',actualOverlap:true});
 }
 check('Aligned writers retain service-only ACL and protected-fact refusal without archive or insertion',()=>{
  for(const sig of signatures)assert.equal(sql(`SELECT has_function_privilege('anon','public.${sig}','execute') OR has_function_privilege('authenticated','public.${sig}','execute') OR NOT has_function_privilege('service_role','public.${sig}','execute')`),'f');
  const before=sql(`SELECT md5(jsonb_agg(to_jsonb(f) ORDER BY id)::text) FROM quote_facts f WHERE case_id='${x.c}'`);refused(supersede(x,9,'ai_extraction'),/PROTECTED_FACT_REQUIRES_OPERATOR/);assert.equal(sql(`SELECT md5(jsonb_agg(to_jsonb(f) ORDER BY id)::text) FROM quote_facts f WHERE case_id='${x.c}'`),before);
 });
 await require('./email_fact_revisions.cjs')({sql,session,waitFor,delay,id,actor,settings,q,j,results,repo});
 console.log(JSON.stringify({status:'PASS',nativePostgreSQL:true,isolation:'network none, tmpfs, no bind/ports',results},null,2));
 }catch(e){console.error(String(e));process.exitCode=1;}finally{if(container)docker(['stop',container]);}})();
