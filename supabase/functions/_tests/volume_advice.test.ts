import {assert,assertEquals} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {assessCargoVolume,projectVolumeAdvice,type VolumeFact} from '../_shared/cargo-volume-advice.ts';
Deno.env.set('ANALYZE_CASE_COHERENCE_DISABLE_SERVE','1');
const {analyzeCaseCoherenceHandler}=await import('../analyze-case-coherence/index.ts');
const dim=(value_text:string):VolumeFact=>({fact_key:'cargo.dimensions',value_text});
const pieces=(value_number:number):VolumeFact=>({fact_key:'cargo.pieces_count',value_number});
for(const [text,n,expected] of [['10 x 10 x 10 mm',1,.000001],['10 X 10 X 10 MM',1,.000001],['100 x 100 x 100 cm',1,1],['1 x 1 x 1 m',1,1],['2 cartons:60 x 80 x 65 cm',2,.624],['60 x 80 x 65 cm 2 cartons',2,.624],['1 carton:100 x 100 x 100 mm;2 cartons:10 x 10 x 10 cm',3,.003]] as const){
 Deno.test('volume advice: complete allocation '+text,()=>assertEquals(assessCargoVolume([dim(text),pieces(n)]).volumeCbm,expected));
}
for(const [text,n] of [['60 x 80 x 65 cm',2],['1 x 1 x 1',1],['-1 x 1 x 1 m',1],['−1 x 1 x 1 m',1],['1e2 x 1 x 1 m',1],['.5 x 1 x 1 m',1],['1 500 x 1 x 1 m',1],['0 x 1 x 1 m',1],['1 carton:1 x 1 x 1 m;1 carton:2 x 2 x 2 m',3],['1 carton:1 x 1 x 1 m;2 x ? x 2 m',1],['1.5 cartons:1 x 1 x 1 m',1],['1e2 cartons:1 x 1 x 1 m',2],['1e2 cartons:1 x 1 x 1 m',1],['.5 cartons:1 x 1 x 1 m',5],['1 x 1 x 1 m\n1 carton:2 x 2 x 2 m',2],['1 x 1 x 1 m;2 x 2 x 2 m',2]] as const){
 Deno.test('volume advice: no guessed allocation '+text,()=>assertEquals(assessCargoVolume([dim(text),pieces(n)]).volumeCbm,null));
}
const group=(count:number|null,length=1)=>({count,length,width:1,height:1,unit:'m'});
const evidence=(sources:unknown[],conflict=false):VolumeFact=>({fact_key:'cargo.dimensions_evidence',value_json:{type:'dimension_groups_v1',conflict,sources:sources.map(groups=>({groups}))}});
Deno.test('volume advice: alternative sources corroborate rather than add; allocation can be supplied explicitly by a matching document',()=>{
 assertEquals(assessCargoVolume([dim('1 x 1 x 1 m'),pieces(2),evidence([[group(2)],[group(2)]])]).volumeCbm,2);
 assertEquals(assessCargoVolume([pieces(2),evidence([[group(2)],[group(2)]])]).volumeCbm,2);
});
Deno.test('volume advice: conflicting or incomplete alternative evidence cannot certify total',()=>{
 for(const e of [evidence([[group(2)]],true),evidence([[group(2)],[group(2,2)]]),evidence([[group(null)]]),evidence([[{...group(2),unit:'in'}]])])assertEquals(assessCargoVolume([dim('1 x 1 x 1 m'),pieces(2),e]).volumeCbm,null);
});
Deno.test('volume advice: partial alternative known allocations are summed before comparison',()=>{
 assertEquals(assessCargoVolume([dim('2 cartons:1 x 1 x 1 m;1 x 1 x 1 m'),pieces(2),evidence([[group(2)]])]).volumeCbm,null,'An additional unallocated row cannot fit after all parcels are already allocated');
 assertEquals(assessCargoVolume([dim('2 cartons:1 x 1 x 1 m;2 cartons:1 x 1 x 1 m;2 x 1 x 1 m'),pieces(4),evidence([[group(3),group(1,2)]])]).volumeCbm,null);
});
Deno.test('volume advice: operator decisions and existing canonical volume are never overwritten by advice',()=>{
 for(const source_type of ['manual_input','operator_correction','operator']){
  const facts=[dim('1 x 1 x 1 m'),pieces(1),{fact_key:'cargo.volume_cbm',value_number:7,source_type},evidence([[group(1,2)]],true)];
  assertEquals(assessCargoVolume(facts).reason,'EXISTING_VOLUME');assertEquals(assessCargoVolume(facts).volumeCbm,null);assertEquals(facts[2].value_number,7);
  assertEquals(assessCargoVolume([{...dim('1 x 1 x 1 m'),source_type},pieces(1),evidence([[group(1,2)]],true)]).volumeCbm,1);
 }
});
const old={summary:'1 fait(s) dérivable(s).',derived_candidates:[{fact_key:'cargo.volume_cbm',value_number:999,explanation_fr:'Obsolete volume'}],false_blocker_candidates:[{gap_key:'cargo.volume_cbm',message_fr:'Obsolete resolvable gap'}],contradiction_flags:[],warnings:[],operator_guidance:[]};
Deno.test('volume advice: projects old event against current facts, summary and gap state without mutating history',()=>{
 const before=JSON.stringify(old),projected=projectVolumeAdvice(old,[dim('1 x 1 x 1 m'),pieces(2)],['cargo.volume_cbm']);
 assertEquals(projected.derived_candidates,[]);assertEquals(projected.false_blocker_candidates,[]);assert(!String(projected.summary).includes('dérivable'));assertEquals(JSON.stringify(old),before);
 assertEquals(projectVolumeAdvice(old,undefined).derived_candidates,[]);
 const positive=projectVolumeAdvice(old,[dim('1 x 1 x 1 m'),pieces(1)],[]);assertEquals((positive.derived_candidates as Array<{value_number:number}>)[0].value_number,1);assertEquals(positive.false_blocker_candidates,[]);
});
type Row=Record<string,unknown>;
async function fixture(){
 const original=globalThis.fetch,names=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'],before=names.map(k=>Deno.env.get(k));
 names.forEach((k,i)=>Deno.env.set(k,['https://fixture.invalid','fake-anon','fake-service'][i]));
 const state={facts:[dim('10 x 10 x 10 mm'),pieces(1)] as Row[],gaps:[{gap_key:'cargo.volume_cbm',is_blocking:true,status:'open'}] as Row[],intent:{id:'intent',related_email_id:'mail',event_data:{intent:{shipment_scope_hypothesis:'unknown'}}} as Row,events:[] as Row[],fail:'',calls:[] as string[]};
 globalThis.fetch=async(input,init)=>{
  const req=input instanceof Request?input:new Request(String(input),init),url=new URL(req.url),name=url.pathname.split('/').pop()!;assertEquals(url.hostname,'fixture.invalid','All network intercepted, no remote AI/database');state.calls.push(req.method+' '+name);
  const reply=(data:unknown,status=200)=>Response.json(data,{status});
  if(name==='user')return reply({id:'actor',email:'qa@example.invalid'});if(name==='has_workspace_access')return reply(true);
  if(name===state.fail)return reply({message:'Synthetic read unavailable'},503);
  if(name==='quote_facts')return reply(state.facts);if(name==='quote_gaps')return reply(state.gaps);
  if(name==='case_timeline_events'){
   if(req.method==='POST'){const event=await req.json();state.events.push({id:'event-'+state.events.length,created_at:String(state.events.length),...event});return reply(null);}
   let events=url.searchParams.get('event_type')==='eq.thread_intent_v1'?[state.intent]:[...state.events].reverse();
   const related=url.searchParams.get('related_email_id');if(related?.startsWith('eq.'))events=events.filter(e=>e.related_email_id===related.slice(3));if(related==='is.null')events=events.filter(e=>e.related_email_id==null);
   if(url.searchParams.has('limit'))events=events.slice(0,Number(url.searchParams.get('limit')));
   return reply(req.headers.get('accept')?.includes('vnd.pgrst.object')?events[0]??null:events);
  }return reply([]);
 };
 const run=async()=>{const response=await analyzeCaseCoherenceHandler(new Request('https://fixture.invalid/coherence',{method:'POST',headers:{Authorization:'Bearer fake','Content-Type':'application/json'},body:JSON.stringify({case_id:'case',related_email_id:'mail'})}));return{status:response.status,data:await response.json()};};
 return{state,run,restore:()=>{globalThis.fetch=original;names.forEach((k,i)=>before[i]===undefined?Deno.env.delete(k):Deno.env.set(k,before[i]!));}};
}
Deno.test('volume advice: actual handler corrects units and caches only identical current inputs, append-only after changes',async()=>{
 const f=await fixture();try{
  const first=await f.run();assertEquals(first.status,200);assertEquals(first.data.coherence.derived_candidates[0].value_number,.000001);assertEquals(f.state.events.length,1);
  const snapshot=JSON.stringify(f.state.events[0]),again=await f.run();assertEquals(again.data.idempotent,true);assertEquals(f.state.events.length,1);
  f.state.facts.reverse();assertEquals((await f.run()).data.idempotent,true,'Stable ordering');
  f.state.facts=[dim('1 x 1 x 1 m'),pieces(2)];const changed=await f.run();assertEquals(changed.data.idempotent,false);assertEquals(changed.data.coherence.derived_candidates,[]);assertEquals(f.state.events.length,2);assertEquals(JSON.stringify(f.state.events[0]),snapshot);
  f.state.gaps=[];await f.run();assertEquals(f.state.events.length,3);
  f.state.intent={...f.state.intent,id:'new-intent'};await f.run();assertEquals(f.state.events.length,4);
  assert(!f.state.calls.some(s=>/supersede_fact|PATCH|ai.gateway/.test(s)));
 }finally{f.restore();}
});
for(const name of ['quote_facts','quote_gaps'])Deno.test('volume advice: current '+name+' read failure never reuses a successful cached answer',async()=>{
 const f=await fixture();try{await f.run();f.state.fail=name;const result=await f.run();assertEquals(result.status,503);assertEquals(f.state.events.length,1);}finally{f.restore();}
});
Deno.test('volume advice: legacy cached result is retained as history and replaced by a versioned current event',async()=>{
 const f=await fixture();try{f.state.events.push({id:'legacy',event_type:'case_coherence_v1',related_email_id:'mail',event_data:old});const before=JSON.stringify(f.state.events[0]);const result=await f.run();assertEquals(result.data.idempotent,false);assertEquals(f.state.events.length,2);assertEquals(JSON.stringify(f.state.events[0]),before);assertEquals(result.data.coherence.derived_candidates[0].value_number,.000001);}finally{f.restore();}
});
