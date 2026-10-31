import { normalizeCountryToISO,resolveDocumentedCountry } from '../../supabase/functions/_shared/request-country';
import { parseCommercialAmount } from '../../supabase/functions/_shared/commercial-preparation';
import type { AirOperatorRequest,AirSourceAttestation } from '../../supabase/functions/_shared/air-cross-trade-loader';
import type { AirScreenState,AirRow } from './airCrossTradeApi';
export const airServiceLabels:Record<string,string>={PICKUP_ORIGIN:'Collecte à l’origine',PRE_CARRIAGE:'Préacheminement',AIR_FREIGHT:'Fret aérien',AIR_HANDLING:'Handling aéroportuaire',CUSTOMS_EXPORT:'Formalités export',BORDER_FEES:'Frais frontière',AGENCY:'Honoraires',ON_CARRIAGE:'Livraison après l’aéroport'};
export const airClientDataLabels:Record<string,string>={'cargo.description':'Nature des marchandises','routing.destination_airport':'Aéroport d’arrivée','routing.destination_city':'Ville de livraison','cargo.weight_kg':'Poids brut total','cargo.weight_net_kg':'Poids net total','cargo.pieces_count':'Nombre de colis','cargo.dimensions':'Dimensions des colis','cargo.volume_cbm':'Volume total','cargo.packaging_type':'Emballage'};
export function mayPrepareAirCrossTrade(type:string|null|undefined,facts:Array<{fact_key:string;value_text?:string|null;is_current?:boolean;source_type?:string|null}>){
 if(type==='AIR_CROSS_TRADE')return true;if(!type?.startsWith('AIR_'))return false;
 const country=(key:string)=>{const f=facts.find(x=>x.fact_key===key&&x.is_current!==false);return f&&!/assumption|system/.test(f.source_type??'')?normalizeCountryToISO(f.value_text??''):'';};
 const a=country('routing.origin_country'),b=country('routing.destination_country');return !!a&&!!b&&a!==b&&a!=='SN'&&b!=='SN'&&!/UNKNOWN|INCONNU/.test(a+b);
}
export function blankAirDraft(state:AirScreenState):AirOperatorRequest{return {requested_services:[],scope_reference:'',client_data_keys:[],attestations:[],plan:{route:{departure_airport:'',departure_country:'',arrival_airport:state.demand.arrival_airport??'',arrival_country:state.demand.destination_country??'',pre_carriage:'none',routing_reference:'',acceptance_reference:''},services:[]}};}
export function airDraftPayload(draft:AirOperatorRequest):AirOperatorRequest {
 const result=structuredClone(draft);
 for(const d of result.plan.services){const extended=d as typeof d & {amount_text?:string;trips_text?:string};
  if(extended.amount_text!==undefined){const value=parseCommercialAmount(extended.amount_text);d.client_sale={amount_xof:value,basis:d.client_sale?.basis??'unknown',reason:d.client_sale?.reason??''};delete extended.amount_text;}
  if(extended.trips_text!==undefined){const value=parseCommercialAmount(extended.trips_text);if(value!==null&&(!Number.isInteger(value)||value<=0))throw new Error('Nombre entier de voyages strictement positif requis');d.service_quantity={kind:'planned',status:'operator',value,fact_id:'planned',source_id:'planned'};delete extended.trips_text;}
 }
 result.attestations=result.attestations.filter(a=>result.plan.services.some(d=>['priced','pending'].includes(d.disposition)&&d.source_id===a.source_kind+':'+a.source_id));
 return result;
}
export function sourceAttestation(kind:'rate_card'|'partner_fact',raw:AirRow,service:string,countries:Array<{country_code:string;country_name:string|null}>=[]):AirSourceAttestation {
 const country=(value:unknown)=>resolveDocumentedCountry(value,countries)?.code??'';
 const key=String(raw.fact_key??'');return {service_key:service,source_kind:kind,source_id:String(raw.id),unit:(kind==='rate_card'?raw.unit:key==='cargo.freight_rate_per_kg'?'kg':'forfait') as AirSourceAttestation['unit'],
  effective_from:typeof raw.effective_from==='string'?raw.effective_from:'',effective_to:typeof raw.effective_to==='string'?raw.effective_to:null,
  origin_country:country(raw.origin_country),destination_country:country(raw.destination_country),
  origin_airport:typeof raw.origin_port==='string'?raw.origin_port:null,destination_airport:typeof raw.destination_port==='string'?raw.destination_port:null,
  reference:'',required_fact_keys:[],included_services:[]};
}
