/** Pure projection: classification confidence is not proof of an airport role.
 * No facts, pricing gate, source text or historical event are mutated here. */
export interface AirportRoleReservation { code:string; reason:'ambiguous_airport_role'; }
export function ambiguousAirportRoles(ownText:string):AirportRoleReservation[]{
 const codes=[...ownText.matchAll(/(?:^|[\n;])\s*AOD\s*:\s*([A-Z]{3})\s*(?=$|[\n;])/gi)].map(m=>m[1].toUpperCase());
 return [...new Set(codes)].filter(code=>{
  // A separate, affirmative, complete role declaration resolves this abbreviation.
  const roles=[...ownText.matchAll(/(?:^|[\n;])\s*(?:Arrival airport|Destination airport|Airport of arrival|Airport of destination|Departure airport|Origin airport|Airport of departure)\s*:\s*([A-Z]{3})\s*(?=$|[\n;])/gi)];
  return roles.filter(m=>m[1].toUpperCase()===code).length!==1;
 }).map(code=>({code,reason:'ambiguous_airport_role'}));
}
export function reserveIntentAirportRoles<T extends Record<string,unknown>>(intent:T,reservations:AirportRoleReservation[],confirmations:Array<{code:string;role:'departure_airport'|'arrival_airport'}>=[]):T & {location_reservations?:AirportRoleReservation[]}{
 if(!reservations.length)return intent;
 const unique=[...new Map(reservations.map(r=>[r.code,r])).values()];
 const note=unique.map(r=>{
  const roles=[...new Set(confirmations.filter(c=>c.code===r.code).map(c=>c.role))];
  return roles.length===1?`L’opérateur a confirmé ${r.code} comme aéroport ${roles[0]==='departure_airport'?'de départ':'d’arrivée'}. L’ancien résumé IA ne valide pas le trajet.`:
   `Le code aéroport ${r.code} est cité ; son rôle de départ ou d’arrivée reste à confirmer.`;
 }).join(' ');
 // A free sentence mentioning an airport role cannot be partly certified.
 // Preserve unrelated explicit information, questions and documentary guidance.
 const roleWords=/a[ée]roport|airport|arriv|d[ée]part|depart|origin|destination/i;
 const relevant=(text:string)=>roleWords.test(text)||unique.some(r=>new RegExp('\\b'+r.code+'\\b','i').test(text));
 const prose=(value:unknown)=>typeof value==='string'&&!relevant(value)?value:note;
 const lines=(value:unknown)=>[...(Array.isArray(value)?value.filter((s):s is string=>typeof s==='string'&&!relevant(s)):[]),note];
 return {...intent,request_summary:prose(intent.request_summary),reasoning:prose(intent.reasoning),
  case_updates:lines(intent.case_updates),operator_guidance:lines(intent.operator_guidance),
  open_questions:lines(intent.open_questions),missing_business_questions:lines(intent.missing_business_questions),location_reservations:unique};
}
export function readAirportRoleReservations(value:unknown):AirportRoleReservation[]{
 return Array.isArray(value)?value.flatMap(r=>r&&typeof r==='object'&&r.reason==='ambiguous_airport_role'&&typeof r.code==='string'&&/^[A-Z]{3}$/.test(r.code)?[{code:r.code,reason:'ambiguous_airport_role' as const}]:[]):[];
}
