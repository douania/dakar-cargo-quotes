import {assert,assertEquals} from 'https://deno.land/std@0.224.0/assert/mod.ts';
let handler:(request:Request)=>Promise<Response>;
const serve=Deno.serve,flag=Deno.env.get('RUN_PRICING_DISABLE_SERVE');
try{
 Deno.env.set('RUN_PRICING_DISABLE_SERVE','0');
 Deno.serve=((callback:unknown)=>{handler=callback as typeof handler;return {} as Deno.HttpServer;}) as typeof Deno.serve;
 await import('./index.ts');
}finally{Deno.serve=serve;if(flag===undefined)Deno.env.delete('RUN_PRICING_DISABLE_SERVE');else Deno.env.set('RUN_PRICING_DISABLE_SERVE',flag);}
for(const pkg of ['EXPORT_SENEGAL','DAP_PROJECT_IMPORT'])for(const provisional of [false,true])Deno.test(`blocking gap read failure: ${pkg}, provisional=${provisional}`,async()=>{
 const savedFetch=globalThis.fetch,keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'],saved=keys.map(k=>Deno.env.get(k));
 const writes:string[]=[],afterFailure:string[]=[];let failed=false;
 try{
  Deno.env.set(keys[0],'https://unit-test.invalid');Deno.env.set(keys[1],'synthetic-anon');Deno.env.set(keys[2],'synthetic-service');
  globalThis.fetch=async(input,init)=>{
   const req=new Request(input,init),url=new URL(req.url);assertEquals(url.origin,'https://unit-test.invalid');
   const name=url.pathname.split('/').pop()!;if(failed)afterFailure.push(req.method+' '+name);
   const json=(value:unknown)=>Response.json(value);
   if(name==='assert_case_source_revisions_resolved')return json(null);
   if(!['GET','HEAD'].includes(req.method)){writes.push(req.method+' '+name);return new Response(JSON.stringify({code:'42501',message:'synthetic mutation denied'}),{status:400,headers:{'Content-Type':'application/json'}});}
   if(name==='user')return json({id:'synthetic-user',aud:'authenticated'});
   if(name==='has_workspace_access')return json(true);
   if(name==='quote_cases')return json({id:'synthetic-case',thread_id:null,status:'PRICED_DRAFT',request_type:'SEA_FCL_IMPORT'});
   if(name==='quote_facts')return json([{fact_key:'service.package',value_text:pkg}]);
   if(name==='quote_gaps'&&url.searchParams.get('is_blocking')==='eq.true'){
    failed=true;return new Response(JSON.stringify({code:'42501',message:'synthetic blocking gaps denied'}),{status:400,headers:{'Content-Type':'application/json'}});
   }
   if(name==='quote_gaps')return json([{gap_key:'source_contract.export_customs',status:'open',is_blocking:true}]);
   return new Response(req.method==='HEAD'?null:'[]',{headers:{'Content-Type':'application/json','Content-Range':'0-0/0'}});
  };
  const response=await handler(new Request('https://unit-test.invalid/run-pricing',{method:'POST',headers:{Authorization:'Bearer synthetic-token','Content-Type':'application/json'},body:JSON.stringify({case_id:'synthetic-case',allow_provisional:provisional})}));
  const body=await response.json();console.log(JSON.stringify({status:response.status,details:body.details,writes,afterFailure}));
  assert(failed);assertEquals(response.status,500);assert(String(body.details).includes('Blocking gap verification failed'));
  assertEquals(afterFailure,[]);assertEquals(writes,[]);
 }finally{globalThis.fetch=savedFetch;keys.forEach((k,i)=>saved[i]===undefined?Deno.env.delete(k):Deno.env.set(k,saved[i]!));}
});
