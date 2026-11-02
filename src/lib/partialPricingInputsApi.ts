import { supabase } from '@/integrations/supabase/client';
import type { PartialPricingInputRead } from '../../supabase/functions/_shared/partial-pricing-input-read';
/** Explicit read-only action. Never fall back to a pricing call or a saved tariff snapshot. */
export async function readPartialPricingInputs(caseId:string, expected:{requestType:string;packageKey:string;serviceKeys:string[]}):Promise<PartialPricingInputRead> {
 const {data,error}=await supabase.functions.invoke('price-service-lines',{body:{action:'read_input_diagnostic',case_id:caseId}});
 const result=data?.data as PartialPricingInputRead|undefined;
 const checked=Date.parse(result?.checked_at??'');
 const sameServices=Array.isArray(result?.service_keys)&&JSON.stringify([...result.service_keys].sort())===JSON.stringify([...expected.serviceKeys].sort());
 const report=result?.report;
 if(error||data?.ok!==true||!result||result.schema_version!==1||result.case_id!==caseId||result.request_type!==expected.requestType||
  result.package_key!==expected.packageKey||!sameServices||!Number.isFinite(checked)||checked>Date.now()+60_000||Date.now()-checked>30_000||
  !/^[a-f0-9]{64}$/.test(result.context_hash)||!/^[a-f0-9]{64}$/.test(result.tariff_hash)||!report||report.schema_version!==1||
  report.contract!=='EXPLICIT_PARTIAL_DESTINATION_DDP_KG'||report.automatic_question!==false||report.quote_readiness!=='NOT_DETERMINED'||
  typeof report.coverage!=='string'||!Array.isArray(report.reserves)||!report.reserves.every(x=>typeof x==='string')||!Array.isArray(report.needs)||
  !report.needs.every(n=>n&&typeof n.key==='string'&&typeof n.service_key==='string'&&typeof n.label==='string'&&typeof n.why==='string'&&typeof n.next_step==='string'&&
   ['client','operator','reference'].includes(n.owner)&&['provided','missing','assumption','contradiction','invalid','unqualified','not_evaluated'].includes(n.state)&&
   Array.isArray(n.fact_ids)&&Array.isArray(n.observations)&&n.observations.every(o=>o&&(o.value_number===null||typeof o.value_number==='number'))&&
   (n.source===null||n.source&&typeof n.source.reference==='string'&&Array.isArray(n.source.conditions)&&n.source.conditions.every(c=>typeof c==='string'))))throw new Error('Diagnostic DDP indisponible ou contexte périmé');
 return result;
}
