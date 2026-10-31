import { requireUser } from "../_shared/auth.ts";
import { handleCors,corsHeaders } from "../_shared/cors.ts";
import { commercialUuid } from "../_shared/commercial-service.ts";
import { readAirOperatorRequest } from "../_shared/air-cross-trade-loader.ts";
import { readAirCrossTradeRequirements,readAirCrossTrade,mutateAirCrossTrade,airCrossTradeOperation } from "../_shared/air-cross-trade-service.ts";
export async function handleAirCrossTrade(req: Request): Promise<Response> {
 const cors=handleCors(req);if(cors)return cors;
 const auth=await requireUser(req);if(auth instanceof Response)return auth;
 try {
  if(req.method!=="POST")return new Response(null,{status:405,headers:corsHeaders});
  const text=await req.text();if(text.length>150000)throw new Error("Demande trop volumineuse");const body=JSON.parse(text);
  if(!commercialUuid(body.case_id))throw new Error("Dossier requis");
  let data:unknown;
  if(body.action==="requirements")data=await readAirCrossTradeRequirements(auth,body.case_id);
  else if(body.action==="read")data=await readAirCrossTrade(auth,body.case_id,body.operator?readAirOperatorRequest(body.operator):null,undefined,typeof body.query==="string"?body.query.slice(0,200):"");
  else if(body.action==="operation")data=await airCrossTradeOperation(auth,body.case_id,body.operation_id);
  else if(body.action==="save"||body.action==="price")data=await mutateAirCrossTrade(auth,body.action,body);
  else throw new Error("Action inconnue");
  return new Response(JSON.stringify({ok:true,data}),{headers:{...corsHeaders,"Content-Type":"application/json"}});
 } catch(error) {const e=error as Error & {status?:number;needs?:unknown;outcome?:string};return new Response(JSON.stringify({ok:false,error:e.message,needs:e.needs,outcome:e.outcome??"refused"}),
 {status:e.status??400,headers:{...corsHeaders,"Content-Type":"application/json"}});}
}
if(import.meta.main)Deno.serve(handleAirCrossTrade);
