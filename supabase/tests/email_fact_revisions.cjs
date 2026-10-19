// Extends the lifecycle bench: the same isolated real PostgreSQL, no external service.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
module.exports=async function({sql,session,waitFor,delay,id,actor,settings,q,j,results,repo}){
 const hash=s=>crypto.createHash('sha256').update(s).digest('hex');let serial=1000;
 sql(`ALTER TABLE quote_cases ADD COLUMN thread_id uuid;ALTER TABLE case_timeline_events ADD COLUMN created_at timestamptz DEFAULT now();
 CREATE TABLE emails(id uuid PRIMARY KEY,thread_ref uuid,body_text text,from_address text,sent_at timestamptz,received_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now(),message_id text);
 CREATE TABLE email_imap_identities(email_id uuid,config_id uuid,account jsonb,mailbox text,uid_validity bigint,imap_uid bigint);
 CREATE TABLE quote_gaps(id uuid DEFAULT gen_random_uuid(),case_id uuid,gap_key text,gap_category text,is_blocking boolean,priority text,question_fr text,question_en text,status text,resolved_by_fact_id uuid,resolved_at timestamptz,updated_at timestamptz);`);
 const seed=()=>{const n=serial;serial+=10;const x={c:id(n),thread:id(n+1),f:id(n+2),emails:[1,2,3].map(i=>({id:id(n+2+i),body:'Weight: '+(i===2?3:2)+' kg.',value:i===2?3:2}))};
  sql(`INSERT INTO quote_cases(id,created_by,status,thread_id) VALUES('${x.c}','${actor}','PRICED_DRAFT','${x.thread}');
   ${x.emails.map((e,i)=>`INSERT INTO emails(id,thread_ref,body_text,from_address,sent_at,message_id) VALUES('${e.id}','${x.thread}',${q(e.body)},'client@example.test','2026-10-18T10:0${i}:00Z','<synthetic-${e.id}@example.test>');
    INSERT INTO email_imap_identities VALUES('${e.id}','${id(900)}','{"synthetic":true}','INBOX',1,${100+i});`).join('\n')}
   INSERT INTO quote_facts(id,case_id,fact_key,fact_category,value_number,source_type,confidence,is_validated,is_current,source_email_id) VALUES('${x.f}','${x.c}','cargo.weight_kg','cargo',2,'email_body',.8,false,true,'${x.emails[0].id}');`);return x;};
 const candidate=e=>({email_id:e.id,body_sha256:hash(e.body),excerpt:e.body,value_type:'number',value:e.value,source_type:'email_body',confidence:.8,evidence_error:null});
 const manifest=x=>JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('id',id,'from_address',from_address,'sent_at',sent_at,'sha256',encode(sha256(convert_to(body_text,'UTF8')),'hex')) ORDER BY id) FROM emails WHERE thread_ref='${x.thread}'`));
 const group=es=>[{key:'cargo.weight_kg',category:'cargo',candidates:es.map(candidate)}];
 const statement=(x,es,key='revision-test-'+serial,options={})=>`SELECT apply_case_email_fact_revisions('${x.c}','${options.actor||actor}',${q(key)},${j(options.groups||group(es))},${j(options.manifest||manifest(x))});`;
 const apply=(x,es,key,options)=>JSON.parse(sql(settings+statement(x,es,key,options)));
 const current=x=>JSON.parse(sql(`SELECT to_jsonb(f) FROM quote_facts f WHERE case_id='${x.c}' AND fact_key='cargo.weight_kg' AND is_current`));
 const refused=(s,re)=>{let err;try{sql(s);}catch(e){err=String(e.stderr||e.message);}assert(err,'Unexpected SQL success');assert.match(err,re);};
 const check=(name,fn)=>{fn();results.push({name,status:'PASS'});};
 const before=seed();sql(`SELECT supersede_fact('${before.c}','cargo.weight_kg','cargo',p_value_number:=2,p_source_type:='email_body',p_source_email_id:='${before.emails[2].id}');SELECT supersede_fact('${before.c}','cargo.weight_kg','cargo',p_value_number:=3,p_source_type:='email_body',p_source_email_id:='${before.emails[1].id}');`);
 assert.equal(current(before).value_number,3);results.push({name:'Before new guard, an older automatic stage actually restores the outdated value',status:'REPRODUCED'});
 sql(fs.readFileSync(path.join(repo,'supabase/migrations/20261018190000_ordered_email_fact_revisions.sql'),'utf8'));
 const x=seed(),command='ordered-source-replay';let result;
 check('New verified declaration atomically replaces an unvalidated fact and retains exact source/date/old/new',()=>{
  result=apply(x,[x.emails[1]],command);assert.equal(result.decisions[0].status,'applied');const f=current(x);assert.equal(f.value_number,3);assert.equal(f.source_email_id,x.emails[1].id);assert.equal(f.supersedes_fact_id,x.f);assert.equal(f.is_validated,false);assert(f.source_revision_id);
  const r=JSON.parse(sql(`SELECT to_jsonb(r) FROM quote_email_fact_revisions r WHERE id='${f.source_revision_id}'`));assert.equal(r.old_fact.value_number,2);assert.equal(r.source_evidence.selected.excerpt,x.emails[1].body);assert(r.source_evidence.sources.some(e=>e.sent_at));assert.equal(sql(`SELECT count(*) FROM case_timeline_events WHERE case_id='${x.c}'`),'1');
 });
 check('Exact replay adds no fact, ledger or event; divergent payload with the same command is refused',()=>{
  const before=sql(`SELECT md5(jsonb_build_object('facts',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM quote_facts f WHERE case_id='${x.c}'),'events',(SELECT count(*) FROM case_timeline_events WHERE case_id='${x.c}'),'revisions',(SELECT count(*) FROM quote_email_fact_revisions WHERE case_id='${x.c}'))::text)`);
  const replay=apply(x,[x.emails[1]],command);assert.equal(replay.decisions[0].replay,true);assert.equal(replay.decisions[0].changed,false);refused(settings+statement(x,[x.emails[2]],command),/idempotency conflict/);assert.equal(sql(`SELECT md5(jsonb_build_object('facts',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM quote_facts f WHERE case_id='${x.c}'),'events',(SELECT count(*) FROM case_timeline_events WHERE case_id='${x.c}'),'revisions',(SELECT count(*) FROM quote_email_fact_revisions WHERE case_id='${x.c}'))::text)`),before);
 });
 check('Newer confirmation preserves a source watermark against a late intermediate correction',()=>{
  const z=seed();assert.equal(apply(z,[z.emails[2]],'watermark-new').decisions[0].status,'confirmed');const f=current(z);assert.equal(f.value_number,2);assert.equal(f.source_email_id,z.emails[2].id);assert.equal(apply(z,[z.emails[1]],'watermark-late').decisions[0].status,'ignored');assert.deepEqual(current(z),f);
  refused(`SELECT supersede_fact('${z.c}','cargo.weight_kg','cargo',p_value_number:=3,p_source_type:='email_body',p_source_email_id:='${z.emails[1].id}');`,/ordered writer/);
  refused(`UPDATE quote_facts SET is_current=false WHERE id='${f.id}'`,/ordered successor/);refused(`UPDATE quote_facts SET source_revision_id=NULL WHERE id='${f.id}'`,/cannot be changed/);refused(`DELETE FROM quote_facts WHERE id='${f.id}'`,/ordered successor/);
 });
 check('Same-source contradictory values and missing ordering metadata stay visible conflicts without replacing values',()=>{
  for(const kind of ['same-source','missing-identity','equal-date']){const z=seed(),es=[z.emails[1]];if(kind==='same-source')es.push({...z.emails[1],value:9});if(kind==='missing-identity')sql(`DELETE FROM email_imap_identities WHERE email_id='${z.emails[1].id}'`);if(kind==='equal-date')sql(`UPDATE emails SET sent_at=(SELECT sent_at FROM emails WHERE id='${z.emails[0].id}') WHERE id='${z.emails[1].id}'`);
   const out=apply(z,es,'conflict-'+kind);assert.equal(out.decisions[0].status,'conflict');assert.equal(current(z).value_number,2);assert.equal(current(z).id,z.f);assert.equal(sql(`SELECT count(*) FROM quote_facts WHERE case_id='${z.c}'`),'1');assert.equal(sql(`SELECT gap_key FROM quote_gaps WHERE case_id='${z.c}' AND status='open'`),'source_revision.cargo.weight_kg');refused(`SELECT assert_case_source_revisions_resolved('${z.c}')`,/explicit operator/);
  }
 });
 check('Manual/validated facts stay unchanged; explicit manual successor resolves the ledger and its dedicated gap atomically',()=>{
  const z=seed();sql(`UPDATE quote_facts SET is_validated=true WHERE id='${z.f}'`);const frozen=current(z);assert.equal(apply(z,[z.emails[1]],'protected-source').decisions[0].status,'protected');assert.deepEqual(current(z),frozen);
  sql(`SELECT supersede_fact('${z.c}','cargo.weight_kg','cargo',p_value_number:=4,p_source_type:='manual_input',p_source_excerpt:='TEST_ONLY explicit operator decision');SELECT assert_case_source_revisions_resolved('${z.c}');`);assert.equal(current(z).value_number,4);assert.equal(current(z).source_type,'manual_input');const event=JSON.parse(sql(`SELECT event_data FROM case_timeline_events WHERE case_id='${z.c}' AND event_data->>'status'='resolved'`));assert.equal(event.old_fact.value_number,2);assert.equal(event.new_value,4);assert.equal(event.source_evidence.manual.excerpt,'TEST_ONLY explicit operator decision');assert.equal(sql(`SELECT status FROM quote_gaps WHERE case_id='${z.c}'`),'resolved');assert.equal(sql(`SELECT count(*) FROM quote_email_fact_revisions WHERE case_id='${z.c}' AND status='resolved'`),'1');
 });
 check('An unchanged protected value creates no false conflict or blocking gap',()=>{const z=seed();sql(`UPDATE quote_facts SET is_validated=true WHERE id='${z.f}'`);assert.equal(apply(z,[z.emails[2]],'protected-equal').decisions[0].status,'unchanged');assert.equal(sql(`SELECT count(*) FROM quote_gaps WHERE case_id='${z.c}'`),'0');});
 check('Changed source bodies and incomplete source collections refuse stale analysis without a write',()=>{const z=seed(),m=manifest(z);sql(`UPDATE emails SET body_text='Changed own source' WHERE id='${z.emails[1].id}'`);refused(settings+statement(z,[z.emails[1]],'stale-manifest',{manifest:m}),/collection changed/);assert.equal(sql(`SELECT count(*) FROM quote_email_fact_revisions WHERE case_id='${z.c}'`),'0');});
 check('Replay is the immutable receipt after a source change; a fresh command checks changed headers',()=>{
  const z=seed(),m=manifest(z);apply(z,[z.emails[1]],'immutable-receipt',{manifest:m});const saved=current(z);
  sql(`UPDATE emails SET from_address='different@example.test',sent_at=sent_at+interval '1 day' WHERE id='${z.emails[1].id}'`);
  assert.equal(apply(z,[z.emails[1]],'immutable-receipt',{manifest:m}).decisions[0].replay,true);assert.deepEqual(current(z),saved);
  refused(settings+statement(z,[z.emails[1]],'fresh-stale-header',{manifest:m}),/collection changed/);
  refused(`UPDATE quote_facts SET value_number=99 WHERE id='${saved.id}'`,/require a successor/);
 });
 check('The registry blocks a fresh version even after a gap is incorrectly closed; a manual successor releases it',()=>{
  const z=seed(),r=id(serial+7);sql(`DELETE FROM email_imap_identities WHERE email_id='${z.emails[1].id}'`);apply(z,[z.emails[1]],'registry-authority');
  const snapshot=()=>sql(`SELECT jsonb_agg(to_jsonb(f)||jsonb_build_object('is_validated',COALESCE(f.is_validated,false))) FROM quote_facts f WHERE case_id='${z.c}' AND is_current`);
  sql(`INSERT INTO pricing_runs VALUES('${r}','${z.c}','success',1,${j(JSON.parse(snapshot()))},now(),now());UPDATE quote_gaps SET status='resolved' WHERE case_id='${z.c}';`);
  refused(`SELECT assert_quotation_run_facts_current('${z.c}','${r}')`,/explicit operator decision/);
  sql(`SELECT supersede_fact('${z.c}','cargo.weight_kg','cargo',p_value_number:=4,p_source_type:='manual_input');`);sql(`UPDATE pricing_runs SET facts_snapshot=${j(JSON.parse(snapshot()))} WHERE id='${r}';SELECT assert_quotation_run_facts_current('${z.c}','${r}');`);
  assert.equal(sql(`SELECT count(*) FROM case_timeline_events WHERE case_id='${z.c}' AND event_data->>'status'='resolved'`),'1');
 });
 check('Missing/null type or source and invalid value shapes cannot archive a fact or write audit rows',()=>{
  const z=seed();const frozen=sql(`SELECT md5(jsonb_agg(to_jsonb(f) ORDER BY id)::text) FROM quote_facts f WHERE case_id='${z.c}'`);
  const variants=[p=>{delete p.value_type;},p=>p.value_type=null,p=>{delete p.source_type;},p=>p.source_type=null,p=>p.value='3',p=>p.value_type='date',p=>p.confidence=null];
  for(let i=0;i<variants.length;i++){const groups=group([z.emails[1]]);variants[i](groups[0].candidates[0]);refused('\\set VERBOSITY verbose\n'+settings+statement(z,[],'invalid-shape-'+i,{groups}),/22023/);assert.equal(sql(`SELECT md5(jsonb_agg(to_jsonb(f) ORDER BY id)::text) FROM quote_facts f WHERE case_id='${z.c}'`),frozen);assert.equal(sql(`SELECT count(*) FROM quote_email_fact_revisions WHERE case_id='${z.c}'`),'0');assert.equal(sql(`SELECT count(*) FROM case_timeline_events WHERE case_id='${z.c}'`),'0');}
 });
 check('Timeline failure rolls back new fact, archive, ledger and metadata together',()=>{const z=seed();sql(`CREATE FUNCTION revision_test_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.case_id='${z.c}' THEN RAISE EXCEPTION 'TEST_ONLY revision event failure';END IF;RETURN NEW;END;$$;CREATE TRIGGER revision_test_fail_event BEFORE INSERT ON case_timeline_events FOR EACH ROW EXECUTE FUNCTION revision_test_fail_event();`);refused(settings+statement(z,[z.emails[1]],'event-rollback'),/revision event failure/);assert.equal(current(z).id,z.f);assert.equal(current(z).source_revision_id,null);assert.equal(sql(`SELECT count(*) FROM quote_facts WHERE case_id='${z.c}'`),'1');assert.equal(sql(`SELECT count(*) FROM quote_email_fact_revisions WHERE case_id='${z.c}'`),'0');sql('DROP TRIGGER revision_test_fail_event ON case_timeline_events;DROP FUNCTION revision_test_fail_event();');});
 const z=seed(),holder=session('revision-concurrency-holder');holder.p.stdin.write(`BEGIN;SELECT 1 FROM quote_cases WHERE id='${z.c}' FOR UPDATE;SELECT 'HELD';\n`);for(let i=0;i<100&&!holder.out().includes('HELD');i++)await delay(30);assert(holder.out().includes('HELD'));
 const a=session('revision-concurrency-A'),b=session('revision-concurrency-B');a.p.stdin.end(statement(z,[z.emails[1]],'concurrent-exact')+'\n\\q\n');b.p.stdin.end(statement(z,[z.emails[1]],'concurrent-exact')+'\n\\q\n');await waitFor('revision-concurrency-A');await waitFor('revision-concurrency-B');holder.p.stdin.end('COMMIT;\n\\q\n');await holder.done;const both=await Promise.all([a.done,b.done]);both.forEach(r=>assert.equal(r.code,0,r.err));const outcomes=both.map(r=>JSON.parse(r.out.trim()).decisions[0]);assert.equal(outcomes[0].fact_id,outcomes[1].fact_id);assert.deepEqual(outcomes.map(r=>r.replay).sort(),[false,true]);assert.equal(sql(`SELECT count(*) FROM quote_facts WHERE case_id='${z.c}'`),'2');results.push({name:'Two real concurrent analyses converge on one fact and ledger command',status:'PASS',actualOverlap:true});
 for(const reverse of [false,true]){
  const x=seed(),label='distinct-'+reverse,h=session(label+'-holder');h.p.stdin.write(`BEGIN;SELECT 1 FROM quote_cases WHERE id='${x.c}' FOR UPDATE;SELECT 'HELD';\n`);
  for(let i=0;i<100&&!h.out().includes('HELD');i++)await delay(30);assert(h.out().includes('HELD'));
  const ws=[];for(const index of reverse?[2,1]:[1,2]){const w=session(label+'-'+index);w.p.stdin.end(statement(x,[x.emails[index]],label+'-command-'+index)+'\n\\q\n');await waitFor(label+'-'+index);ws.push(w);}
  h.p.stdin.end('COMMIT;\n\\q\n');await h.done;for(const w of ws){const r=await w.done;assert.equal(r.code,0,r.err);}assert.equal(current(x).source_email_id,x.emails[2].id);assert.equal(current(x).value_number,2);
 }
 results.push({name:'Two distinct simultaneous commands converge on M3 in either lock acquisition order',status:'PASS',actualOverlap:true});
 for(const kind of ['ban','role','manual']){
  const x=seed(),label='wait-'+kind,h=session(label+'-holder');h.p.stdin.write(`BEGIN;SELECT 1 FROM quote_cases WHERE id='${x.c}' FOR UPDATE;SELECT 'HELD';\n`);
  for(let i=0;i<100&&!h.out().includes('HELD');i++)await delay(30);assert(h.out().includes('HELD'));
  const w=session(label+'-writer');w.p.stdin.end(statement(x,[x.emails[1]],label+'-command')+'\n\\q\n');await waitFor(label+'-writer');
  if(kind==='ban')sql(`UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${actor}'`);
  if(kind==='role')sql(`DELETE FROM app_roles WHERE user_id='${actor}'`);
  h.p.stdin.end((kind==='manual'?`SELECT supersede_fact('${x.c}','cargo.weight_kg','cargo',p_value_number:=7,p_source_type:='manual_input');`:'')+'COMMIT;\n\\q\n');assert.equal((await h.done).code,0);
  const r=await w.done;if(kind==='manual'){assert.equal(r.code,0,r.err);assert.equal(current(x).value_number,7);assert.equal(JSON.parse(r.out.trim()).decisions[0].status,'protected');}
  else{assert.notEqual(r.code,0);assert.match(r.err,/forbidden/);assert.equal(current(x).id,x.f);assert.equal(sql(`SELECT count(*) FROM quote_email_fact_revisions WHERE case_id='${x.c}'`),'0');}
  if(kind==='ban')sql(`UPDATE auth.users SET banned_until=NULL WHERE id='${actor}'`);
  if(kind==='role')sql(`INSERT INTO app_roles VALUES('${actor}','workspace_operator')`);
 }
 results.push({name:'Ban, role removal and manual decision committed during real lock waits are respected',status:'PASS',actualOverlap:true});
 check('RPC clients are denied and the audit register remains deny-all and append-only',()=>{const sig='apply_case_email_fact_revisions(uuid,uuid,text,jsonb,jsonb)';assert.equal(sql(`SELECT has_function_privilege('anon','${sig}','execute') OR has_function_privilege('authenticated','${sig}','execute') OR NOT has_function_privilege('service_role','${sig}','execute')`),'f');refused('SET ROLE authenticated;SELECT * FROM quote_email_fact_revisions',/permission denied/);refused(`UPDATE quote_email_fact_revisions SET reason='changed' WHERE case_id='${z.c}'`,/append-only/);refused(`DELETE FROM quote_email_fact_revisions WHERE case_id='${z.c}'`,/append-only/);});
};
