const assert=require('node:assert/strict');
module.exports=async function({sql,session,waitFor,delay,id,actor,settings,q,j,results}){
 const c=id(8700);sql("INSERT INTO quote_cases(id,created_by,status) VALUES("+q(c)+","+q(actor)+",'NEED_INFO')");
 const replace=lines=>"SELECT replace_quote_request_lines("+q(c)+","+j(lines)+")";
 const count=()=>sql("SELECT count(*) FROM quote_request_lines WHERE case_id="+q(c));
 const hashes=()=>sql("SELECT COALESCE(md5(jsonb_agg(to_jsonb(l) ORDER BY id)::text),'empty') FROM quote_request_lines l WHERE case_id="+q(c));
 const archives=()=>JSON.parse(sql("SELECT COALESCE(jsonb_agg(event_data ORDER BY created_at,id),'[]') FROM case_timeline_events WHERE case_id="+q(c)+" AND event_data->>'atomic'='true'"));
 sql(settings+replace([{line_index:1,line_label:'original',source_excerpt:'raw original evidence',meta_json:{raw:'kept'}}]));
 const old=JSON.parse(sql("SELECT to_jsonb(l) FROM quote_request_lines l WHERE case_id="+q(c)));
 const before=hashes(),events=archives().length;let refused=false;
 try{sql(settings+replace([{line_index:1,source_email_id:'not-a-uuid'}]));}catch{refused=true;}
 assert(refused);assert.equal(hashes(),before);assert.equal(archives().length,events);
 results.push({name:'Line history: insert failure rolls archive and deletion back',status:'PASS'});
 sql("CREATE FUNCTION line_history_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.case_id="+q(c)+" THEN RAISE EXCEPTION 'synthetic archive failure';END IF;RETURN NEW;END;$$;CREATE TRIGGER line_history_fail BEFORE INSERT ON case_timeline_events FOR EACH ROW EXECUTE FUNCTION line_history_fail()");
 refused=false;try{sql(settings+replace([]));}catch{refused=true;}assert(refused);assert.equal(hashes(),before);assert.equal(archives().length,events);
 sql('DROP TRIGGER line_history_fail ON case_timeline_events;DROP FUNCTION line_history_fail()');
 results.push({name:'Line history: archive failure prevents clearing without partial writes',status:'PASS'});
 const hold=session('line-history-A'),waiting=session('line-history-B');
 hold.p.stdin.write("BEGIN;SELECT pg_advisory_xact_lock(hashtext("+q('qrl_'+c)+"));SELECT 'HELD';\n");
 for(let i=0;i<100&&!hold.out().includes('HELD');i++)await delay(25);assert(hold.out().includes('HELD'));
 waiting.p.stdin.end(replace([])+";\n\\q\n");await waitFor('line-history-B');
 hold.p.stdin.end(replace([{line_index:1,line_label:'intermediate A'}])+";SELECT to_jsonb(l) FROM quote_request_lines l WHERE case_id="+q(c)+";COMMIT;\n\\q\n");
 const first=await hold.done;assert.equal(first.code,0);assert.equal((await waiting.done).code,0);assert.equal(count(),'0');
 const intermediate=JSON.parse(first.out.split(/\r?\n/).find(s=>s.startsWith('{')));
 const history=archives();assert(history.some(e=>e.previous_lines.some(l=>l.id===old.id&&JSON.stringify(l)===JSON.stringify(old))));
 assert(history.some(e=>e.previous_lines.some(l=>JSON.stringify(l)===JSON.stringify(intermediate))));
 results.push({name:'Line history: real overlapping replacement and clear retain both complete prior rows',status:'PASS',actualOverlap:true});
};
