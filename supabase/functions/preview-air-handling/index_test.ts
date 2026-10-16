import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handleAirPreview } from './index.ts';
const profile = { id:'a2a50000-1016-4000-8000-000000000001', revision:1,supplier:'2AS',airport:'DSS',direction:'IMPORT',cargo_class:'GENERAL_CARGO',effective_from:'2026-10-16',effective_to:null,
  rates:{collection_per_kg:20,security_per_kg:10,documents:25000,warehouse_passage:6000,it:1500},source_reference:'Synthetic source',evidence:{} };
async function fixture(run:(invoke:(body:unknown,auth?:boolean)=>Promise<Response>,calls:string[])=>Promise<void>,admitted=true) {
  const old=globalThis.fetch, keys=['SUPABASE_URL','SUPABASE_ANON_KEY'], env=keys.map(k=>Deno.env.get(k));
  Deno.env.set(keys[0],'https://fixture.invalid');Deno.env.set(keys[1],'synthetic-anon');const calls:string[]=[];
  globalThis.fetch=async(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input));assertEquals(url.hostname,'fixture.invalid');calls.push(url.pathname);
    const json=(data:unknown)=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
    if(url.pathname==='/auth/v1/user')return json({id:'synthetic-user'});
    if(url.pathname.endsWith('/has_workspace_access'))return json(admitted);
    assert(url.pathname.endsWith('/air_handling_read'),'No mutation or other RPC permitted');
    const body=JSON.parse(String(init?.body??'{}'));
    return json(body.p_case_id ? {selection:null,context_hash:'fixture',request_type:'AIR_IMPORT',lot_count:0,facts:[]} : {profiles:[profile],can_edit:false});
  };
  try{await run((body,auth=true)=>handleAirPreview(new Request('https://fixture.invalid/preview-air-handling',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer synthetic-token'}:{})},body:JSON.stringify(body)})),calls);}
  finally{globalThis.fetch=old;keys.forEach((k,i)=>env[i]===undefined?Deno.env.delete(k):Deno.env.set(k,env[i]!));}
}
Deno.test('AIR preview refuses anonymous identity without reading a profile',()=>fixture(async(invoke,calls)=>{
  assertEquals((await invoke({},false)).status,401);assertEquals(calls.length,0);
}));
Deno.test('AIR preview refuses a non-member or banned admission before business reads',()=>fixture(async(invoke,calls)=>{
  assertEquals((await invoke({})).status,403);assert(!calls.some(c=>c.endsWith('/air_handling_read')));
},false));
Deno.test('AIR preview example uses the production resolver and never forces TTC reconciliation',()=>fixture(async(invoke,calls)=>{
  for(const [kg,ht] of [[64,34420],[545,48850],[268,40540]]){
    const response=await invoke({profile_id:profile.id,taxable_kg:kg,general_cargo_confirmed:true,warehouse_bracket_confirmed:true});
    assertEquals(response.status,200);const data=(await response.json()).data;assertEquals(data.example,true);
    assertEquals(data.resolution.supplier_complete_ht_xof,ht);assertEquals(data.resolution.supplier_ttc_xof,null);assertEquals(data.resolution.selling_amount_xof,null);
  }
  assert(calls.every(c=>!c.includes('pricing_runs')));
}));
Deno.test('AIR preview requires explicit general-cargo input and numeric taxable weight',()=>fixture(async invoke=>{
  for(const body of [{taxable_kg:'64',general_cargo_confirmed:true},{taxable_kg:64,general_cargo_confirmed:false},{taxable_kg:-1,general_cargo_confirmed:true}]){
    assertEquals((await invoke({profile_id:profile.id,warehouse_bracket_confirmed:true,...body})).status,400);
  }
}));
Deno.test('AIR preview case with no explicit profile remains unconfigured',()=>fixture(async invoke=>{
  const response=await invoke({case_id:'22222222-2222-4222-8222-222222222222'});assertEquals(response.status,200);
  const data=(await response.json()).data;assertEquals(data.example,false);assertEquals(data.resolution,null);
}));
