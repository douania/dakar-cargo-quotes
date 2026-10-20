import {assert,assertEquals} from 'https://deno.land/std@0.224.0/assert/mod.ts';
let handler:(req:Request)=>Promise<Response>;
const oldServe=Deno.serve;
Deno.env.set('RUN_PRICING_DISABLE_SERVE','0');
Deno.serve=((h:unknown)=>{handler=h as typeof handler;return {} as Deno.HttpServer;}) as typeof Deno.serve;
await import('./index.ts');
Deno.serve=oldServe;
for(const scenario of ['legacy_composite','via_not_pod','reference_denied','incomplete'] as const)Deno.test('actual pricing handler: route '+scenario+' refuses before first mutation',async()=>{
 const saved=fetch,keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'],values=keys.map(k=>Deno.env.get(k));
 const writes:string[]=[];let routeRead=false;
 keys.forEach((k,i)=>Deno.env.set(k,i===0?'https://route.fixture.invalid':'synthetic-key'));
 globalThis.fetch=async(input,init)=>{
  const req=new Request(input,init),u=new URL(req.url),name=u.pathname.split('/').pop()!,method=req.method;
  const json=(rows:unknown,count=Array.isArray(rows)?rows.length:1)=>new Response(method==='HEAD'?null:JSON.stringify(rows),{headers:{'Content-Type':'application/json','Content-Range':'0-'+Math.max(0,count-1)+'/'+count}});
  if(name==='user')return json({id:'synthetic-operator'});
  if(name==='has_workspace_access')return json(true);
  if(name==='assert_case_source_revisions_resolved')return json(null,0);
  if(!['GET','HEAD'].includes(method)){writes.push(method+' '+name);throw new Error('Unexpected pricing mutation');}
  if(name==='email_threads')return json({id:'thread',client_email:'client@fixture.invalid'});
  if(name==='quote_cases')return json({id:'case',thread_id:'thread',status:'READY_TO_PRICE',request_type:'SEA_FCL_IMPORT'});
  if(name==='quote_facts'){
   const port={id:'port',case_id:'case',fact_key:'routing.destination_port',value_text:scenario==='legacy_composite'?'Goma via Rwanda':'Mombasa',is_current:true,
    source_type:scenario==='reference_denied'?'manual_input':'email_body',source_email_id:scenario==='reference_denied'?null:'source',source_excerpt:'Place of delivery: Goma via Mombasa'};
   if(u.searchParams.get('fact_key')?.includes('routing.destination_port')){routeRead=true;return json([port],scenario==='incomplete'?2:1);}
   return json([{fact_key:'service.package',value_text:'EXPORT_SENEGAL'}]);
  }
  if(name==='emails'){
   const row={id:'source',thread_ref:'thread',body_text:'Place of delivery: Goma via Mombasa',from_address:'client@fixture.invalid'};
   return json(req.headers.get('Accept')?.includes('vnd.pgrst.object')?row:[row]);
  }
  if(name==='location_aliases'){
   if(scenario==='reference_denied')return Response.json({message:'synthetic alias read denied'},{status:400});
   return json([{locations_reference:{id:'sea-ke',canonical_name:'Mombasa',location_type:'sea',is_active:true}}]);
  }
  return json([],0);
 };
 try{
  const response=await handler(new Request('https://route.fixture.invalid/run-pricing',{method:'POST',headers:{Authorization:'Bearer synthetic-token','Content-Type':'application/json'},body:JSON.stringify({case_id:'case'})}));
  const result=await response.json();assert(routeRead,JSON.stringify(result));assertEquals(writes,[]);
  assertEquals(response.status,['reference_denied','incomplete'].includes(scenario)?500:400,JSON.stringify(result));
  if(response.status===400)assert(Array.isArray(result.pricing_blockers)&&result.pricing_blockers.length>0);
 }finally{globalThis.fetch=saved;keys.forEach((k,i)=>values[i]===undefined?Deno.env.delete(k):Deno.env.set(k,values[i]!));}
});
