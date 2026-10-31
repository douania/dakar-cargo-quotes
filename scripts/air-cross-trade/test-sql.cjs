// Local synthetic PostgreSQL only. No host ports, existing volume or Cloud target.
const {execFileSync,spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const repo=process.cwd(),proofRoot=process.argv[2];if(!proofRoot)throw Error('Explicit proof directory required');
const name='dcq-air-cross-'+Date.now(),uid='10000000-0000-4000-8000-000000000001',cid='20000000-0000-4000-8000-000000000001',sid='30000000-0000-4000-8000-000000000001';
const proof=path.join(proofRoot,name);fs.mkdirSync(proof,{recursive:false});
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']});
const sql=(text,fail=false)=>{try{return execFileSync('docker',['exec','-i',name,'psql','-U','postgres','-XAtq','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{input:"SET statement_timeout='8s';"+text,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();}catch(e){if(fail)return e.stderr.toString();throw Error(e.stderr?.toString()||e.message);}};
const role="SET request.jwt.claim.role='service_role';SET ROLE service_role;";
const results=[];let created=false;
async function held(statement) {
 const c=spawn('docker',['exec','-i',name,'psql','-U','postgres','-XAtq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
 c.stdout.on('data',b=>{stdout+=b});c.stderr.on('data',b=>{stderr+=b});
 const done=new Promise(resolve=>c.on('close',code=>resolve({code,stdout,stderr})));
 c.stdin.write('BEGIN;'+statement+";\n\\echo AIR_LOCK_HELD\n");
 for(let i=0;!stdout.includes('AIR_LOCK_HELD');i++){if(i>200)throw Error('Held SQL handshake missing: '+stderr);await new Promise(r=>setTimeout(r,25));}
 return {finish:async(commit=false)=>{c.stdin.end((commit?'COMMIT':'ROLLBACK')+';\n\\q\n');return done;}};
}
function asyncSql(statement) {
 const c=spawn('docker',['exec','-i',name,'psql','-U','postgres','-XAtq','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
 c.stdout.on('data',b=>stdout+=b);c.stderr.on('data',b=>stderr+=b);c.stdin.end(statement);
 return new Promise(resolve=>c.on('close',code=>resolve({code,stdout,stderr})));
}

(async()=>{try{
 docker(['info','--format','{{.ServerVersion}}']);docker(['image','inspect','postgres:17-alpine']);
 fs.writeFileSync(path.join(proof,'container-name.txt'),name); // Receipt precedes the single create attempt.
 const id=docker(['run','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine']).trim();created=true;
 const inspect=JSON.parse(docker(['inspect',name]))[0];assert.equal(inspect.HostConfig.NetworkMode,'none');assert.equal(inspect.HostConfig.PortBindings&&Object.keys(inspect.HostConfig.PortBindings).length||0,0);assert.equal(inspect.Mounts.some(m=>m.Type==='volume'||m.Type==='bind'),false);
 fs.writeFileSync(path.join(proof,'container-receipt.json'),JSON.stringify({name,id,network:inspect.HostConfig.NetworkMode,ports:inspect.HostConfig.PortBindings,mounts:inspect.Mounts,tmpfs:inspect.HostConfig.Tmpfs},null,2));
 for(let i=0;i<40;i++){try{docker(['exec',name,'pg_isready','-U','postgres']);break;}catch{if(i===39)throw Error('PostgreSQL not ready');await new Promise(r=>setTimeout(r,250));}}
 sql(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,banned_until timestamptz);
 CREATE TABLE public.app_roles(user_id uuid REFERENCES auth.users(id),role text);
 CREATE TYPE public.quote_request_type AS ENUM('AIR_IMPORT','SEA_FCL_IMPORT');
 CREATE TYPE public.quote_case_status AS ENUM('INTAKE','FACTS_PARTIAL','NEED_INFO','READY_TO_PRICE','DECISIONS_PENDING','DECISIONS_COMPLETE','ACK_READY_FOR_PRICING','PRICED_DRAFT','HUMAN_REVIEW','QUOTED_VERSIONED','SENT');
 CREATE TABLE public.quote_cases(id uuid PRIMARY KEY,request_type public.quote_request_type,status public.quote_case_status,created_by uuid,assigned_to uuid,updated_at timestamptz DEFAULT now(),pricing_runs_count integer DEFAULT 0);
 CREATE TABLE public.quote_facts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL REFERENCES public.quote_cases(id) ON DELETE CASCADE,fact_key text,fact_category text DEFAULT 'cargo',value_text text,value_number numeric,value_json jsonb,value_date timestamptz,source_type text,source_email_id uuid,source_attachment_id uuid,source_excerpt text,supersedes_fact_id uuid,confidence numeric DEFAULT .8,is_validated boolean DEFAULT false,is_current boolean DEFAULT true,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
 CREATE UNIQUE INDEX current_fact ON public.quote_facts(case_id,fact_key) WHERE is_current;
 CREATE TABLE public.quote_request_lines(id uuid PRIMARY KEY,case_id uuid NOT NULL REFERENCES public.quote_cases(id) ON DELETE CASCADE,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
 CREATE TABLE public.pricing_rate_cards(id uuid PRIMARY KEY,status text,service_key text,unit text,value numeric,currency text,min_charge numeric,origin_country text,destination_country text,origin_port text,destination_port text,effective_from date,effective_to date,container_type text,scope text DEFAULT 'import',notes text,source text DEFAULT 'internal');
 CREATE TABLE public.external_quote_requests(id uuid PRIMARY KEY,case_id uuid,purpose text);
 CREATE TABLE public.external_quote_responses(id uuid PRIMARY KEY,request_id uuid,source_email_id uuid);
 CREATE TABLE public.external_quote_response_facts(id uuid PRIMARY KEY,case_id uuid,request_id uuid,response_id uuid,fact_key text,proposed_value_number numeric,currency text,validation_status text,validated_by uuid,validated_at timestamptz,source_excerpt text);
 CREATE TABLE public.exchange_rates(id uuid PRIMARY KEY,currency_code text,rate_to_xof numeric,valid_from timestamptz,valid_until timestamptz,source text);
 CREATE TABLE public.locations_reference(id uuid PRIMARY KEY,country_code text,country_name text,is_active boolean DEFAULT true);
 CREATE TABLE public.pricing_runs(id uuid PRIMARY KEY,case_id uuid,run_number integer,status text,currency text,created_by uuid,started_at timestamptz,completed_at timestamptz,facts_snapshot jsonb,inputs_json jsonb,outputs_json jsonb,tariff_lines jsonb,tariff_sources jsonb,total_ht numeric,total_ttc numeric,engine_version text);
 CREATE TABLE public.quotation_versions(id uuid PRIMARY KEY,case_id uuid,pricing_run_id uuid,version_number integer,status text,is_selected boolean,snapshot jsonb,created_by uuid,source_kind text DEFAULT 'canonical',commercial_revision_id uuid);
 CREATE TABLE public.quotation_version_lines(quotation_version_id uuid,line_order integer,service_code text,description text,quantity numeric,unit_price numeric,amount numeric,currency text,breakdown jsonb);
 CREATE TABLE public.case_timeline_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid,event_type text,event_data jsonb,actor_type text,actor_user_id uuid,related_fact_id uuid,created_at timestamptz DEFAULT clock_timestamp());
 CREATE TABLE public.quote_gaps(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid,gap_key text,status text DEFAULT 'open',is_blocking boolean DEFAULT true,resolved_at timestamptz,resolved_by_fact_id uuid,waived_reason text,updated_at timestamptz DEFAULT now());
 CREATE TABLE public.client_gap_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid,gap_key text,status text,source_timeline_event_id uuid,response_email_id uuid,validated_fact_id uuid);
 CREATE TABLE public.email_imap_identities(email_id uuid);
 CREATE FUNCTION public.has_case_write_access(p_case uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT auth.role()='authenticated' AND EXISTS(SELECT 1 FROM quote_cases WHERE id=p_case AND (created_by=auth.uid() OR assigned_to=auth.uid()))$$;
 CREATE FUNCTION public.has_case_read_access(p_case uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT auth.role()='authenticated' AND EXISTS(SELECT 1 FROM app_roles r JOIN auth.users u ON u.id=r.user_id WHERE r.user_id=auth.uid() AND (u.banned_until IS NULL OR u.banned_until<=now())) AND EXISTS(SELECT 1 FROM quote_cases WHERE id=p_case)$$;
 INSERT INTO auth.users VALUES('${uid}',NULL),('10000000-0000-4000-8000-000000000002',NULL),('10000000-0000-4000-8000-000000000003',NULL);
 INSERT INTO app_roles VALUES('${uid}','workspace_operator'),('10000000-0000-4000-8000-000000000002','workspace_operator');
 INSERT INTO quote_cases(id,request_type,status,created_by) VALUES('${cid}','AIR_IMPORT','NEED_INFO','${uid}');
 INSERT INTO locations_reference(id,country_code,country_name) VALUES(gen_random_uuid(),'KE','Kenya'),(gen_random_uuid(),'NL','Netherlands');
 INSERT INTO pricing_rate_cards(id,status,service_key,unit,value,currency,min_charge,origin_country,destination_country,origin_port,destination_port,effective_from,effective_to) VALUES('${sid}','active','AIR_FREIGHT','kg',4,'XOF',NULL,'KE','NL','NBO','AMS','2020-01-01','2099-12-31');
 GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role; GRANT SELECT,UPDATE ON public.quote_cases TO service_role;`);
 sql(fs.readFileSync(path.join(repo,'scripts/air-cross-trade/cloud-checks-20261031.sql'),'utf8'));
 const factValues=[['routing.origin_country','Kenya',null],['routing.destination_country','Netherlands',null],['routing.destination_airport','AMS',null],['cargo.description','SYNTHETIC GOODS',null],['cargo.weight_kg',null,30]];
 factValues.forEach(([key,text,number],i)=>sql(`INSERT INTO quote_facts(id,case_id,fact_key,fact_category,value_text,value_number,source_type,source_email_id) VALUES('60000000-0000-4000-8000-${String(i+1).padStart(12,'0')}','${cid}',${q(key)},${q(key.split('.')[0])},${text===null?'NULL':q(text)},${number??'NULL'},'ai_extraction','70000000-0000-4000-8000-000000000001');`));
 // Reuse the deployed-contract fact writer and ordered-source guard definitions, not a mock success.
 const preservation=fs.readFileSync(path.join(repo,'supabase/migrations/20261018150000_preserve_validated_quote_facts.sql'),'utf8');
 sql(preservation.slice(preservation.indexOf('CREATE OR REPLACE FUNCTION public.supersede_fact'),preservation.indexOf('$function$;')+'$function$;'.length));
 sql('REVOKE ALL ON FUNCTION public.supersede_fact(uuid,text,text,text,numeric,jsonb,timestamptz,text,uuid,uuid,text,numeric) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.supersede_fact(uuid,text,text,text,numeric,jsonb,timestamptz,text,uuid,uuid,text,numeric) TO service_role;');
 // Apply the same pre-1900 case-before-fact lock patch, with its original fingerprint.
 sql(`DO $fixture$ DECLARE t regprocedure:='public.supersede_fact(uuid,text,text,text,numeric,jsonb,timestamptz,text,uuid,uuid,text,numeric)'::regprocedure; d text; BEGIN
 d:=replace(pg_get_functiondef(t),chr(13),'');IF md5(d)<>'9c9143ed0dff18c70ad5f0a6260f7bae' THEN RAISE EXCEPTION 'Unexpected pre-lifecycle fact writer';END IF;
 EXECUTE replace(d,'  PERFORM pg_advisory_xact_lock(hashtext(p_case_id::text || p_fact_key));',E'  -- STRUCTURAL_PATCH_ALLOWED: case before dependent locks, shared with quotation writes.\\n  PERFORM 1 FROM public.quote_cases WHERE id=p_case_id FOR UPDATE;\\n  PERFORM pg_advisory_xact_lock(hashtext(p_case_id::text || p_fact_key));');END $fixture$;`);
 const revisions=fs.readFileSync(path.join(repo,'supabase/migrations/20261018190000_ordered_email_fact_revisions.sql'),'utf8');
 sql(revisions.slice(revisions.indexOf('CREATE TABLE public.quote_email_fact_revisions'),revisions.indexOf('CREATE FUNCTION public.email_revision_value_key')));
 sql(revisions.slice(revisions.indexOf('CREATE FUNCTION public.guard_email_revision_history'),revisions.indexOf('CREATE FUNCTION public.apply_case_email_fact_revisions')));
 // Real legacy scenario RPC/ledger contracts, with synthetic prerequisite rows only.
 sql(`CREATE TABLE public.quote_scenarios(id uuid PRIMARY KEY,case_id uuid REFERENCES quote_cases(id),status text,scope_hash text,scope_snapshot jsonb);
 CREATE TABLE public.quote_scenario_assumptions(id uuid PRIMARY KEY,case_id uuid,status text,assumption_type text,assumed_fact_key text,assumed_value_type text,assumed_value jsonb,statement text,basis text,source_type text,source_refs jsonb,risk_level text);
 CREATE TABLE public.quote_scenario_links(scenario_id uuid,assumption_id uuid);`);
 sql(fs.readFileSync(path.join(repo,'supabase/migrations/20260829200000_create_scenario_pricing_p1a4.sql'),'utf8'));
 const beforeRolloutCase=sql(`SELECT request_type::text||'/'||status::text FROM quote_cases WHERE id='${cid}'`);
 for(const file of ['20261030110000_client_gap_scope_fence.sql','20261030130000_air_cross_trade_type.sql','20261030130100_air_cross_trade_workflow.sql'])sql(fs.readFileSync(path.join(repo,'supabase/migrations',file),'utf8'));
 const lifecycle=fs.readFileSync(path.join(repo,'supabase/migrations/20261018180000_quotation_lifecycle_integrity.sql'),'utf8');
 for(const fn of ['assert_quotation_run_facts_current','create_canonical_quotation_version']){const start=lifecycle.indexOf('FUNCTION public.'+fn+'('),end=lifecycle.indexOf('$$;',start)+3;assert(start>0&&end>start);sql('CREATE OR REPLACE '+lifecycle.slice(start,end));}
 results.push({check:'candidate migrations and original canonical writer compile',pass:true});
 assert.equal(sql(`SELECT request_type::text||'/'||status::text FROM quote_cases WHERE id='${cid}'`),beforeRolloutCase);
 assert.equal(sql('SELECT count(*) FROM air_cross_trade_plans'),'0');assert.equal(sql('SELECT count(*) FROM air_cross_trade_pricing_receipts'),'0');
 assert.equal(sql(`SELECT count(*) FROM quote_facts WHERE case_id='${cid}'`),'5');
 results.push({check:'all three candidate migrations applied together without reclassification, plan, price or backfill',pass:true});

 sql(`INSERT INTO quote_gaps(case_id,gap_key,status,is_blocking)VALUES('${cid}','routing.destination_city','open',true);
 INSERT INTO client_gap_requests(case_id,gap_key,status)VALUES('${cid}','routing.destination_city','sent'),('${cid}','routing.destination_city','drafted');`);
 const output=execFileSync('deno',['run','--import-map=scripts/deno-ci-imports.json','--no-lock','--node-modules-dir=none','--allow-env','--allow-read','--allow-run=docker','scripts/air-cross-trade/sql-driver.ts',name],{cwd:repo,encoding:'utf8',stdio:['pipe','pipe','pipe']});
 fs.writeFileSync(path.join(proof,'service-positive.json'),output);const receipt=JSON.parse(output.trim());
 assert.equal(sql('SELECT count(*) FROM air_cross_trade_plans'), '1');assert.equal(sql('SELECT count(*) FROM pricing_runs'), '1');results.push({check:'real service loader/save/pricing/replays use one plan and run',pass:true});
 const run=JSON.parse(sql(`SELECT to_jsonb(r) FROM pricing_runs r WHERE id=${q(receipt.receipt.pricing_run_id)}`));
 const snap={meta:{pricing_run_id:run.id,quoteQualification:run.outputs_json.quoteQualification},inputs:{origin:'KE',destination:'AMS'},air_cross_trade:run.outputs_json.air_cross_trade,raw_lines:run.tariff_lines,lines:run.tariff_lines,totals:{total_ht:run.total_ht,total_ttc:run.total_ttc,currency:'XOF'}};
 const version=JSON.parse(sql(role+`SELECT public.create_canonical_quotation_version('${cid}',${q(run.id)},'${uid}',${q(JSON.stringify(snap))}::jsonb,${q(JSON.stringify(snap.lines))}::jsonb);`));assert.equal(version.snapshot.air_cross_trade.plan.id,receipt.saved.id);
 results.push({check:'actual canonical SQL version from saved run retains plan',pass:true});
 const denied=sql(`SET request.jwt.claim.role='service_role';SET ROLE service_role;SELECT air_cross_trade_store_plan(gen_random_uuid(),'${cid}','10000000-0000-4000-8000-000000000002',NULL,'x','x','{}','{}');`,true);assert.match(denied,/42501/);results.push({check:'admitted colleague read/write separation',pass:true});
 sql(`UPDATE pricing_rate_cards SET value=7 WHERE id='${sid}';`);assert.equal(sql(`SELECT total_ttc FROM pricing_runs WHERE id=${q(run.id)}`),'1000');assert.equal(sql(`SELECT snapshot->'totals'->>'total_ttc' FROM quotation_versions WHERE id=${q(version.version_id)}`),'1000');results.push({check:'later source edit never rewrites saved run/version',pass:true});
 // Known nonexecuted stale source commit must refuse without adding a second run.
 const old=receipt.pricingRequest,pricing=receipt.ready.pricing;
 const stale=sql(role+`SELECT air_cross_trade_commit_pricing(gen_random_uuid(),'${cid}','${uid}',${q(old.plan_id)},${q(old.expected_context)},${q(old.expected_sources)},${q(JSON.stringify(pricing))}::jsonb);`,true);assert.match(stale,/40001/);assert.equal(sql('SELECT count(*) FROM pricing_runs'),'1');results.push({check:'stale source rejected atomically before new run',pass:true});

 sql(`UPDATE pricing_rate_cards SET value=4 WHERE id='${sid}';`);
 const readState=()=>JSON.parse(execFileSync('deno',['run','--import-map=scripts/deno-ci-imports.json','--no-lock','--node-modules-dir=none','--allow-env','--allow-read','--allow-run=docker','scripts/air-cross-trade/sql-driver.ts',name,'read'],{cwd:repo,encoding:'utf8',stdio:['pipe','pipe','pipe']}));
 const prepared=readState();assert(prepared.evaluation?.pricing);
 const commitSql=(id,state=prepared)=>role+`SELECT air_cross_trade_commit_pricing('${id}','${cid}','${uid}',${q(state.head.id)},${q(state.context_hash)},${q(state.sources_hash)},${q(JSON.stringify(state.evaluation.pricing))}::jsonb);`;
 // A not-yet-committed fact insertion fences a pricing transaction before any write.
 const factWriter=await held(`INSERT INTO quote_facts(fact_category,source_type,id,case_id,fact_key,value_text) VALUES('other','manual_input',gen_random_uuid(),'${cid}','synthetic.concurrent','test')`);
 try{assert.match(sql(commitSql('50000000-0000-4000-8000-000000000002'),true),/40001/);}finally{await factWriter.finish();}
 assert.equal(sql('SELECT count(*) FROM pricing_runs'),'1');results.push({check:'concurrent uncommitted fact insert prevents stale run',pass:true});
 const exclusive=await held(`SELECT pg_advisory_xact_lock(hashtextextended('air_cross_trade:${cid}',0))`);
 try{assert.match(sql(`INSERT INTO quote_facts(fact_category,source_type,id,case_id,fact_key,value_text) VALUES('other','manual_input',gen_random_uuid(),'${cid}','synthetic.phantom','test');`,true),/40001/);}finally{await exclusive.finish();}
 assert.equal(sql("SELECT count(*) FROM quote_facts WHERE fact_key='synthetic.phantom'"),'0');results.push({check:'new fact phantom cannot enter exclusive pricing window',pass:true});
 const ordinary=await held(`INSERT INTO quote_facts(fact_category,source_type,id,case_id,fact_key,value_text) VALUES('other','manual_input',gen_random_uuid(),'${cid}','synthetic.ordinary-a','test')`);
 try{assert.match(sql(`BEGIN;INSERT INTO quote_facts(fact_category,source_type,id,case_id,fact_key,value_text) VALUES('other','manual_input',gen_random_uuid(),'${cid}','synthetic.ordinary-b','test');ROLLBACK;`,true),/40001/);}finally{await ordinary.finish();}
 results.push({check:'concurrent Cross scope invalidation refuses promptly without hanging',pass:true});
 const legacy='20000000-0000-4000-8000-000000000002';sql(`INSERT INTO quote_cases(id,request_type,status,created_by)VALUES('${legacy}','AIR_IMPORT','NEED_INFO','${uid}');`);
 // Mixed-version follow-up writers with the three real candidate migrations installed.
 const mixedCase='20000000-0000-4000-8000-000000000005',mixedAction='83000000-0000-4000-8000-000000000001',mixedDraft='83000000-0000-4000-8000-000000000002',mixedOld='83000000-0000-4000-8000-000000000003',mixedRequest='84000000-0000-4000-8000-000000000001';
 const mixedKey=`REQUEST_CLIENT_INFO_FOR_GAPS:${mixedCase}:cargo.weight_kg`;
 sql(`INSERT INTO quote_cases(id,request_type,status,created_by)VALUES('${mixedCase}','AIR_IMPORT','NEED_INFO','${uid}');
 INSERT INTO quote_gaps(case_id,gap_key,status,is_blocking)VALUES('${mixedCase}','cargo.weight_kg','open',true);
 INSERT INTO case_timeline_events(id,case_id,event_type,event_data,actor_type)VALUES('${mixedOld}','${mixedCase}','output_generated','{"kind":"reply_draft_v1","requested_gap_keys":["cargo.weight_kg"],"draft_reply":{"subject":"SYNTHETIC OLD","body":"SYNTHETIC OLD BODY"}}','system');
 INSERT INTO case_timeline_events(id,case_id,event_type,event_data,actor_type)VALUES('${mixedAction}','${mixedCase}','manual_action',jsonb_build_object('action_code','REQUEST_CLIENT_INFO_FOR_GAPS','dedupe_key','${mixedKey}','status','open','requested_gap_keys',jsonb_build_array('cargo.weight_kg'),'client_question_policy_version',4,'client_gap_guard',jsonb_build_object('version',1,'scope',client_gap_snapshot_v1('${mixedCase}'))),'system');
 INSERT INTO case_timeline_events(id,case_id,event_type,event_data,actor_type)VALUES('${mixedDraft}','${mixedCase}','output_generated',jsonb_build_object('kind','reply_draft_v1','source_action_dedupe_key','${mixedKey}','requested_gap_keys',jsonb_build_array('cargo.weight_kg'),'draft_reply',jsonb_build_object('subject','SYNTHETIC NEW','body','SYNTHETIC PROTECTED BODY'),'client_question_policy_version',4,'client_gap_guard',jsonb_build_object('version',1,'scope',client_gap_snapshot_v1('${mixedCase}'))),'system');
 INSERT INTO client_gap_requests(id,case_id,gap_key,status,source_timeline_event_id)VALUES('${mixedRequest}','${mixedCase}','cargo.weight_kg','drafted','${mixedDraft}');`);
 const mixedEvents=sql(`SELECT count(*) FROM case_timeline_events WHERE case_id='${mixedCase}'`);
 assert.match(sql(`UPDATE client_gap_requests SET status='cancelled' WHERE id='${mixedRequest}';`,true),/PT409:[^\n]*CLIENT_GAP_CURRENT_DRAFT_PROTECTED/);
 assert.match(sql(`INSERT INTO case_timeline_events(case_id,event_type,event_data,actor_type)VALUES('${mixedCase}','manual_action',jsonb_build_object('action_code','REQUEST_CLIENT_INFO_FOR_GAPS','dedupe_key','${mixedKey}','status','done'),'system');`,true),/PT409:[^\n]*CLIENT_GAP_CURRENT_ACTION_PROTECTED/);
 assert.equal(sql(`SELECT count(*) FROM case_timeline_events WHERE case_id='${mixedCase}'`),mixedEvents);
 assert.equal(sql(`SELECT event_data#>>'{draft_reply,body}' FROM case_timeline_events WHERE id='${mixedOld}'`),'SYNTHETIC OLD BODY');
 assert.equal(sql(`SELECT event_data#>>'{draft_reply,body}' FROM case_timeline_events WHERE id='${mixedDraft}'`),'SYNTHETIC PROTECTED BODY');
 results.push({check:'three-migration mixed state: legacy sync cannot cancel or complete protected newer work; both bodies stay intact',pass:true});
 assert.match(sql(`INSERT INTO client_gap_requests(id,case_id,gap_key,status,source_timeline_event_id)VALUES(gen_random_uuid(),'${mixedCase}','cargo.weight_kg','drafted','${mixedOld}');`,true),/PT409:[^\n]*CLIENT_GAP_LEGACY_WRITE_BLOCKED/);
 assert.equal(sql(`SELECT count(*) FROM client_gap_requests WHERE case_id='${mixedCase}'`),'1');
 results.push({check:'legacy generator cannot rebind a current request to its older source body',pass:true});
 assert.match(sql(`UPDATE client_gap_requests SET status='sent' WHERE id='${mixedRequest}';`,true),/PT409:[^\n]*CLIENT_GAP_EXPECTED_SOURCE_REQUIRED/);
 const ackHeaders=JSON.stringify({'x-dcq-client-gap-request-id':mixedRequest,'x-dcq-client-gap-source-id':mixedDraft});
 assert.equal(sql(`BEGIN;SET LOCAL request.headers=${q(ackHeaders)};UPDATE client_gap_requests SET status='sent' WHERE id='${mixedRequest}';SELECT status FROM client_gap_requests WHERE id='${mixedRequest}';ROLLBACK;`),'sent');
 assert.equal(sql(`SELECT status FROM client_gap_requests WHERE id='${mixedRequest}'`),'drafted');
 results.push({check:'legacy ACK refuses missing exact intent; exact synthetic ACK succeeds only inside a rolled-back test, without sent history',pass:true});
 const followupLock=await held(`SELECT client_gap_lock_v1('${mixedCase}')`);
 try{assert.match(sql(`UPDATE client_gap_requests SET status='cancelled' WHERE id='${mixedRequest}';`,true),/PT409:[^\n]*CLIENT_GAP_SCOPE_BUSY/);}finally{await followupLock.finish();}
 assert.equal(sql(`SELECT status FROM client_gap_requests WHERE id='${mixedRequest}'`),'drafted');
 results.push({check:'concurrent legacy follow-up writer fails fast under the combined SQL scope fence',pass:true});
 const legacyWriter=await held(`INSERT INTO quote_facts(fact_category,source_type,id,case_id,fact_key,value_text)VALUES('other','manual_input',gen_random_uuid(),'${legacy}','synthetic.ordinary-a','test')`);
 try{sql(`BEGIN;INSERT INTO quote_facts(fact_category,source_type,id,case_id,fact_key,value_text)VALUES('other','manual_input',gen_random_uuid(),'${legacy}','synthetic.ordinary-b','test');ROLLBACK;`);}finally{await legacyWriter.finish();}
 results.push({check:'ordinary legacy writers keep compatible concurrent access',pass:true});
 const sourceWriter=await held(`UPDATE pricing_rate_cards SET value=8 WHERE id='${sid}'`);
 let candidate;
 try{
  candidate=asyncSql(commitSql('50000000-0000-4000-8000-000000000003').replace('SELECT air_cross_trade_commit_pricing','SELECT /* source-race-candidate */ air_cross_trade_commit_pricing'));
  let waiting=false;for(let i=0;i<100;i++){waiting=sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND query LIKE '%source-race-candidate%' AND wait_event_type='Lock')")==='t';if(waiting)break;await new Promise(r=>setTimeout(r,25));}assert(waiting,'pricing must actually wait on selected source row');
 }finally{await sourceWriter.finish(true);}
 const raced=await candidate;assert.notEqual(raced.code,0);assert.match(raced.stderr,/40001/);assert.equal(sql('SELECT count(*) FROM pricing_runs'),'1');
 results.push({check:'source changed while commit waits is rejected after row lock',pass:true});
 sql(`UPDATE pricing_rate_cards SET value=4 WHERE id='${sid}';`);
 const positive=readState();assert(positive.evaluation?.pricing);
 sql("ALTER TABLE quote_cases ADD CONSTRAINT synthetic_reject_priced CHECK(status<>'PRICED_DRAFT');");
 try{assert.match(sql(commitSql('50000000-0000-4000-8000-000000000004',positive),true),/23514/);}finally{sql('ALTER TABLE quote_cases DROP CONSTRAINT synthetic_reject_priced;');}
 assert.equal(sql('SELECT count(*) FROM pricing_runs'),'1');assert.equal(sql('SELECT count(*) FROM air_cross_trade_pricing_receipts'),'1');results.push({check:'failure after run insertion rolls back run and receipt atomically',pass:true});
 assert.equal(sql(`SET request.jwt.claim.role='authenticated';SET request.jwt.claim.sub='10000000-0000-4000-8000-000000000002';SET ROLE authenticated;SELECT count(*) FROM air_cross_trade_plans;`),'1');
 assert.match(sql(`SET request.jwt.claim.role='authenticated';SET ROLE authenticated;SELECT air_cross_trade_read('${cid}','${uid}',NULL);`,true),/42501/);
 assert.match(sql(`SET request.jwt.claim.role='authenticated';SET ROLE authenticated;INSERT INTO air_cross_trade_plans(id)VALUES(gen_random_uuid());`,true),/42501/);
 assert.equal(sql(`SET request.jwt.claim.role='authenticated';SET request.jwt.claim.sub='10000000-0000-4000-8000-000000000003';SET ROLE authenticated;SELECT count(*) FROM air_cross_trade_plans;`),'0');
 sql(`UPDATE auth.users SET banned_until='2099-01-01' WHERE id='${uid}';`);
 try{assert.match(sql(role+`SELECT air_cross_trade_read('${cid}','${uid}',NULL);`,true),/42501/);}finally{sql(`UPDATE auth.users SET banned_until=NULL WHERE id='${uid}';`);}
 results.push({check:'RLS admitted read, outsider deny, direct RPC/write deny and revocation',pass:true});
 const current=readState(),newRequest=structuredClone(current.head.request);newRequest.plan.services[0].client_sale.amount_xof=1001;
 const plan={...current.head.plan,plan:newRequest.plan};
 const newer=JSON.parse(sql(role+`SELECT air_cross_trade_store_plan('40000000-0000-4000-8000-000000000002','${cid}','${uid}',${q(current.head.id)},${q(current.context_hash)},${q(current.sources_hash)},${q(JSON.stringify(newRequest))}::jsonb,${q(JSON.stringify(plan))}::jsonb);`));
 assert.equal(newer.revision,2);
 assert.match(sql(`INSERT INTO quotation_versions(id,case_id,pricing_run_id,version_number,status,is_selected,snapshot,created_by)VALUES(gen_random_uuid(),'${cid}',${q(run.id)},2,'draft',false,'{}','${uid}');`,true),/40001/);
 assert.equal(sql('SELECT count(*) FROM quotation_versions'),'1');results.push({check:'new plan invalidates new canonical insertion from old run without changing history',pass:true});
 assert.equal(sql(`SELECT value_text FROM quote_facts WHERE case_id='${cid}' AND fact_key='service.package' AND is_current`),'AIR_CROSS_TRADE');
 assert.equal(sql(`SELECT value_json->>'plan_id' FROM quote_facts WHERE case_id='${cid}' AND fact_key='service.air_cross_trade_requirements' AND is_current`),newer.id);
 assert.equal(sql(`SELECT count(*) FROM quote_facts WHERE case_id='${cid}' AND fact_key='routing.destination_city'`),'0');
 assert.equal(sql(`SELECT status||'/'||is_blocking FROM quote_gaps WHERE case_id='${cid}' AND gap_key='routing.destination_city'`),'resolved/false');
 assert.equal(sql(`SELECT string_agg(status,',' ORDER BY status) FROM client_gap_requests WHERE case_id='${cid}' AND gap_key='routing.destination_city'`),'drafted,sent');
 sql(`INSERT INTO quote_gaps(case_id,gap_key,status,is_blocking)VALUES('${cid}','routing.destination_city','open',true);`);
 assert.equal(sql(`SELECT count(*) FROM quote_gaps WHERE case_id='${cid}' AND gap_key='routing.destination_city' AND status='open'`),'0');
 results.push({check:'atomic service/requirements projection retires city without fabricating fact or rewriting sent/draft history; late writer fenced',pass:true});
 assert.match(sql(role+`UPDATE quote_cases SET request_type='AIR_IMPORT' WHERE id='${cid}';`,true),/40001/);
 assert.match(sql(`UPDATE quote_facts SET value_json='{}' WHERE case_id='${cid}' AND fact_key='service.air_cross_trade_requirements' AND is_current`,true),/42501/);
 results.push({check:'late service classification and forged requirement metadata refused',pass:true});
 const changed=structuredClone(newRequest);changed.requested_services.push('AGENCY');changed.plan.services.push({service_key:'AGENCY',disposition:'pending',reason:'SYNTHETIC addition'});
 const planCount=sql('SELECT count(*) FROM air_cross_trade_plans'),factCount=sql('SELECT count(*) FROM quote_facts');
 assert.match(sql(role+`SELECT air_cross_trade_store_plan(gen_random_uuid(),'${cid}','${uid}',${q(newer.id)},${q(newer.context_hash)},${q(current.sources_hash)},${q(JSON.stringify(changed))}::jsonb,${q(JSON.stringify({...newer.plan,plan:changed.plan}))}::jsonb);`,true),/explicit acknowledgement/);
 assert.equal(sql('SELECT count(*) FROM air_cross_trade_plans'),planCount);assert.equal(sql('SELECT count(*) FROM quote_facts'),factCount);
 results.push({check:'unacknowledged operator scope change rolls back new plan and fact history',pass:true});
 // Distinguish the outer client-scope fence from the independent stale AIR guard.
 const missingGapRows=sql('SELECT count(*) FROM client_gap_requests');
 assert.match(sql(`INSERT INTO client_gap_requests(case_id,gap_key,status)VALUES('${cid}','cargo.description','drafted');`,true),/PT409:[^\n]*CLIENT_GAP_SCOPE_CHANGED/);
 assert.equal(sql('SELECT count(*) FROM client_gap_requests'),missingGapRows);
 results.push({check:'combined client-scope fence rejects an absent open gap with PT409 and no new follow-up',pass:true});
 const staleQuestion=sql(`BEGIN;INSERT INTO quote_gaps(case_id,gap_key,status,is_blocking)VALUES('${cid}','cargo.description','open',true);INSERT INTO quote_facts(fact_category,source_type,id,case_id,fact_key,value_text)VALUES('other','manual_input',gen_random_uuid(),'${cid}','synthetic.changed','new');
 INSERT INTO client_gap_requests(case_id,gap_key,status)VALUES('${cid}','cargo.description','drafted');`,true);
 assert.match(staleQuestion,/40001/);assert.equal(sql("SELECT count(*) FROM quote_facts WHERE fact_key='synthetic.changed'"),'0');
 results.push({check:'stale requirements suspend a new customer question and whole transaction rolls back',pass:true});
 const afterNewer=readState();
 const sourceConflict=sql(`BEGIN;INSERT INTO quote_email_fact_revisions(case_id,fact_key,command_key,batch_hash,request,status,reason,source_evidence,response)VALUES('${cid}','cargo.weight_kg','synthetic-conflict','hash','{}','conflict','SYNTHETIC','{}','{}');`+commitSql('50000000-0000-4000-8000-000000000008',afterNewer),true);
 assert.match(sourceConflict,/PT409/);assert.equal(sql('SELECT count(*) FROM pricing_runs'),'1');
 results.push({check:'ordered source conflict cannot be bypassed by dedicated pricing writer',pass:true});
 const intentBlocked=sql(`BEGIN;INSERT INTO case_timeline_events(case_id,event_type,event_data)VALUES('${cid}','thread_intent_v1','{"intent":{"pricing_gate":false,"intent_type":"general_inquiry"}}');`+"SET request.jwt.claim.role='service_role';"+`
 SELECT air_cross_trade_store_plan('40000000-0000-4000-8000-000000000009','${cid}','${uid}',${q(newer.id)},md5(_air_cross_trade_context('${cid}')::text),${q(current.sources_hash)},${q(JSON.stringify(newRequest))}::jsonb,${q(JSON.stringify(newer.plan))}::jsonb);
 SELECT air_cross_trade_commit_pricing(gen_random_uuid(),'${cid}','${uid}','40000000-0000-4000-8000-000000000009',md5(_air_cross_trade_context('${cid}')::text),${q(current.sources_hash)},'{}');`,true);
 assert.match(intentBlocked,/blocked by intent/);assert.equal(sql('SELECT count(*) FROM pricing_runs'),'1');
 results.push({check:'current intent gate independently blocks dedicated pricing without run or persisted test plan',pass:true});
 // Each sql() is its own connection, so use one explicit transaction for every stale/history assertion.
 const staleSourceRead=sql(`BEGIN;UPDATE pricing_rate_cards SET notes='SYNTHETIC CHANGED CONDITION' WHERE id='${sid}';`+role+`SELECT air_cross_trade_requirements_read('${cid}','${uid}') IS NULL;ROLLBACK;`);assert.equal(staleSourceRead,'t');
 const staleHistorical=sql(`BEGIN;UPDATE pricing_rate_cards SET notes='SYNTHETIC CHANGED CONDITION' WHERE id='${sid}';
 UPDATE client_gap_requests SET source_timeline_event_id=NULL,response_email_id=NULL WHERE case_id='${cid}' AND status='sent';
 UPDATE client_gap_requests SET status='sent' WHERE case_id='${cid}' AND status='drafted';
 SELECT count(*) FROM client_gap_requests WHERE case_id='${cid}' AND status='sent';ROLLBACK;`);assert.equal(staleHistorical,'2');
 const staleNew=sql(`BEGIN;INSERT INTO quote_gaps(case_id,gap_key,status,is_blocking)VALUES('${cid}','cargo.description','open',true);UPDATE pricing_rate_cards SET notes='SYNTHETIC CHANGED CONDITION' WHERE id='${sid}';INSERT INTO client_gap_requests(case_id,gap_key,status)VALUES('${cid}','cargo.description','drafted');`,true);assert.match(staleNew,/40001/);
 results.push({check:'changed source suspends requirements/new questions while historical FK cleanup and sent acknowledgement remain possible',pass:true});
 assert.match(sql(`INSERT INTO pricing_runs(id,case_id,run_number,status,engine_version)VALUES(gen_random_uuid(),'${cid}',99,'running','legacy_import');`,true),/Use retained AIR/);
 assert.equal(sql('SELECT count(*) FROM pricing_runs'),'1');results.push({check:'late legacy import worker cannot insert a Cross pricing run',pass:true});
 const cascade=sql(`BEGIN;DELETE FROM quote_cases WHERE id='${cid}';SELECT count(*) FROM air_cross_trade_plans WHERE case_id='${cid}';ROLLBACK;`);assert.equal(cascade,'0');assert.equal(sql('SELECT count(*) FROM air_cross_trade_plans'),planCount);
 results.push({check:'existing explicit case cascade is not blocked by derived metadata; rollback restores history',pass:true});
 assert.equal(sql(`SELECT source_type||'/'||is_validated FROM quote_facts WHERE case_id='${cid}' AND fact_key='service.air_cross_trade_requirements' AND is_current`),'quotation_engine/false');
 assert.match(sql(`INSERT INTO quote_facts(id,case_id,fact_key,fact_category,source_type)VALUES(gen_random_uuid(),'${legacy}','synthetic.system','other','system');`,true),/quote_facts_source_type_check/);
 results.push({check:'exact Cloud source-type CHECK rejects system; derived engine provenance saves without human validation',pass:true});
 const gw='20000000-0000-4000-8000-000000000003',gwSource='30000000-0000-4000-8000-000000000003';
 sql(`INSERT INTO quote_cases(id,request_type,status,created_by)VALUES('${gw}','AIR_IMPORT','NEED_INFO','${uid}');
 INSERT INTO locations_reference(id,country_code,country_name)VALUES(gen_random_uuid(),'BE','Belgium');
 INSERT INTO pricing_rate_cards(id,status,service_key,unit,value,currency,min_charge,origin_country,destination_country,origin_port,destination_port,effective_from,effective_to)VALUES('${gwSource}','active','AIR_FREIGHT','kg',4,'XOF',NULL,'Guinea-Bissau','Belgium','AAA','BBB','2020-01-01','2099-12-31');`);
 const gwFacts=[['routing.origin_country','Guinea-Bissau',null],['routing.destination_country','Belgium',null],['routing.destination_airport','BBB',null],['cargo.description','SYNTHETIC GOODS; NO REAL CARRIER AGREEMENT',null],['cargo.weight_kg',null,30]];
 gwFacts.forEach(([key,text,number])=>sql(`INSERT INTO quote_facts(id,case_id,fact_key,fact_category,value_text,value_number,source_type,source_email_id)VALUES(gen_random_uuid(),'${gw}',${q(key)},${q(key.split('.')[0])},${text===null?'NULL':q(text)},${number??'NULL'},'ai_extraction','70000000-0000-4000-8000-000000000003');`));
 assert.equal(sql("SELECT count(*) FROM locations_reference WHERE country_code='GW'"),'0');
 const gwResult=JSON.parse(execFileSync('deno',['run','--import-map=scripts/deno-ci-imports.json','--no-lock','--node-modules-dir=none','--allow-env','--allow-read','--allow-run=docker','scripts/air-cross-trade/sql-driver.ts',name,'gw'],{cwd:repo,encoding:'utf8',stdio:['pipe','pipe','pipe']}));
 assert.deepEqual(gwResult,{status:'PASS',country_without_location:true,choice_available:true,price_xof:1000});
 assert.equal(sql(`SELECT plan#>>'{country_normalization,origin_country,normalization_reference}' FROM air_cross_trade_plans WHERE case_id='${gw}'`),'request-country-aliases-v1:GW');
 assert.equal(sql(`SELECT outputs_json#>>'{air_cross_trade,country_normalization,origin_country,source_value}' FROM pricing_runs WHERE case_id='${gw}'`),'Guinea-Bissau');
 assert.equal(sql(`SELECT count(*) FROM locations_reference WHERE country_code='GW'`),'0');
 results.push({check:'GW absent from places: actual service read choices/save/run succeed with versioned original country evidence and no fake location',pass:true});
 // The legacy scenario ledger is separate from canonical pricing_runs.
 const scenarioLegacy='81000000-0000-4000-8000-000000000001',scenarioCross='81000000-0000-4000-8000-000000000002',scenarioHash='a'.repeat(64);
 sql(`INSERT INTO quote_scenarios(id,case_id,status,scope_hash,scope_snapshot)VALUES
 ('${scenarioLegacy}','${legacy}','draft','${scenarioHash}','{"transport_mode":"AIR","movement_direction":"IMPORT","cargo_units":[]}'),
 ('${scenarioCross}','${cid}','draft','${scenarioHash}','{"transport_mode":"AIR","movement_direction":"IMPORT","cargo_units":[]}');`);
 const scenarioRecord=(caseId,scenarioId,key)=>{
  // Build the synthetic loader snapshot outside the service-role RPC transaction;
  // do not add table grants merely to make this test payload construction work.
  const payload=sql(`SELECT jsonb_build_object('status','success','qualification','provisional','blockers','[]'::jsonb,
 'scenario_snapshot',(SELECT scope_snapshot FROM quote_scenarios WHERE id='${scenarioId}'),'inputs_json','{}'::jsonb,
 'facts_snapshot',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM quote_facts f WHERE case_id='${caseId}' AND is_current),'[]'::jsonb),
 'assumptions_snapshot','[]'::jsonb,'overlay_json','[]'::jsonb,'reservations','[]'::jsonb,
 'tariff_lines','[]'::jsonb,'tariff_sources','[]'::jsonb,'firm_total_ht',100,'firm_total_ttc',100,'indicative_total_ht',100,'indicative_total_ttc',100,'currency','XOF','duration_ms',0)`);
  return role+`SELECT public.record_quote_scenario_pricing_run('${caseId}','${scenarioId}','${scenarioHash}','${key}','${scenarioHash}','${uid}',${q(payload)}::jsonb);`;
 };
 const legacyScenarioRun=JSON.parse(sql(scenarioRecord(legacy,scenarioLegacy,'synthetic-legacy-1')));
 assert.equal(legacyScenarioRun.status,'success');
 assert.equal(JSON.parse(sql(scenarioRecord(legacy,scenarioLegacy,'synthetic-legacy-1'))).pricing_run_id,legacyScenarioRun.pricing_run_id);
 assert.equal(sql('SELECT count(*) FROM quote_scenario_pricing_runs'),'1');
 results.push({check:'actual legacy scenario RPC positive and exact replay preserved',pass:true});
 const legacyVersion='82000000-0000-4000-8000-000000000001';
 const scenarioVersion=(id,number)=>`INSERT INTO quotation_versions(id,case_id,source_kind,scenario_pricing_run_id,version_number,status,is_selected,snapshot)VALUES('${id}','${legacy}','scenario',${q(legacyScenarioRun.pricing_run_id)},${number},'draft',false,'{}');`;
 sql(scenarioVersion(legacyVersion,-1));
 results.push({check:'normal legacy scenario version insertion remains possible',pass:true});

 assert.match(sql(scenarioRecord(cid,scenarioCross,'synthetic-cross-1'),true),/40001/);
 assert.equal(sql('SELECT count(*) FROM quote_scenario_pricing_runs'),'1');assert.equal(sql('SELECT count(*) FROM quote_scenario_pricing_mutations'),'1');
 results.push({check:'late legacy worker cannot persist Cross scenario success; actual RPC rolls back run and mutation',pass:true});
 const exclusiveScenario=await held(`SELECT pg_advisory_xact_lock(hashtextextended('air_cross_trade:${legacy}',0))`);
 try{assert.match(sql(scenarioRecord(legacy,scenarioLegacy,'synthetic-busy-1'),true),/40001/);}finally{await exclusiveScenario.finish();}
 results.push({check:'scenario insert refuses promptly while a Cross plan owns the exclusive case fence',pass:true});
 const scenarioWriter=await held(scenarioRecord(legacy,scenarioLegacy,'synthetic-inflight-1'));
 try{
  assert.match(sql(role+`SELECT air_cross_trade_store_plan(gen_random_uuid(),'${legacy}','${uid}',NULL,'x','x','{}','{}');`,true),/40001/);
  assert.match(sql(`INSERT INTO quote_facts(case_id,fact_key,fact_category,source_type,value_text)VALUES('${legacy}','service.package','service','operator','AIR_CROSS_TRADE');`,true),/40001/);
 }finally{await scenarioWriter.finish();}
 assert.equal(sql('SELECT count(*) FROM quote_scenario_pricing_runs'),'1');
 results.push({check:'scenario transaction fences plan retention until outcome; rollback restores legacy history',pass:true});
 // A case edit outside the plan endpoint also serializes with the late writer.
 const classWriter=await held(`UPDATE quote_cases SET request_type='AIR_CROSS_TRADE' WHERE id='${legacy}'`);
 let lateScenario;
 try{
  lateScenario=asyncSql(scenarioRecord(legacy,scenarioLegacy,'synthetic-reclassified-1').replace('SELECT public.record_quote_scenario','SELECT /* scenario-class-race */ public.record_quote_scenario'));
  let waiting=false;for(let i=0;i<100;i++){waiting=sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND query LIKE '%scenario-class-race%' AND wait_event_type='Lock')")==='t';if(waiting)break;await new Promise(r=>setTimeout(r,25));}assert(waiting,'late scenario must actually wait for the current case row');
 }finally{await classWriter.finish(true);}
 const lateOutcome=await lateScenario;assert.notEqual(lateOutcome.code,0);assert.match(lateOutcome.stderr,/40001/);
 assert.equal(sql('SELECT count(*) FROM quote_scenario_pricing_runs'),'1');
 results.push({check:'concurrent committed reclassification is re-read after row wait and rejects the old engine result',pass:true});
 const historicalReplay=JSON.parse(sql(scenarioRecord(legacy,scenarioLegacy,'synthetic-legacy-1')));
 assert.equal(historicalReplay.pricing_run_id,legacyScenarioRun.pricing_run_id);assert.equal(historicalReplay.idempotent_replay,true);
 assert.equal(sql(`SELECT status FROM quote_scenario_pricing_runs WHERE id=${q(legacyScenarioRun.pricing_run_id)}`),'success');
 results.push({check:'historical scenario receipt remains readable/replayable after Cross classification, without a new run',pass:true});
 assert.match(sql(scenarioVersion('82000000-0000-4000-8000-000000000002',-2),true),/40001/);
 assert.equal(sql(`SELECT count(*) FROM quotation_versions WHERE case_id='${legacy}'`),'1');
 assert.equal(sql(`SELECT snapshot::text FROM quotation_versions WHERE id='${legacyVersion}'`),'{}');
 results.push({check:'late scenario version is refused after Cross classification; the old version stays unchanged',pass:true});

 sql(`UPDATE quote_cases SET request_type='AIR_IMPORT' WHERE id='${legacy}';INSERT INTO quote_facts(case_id,fact_key,fact_category,source_type,value_text)VALUES('${legacy}','service.package','service','operator','AIR_CROSS_TRADE');`);
 assert.match(sql(scenarioRecord(legacy,scenarioLegacy,'synthetic-cross-package-1'),true),/40001/);
 assert.equal(sql('SELECT count(*) FROM quote_scenario_pricing_runs'),'1');
 results.push({check:'Cross package alone also blocks the legacy ledger despite a stale import case type',pass:true});
 assert.equal(sql("SELECT has_function_privilege('authenticated','public._air_cross_trade_assert_legacy_scenario(uuid)','EXECUTE') OR has_function_privilege('anon','public._air_cross_trade_assert_legacy_scenario(uuid)','EXECUTE')"),'f');
 results.push({check:'new assertion remains private without expanding client grants',pass:true});
 assert.equal(sql(`BEGIN;DROP TRIGGER air_cross_trade_scenario_guard ON quote_scenario_pricing_runs;SELECT count(*) FROM quote_scenario_pricing_runs;ROLLBACK;`),'1');
 assert.equal(sql("SELECT count(*) FROM pg_trigger WHERE tgname='air_cross_trade_scenario_guard' AND NOT tgisinternal"),'1');
 assert.equal(sql('SELECT count(*) FROM quote_scenario_pricing_runs'),'1');
 results.push({check:'transactional guard rollback preserves ledger and restores protection, without data deletion',pass:true});

 console.log(JSON.stringify({status:'PASS',name,proof,results},null,2));
 }catch(error){fs.writeFileSync(path.join(proof,'sql-failure.txt'),error.stack||String(error));throw error;}
 finally{if(created){const inspect=JSON.parse(docker(['inspect',name]))[0];assert.equal(inspect.Name,'/'+name);assert.equal(inspect.HostConfig.NetworkMode,'none');assert.equal(inspect.Mounts.some(m=>m.Type==='volume'||m.Type==='bind'),false);docker(['rm','-f',name]);let absent=false;try{docker(['inspect',name]);}catch{absent=true;}assert(absent);fs.writeFileSync(path.join(proof,'container-cleanup.json'),JSON.stringify({name,absent_verified:absent},null,2));}}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
