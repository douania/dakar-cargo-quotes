const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
module.exports=async function({sql,session,waitFor,delay,id,actor,settings,q,j,results,repo}){
 sql('ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated,service_role');
 sql(fs.readFileSync(path.join(repo,'supabase/migrations/20261020093000_versioned_equipment_reprocessing.sql'),'utf8'));
 sql(fs.readFileSync(path.join(repo,'supabase/migrations/20261020101000_equipment_quantity_boundaries.sql'),'utf8'));
 let serial=6000;const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
 const check=(name,fn)=>{try{fn();}catch(error){throw new Error('equipment repair: '+name+': '+error.stack);}results.push({name:'equipment repair: '+name,status:'PASS'});};
 const current=x=>JSON.parse(sql("SELECT to_jsonb(f) FROM quote_facts f WHERE case_id="+q(x.c)+" AND fact_key='cargo.containers' AND is_current"));
 const manifest=x=>JSON.parse(sql("SELECT jsonb_agg(jsonb_build_object('id',id,'from_address',from_address,'sent_at',sent_at,'sha256',encode(sha256(convert_to(body_text,'UTF8')),'hex')) ORDER BY id) FROM emails WHERE thread_ref="+q(x.thread)));
 const groups=(x,type='40HC')=>[{key:'cargo.containers',category:'cargo',candidates:[{email_id:x.e,body_sha256:hash(x.body),excerpt:x.body,value_type:'json',value:[{quantity:1,type}],source_type:'email_body',confidence:.9,evidence_error:null}]}];
 const apply=(x,type,key,more=[])=>JSON.parse(sql(settings+"SELECT apply_case_email_fact_revisions("+q(x.c)+","+q(actor)+","+q(key)+","+j([{...groups(x,type)[0],candidates:[...groups(x,type)[0].candidates,...more]}])+","+j(manifest(x))+")")).decisions[0];
 const seed=(body='No. of containers: 1 x 40\u2019HC')=>{const n=serial;serial+=10;const x={c:id(n),thread:id(n+1),e:id(n+2),body,initial:null};
  sql("INSERT INTO quote_cases(id,created_by,status,thread_id) VALUES("+q(x.c)+","+q(actor)+",'NEED_INFO',"+q(x.thread)+");"+
   "INSERT INTO emails(id,thread_ref,body_text,from_address,sent_at) VALUES("+q(x.e)+","+q(x.thread)+","+q(x.body)+",'client@fixture.invalid','2026-10-16T05:07:35Z')");
  x.initial=apply(x,'40GP','initial-'+n);apply(x,'40HC','corrected-'+n);return x;
 };
 const args=(x,label='base')=>{const f=current(x);return {p_case:x.c,p_actor:actor,p_command:'equipment-v2:'+hash(x.c+label),p_expected_fact:f.id,p_expected_revision:f.source_revision_id,p_groups:groups(x),p_manifest:manifest(x)};};
 const statement=p=>"SELECT reprocess_case_equipment("+[q(p.p_case),q(p.p_actor),q(p.p_command),q(p.p_expected_fact),q(p.p_expected_revision),j(p.p_groups),j(p.p_manifest)].join(',')+")";
 const repair=p=>JSON.parse(sql(settings+statement(p)));
 const snapshot=x=>sql("SELECT md5(jsonb_build_object('f',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM quote_facts f WHERE case_id="+q(x.c)+"),'r',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM quote_email_fact_revisions r WHERE case_id="+q(x.c)+"),'e',(SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at) FROM case_timeline_events e WHERE case_id="+q(x.c)+"))::text)");
 const refused=(s,re)=>{let error;try{sql(s);}catch(e){error=String(e.stderr||e.message);}assert(error,'Expected refusal');assert.match(error,re);};
 const unresolved=x=>sql("SELECT count(*) FROM quote_email_fact_revisions r WHERE case_id="+q(x.c)+" AND status IN('conflict','protected') AND NOT EXISTS(SELECT 1 FROM quote_email_fact_revisions y WHERE y.resolves_revision_id=r.id AND y.status='resolved')");
 const historical=seed(),legacyAi={...groups(historical,"40'HC")[0].candidates[0],source_type:'ai_extraction'};
 apply(historical,'40HC','mixed-ai-real',[legacyAi]);
 assert.equal(JSON.parse(sql("SELECT source_evidence FROM quote_email_fact_revisions WHERE id="+q(current(historical).source_revision_id))).selected,null);
 const legacyLines=fs.readFileSync(path.join(repo,'supabase/migrations/20260224155241_bac071e7-ec75-4aa9-9bdb-4d138d656305.sql'),'utf8'),linesStart=legacyLines.indexOf('CREATE OR REPLACE FUNCTION public.replace_quote_request_lines(');
 assert(linesStart>=0);sql("ALTER TABLE quote_request_lines ALTER COLUMN id SET DEFAULT gen_random_uuid();ALTER TABLE quote_request_lines ADD COLUMN line_index integer,ADD COLUMN line_label text,ADD COLUMN request_type_hint text,ADD COLUMN confidence numeric,ADD COLUMN source_email_id uuid,ADD COLUMN source_excerpt text,ADD COLUMN segment_text text,ADD COLUMN extracted_facts_json jsonb,ADD COLUMN meta_json jsonb;");
 sql(legacyLines.slice(linesStart,legacyLines.indexOf('$$;',linesStart)+3));sql('REVOKE ALL ON FUNCTION replace_quote_request_lines(uuid,jsonb) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION replace_quote_request_lines(uuid,jsonb) TO service_role');
 const notationSql=fs.readFileSync(path.join(repo,'supabase/migrations/20261020104000_equipment_notation_receipts.sql'),'utf8');sql(notationSql);
 check('closed SQL type matrix agrees with all46declared aliases and preserves subtypes',()=>{
  const aliases=JSON.parse(/aliases jsonb:='([^']+)'/.exec(notationSql)[1]);assert.equal(Object.keys(aliases).length,46);
  for(const [raw,type] of Object.entries(aliases))for(const variant of [raw,raw.toLowerCase(),raw.slice(0,2)+'\u2032 '+raw.slice(2),raw.slice(0,2)+' ft '+raw.slice(2),raw.slice(0,2)+' pieds '+raw.slice(2)])assert.equal(sql('SELECT container_designation_type('+q(variant)+')'),type,variant);
  for(const raw of ['40',"40'",'45G1','L5G1','40/45HC','40RFHC','40HCOT','20FR DG SOC','40NOR','53HC','2040','400','40 000 USD'])assert.equal(sql('SELECT container_designation_type('+q(raw)+') IS NULL'),'t',raw);
  const value=[{type:'20\u2019 DC',quantity:2,coc_soc:'SOC',unit_ref:'a'},{type:'40_HQ',quantity:3,unit_ref:'b'}];
  assert.deepEqual(JSON.parse(sql('SELECT equipment_notation_inventory('+j(value)+')')),[{...value[0],type:'20GP'},{...value[1],type:'40HC'}]);
 });
 check('canonical comparisons leave manual and validated alias facts byte-identical',()=>{
  for(const [raw,type] of [['40DV','40GP'],['40DC','40GP'],['40ST','40GP'],['40HQ','40HC']])for(const protect of ['manual','validated']){
   const z=seed('No. of containers:1 x '+raw);
   sql("SELECT supersede_fact("+q(z.c)+",'cargo.containers','cargo',p_value_json:="+j([{type:raw,quantity:1}])+",p_source_type:='manual_input')");
   if(protect==='validated')sql("UPDATE quote_facts SET source_type='email_body',is_validated=true WHERE id="+q(current(z).id));
   const before=current(z);assert.equal(apply(z,type,'equivalent-'+raw+'-'+protect).reason,'protected_value_unchanged');assert.deepEqual(current(z),before);
  }
  for(const validated of [false,true]){
   const z=seed();sql("SELECT supersede_fact("+q(z.c)+",'cargo.containers','cargo',p_value_json:="+j([{type:'40TK',quantity:1}])+",p_source_type:='manual_input')");
   if(validated)sql("UPDATE quote_facts SET source_type='email_body',is_validated=true WHERE id="+q(current(z).id));
   const before=current(z);assert.equal(apply(z,'40RH','different-unknown').status,'protected');assert.deepEqual(current(z),before);
  }
 });
 check('Unicode HQ defect repair derives canonical HC while retaining its original own excerpt',()=>{
  const z=seed('No. of containers:1 x 40\u2019HQ'),before=current(z);assert.equal(repair(args(z)).status,'applied');
  assert.equal(current(z).value_json[0].type,'40HC');assert.equal(current(z).source_excerpt,before.source_excerpt);assert.equal(unresolved(z),'0');
 });
 check('mixed equipment cannot be misclassified as registered defect',()=>{for(const other of ['1x40GP','1x45GP','45HC'])assert.equal(sql('SELECT unicode_equipment_inventory('+q(other+'; 1x40\u2019HC')+') IS NULL'),'t',other);});
 check('plain years and bare numbers are not equipment; explicit quantity separator is required',()=>{
  for(const body of ['Established 2020. No. of containers: 1 x 40\u2019HC','2020\n1x40\u2019HC','1 40\u2019HC'])assert.deepEqual(JSON.parse(sql('SELECT unicode_equipment_inventory('+q(body)+')')),[{quantity:1,type:'40HC'}]);
  for(const body of ['2020','140\u2019HC','720'])assert.equal(sql('SELECT unicode_equipment_inventory('+q(body)+') IS NULL'),'t');
 });
 check('real mixed AI feet notation with null selected receipt repairs without rewriting history',()=>{
  const z=historical;
  const receipt=JSON.parse(sql("SELECT source_evidence FROM quote_email_fact_revisions WHERE id="+q(current(z).source_revision_id)));assert.equal(receipt.selected,null);
  const prior=sql("SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM quote_email_fact_revisions r WHERE case_id="+q(z.c));
  assert.equal(repair(args(z)).status,'applied');assert.equal(current(z).value_json[0].type,'40HC');assert.equal(unresolved(z),'0');
  assert.equal(sql("SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM quote_email_fact_revisions r WHERE case_id="+q(z.c)+" AND reason<>'parser_correction'"),prior);
 });
 check('notation conflict with different quantity, class, source or unproven excerpt remains unresolved',()=>{
  for(const kind of ['quantity','class','source','excerpt']){
   const z=seed(),ai={...groups(z,"40'HC")[0].candidates[0],source_type:'ai_extraction'};
   if(kind==='quantity')ai.value=[{quantity:2,type:"40'HC"}];
   if(kind==='class')ai.value=[{quantity:1,type:'40RF'}];
   if(kind==='excerpt')ai.excerpt='Unproven text';
   if(kind==='source'){const other=id(serial++);sql("INSERT INTO emails(id,thread_ref,body_text,from_address,sent_at) VALUES("+q(other)+","+q(z.thread)+","+q(z.body)+",'other@fixture.invalid','2026-10-16T05:07:35Z')");ai.email_id=other;}
   apply(z,'40HC','mixed-different-'+kind,[ai]);const before=snapshot(z);
   assert.equal(repair(args(z)).status,'not_eligible',kind);assert.equal(snapshot(z),before,kind);assert.notEqual(unresolved(z),'0');
  }
 });
 const x=seed(),p=args(x),old=current(x),oldReceipts=sql("SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM quote_email_fact_revisions r WHERE case_id="+q(x.c));
 let result;
 check('atomic successor derives HC from immutable own receipt, resolves only mechanical gap',()=>{
  sql("INSERT INTO quote_gaps(case_id,gap_key,status,is_blocking) VALUES("+q(x.c)+",'source_contract.export_customs','open',true)");
  result=repair(p);const f=current(x);assert.equal(result.status,'applied');assert.equal(result.reason,'parser_correction');assert.equal(f.value_json[0].type,'40HC');assert.equal(f.supersedes_fact_id,old.id);assert.equal(f.is_validated,false);assert.equal(unresolved(x),'0');
  assert.equal(sql("SELECT status FROM quote_gaps WHERE case_id="+q(x.c)+" AND gap_key='source_contract.export_customs'"),'open');
  assert.equal(sql("SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM quote_email_fact_revisions r WHERE case_id="+q(x.c)+" AND reason<>'parser_correction'"),oldReceipts);
  assert.equal(sql("SELECT count(*) FROM case_timeline_events WHERE case_id="+q(x.c)+" AND event_data->>'reason'='parser_correction' AND event_data->>'status'='applied'"),'1');
 });
 check('exact recovery is immutable; divergent same command fails without mutation',()=>{
  const before=snapshot(x);assert.equal(repair(p).replay,true);assert.equal(snapshot(x),before);
  refused(settings+statement({...p,p_expected_fact:id(999)}),/idempotency conflict/);assert.equal(snapshot(x),before);
 });
 check('retired old GP and mixed GP+HC with fresh commands cannot recreate conflict',()=>{
  const f=current(x);assert.equal(apply(x,'40GP','legacy-new-gp').reason,'retired_parser_output');
  assert.equal(apply(x,'40HC','legacy-mixed',[groups(x,'40GP')[0].candidates[0]]).status,'unchanged');
  assert.deepEqual(current(x),f);assert.equal(unresolved(x),'0');
  const replay=apply(x,'40GP','initial-'+Number(x.c.slice(0,8)));assert.equal(replay.replay,true);assert.equal(replay.revision_id,x.initial.revision_id);
 });
 check('validation of same HC survives both retired legacy commands unchanged',()=>{
  sql("UPDATE quote_facts SET is_validated=true WHERE id="+q(current(x).id));const f=current(x);
  assert.equal(apply(x,'40GP','validated-legacy-gp').status,'ignored');assert.equal(apply(x,'40HC','validated-legacy-mixed',[groups(x,'40GP')[0].candidates[0]]).status,'unchanged');assert.deepEqual(current(x),f);assert.equal(unresolved(x),'0');
 });
 check('different quantity is a real new conflict, not a retired output',()=>{
  const z=seed();repair(args(z));const candidate=groups(z,'40GP')[0].candidates[0];candidate.value[0].quantity=2;
  const d=apply(z,'40HC','changed-quantity',[candidate]);assert.equal(d.status,'conflict');assert.equal(unresolved(z),'1');assert.equal(current(z).value_json[0].type,'40HC');
 });
 for(const kind of ['validated','manual','source','manifest','candidate','unrelated'])check(kind+' rejects without partial writes',()=>{
  const z=seed(),a=args(z);
  if(kind==='validated')sql("UPDATE quote_facts SET is_validated=true WHERE id="+q(a.p_expected_fact));
  if(kind==='manual')sql("SELECT supersede_fact("+q(z.c)+",'cargo.containers','cargo',p_value_json:='[{\"quantity\":1,\"type\":\"40HQ\"}]',p_source_type:='manual_input')");
  if(kind==='source')sql("UPDATE emails SET body_text=body_text||' amended' WHERE id="+q(z.e));
  if(kind==='manifest')a.p_manifest=[];
  if(kind==='candidate')a.p_groups[0].candidates[0].value[0].quantity=2;
  if(kind==='unrelated'){apply(z,'40RF','unrelated-new-source');a.p_expected_revision=current(z).source_revision_id;}
  const before=snapshot(z);if(['candidate','unrelated'].includes(kind))assert.equal(repair(a).status,'not_eligible');else refused(settings+statement(a),/state changed|source collection changed|protected/);assert.equal(snapshot(z),before);
 });
 check('timeline failure rolls all successor/receipt/gap changes back',()=>{
  const z=seed(),a=args(z),before=snapshot(z);
  sql("CREATE FUNCTION equipment_event_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.case_id="+q(z.c)+" AND NEW.event_data->>'reason'='parser_correction' THEN RAISE EXCEPTION 'equipment event failure';END IF;RETURN NEW;END;$$;CREATE TRIGGER equipment_event_fail BEFORE INSERT ON case_timeline_events FOR EACH ROW EXECUTE FUNCTION equipment_event_fail()");
  refused(settings+statement(a),/equipment event failure/);assert.equal(snapshot(z),before);sql('DROP TRIGGER equipment_event_fail ON case_timeline_events;DROP FUNCTION equipment_event_fail()');
 });
 check('explicit new RPC grants and hidden helper ACL',()=>{
  for(const signature of ['reprocess_case_equipment(uuid,uuid,text,uuid,uuid,jsonb,jsonb)','unicode_equipment_inventory(text)','retired_equipment_candidate(uuid,jsonb)','equipment_notation_inventory(jsonb)','container_designation_type(text)','container_revision_value_key(text,text,jsonb)']){
   assert.equal(sql("SELECT has_function_privilege('anon',"+q(signature)+",'execute') OR has_function_privilege('authenticated',"+q(signature)+",'execute')"),'f');
   assert.equal(sql("SELECT has_function_privilege('service_role',"+q(signature)+",'execute')"),signature.startsWith('reprocess')?'t':'f');
  }
  refused('SET ROLE authenticated;'+statement(p),/permission denied/);
 });
 const z=seed(),a=args(z,'A'),b=args(z,'B'),h=session('equipment-lock');h.p.stdin.write("BEGIN;SELECT id FROM quote_cases WHERE id="+q(z.c)+" FOR NO KEY UPDATE;SELECT 'HELD';\n");
 for(let i=0;i<100&&!h.out().includes('HELD');i++)await delay(25);assert(h.out().includes('HELD'));
 const wa=session('equipment-A'),wb=session('equipment-B');wa.p.stdin.end(statement(a)+';\n\\q\n');wb.p.stdin.end(statement(b)+';\n\\q\n');
 await waitFor('equipment-A');await waitFor('equipment-B');h.p.stdin.end('COMMIT;\n\\q\n');await h.done;
 const outcomes=await Promise.all([wa.done,wb.done]);assert.deepEqual(outcomes.map(r=>r.code===0).sort(),[false,true]);assert.equal(current(z).value_json[0].type,'40HC');results.push({name:'equipment repair: two real overlapping distinct commands produce one successor',status:'PASS',actualOverlap:true});
 for(const kind of ['manual','ban','role']){
  const z=seed(),a=args(z,kind),hold=session('equipment-wait-'+kind),writer=session('equipment-writer-'+kind);
  hold.p.stdin.write("BEGIN;"+(kind==='manual'?"SELECT id FROM quote_cases WHERE id="+q(z.c)+" FOR UPDATE;":"")+"SELECT pg_advisory_xact_lock(hashtext("+q(z.c+'cargo.containers')+"));SELECT 'HELD';\n");
  for(let i=0;i<100&&!hold.out().includes('HELD');i++)await delay(25);assert(hold.out().includes('HELD'));
  writer.p.stdin.end(statement(a)+';\n\\q\n');await waitFor('equipment-writer-'+kind);
  if(kind==='ban')sql("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id="+q(actor));
  if(kind==='role')sql("DELETE FROM app_roles WHERE user_id="+q(actor));
  hold.p.stdin.end((kind==='manual'?"SELECT supersede_fact("+q(z.c)+",'cargo.containers','cargo',p_value_json:='[{\"quantity\":1,\"type\":\"40HQ\"}]',p_source_type:='manual_input');":'')+"COMMIT;\n\\q\n");
  assert.equal((await hold.done).code,0);const out=await writer.done;assert.notEqual(out.code,0,out.err);assert.match(out.err,/forbidden|protected|state changed/);
  if(kind==='ban')sql("UPDATE auth.users SET banned_until=NULL WHERE id="+q(actor));
  if(kind==='role')sql("INSERT INTO app_roles VALUES("+q(actor)+",'workspace_operator')");
  results.push({name:'equipment repair: '+kind+' during real advisory-lock wait is respected',status:'PASS',actualOverlap:true});
 }
 await require('./request_line_history.cjs')({sql,session,waitFor,delay,id,actor,settings,q,j,results});
 results.push({name:'equipment repair: exact installed function fingerprints',status:'PASS',functions:JSON.parse(sql("SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'md5',md5(replace(pg_get_functiondef(p.oid),chr(13),'')))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('unicode_equipment_inventory','retired_equipment_candidate','reprocess_case_equipment','apply_case_email_fact_revisions','supersede_fact','equipment_notation_inventory','container_designation_type','container_revision_value_key','replace_quote_request_lines')"))});
};
