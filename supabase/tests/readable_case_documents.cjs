// Native isolated PostgreSQL extension; only synthetic sources.
module.exports=async function({sql,session,waitFor,delay,id,actor,settings,q,j,results,repo}) {
 const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
 sql(`ALTER TABLE quote_cases ADD COLUMN IF NOT EXISTS request_type text,ADD COLUMN IF NOT EXISTS facts_count integer,
 ADD COLUMN IF NOT EXISTS gaps_count integer,ADD COLUMN IF NOT EXISTS puzzle_completeness integer,
 ADD COLUMN IF NOT EXISTS last_activity_at timestamptz,ADD COLUMN IF NOT EXISTS updated_at timestamptz;
 ALTER TABLE emails ADD COLUMN subject text,ADD COLUMN to_addresses text[],ADD COLUMN is_quotation_request boolean;
 CREATE TABLE case_documents(id uuid PRIMARY KEY,case_id uuid REFERENCES quote_cases(id),file_name text,document_type text,
 extracted_text text,storage_path text,mime_type text,file_size integer);
 CREATE TABLE case_puzzle_jobs(id uuid PRIMARY KEY,case_id uuid REFERENCES quote_cases(id),created_by uuid,status text,request_params jsonb,final_result jsonb);`);
 sql(fs.readFileSync(path.join(repo,'supabase/migrations/20261019090000_readable_case_documents.sql'),'utf8'));
 let serial=2000;const check=(name,fn)=>{fn();results.push({name,status:'PASS'});};
 const refused=(s,re)=>{let e;try{sql(s);}catch(x){e=String(x.stderr||x.message);}assert(e,'Unexpected SQL success');assert.match(e,re);};
 const seed=(mode='mixed',status='RFQ_DETECTED')=>{const n=serial;serial+=10;const x={c:id(n),bad:id(n+1),good:id(n+2),thread:id(n+3),email:id(n+4),run:id(n+5),next:id(n+6),job:id(n+7)};
  sql(`INSERT INTO quote_cases(id,created_by,status,thread_id) VALUES('${x.c}','${actor}',${q(status)},'${x.thread}');
  INSERT INTO case_documents(id,case_id,file_name,document_type,extracted_text,storage_path) VALUES('${x.bad}','${x.c}','photo.png','other',NULL,'synthetic/source-a');
  ${mode==='mixed'?`INSERT INTO case_documents(id,case_id,file_name,document_type,extracted_text,storage_path) VALUES('${x.good}','${x.c}','invoice.txt','invoice','SYNTHETIC 190 kg','synthetic/source-b');`:''}
  ${mode==='email'?`INSERT INTO emails(id,thread_ref,from_address,body_text,subject) VALUES('${x.email}','${x.thread}','client@example.test','SYNTHETIC readable request','Synthetic request');`:''}`);
  return x;
 };
 const inspect=x=>JSON.parse(sql(settings+`SELECT case_document_analysis_inspect('${actor}','${x.c}');`));
 const begin=(x,mode='readable',key=x.run)=>`SELECT case_document_analysis_begin('${actor}','${x.c}','${key}',${q(inspect(x).context_hash)},${q(mode)});`;
 const patch={status:'READY_TO_PRICE',request_type:'AIR_IMPORT',facts_count:1,gaps_count:1,puzzle_completeness:100};
 const finish=(x,key=x.run)=>`SELECT case_document_analysis_finish('${actor}','${x.c}','${key}',${j(patch)},${j({case_id:x.c,new_status:'READY_TO_PRICE',ready_to_price:true})});`;
 const fail=x=>sql(settings+`SELECT case_document_analysis_fail('${actor}','${x.c}','${x.run}');`);
 const versions=sql("SELECT md5(COALESCE(jsonb_agg(to_jsonb(v) ORDER BY id)::text,'[]')) FROM quotation_versions v;");
 check('SQL extraction rejects legacy markers, whitespace and controls but accepts short text',()=>{
  for(const value of ['',' \t\n','[OCR vide]','[Extraction echouee]',"\u00a0[OCR vide]\ufeff",'[PDF détecté - extraction texte indisponible]',"[Format non supporté pour l'extraction de texte]",'\\u0000'])assert.equal(sql(`SELECT document_analysis_has_text(${q(value)});`),'f');
  for(const value of ['5','190 kg','The text [OCR vide] is quoted in a real paragraph.'])assert.equal(sql(`SELECT document_analysis_has_text(${q(value)});`),'t');
 });
 const a=seed();
 check('Partial selection keeps both documents and creates a durable blocking reserve before facts',()=>{
  sql(settings+begin(a));assert.equal(sql(`SELECT count(*) FROM case_documents WHERE case_id='${a.c}'`),'2');
  assert.equal(sql(`SELECT count(*) FROM quote_gaps WHERE case_id='${a.c}' AND gap_key='documents.analysis_coverage' AND status='open' AND is_blocking`),'1');
  assert.equal(inspect(a).latest.state,'pending');
 });
 check('A second analysis cannot overlap an unconfirmed attempt',()=>refused(settings+begin(a,'readable',a.next),/already pending/));
 check('Partial finish retains exclusions and cannot claim READY_TO_PRICE',()=>{
  const result=JSON.parse(sql(settings+finish(a)));assert.equal(result.ready_to_price,false);assert.equal(result.new_status,'NEED_INFO');assert.equal(result.document_analysis.state,'partial');
  assert.equal(result.document_analysis.documents.filter(d=>!d.readable).length,1);assert.equal(inspect(a).latest.state,'partial');
  refused(settings+`SELECT assert_case_document_analysis_complete('${a.c}');`,/incomplete/);
 });
 check('Generic waiver, delete or renamed gap cannot remove the documentary reserve',()=>{
  const other=seed();
  for(const command of ["UPDATE quote_gaps SET status='waived'","DELETE FROM quote_gaps","UPDATE quote_gaps SET gap_key='other.key'",`UPDATE quote_gaps SET case_id='${other.c}'`]){
   refused(command+` WHERE case_id='${a.c}' AND gap_key='documents.analysis_coverage';`,/confirmed complete analysis/);
  }
 });
 const homonym=seed();
 check('An existing non-blocking open homonym is upgraded before partial analysis',()=>{
  sql(`INSERT INTO quote_gaps(case_id,gap_key,gap_category,is_blocking,priority,status) VALUES('${homonym.c}','documents.analysis_coverage','documents',false,'low','open');`);
  sql(settings+begin(homonym));
  assert.equal(sql(`SELECT count(*) FROM quote_gaps WHERE case_id='${homonym.c}' AND gap_key='documents.analysis_coverage' AND status='open' AND is_blocking`),'1');
  assert.equal(JSON.parse(sql(settings+finish(homonym))).ready_to_price,false);
 });
 check('Successful OCR on the same source cannot itself claim analysis completion',()=>{
  sql(`UPDATE case_documents SET extracted_text='SYNTHETIC recovered photo text' WHERE id='${a.bad}';`);
  assert.equal(inspect(a).latest.sources_changed,true);assert.equal(inspect(a).latest.state,'partial');
  refused(settings+`SELECT assert_case_document_analysis_complete('${a.c}');`,/incomplete/);
 });
 check('Complete reanalysis closes only its reserve and retains prior partial history',()=>{
  sql(settings+begin(a,'complete',a.next));const r=JSON.parse(sql(settings+finish(a,a.next)));
  assert.equal(r.document_analysis.state,'complete');assert.equal(r.ready_to_price,true);
  assert.equal(sql(`SELECT count(*) FROM quote_gaps WHERE case_id='${a.c}' AND gap_key='documents.analysis_coverage' AND status='open'`),'0');
  sql(settings+`SELECT assert_case_document_analysis_complete('${a.c}');`);assert.equal(inspect(a).latest.state,'complete');
  assert.equal(sql(`SELECT count(*) FROM case_document_analysis_runs WHERE case_id='${a.c}'`),'2');
  refused(settings+finish(a,a.next),/no longer current/);
 });
 check('Changed sources cannot borrow a prior complete attestation for a new quotation',()=>{
  sql(`UPDATE case_documents SET file_name='changed.txt' WHERE id='${a.good}';`);
  refused(settings+`SELECT assert_case_document_analysis_complete('${a.c}');`,/sources changed/);
 });
 const empty=seed('empty');
 check('No readable source rejects explicit partial mode before any attempt or reserve',()=>{
  refused(settings+begin(empty),/No readable source/);assert.equal(inspect(empty).latest,null);
  assert.equal(sql(`SELECT count(*) FROM quote_gaps WHERE case_id='${empty.c}'`),'0');
 });
 const email=seed('email');
 check('A readable inbound email supports a partial manual-document analysis',()=>{
  sql(settings+begin(email));assert.equal(JSON.parse(sql(settings+finish(email))).document_analysis.state,'partial');
 });
 const changed=seed();
 check('Changed source refuses finalization; failure is append-only and permits a new explicit attempt',()=>{
  sql(settings+begin(changed));sql(`UPDATE case_documents SET extracted_text='SYNTHETIC replacement' WHERE id='${changed.good}';`);
  refused(settings+finish(changed),/changed during analysis/);fail(changed);const after=sql(`SELECT count(*) FROM case_timeline_events WHERE case_id='${changed.c}'`);
  fail(changed);assert.equal(sql(`SELECT count(*) FROM case_timeline_events WHERE case_id='${changed.c}'`),after);
  assert.equal(inspect(changed).latest.state,'failed');sql(settings+begin(changed,'readable',changed.next));
  assert.equal(JSON.parse(sql(settings+finish(changed,changed.next))).ready_to_price,false);
 });
 const frozen=seed('mixed','PRICED_DRAFT');
 check('Partial analysis preserves frozen status and cannot imply a ready calculation',()=>{
  sql(settings+begin(frozen));const r=JSON.parse(sql(settings+finish(frozen)));
  assert.equal(r.new_status,'PRICED_DRAFT');assert.equal(r.ready_to_price,false);
 });
 const job=seed();
 check('Owner-editable completed and final_result fields are not authoritative coverage',()=>{
  const request={mode:'readable',context_hash:inspect(job).context_hash};
  sql(`INSERT INTO case_puzzle_jobs VALUES('${job.job}','${job.c}','${actor}','running',${j({document_analysis:request})},NULL);`);
  sql(settings+`SELECT case_document_analysis_begin('${actor}','${job.c}','${job.run}',${q(request.context_hash)},'readable','${job.job}');`);
  sql(`UPDATE case_puzzle_jobs SET status='completed',request_params='{}',final_result='{"ready_to_price":true}' WHERE id='${job.job}';`);
  const r=JSON.parse(sql(settings+`SELECT case_document_analysis_job('${actor}','${job.job}');`));assert.equal(r.managed,true);assert.equal(r.pending,true);assert.equal(r.result,null);
  sql(settings+finish(job));const saved=JSON.parse(sql(settings+`SELECT case_document_analysis_job('${actor}','${job.job}');`));assert.equal(saved.result.ready_to_price,false);assert.equal(saved.pending,false);
 });
 check('Ledger deny-all grants and immutability preserve all historical versions',()=>{
  for(const table of ['case_document_analysis_runs','case_document_analysis_results'])for(const role of ['anon','authenticated','service_role'])assert.equal(sql(`SELECT has_table_privilege('${role}','${table}','select,insert,update,delete');`),'f');
  refused(`UPDATE case_document_analysis_runs SET mode='complete' WHERE id='${frozen.run}';`,/append-only/);
  refused(`DELETE FROM case_document_analysis_results WHERE analysis_id='${frozen.run}';`,/append-only/);
  assert.equal(sql("SELECT md5(COALESCE(jsonb_agg(to_jsonb(v) ORDER BY id)::text,'[]')) FROM quotation_versions v;"),versions);
 });
 const atomic=seed();
 check('Final timeline failure rolls back the case update, result and reserve closure together',()=>{
  sql(`UPDATE case_documents SET extracted_text='SYNTHETIC recovered' WHERE id='${atomic.bad}';`);sql(settings+begin(atomic,'complete'));
  const before=sql(`SELECT to_jsonb(c) FROM quote_cases c WHERE id='${atomic.c}'`);
  sql(`CREATE FUNCTION document_test_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.case_id='${atomic.c}' AND NEW.event_data->>'stage'='complete' THEN RAISE EXCEPTION 'TEST_ONLY document finish';END IF;RETURN NEW;END$$;
  CREATE TRIGGER document_test_fail_event BEFORE INSERT ON case_timeline_events FOR EACH ROW EXECUTE FUNCTION document_test_fail_event();`);
  refused(settings+finish(atomic),/TEST_ONLY document finish/);assert.equal(inspect(atomic).latest.state,'pending');
  assert.equal(sql(`SELECT to_jsonb(c) FROM quote_cases c WHERE id='${atomic.c}'`),before);
  assert.equal(sql(`SELECT count(*) FROM quote_gaps WHERE case_id='${atomic.c}' AND gap_key='documents.analysis_coverage' AND status='open' AND is_blocking`),'1');
  sql('DROP TRIGGER document_test_fail_event ON case_timeline_events;DROP FUNCTION document_test_fail_event();');sql(settings+finish(atomic));
 });
 for(const stage of ['begin','finish']){
  const x=seed();if(stage==='finish')sql(settings+begin(x));
  const command=stage==='begin'?begin(x):finish(x),name='document-source-overlap-'+stage,holder=session(name+'-holder');
  holder.p.stdin.write(`BEGIN;INSERT INTO case_documents(id,case_id,file_name,document_type,extracted_text) VALUES('${id(serial+8)}','${x.c}','concurrent.txt','other','SYNTHETIC concurrent');SELECT 'HELD';\n`);
  for(let i=0;i<100&&!holder.out().includes('HELD');i++)await delay(30);assert(holder.out().includes('HELD'));
  const waiter=session(name);waiter.p.stdin.end(settings+command+'\n\\q\n');await waitFor(name);
  holder.p.stdin.end('COMMIT;\n\\q\n');assert.equal((await holder.done).code,0);
  const denied=await waiter.done;assert.notEqual(denied.code,0);assert.match(denied.err,/sources changed/i);
  assert.equal(inspect(x).latest?.state||null,stage==='begin'?null:'pending');
  if(stage==='finish')fail(x);
  results.push({name:'Concurrent source FK insertion and '+stage+' avoid lock inversion and reject stale context',status:'PASS',actualOverlap:true});
 }
 for(const change of ['ban','role']){
  const x=seed(),name='document-admission-'+change,holder=session(name+'-holder');
  holder.p.stdin.write(`BEGIN;SELECT 1 FROM quote_cases WHERE id='${x.c}' FOR NO KEY UPDATE;SELECT 'HELD';\n`);
  for(let i=0;i<100&&!holder.out().includes('HELD');i++)await delay(30);assert(holder.out().includes('HELD'));
  const waiter=session(name);waiter.p.stdin.end(settings+begin(x)+'\n\\q\n');await waitFor(name);
  holder.p.stdin.end((change==='ban'?`UPDATE auth.users SET banned_until='2099-01-01' WHERE id='${actor}';`:`DELETE FROM app_roles WHERE user_id='${actor}';`)+'COMMIT;\n\\q\n');assert.equal((await holder.done).code,0);
  const denied=await waiter.done;assert.notEqual(denied.code,0);assert.match(denied.err,/forbidden/);
  sql(change==='ban'?`UPDATE auth.users SET banned_until=NULL WHERE id='${actor}';`:`INSERT INTO app_roles(user_id,role) VALUES('${actor}','workspace_operator');`);
  assert.equal(inspect(x).latest,null);results.push({name:'Document actor '+change+' during wait is refused before source effects',status:'PASS',actualOverlap:true});
 }
};
