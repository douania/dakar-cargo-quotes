import {documentedCountryChoices} from "./request-country.ts";
import { deriveAirRequirements } from "./air-cross-trade-requirements.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import type { AuthResult } from "./auth.ts";
import { commercialUuid, commercialError } from "./commercial-service.ts";
import { airCrossTradeCanonical, classifyAirCrossTrade, evaluateAirCrossTrade, retainAirCrossTradePlan, type AirPlanRevision } from "./air-cross-trade.ts";
import { mapAirRequest, mapAirSources, readAirOperatorRequest, type AirLoadedState, type AirOperatorRequest } from "./air-cross-trade-loader.ts";

type RpcClient = {rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: {code?: string;message?: string}|null}>};
export function airServiceClient(): RpcClient { return createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}}); }
async function rpc(client: RpcClient,name: string,args: Record<string,unknown>) {
 let result: {data:unknown;error:{code?:string;message?:string}|null};
 try { result=await client.rpc(name,args); }
 catch { throw Object.assign(new Error("Résultat non confirmé ; vérifier l’opération avant toute reprise."),{status:503,outcome:"unknown"}); }
 if(result.error) {
  const code=result.error.code??"", known=/^[0-9A-Z]{5}$/.test(code);
  if(!known) throw Object.assign(new Error("Résultat non confirmé ; vérifier l’opération avant toute reprise."),{status:503,outcome:"unknown"});
  throw Object.assign(new Error(code==="42501"?"Accès non autorisé.":["40001","PT409"].includes(code)?"Contexte modifié ; conserver la saisie et actualiser.":"Opération refusée par la base ; aucune reprise automatique."),{status:code==="42501"?403:["40001","PT409"].includes(code)?409:400,outcome:"refused"});
 }
 return result.data;
}
function pinPlan(operator: AirOperatorRequest,loaded: Awaited<ReturnType<typeof mapAirSources>>,id:string) {
 for(const d of operator.plan.services) {
  if(d.disposition==="priced") {
   const source=loaded.sources.find(s=>s.id===d.source_id);if(!source)throw new Error("Source de la prestation requise");d.source_fingerprint=source.fingerprint;
   if(d.fx_id){const fx=loaded.fx.find(f=>f.id===d.fx_id);if(!fx)throw new Error("Change sélectionné absent");d.fx_fingerprint=fx.fingerprint;}
  }
  if(d.service_quantity?.kind==="planned")d.service_quantity={kind:"planned",status:"operator",value:d.service_quantity.value,source_id:id,fact_id:`plan:${id}:${d.service_key}:trips`};
 }
}
export async function readAirCrossTrade(auth: AuthResult,caseId: string,operator: AirOperatorRequest|null=null, client=airServiceClient(),query="") {
  const state=await rpc(client,"air_cross_trade_read",{p_case:caseId,p_actor:auth.user.id,p_request:operator,p_query:query}) as AirLoadedState;
  const retained=state.head?.plan as AirPlanRevision|undefined;
  const request=operator ?? state.head?.request as AirOperatorRequest|undefined;
  const blank={requested_services:[],scope_reference:"",plan:{route:{},services:[]},attestations:[]} as unknown as AirOperatorRequest;
  const demand=mapAirRequest(state,request??blank);
  const common={...state,country_choices:documentedCountryChoices(state.countries),applicable:classifyAirCrossTrade(demand)==="eligible",demand:{origin_country:demand.origin_country?.value??null,destination_country:demand.destination_country?.value??null,arrival_airport:demand.arrival_airport?.value??null}};
  if(!request) return {...common,evaluation:null};
  try {
    const loaded=await mapAirSources(state,request);
    let assessed=retained??null;
    if(operator) {pinPlan(operator,loaded,"preview");assessed={id:"preview",case_id:caseId,revision:Number(state.head?.revision??0)+1,actor_id:auth.user.id,context_fingerprint:state.context_hash,plan:operator.plan};}
    const evaluation=evaluateAirCrossTrade({request:mapAirRequest(state,request),retained:assessed,
      context_fingerprint:state.context_hash,...loaded,as_of:new Date().toISOString()});
    const blockers:Array<{key:string;owner:"operator";service_key:null;reason:string}>=[];
    if(state.source_revisions_clear!==true)blockers.push({key:"source.revisions",owner:"operator",service_key:null,reason:"Vérifier les corrections de source avant le calcul."});
    const intent=state.intent?.intent as Record<string,unknown>|undefined??state.intent;
    if(intent?.pricing_gate===false||["opportunity_check","general_inquiry","send_document"].includes(String(intent?.intent_type)))blockers.push({key:"thread.intent",owner:"operator",service_key:null,reason:"L’intention courante ne permet pas de calculer une cotation."});
    for(const gap of state.blocking_gaps??[])if(!(gap.gap_key==="routing.destination_city"&&operator&&!deriveAirRequirements(request,loaded.sources,evaluation).required_fact_keys.includes(gap.gap_key)&&!request.plan.services.some(d=>d.service_key==="ON_CARRIAGE"&&d.disposition!=="excluded")))blockers.push({key:gap.gap_key,owner:"operator",service_key:null,reason:"Une réserve bloquante du dossier reste à résoudre."});
    if(!operator&&state.head&&!state.requirements)blockers.push({key:"service.requirements",owner:"operator",service_key:null,reason:"Le périmètre est périmé ; retenir une nouvelle révision du plan."});
    const requirements=operator?deriveAirRequirements(request,loaded.sources,evaluation):state.requirements;
    return {...common,requirements,evaluation:blockers.length?{...evaluation,ready_to_price:false,pricing:null,needs:[...evaluation.needs,...blockers]}:evaluation};
  } catch { return {...common,evaluation:null,qualification_error:"Sources ou attestations à actualiser ; le plan conservé n’est pas supprimé."}; }
}
interface AirMutation { case_id:string; operation_id:string; expected_context:string; expected_sources:string; parent_id:string|null; operator?:unknown; plan_id?:string }
export async function mutateAirCrossTrade(auth: AuthResult,action:"save"|"price",body: AirMutation,client=airServiceClient()) {
  if(!commercialUuid(body.case_id)||!commercialUuid(body.operation_id)||(body.parent_id!==null&&!commercialUuid(body.parent_id))||
    !body.expected_context||!body.expected_sources) throw new Error("Identité et contexte de l’opération requis");
  // An exact replay is a historical receipt, never a fresh calculation.
  const prior=await airCrossTradeOperation(auth,body.case_id,body.operation_id,client) as {plan?:Record<string,unknown>|null;pricing?:Record<string,unknown>|null};
  const business=(value:unknown)=>JSON.parse(JSON.stringify(value,(key,item)=>["source_fingerprint","fx_fingerprint"].includes(key)?undefined:
    key==="service_quantity"&&item?.kind==="planned"?{kind:"planned",status:item.status,value:item.value}:item));
  if(prior.plan||prior.pricing) {
    if(action==="save"&&prior.plan&& !prior.pricing && prior.plan.created_by===auth.user.id &&
      prior.plan.parent_id===body.parent_id && prior.plan.request_context_hash===body.expected_context && prior.plan.sources_hash===body.expected_sources && airCrossTradeCanonical(business(prior.plan.request))===airCrossTradeCanonical(business(readAirOperatorRequest(body.operator)))) return prior.plan;
    if(action==="price"&&prior.pricing&&!prior.plan&&prior.pricing.created_by===auth.user.id&&prior.pricing.plan_id===body.plan_id&&
      prior.pricing.context_hash===body.expected_context&&prior.pricing.sources_hash===body.expected_sources) return prior.pricing;
    commercialError({code:"40001",message:"Identifiant déjà utilisé avec une autre opération"});
  }
  // No automatic write retry. The official operation read resolves a lost response.
  if(action==="save") {
    const operator=readAirOperatorRequest(body.operator);
    const state=await rpc(client,"air_cross_trade_read",{p_case:body.case_id,p_actor:auth.user.id,p_request:operator}) as AirLoadedState;
    if(state.context_hash!==body.expected_context||state.sources_hash!==body.expected_sources|| (state.head?.id??null)!==body.parent_id)
      commercialError({code:"40001",message:"Contexte ou source modifiés ; conservez la saisie et actualisez."});
    const loaded=await mapAirSources(state,operator);
    const request=mapAirRequest(state,operator);
    if(classifyAirCrossTrade(request)!=="eligible") throw new Error("Pays tiers et mode aérien documentés requis ; aucun reclassement supposé.");
    pinPlan(operator,loaded,body.operation_id);
    const plan=retainAirCrossTradePlan({history:state.head?[state.head.plan as AirPlanRevision]:[],id:body.operation_id,expected_id:body.parent_id,
      actor_id:auth.user.id,case_id:body.case_id,expected_context:body.expected_context,actual_context:state.context_hash,plan:operator.plan});
    // Shape/units/coverage are assessed even for an incomplete retained plan.
    const assessed=evaluateAirCrossTrade({request,retained:plan,context_fingerprint:state.context_hash,...loaded,as_of:new Date().toISOString()});
    const requirements=deriveAirRequirements(operator,loaded.sources,assessed);
    const targetKeys=operator.plan.services.filter(d=>d.disposition!=="excluded").map(d=>d.service_key).sort();
    const changedScope=state.facts.filter(f=>["service.package","service.overrides"].includes(String(f.fact_key))&&
      (f.is_validated===true||["operator","manual_input","operator_correction"].includes(String(f.source_type)))&&
      (f.fact_key==="service.package"?f.value_text!=="AIR_CROSS_TRADE":airCrossTradeCanonical(f.value_json)!==airCrossTradeCanonical({add:targetKeys,remove:[]})));
    const acknowledged=(operator as AirOperatorRequest & {acknowledged_scope_fact_ids?:string[]}).acknowledged_scope_fact_ids??[];
    if(changedScope.some(f=>!acknowledged.includes(String(f.id))))commercialError({code:"40001",message:"Le périmètre validé précédent doit être révisé explicitement"});
    return await rpc(client,"air_cross_trade_store_plan",{p_id:body.operation_id,p_case:body.case_id,p_actor:auth.user.id,p_parent:body.parent_id,
      p_context:body.expected_context,p_sources:body.expected_sources,p_request:operator,p_plan:{...plan,requirements,country_normalization:{origin_country:request.origin_country,destination_country:request.destination_country}}});
  }
  if(!commercialUuid(body.plan_id)) throw new Error("Plan enregistré requis");
  const state=await rpc(client,"air_cross_trade_read",{p_case:body.case_id,p_actor:auth.user.id,p_request:null}) as AirLoadedState;
  if(state.head?.id!==body.plan_id||state.context_hash!==body.expected_context||state.sources_hash!==body.expected_sources)
    commercialError({code:"40001",message:"Plan ou source modifiés avant calcul"});
  const operator=readAirOperatorRequest(state.head.request), loaded=await mapAirSources(state,operator);
  const evaluation=evaluateAirCrossTrade({request:mapAirRequest(state,operator),retained:state.head.plan as AirPlanRevision,
    context_fingerprint:state.context_hash,...loaded,as_of:new Date().toISOString()});
  if(!evaluation.pricing) throw Object.assign(new Error("Qualification à compléter avant calcul"),{status:409,needs:evaluation.needs});
  return await rpc(client,"air_cross_trade_commit_pricing",{p_id:body.operation_id,p_case:body.case_id,p_actor:auth.user.id,p_plan:body.plan_id,
    p_context:body.expected_context,p_sources:body.expected_sources,p_pricing:evaluation.pricing});
}
export async function airCrossTradeOperation(auth: AuthResult,caseId:string,id:string,client=airServiceClient()) {
 if(!commercialUuid(caseId)||!commercialUuid(id)) throw new Error("Opération requise");
 return rpc(client,"air_cross_trade_operation",{p_case:caseId,p_actor:auth.user.id,p_id:id});
}

export async function readAirCrossTradeRequirements(auth:AuthResult,caseId:string,client=airServiceClient()) {
 if(!commercialUuid(caseId))throw new Error("Dossier requis");
 return rpc(client,"air_cross_trade_requirements_read",{p_case:caseId,p_actor:auth.user.id}) as Promise<{plan_id:string;required_fact_keys:string[];client_data_keys:string[]}|null>;
}
