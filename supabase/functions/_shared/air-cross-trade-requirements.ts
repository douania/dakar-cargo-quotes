import type { AirOperatorRequest } from "./air-cross-trade-loader.ts";
import type { AirRateSource,evaluateAirCrossTrade } from "./air-cross-trade.ts";
export const AIR_REQUIREMENTS_KEY="service.air_cross_trade_requirements";
export const AIR_CLIENT_DATA_KEYS=new Set(["cargo.description","routing.destination_airport","routing.destination_city","cargo.weight_kg","cargo.weight_net_kg","cargo.pieces_count","cargo.dimensions","cargo.volume_cbm","cargo.packaging_type"]);
export function deriveAirRequirements(operator:AirOperatorRequest,sources:AirRateSource[],assessment:ReturnType<typeof evaluateAirCrossTrade>) {
 const required=new Set(["routing.origin_country","routing.destination_country","routing.destination_airport","cargo.description"]);
 for(const d of operator.plan.services) {
  if(d.disposition!=="priced"||assessment.needs.some(n=>n.service_key===d.service_key&&["tariff.source","tariff.applicability"].includes(n.key)))continue;
  const source=sources.find(s=>s.id===d.source_id);if(!source)continue;
  for(const key of source.required_fact_keys)required.add(key);
  if(source.unit==="kg"&&d.weight_basis)required.add(({gross_kg:"cargo.weight_kg",net_kg:"cargo.weight_net_kg",chargeable_kg:"cargo.chargeable_weight_kg"})[d.weight_basis]);
  if(source.unit==="colis")required.add("cargo.pieces_count");if(source.unit==="cbm")required.add("cargo.volume_cbm");
 }
 const selected=operator.client_data_keys??[];
 if(!Array.isArray(selected)||selected.some(k=>!AIR_CLIENT_DATA_KEYS.has(k)||!required.has(k)))throw new Error("Une question client doit correspondre à une donnée réellement nécessaire au périmètre qualifié");
 return {required_fact_keys:[...required].sort(),client_data_keys:[...new Set(["cargo.description","routing.destination_airport",...selected])].sort()};
}
export function readAirRequirements(facts:Array<{fact_key:string;value_json?:unknown;is_current?:boolean}>) {
 const rows=facts.filter(f=>f.fact_key===AIR_REQUIREMENTS_KEY&&f.is_current!==false);if(rows.length!==1)return null;
 const value=rows[0].value_json as Record<string,unknown>|null;
 if(!value||typeof value.plan_id!=="string"||!Array.isArray(value.required_fact_keys)||!Array.isArray(value.client_data_keys)||
  value.required_fact_keys.some(k=>typeof k!=="string")||value.client_data_keys.some(k=>typeof k!=="string"||!AIR_CLIENT_DATA_KEYS.has(k)||!(value.required_fact_keys as unknown[]).includes(k)))return null;
 return value as {plan_id:string;required_fact_keys:string[];client_data_keys:string[]};
}
