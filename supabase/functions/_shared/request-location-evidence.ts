import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { decodeEmailQuoteView, splitEmailQuoteContext } from './email-quote-context.ts';
import { sourceSha256 } from './email-fact-revisions.ts';
import {normalizeContainerInventory,inspectContainerText} from './container-designation.ts';

/** Both replacement and clearing retain the exact old rows before the existing RPC. */
export async function replaceRequestLinesWithEvidence(client:SupabaseClient,args:{
 caseId:string;actorId:string;lines:unknown[];proposedLines:unknown[];mode:string;
}) {
 const previous=await client.from('quote_request_lines').select('*',{count:'exact'}).eq('case_id',args.caseId);
 if(previous.error || !Array.isArray(previous.data) || previous.count!==previous.data.length)throw new Error('Previous line evidence unavailable or incomplete');
 const retained=await client.from('case_timeline_events').insert({case_id:args.caseId,event_type:'case_reasoning_v1',actor_type:'system',actor_user_id:args.actorId,
  event_data:{kind:'quote_line_location_review',version:1,mode:args.mode,previous_lines:previous.data || [],proposed_lines:args.proposedLines}});
 if(retained.error)throw new Error('Request line evidence could not be retained');
 return await client.rpc('replace_quote_request_lines',{p_case_id:args.caseId,p_lines:args.lines});
}

export interface LocationSource {id:string;kind:'email'|'attachment'|'document';text:string;sourceHash?:string;emailId?:string|null;}
export interface LocationClaim {
 key:string;value:unknown;sourceExcerpt?:string;sourceEmailId?:string;sourceAttachmentId?:string;
 sourceType?:string;validated?:boolean;
}
export interface LocationProof {
 key:string;rawValue:unknown;excerpt:string;role:string;status:'accepted'|'rejected';reason:string;
 sources:Array<{id:string;kind:LocationSource['kind'];sha256:string}>;
 locationId:string|null;locationType:string|null;
}
const normalize=(value:string)=>value.toUpperCase().replace(/\s+/g,' ').trim();
export const locationOwnText=(raw:string)=>splitEmailQuoteContext(decodeEmailQuoteView(raw,x=>x)).ownText;
export const isLocationKey=(key:string)=>/^routing\.(?:origin_port|destination_port|origin_airport|destination_airport|destination_city|final_destination)$/.test(key);
const portKey=(key:string)=>/_(?:port|airport)$/.test(key);
const manual=(claim:LocationClaim)=>claim.validated===true||['operator','manual_input','operator_correction'].includes(claim.sourceType || '');

/** Type and transport role are independent. A maritime stop after "via" is not a POD. */
export async function assessLocationClaim(client:SupabaseClient,claim:LocationClaim,sources:LocationSource[]):Promise<LocationProof>{
 const value=typeof claim.value==='string'?claim.value.trim():'';
 const excerpt=(claim.sourceExcerpt || '').trim();
 const matches=sources.filter(s=>(claim.sourceAttachmentId?s.kind!=='email'&&s.id===claim.sourceAttachmentId&&(!claim.sourceEmailId||s.emailId===claim.sourceEmailId):
  !claim.sourceEmailId||s.kind==='email'&&s.id===claim.sourceEmailId)&&excerpt&&normalize(s.text).includes(normalize(excerpt)));
 const proof:LocationProof={key:claim.key,rawValue:claim.value,excerpt,role:'unknown',status:'rejected',reason:'source_not_proven',
  sources:await Promise.all(matches.map(async s=>({id:s.id,kind:s.kind,sha256:s.sourceHash || await sourceSha256(s.text)}))),
  locationId:null,locationType:null};
 if(!value)return {...proof,reason:'empty_location'};
 if(!manual(claim)&&(!matches.length||!normalize(excerpt).includes(normalize(value))))return proof;
 if(!portKey(claim.key)){
  const delivery=/(?:place of delivery|final destination|delivery destination|destination finale|lieu de livraison)\s*:\s*([^\n;]+)/gi;
  const own=excerpt;
  const declared=[...own.matchAll(delivery)].some(m=>normalize(m[1].split(/\s+via\s+/i)[0].split(',')[0])===normalize(value));
  return {...proof,role:'final_delivery_city',status:manual(claim)||declared?'accepted':'rejected',reason:manual(claim)?'operator_decision':declared?'explicit_final_delivery':'delivery_role_not_proven'};
 }
 if(/\b(?:via|transshipment|transhipment|transbordement|or|ou)\b|[;/\n]/i.test(value))return {...proof,reason:'composite_location'};
 const {data,error}=await client.from('location_aliases')
  .select('locations_reference!inner(id,canonical_name,location_type,is_active,country_code,country_name)')
  .eq('normalized_alias',normalize(value)).eq('locations_reference.is_active',true);
 if(error||!Array.isArray(data))throw new Error('Location reference unavailable: '+(error?.message || 'invalid response'));
 const locations=data.flatMap(row=>Array.isArray(row.locations_reference)?row.locations_reference:[row.locations_reference])
  .filter(r=>r?.is_active);
 const unique=new Map(locations.map(r=>[r.id || r.canonical_name,r]));
 if(unique.size!==1)return {...proof,reason:unique.size?'ambiguous_location':'unknown_location'};
 const location=[...unique.values()][0],expected=claim.key.endsWith('_airport')?'air':'sea';
 proof.locationId=location.id??null;proof.locationType=location.location_type;
 if(location.location_type!==expected)return {...proof,reason:'location_type_mismatch'};
 const origin=claim.key.includes('origin_');
 const role=expected==='sea'?(origin?'port_of_loading':'port_of_discharge'):(origin?'departure_airport':'arrival_airport');
 if(manual(claim))return {...proof,role,status:'accepted',reason:'operator_decision'};
 const context=excerpt;
 const prefix=expected==='sea'?(origin?'(?:POL|Port of loading|Loading port|Port d.embarquement)':'(?:POD|Port of discharge|Discharge port|Port de d.chargement)'):
  (origin?'(?:Departure airport|Origin airport|Airport of departure)':'(?:Arrival airport|Destination airport|Airport of arrival)');
 const clauses=[...context.matchAll(new RegExp('\\b'+prefix+'\\s*[:=-]?\\s*([^\\n;]+)','gi'))];
 const affirmative=(label:string)=>!/[/]|\b(?:or|ou|and|et|not|never|transshipment|transhipment|transbordement)\b|\bn['’]est\s+pas\b/i.test(label);
 const boundClauses=matches.flatMap(s=>[...s.text.matchAll(new RegExp('(?:^|[\\n;])\\s*(?:[-•]\\s*)?'+prefix+'\\s*[:=-]?\\s*([^\\n;]+)','gi'))]);
 const match=clauses.find(m=>{
  const label=normalize(m[1]),name=normalize(value);
  return (label===name||label.startsWith(name+',')||label.startsWith(name+' '))&&
    affirmative(m[0])&&boundClauses.some(bound=>affirmative(bound[0])&&normalize(bound[0]).includes(normalize(m[0])));
 });
 if(match&&clauses.length===1)return {...proof,role,status:'accepted',reason:'explicit_transport_role',excerpt:match[0]};
 const other=/\b(?:transshipment|transhipment|transbordement)\b/i.test(excerpt)?'ocean_transshipment':/\bvia\b/i.test(excerpt)?'sea_gateway_unspecified':'unknown';
 return {...proof,role:other,reason:'transport_role_not_proven'};
}

export async function validateLineLocations(client:SupabaseClient, facts:Array<Record<string,unknown>>, sources:LocationSource[], excerpt:string){
 const accepted:Array<Record<string,unknown>>=[],proofs:LocationProof[]=[];
 const lineSources=excerpt.trim()?sources.filter(s=>normalize(s.text).includes(normalize(excerpt))):[];
 for(const fact of facts){
  if(typeof fact.key!=='string'||!isLocationKey(fact.key)){accepted.push(fact);continue;}
  const fieldExcerpt=typeof fact.sourceExcerpt==='string'?fact.sourceExcerpt:excerpt;
  const withinLine=!!excerpt.trim()&&normalize(excerpt).includes(normalize(fieldExcerpt));
  const assessed=await assessLocationClaim(client,{key:fact.key,value:fact.value,sourceExcerpt:fieldExcerpt},withinLine?lineSources:[]);
  const proof:LocationProof=withinLine?assessed:{...assessed,status:'rejected',reason:'outside_line_evidence'};
  proofs.push(proof);
  if(proof.status==='accepted')accepted.push({...fact,location_evidence:proof});
 }
 return {facts:accepted,proofs};
}

/** Read only, before a run/status change. Historical lines and canonical facts
 * pass the same type/role checks after the established lot merge. */
export async function pricingLocationPreflight(client:SupabaseClient,caseId:string,requestType:string,
 merge:(global:Record<string,unknown>[],lot:Record<string,unknown>[])=>Record<string,unknown>[],threadId?:string|null):Promise<string[]>{
 const lineRead=await client.from('quote_request_lines').select('*',{count:'exact'}).eq('case_id',caseId);
 if(lineRead.error||!Array.isArray(lineRead.data)||lineRead.count!==lineRead.data.length)throw new Error('Pricing route collection unavailable or incomplete');
 const lines=lineRead.data as Record<string,unknown>[];
 if(/AIR/.test(requestType)&&!(lines.length>=2&&lines.some(l=>/SEA/.test(String(l.request_type_hint || '')))))return [];
 const factRead=await client.from('quote_facts').select('*',{count:'exact'}).eq('case_id',caseId).eq('is_current',true)
  .in('fact_key',['routing.origin_port','routing.destination_port','routing.origin_airport','routing.destination_airport','routing.destination_city','routing.final_destination','cargo.containers']);
 if(factRead.error||!Array.isArray(factRead.data)||factRead.count!==factRead.data.length)throw new Error('Pricing route collection unavailable or incomplete');
 const globals=factRead.data as Record<string,unknown>[];
 const problems:string[]=[];
 async function sourcesFor(id:string,kind:LocationSource['kind']):Promise<LocationSource[]>{
  const table=kind==='email'?'emails':kind==='document'?'case_documents':'email_attachments';
  const {data,error}=await client.from(table).select('*').eq('id',id).maybeSingle();
  if(error||!data)throw new Error('Pricing route source unavailable');
  if(threadId!==undefined&&kind==='email'&&data.thread_ref!==threadId)throw new Error('Pricing route source belongs to another thread');
  if(kind==='email'&&(!data.from_address||/@sodatra\.(?:sn|com)$/i.test(String(data.from_address).trim())))throw new Error('Pricing route inbound source not proven');
  if(kind==='document'&&data.case_id!==caseId)throw new Error('Pricing route document belongs to another case');
  if(kind==='document'&&['quotation_draft','quotation_sent','internal_note','devis','proforma_sent'].includes(data.document_type))throw new Error('Pricing route internal document is not a client source');
  if(kind==='attachment'){
   const parent=await client.from('emails').select('thread_ref,from_address').eq('id',data.email_id).maybeSingle();
   if(parent.error||!parent.data||(threadId!==undefined&&parent.data.thread_ref!==threadId))throw new Error('Pricing route attachment belongs to another thread');
   if(!parent.data.from_address||/@sodatra\.(?:sn|com)$/i.test(String(parent.data.from_address).trim()))throw new Error('Pricing route inbound source not proven');
  }
  return [{id,kind,emailId:kind==='attachment'?data.email_id:null,text:kind==='email'?locationOwnText(String(data.body_text || '')):String(data.extracted_text || data.extracted_data?.text_content || ''),
   sourceHash:await sourceSha256(kind==='email'?String(data.body_text || ''):String(data.extracted_text || data.extracted_data?.text_content || ''))}];
 }
 const targets=lines.length>=2?lines:[null];
 for(const line of targets){
  const own=line&&Array.isArray(line.extracted_facts_json)?line.extracted_facts_json as Record<string,unknown>[]:[];
  const rawValidation=line&&line.meta_json&&typeof line.meta_json==='object'&&!Array.isArray(line.meta_json)?(line.meta_json as Record<string,unknown>).routing_validation:null;
  if(Array.isArray(rawValidation)&&rawValidation.some(p=>p?.status==='rejected'))problems.push('LOT_'+line!.line_index+':rejected_location_proposal');
  const effective=line?merge(globals,own):globals;
  for(const fact of effective){
   const key=String(fact.fact_key || '');
   if(key==='cargo.containers'){
    let value=fact.value_json??fact.value_text;
    if(typeof value==='string'){const text=value;try{value=JSON.parse(text);}catch{const parsed=inspectContainerText(text,true);value=parsed.issues.length?null:parsed.containers;}}
    const inventory=normalizeContainerInventory(value);
    if(inventory.status!=='valid')problems.push((line?'LOT_'+line.line_index+':':'')+key+':'+inventory.reason);
    continue;
   }
   if(!/_(port|airport)$/.test(key))continue;
   const override=own.find(f=>f.key===key);
   const saved=override?.location_evidence as LocationProof|undefined;
   const sources:LocationSource[]=[];
   if(saved?.sources?.length)for(const s of saved.sources){
    const loaded=await sourcesFor(s.id,s.kind);
    if(loaded[0].sourceHash!==s.sha256)throw new Error('Pricing route source changed');
    sources.push(...loaded);
   }
   else if(fact.source_attachment_id)sources.push(...await sourcesFor(String(fact.source_attachment_id),'attachment'));
   else if(fact.source_email_id)sources.push(...await sourcesFor(String(fact.source_email_id),'email'));
   if(override){
    const lineExcerpt=String(line?.source_excerpt || line?.segment_text || ''),fieldExcerpt=saved?.excerpt || String(override.sourceExcerpt || '');
    if(!lineExcerpt.trim()||!fieldExcerpt.trim()||!normalize(lineExcerpt).includes(normalize(fieldExcerpt))||!sources.some(s=>normalize(s.text).includes(normalize(lineExcerpt)))){
     problems.push('LOT_'+line!.line_index+':'+key+':outside_line_evidence');continue;
    }
   }
   const proof=await assessLocationClaim(client,{key,value:fact.value_text??fact.value_json,sourceExcerpt:saved?.excerpt || String(fact.source_excerpt || ''),
    sourceType:override?'ai_extraction':String(fact.source_type || ''),validated:!override&&fact.is_validated===true},sources);
   if(proof.status!=='accepted')problems.push((line?'LOT_'+line.line_index+':':'')+key+':'+proof.reason);
  }
 }
 return [...new Set(problems)];
}
