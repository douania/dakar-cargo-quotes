import { serverFixture } from "../../supabase/functions/_shared/air-cross-trade-loader_test.ts";
import { mutateAirCrossTrade,readAirCrossTrade } from "../../supabase/functions/_shared/air-cross-trade-service.ts";
import type { AuthResult } from "../../supabase/functions/_shared/auth.ts";
const container=Deno.args[0];if(!/^dcq-air-cross-[0-9]+$/.test(container))throw new Error("Explicit isolated container required");
const q=(v:unknown)=>v===null?"NULL":typeof v==="object"?"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb":"'"+String(v).replaceAll("'","''")+"'";
const client={rpc:async(name:string,args:Record<string,unknown>)=>{
 if(!["air_cross_trade_read","air_cross_trade_operation","air_cross_trade_store_plan","air_cross_trade_commit_pricing"].includes(name))throw new Error("RPC outside candidate");
 const sql="SET request.jwt.claim.role='service_role';SET ROLE service_role; SELECT public."+name+"("+Object.entries(args).map(([k,v])=>k+"=>"+q(v)).join(",")+");";
 const child=new Deno.Command("docker",{args:["exec","-i",container,"psql","-U","postgres","-XAtq","-v","ON_ERROR_STOP=1","-v","VERBOSITY=verbose"],stdin:"piped",stdout:"piped",stderr:"piped"}).spawn();
 const writer=child.stdin.getWriter();await writer.write(new TextEncoder().encode(sql));await writer.close();const out=await child.output();
 if(!out.success){const message=new TextDecoder().decode(out.stderr),code=/ERROR:\s+([A-Z0-9]{5}):/.exec(message)?.[1]??"SQL";
 console.error(JSON.stringify({synthetic_sql_refusal:code,constraint:/constraint "([^"]+)"/.exec(message)?.[1]??null}));return {data:null,error:{message,code}};}
 return {data:JSON.parse(new TextDecoder().decode(out.stdout).trim()),error:null};
}};
const f=serverFixture();
if(Deno.args[1]==="gw"){
 f.cid="20000000-0000-4000-8000-000000000003";f.sid="30000000-0000-4000-8000-000000000003";
 Object.assign(f.operator.plan.route,{departure_country:"GW",departure_airport:"AAA",arrival_country:"BE",arrival_airport:"BBB",routing_reference:"SYNTHETIC OPERATOR ROUTE; NOT REAL CARGO ACCEPTANCE"});
 f.operator.plan.services[0].source_id=`rate_card:${f.sid}`;Object.assign(f.operator.attestations[0],{source_id:f.sid,origin_country:"GW",destination_country:"BE",origin_airport:"AAA",destination_airport:"BBB"});
}
const auth={user:{id:f.uid},token:"synthetic-auth-only"} as AuthResult;
if(Deno.args[1]==="read") {console.log(JSON.stringify(await readAirCrossTrade(auth,f.cid,null,client)));Deno.exit(0);}
const first=await readAirCrossTrade(auth,f.cid,f.operator,client);
const request={case_id:f.cid,operation_id:Deno.args[1]==="gw"?"40000000-0000-4000-8000-000000000003":"40000000-0000-4000-8000-000000000001",parent_id:null,expected_context:first.context_hash,expected_sources:first.sources_hash,operator:f.operator};
const saved=await mutateAirCrossTrade(auth,"save",request,client) as Record<string,unknown>;
const replay=await mutateAirCrossTrade(auth,"save",request,client) as Record<string,unknown>;
if(saved.id!==replay.id)throw new Error("Plan replay duplicated");
const ready=await readAirCrossTrade(auth,f.cid,null,client);
if(!ready.evaluation?.ready_to_price)throw new Error("Positive candidate did not qualify: "+JSON.stringify(ready));
const pricingRequest={case_id:f.cid,operation_id:Deno.args[1]==="gw"?"50000000-0000-4000-8000-000000000003":"50000000-0000-4000-8000-000000000001",parent_id:String(saved.id),plan_id:String(saved.id),expected_context:ready.context_hash,expected_sources:ready.sources_hash};
const receipt=await mutateAirCrossTrade(auth,"price",pricingRequest,client) as Record<string,unknown>;
const same=await mutateAirCrossTrade(auth,"price",pricingRequest,client) as Record<string,unknown>;
if(receipt.pricing_run_id!==same.pricing_run_id)throw new Error("Pricing replay duplicated");
if(Deno.args[1]==="gw")console.log(JSON.stringify({status:"PASS",country_without_location:first.demand.origin_country==="GW",choice_available:first.country_choices.some(c=>c.country_code==="GW"),price_xof:ready.evaluation!.pricing!.total_ttc}));
else console.log(JSON.stringify({saved,receipt,pricingRequest,request,ready:ready.evaluation}));
