import {assertEquals,assertRejects} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {serverFixture} from "./air-cross-trade-loader_test.ts";
import {mapAirSources} from "./air-cross-trade-loader.ts";
import {readAirCrossTrade,mutateAirCrossTrade} from "./air-cross-trade-service.ts";
import type {AuthResult} from "./auth.ts";
Deno.test("AIR service read: external blocking gates cannot be hidden by a complete mathematical candidate",async()=>{
 const f=serverFixture(),loaded=await mapAirSources(f.state,f.operator);f.operator.plan.services[0].source_fingerprint=loaded.sources[0].fingerprint;
 const auth={user:{id:f.uid},token:"synthetic-only"} as AuthResult;
 const current={...f.state,source_revisions_clear:true,requirements:{plan_id:"plan",required_fact_keys:[],client_data_keys:[]},head:{id:"plan",request:f.operator,plan:{id:"plan",case_id:f.cid,revision:1,actor_id:f.uid,context_fingerprint:"ctx1",plan:f.operator.plan}}};
 const read=(patch:Record<string,unknown>)=>readAirCrossTrade(auth,f.cid,null,{rpc:async()=>({data:{...current,...patch},error:null})});
 assertEquals((await read({})).evaluation?.ready_to_price,true);
 for(const patch of [{source_revisions_clear:false},{source_revisions_clear:null},{requirements:null},{blocking_gaps:[{gap_key:"source.contract"}]},{intent:{intent:{pricing_gate:false}}}]){
  const result=await read(patch);assertEquals(result.evaluation?.ready_to_price,false);assertEquals(result.evaluation?.pricing,null);
 }
});
Deno.test("AIR service mutations: known refusal differs from transport unknown and creates no retry",async()=>{
 const f=serverFixture(),auth={user:{id:f.uid},token:"synthetic-only"} as AuthResult,body={case_id:f.cid,operation_id:"40000000-0000-4000-8000-000000000001",parent_id:null,expected_context:"ctx",expected_sources:"src",operator:f.operator};
 for(const code of ["PT409","23505"]){let calls=0;try{await mutateAirCrossTrade(auth,"save",body,{rpc:async()=>{calls++;return{data:null,error:{code,message:"synthetic refusal"}};}});throw new Error("Expected rejection");}catch(e){assertEquals((e as {outcome:string}).outcome,"refused");}assertEquals(calls,1);}
 let calls=0;await assertRejects(()=>mutateAirCrossTrade(auth,"save",body,{rpc:async()=>{calls++;throw new Error("Lost transport");}}),Error,"non confirmé");assertEquals(calls,1);
});

Deno.test("AIR HTTP boundary: no-auth is refused and preflight never calls a service",async()=>{
 const {handleAirCrossTrade}=await import("../manage-air-cross-trade/index.ts");
 const response=await handleAirCrossTrade(new Request("http://localhost/manage-air-cross-trade",{method:"POST",body:JSON.stringify({action:"price",case_id:"synthetic"})}));assertEquals(response.status,401);
 const options=await handleAirCrossTrade(new Request("http://localhost/manage-air-cross-trade",{method:"OPTIONS"}));assertEquals(options.status,200);
});

Deno.test("AIR read keeps conflicting source references separate from display choices",async()=>{
 const f=serverFixture();f.state.countries=[{country_code:"UG",country_name:"Guinea-Bissau"}];f.state.facts[0].value_text="Guinea-Bissau";
 const result=await readAirCrossTrade({user:{id:f.uid},token:"synthetic-only"} as AuthResult,f.cid,null,{rpc:async()=>({data:f.state,error:null})});
 assertEquals(result.countries,f.state.countries);assertEquals(result.country_choices.some(c=>c.country_code==="GW"),true);assertEquals(result.demand.origin_country,null);assertEquals(result.applicable,false);
});
