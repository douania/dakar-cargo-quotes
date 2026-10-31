import { supabase } from '@/integrations/supabase/client';
import type { AirLoadedState,AirOperatorRequest } from '../../supabase/functions/_shared/air-cross-trade-loader';
import type { AirPlanRevision,evaluateAirCrossTrade } from '../../supabase/functions/_shared/air-cross-trade';
export type AirRow=Record<string,unknown>;
export type AirScreenState=Omit<AirLoadedState,'head'> & {head:({id:string;revision:number;created_at:string;created_by:string;plan:AirPlanRevision;request:AirOperatorRequest})|null;
 country_choices?:AirLoadedState["countries"];applicable:boolean;demand:{origin_country:string|null;destination_country:string|null;arrival_airport:string|null};can_write:boolean;
 catalog:AirRow[];partner_catalog:AirRow[];fx_catalog:AirRow[];catalog_has_more:boolean;evaluation:ReturnType<typeof evaluateAirCrossTrade>|null;qualification_error?:string};
export class AirCallError extends Error {constructor(message:string,public outcome:'unknown'|'refused',public status=0){super(message);}}
export async function airCrossTradeCall<T>(body:AirRow):Promise<T>{
 try {
  const {data,error}=await supabase.functions.invoke('manage-air-cross-trade',{body});
  if(error){const detail=await error.context?.json?.().catch(()=>null);throw new AirCallError(detail?.error??'Résultat non confirmé. Vérifiez l’opération avant de reprendre.',detail?.outcome==='refused'?'refused':'unknown',error.context?.status??0);}
  if(!data?.ok)throw new AirCallError(data?.error??'Opération refusée',data?.outcome==='unknown'?'unknown':'refused');
  return data.data as T;
 }catch(error){if(error instanceof AirCallError)throw error;throw new AirCallError('Résultat non confirmé. Vérifiez l’opération avant de reprendre.','unknown');}
}

export async function airClientRequirementFacts(caseId:string,type:string|undefined){
 if(type!=="AIR_CROSS_TRADE")return [];
 const value=await airCrossTradeCall<{plan_id:string;required_fact_keys:string[];client_data_keys:string[]}|null>({action:'requirements',case_id:caseId});
 return value?[{fact_key:'service.air_cross_trade_requirements',value_json:value}]:[];
}
