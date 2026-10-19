import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
Deno.env.set('BUILD_CASE_PUZZLE_DISABLE_SERVE', '1');
const { buildCasePuzzleHandler } = await import('../build-case-puzzle/index.ts');

// Execute the entire analyser. Only its HTTP boundary is synthetic: no provider,
// database, credentials or client data. Native SQL coverage is a separate bench.
for (const protectedKey of ['source_revision.cargo.description','source_contract.export_customs','source_contract.rfq_deadline'])
for (const status of ['open', 'pending_response', 'resolved']) {
  for (const homonym of [false, true]) Deno.test(`source integrity gap ${protectedKey}: ${status}, homonymous fact=${homonym}`, async () => {
    const priorFetch = globalThis.fetch;
    const envKeys = ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','LOVABLE_API_KEY'];
    const priorEnv = envKeys.map(key => Deno.env.get(key));
    Deno.env.set(envKeys[0], 'https://fixture.invalid');
    Deno.env.set(envKeys[1], 'synthetic-anon'); Deno.env.set(envKeys[2], 'synthetic-service'); Deno.env.delete(envKeys[3]);
    const gaps: Array<Record<string, unknown>> = [
      {id:'source-gap',case_id:'case',gap_key:protectedKey,status,is_blocking:true,gap_category:'cargo'},
      {id:'orphan-gap',case_id:'case',gap_key:'unused.synthethic',status:'open',is_blocking:false,gap_category:'cargo'},
    ];
    const requests: Array<Record<string, unknown>> = [
      {case_id:'case',gap_key:protectedKey,status:'drafted'},
      {case_id:'case',gap_key:'unused.synthethic',status:'drafted'},
    ];
    const original = {id:'manual-fob',case_id:'case',fact_key:'routing.incoterm',fact_category:'routing',value_text:'FOB',source_type:'manual_input',is_current:true,is_validated:true};
    const facts = [original, {id:'description',case_id:'case',fact_key:'cargo.description',fact_category:'cargo',value_text:'Marchandises générales',source_type:'email_body',is_current:true,is_validated:false},
      ...(homonym ? [{id:'legacy-homonym',case_id:'case',fact_key:protectedKey,fact_category:'cargo',value_text:'This is not a resolution receipt',source_type:'manual_input',is_current:true,is_validated:true}] : [])];
    const factSnapshot=JSON.stringify(facts), events: Array<Record<string, unknown>> = [], calls: string[] = [];
    const tables: Record<string, Array<Record<string, unknown>>> = {quote_gaps:gaps,client_gap_requests:requests,quote_facts:facts,case_timeline_events:events,
      emails:[{id:'existing-email',thread_ref:'thread',body_text:'Bonjour.',from_address:'client@example.test',sent_at:'2026-10-19T10:00:00Z'}]};
    const matches=(row:Record<string,unknown>,url:URL)=>[...url.searchParams].every(([key,raw])=>{
      if (['select','order','limit','offset','or','and'].includes(key)) return true;
      if(raw.startsWith('eq.')) return String(row[key])===raw.slice(3);
      if(raw.startsWith('in.(')) return raw.slice(4,-1).split(',').includes(String(row[key]));
      return true;
    });
    globalThis.fetch = async (input, init) => {
      const url=new URL(input instanceof Request?input.url:String(input)); assertEquals(url.hostname,'fixture.invalid');
      const options=init as {method?:string;body?:unknown;headers?:HeadersInit}|undefined;
      const method=options?.method||'GET', name=url.pathname.split('/').pop()!;
      calls.push(method+' '+name);
      const json=(data:unknown,count=0)=>new Response(method==='HEAD'?null:JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json','Content-Range':`0-${Math.max(0,count-1)}/${count}`}});
      if(name==='user')return json({id:'operator',email:'operator@fixture.invalid'});
      if(name==='has_workspace_access')return json(true);
      if(name==='case_document_analysis_inspect')return json({contract:1,scope:'manual_case_documents',context_hash:'a'.repeat(32),documents:[],readable_email_count:0,latest:null});
      if(name==='apply_case_email_fact_revisions')throw Error('No source candidate expected');
      if(name==='supersede_fact')return json('unchanged-synthetic-fact');
      if(url.pathname.includes('/rpc/'))return json([]);
      if(name==='quote_cases')return json({id:'case',status:'FACTS_PARTIAL',thread_id:'thread',request_type:'SEA_FCL_IMPORT',email_threads:{id:'thread',subject_normalized:'Demande existante',client_email:'client@example.test'}});
      const rows=tables[name];
      if(rows){
        if(method==='PATCH'){const body=JSON.parse(String(options?.body));for(const row of rows.filter(r=>matches(r,url)))Object.assign(row,body);return json([]);}
        if(method==='POST'){const body=JSON.parse(String(options?.body));rows.push(...(Array.isArray(body)?body:[body]));return json([]);}
        const found=rows.filter(row=>matches(row,url));
        return json(new Headers(options?.headers).get('Accept')?.includes('vnd.pgrst.object')?found[0]??null:found,found.length);
      }
      return json(new Headers(options?.headers).get('Accept')?.includes('vnd.pgrst.object')?null:[]);
    };
    try {
      for(let replay=0;replay<2;replay++){
        const response=await buildCasePuzzleHandler(new Request('https://fixture.invalid/build-case-puzzle',{method:'POST',headers:{Authorization:'Bearer synthetic-token','Content-Type':'application/json'},body:JSON.stringify({case_id:'case'})}));
        const body=await response.json();assertEquals(response.status,200,JSON.stringify(body));
        assertEquals(gaps.find(g=>g.id==='source-gap')!.status,status);
        assertEquals(requests[0].status,'drafted');
        assertEquals(events.filter(e=>e.event_type==='gap_resolved'&&(e.event_data as Record<string,unknown>)?.gap_key===protectedKey).length,0);
        assertEquals(JSON.stringify(facts),factSnapshot);
      }
      assertEquals(gaps.find(g=>g.id==='orphan-gap')!.status,'resolved');assertEquals(requests[1].status,'cancelled');
      assertEquals(events.filter(e=>e.event_type==='gap_resolved'&&(e.event_data as Record<string,unknown>)?.gap_key==='unused.synthethic').length,1);
      assert(!calls.some(c=>c.includes('run-pricing')));
    } finally {
      globalThis.fetch=priorFetch;envKeys.forEach((key,i)=>priorEnv[i]===undefined?Deno.env.delete(key):Deno.env.set(key,priorEnv[i]!));
    }
  });
}
