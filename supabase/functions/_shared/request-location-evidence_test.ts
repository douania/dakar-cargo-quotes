import {assert,assertEquals,assertRejects} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {createClient} from 'jsr:@supabase/supabase-js@2';
import {assessLocationClaim,validateLineLocations,pricingLocationPreflight,replaceRequestLinesWithEvidence,type LocationSource} from './request-location-evidence.ts';
Deno.env.set('RUN_PRICING_DISABLE_SERVE','1');
const {mergeFactsForLot}=await import('../run-pricing/index.ts');
type Row=Record<string,unknown>;
Deno.test('line history: clear and replacement retain exact previous rows and rejected proposals before RPC',async()=>{
 for(const mode of ['ai_no_lines','ai_extraction']){
  const calls:string[]=[],old={id:'old',extracted_facts_json:[{key:'routing.destination_port',value:'inland city'}]},proposed=[{raw:'rejected'}];let saved:Record<string,unknown>={};
  const client=createClient('https://line-history.fixture.invalid','synthetic-service',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
   const r=new Request(input,init),name=new URL(r.url).pathname.split('/').pop()!;calls.push(r.method+' '+name);
   if(r.method==='GET')return Response.json([old],{headers:{'Content-Range':'0-0/1'}});
   const body=await r.json();if(name==='case_timeline_events'){saved=body.event_data;return new Response(null,{status:201});}
   assertEquals(saved.previous_lines,[old]);assertEquals(saved.proposed_lines,proposed);assertEquals(body.p_lines,mode==='ai_no_lines'?[]:proposed);return Response.json(0);
  }}});
  assertEquals((await replaceRequestLinesWithEvidence(client,{caseId:'case',actorId:'actor',lines:mode==='ai_no_lines'?[]:proposed,proposedLines:proposed,mode})).error,null);
  assertEquals(calls,['GET quote_request_lines','POST case_timeline_events','POST replace_quote_request_lines']);
 }
});
Deno.test('line history: failed read or append prevents every replacement RPC',async()=>{
 for(const failure of ['read','append']){
  const calls:string[]=[];
  const client=createClient('https://line-history.fixture.invalid','synthetic-service',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
   const r=new Request(input,init),name=new URL(r.url).pathname.split('/').pop()!;calls.push(name);
   return r.method==='GET'&&failure==='append'?Response.json([],{headers:{'Content-Range':'*/0'}}):Response.json({message:'synthetic failure'},{status:400});
  }}});
  await assertRejects(()=>replaceRequestLinesWithEvidence(client,{caseId:'case',actorId:'actor',lines:[],proposedLines:[],mode:'ai_no_lines'}),Error,failure==='read'?'Previous line':'could not be retained');
  assert(!calls.includes('replace_quote_request_lines'));
 }
});
Deno.test('line history: null or truncated source inventory prevents archive and clearing',async()=>{
 for(const data of [null,[{id:'only-returned'}]]){
  const calls:string[]=[];
  const client=createClient('https://line-history.fixture.invalid','synthetic-service',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
   const r=new Request(input,init);calls.push(r.method);return Response.json(data,{headers:{'Content-Range':'0-0/2'}});
  }}});
  await assertRejects(()=>replaceRequestLinesWithEvidence(client,{caseId:'case',actorId:'actor',lines:[],proposedLines:[],mode:'ai_no_lines'}),Error,'incomplete');assertEquals(calls,['GET']);
 }
});
function db(tables:Record<string,Row[]>={},failure?:string,incomplete=false){
 const calls:string[]=[];
 const client=createClient('https://location.fixture.invalid','synthetic-service',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
  const req=new Request(input,init),u=new URL(req.url),table=u.pathname.split('/').pop()!;calls.push(req.method+' '+table);
  assertEquals(req.method,'GET','No mutation/provider call in location validation');
  if(table===failure)return Response.json({message:'synthetic read failure'},{status:400});
  let rows=table==='location_aliases'?(tables.location_aliases??[{normalized_alias:'MOMBASA',locations_reference:{id:'sea-ke',canonical_name:'Mombasa',location_type:'sea',is_active:true}},
   {normalized_alias:'SINGAPORE',locations_reference:{id:'sea-sg',canonical_name:'Singapore',location_type:'sea',is_active:true}},
   {normalized_alias:'GOMA',locations_reference:{id:'inland-cd',canonical_name:'Goma',location_type:'inland',is_active:true}},
   {normalized_alias:'AIRFIELD',locations_reference:{id:'air-a',canonical_name:'Airfield',location_type:'air',is_active:true}},
   {normalized_alias:'NAIROBI',locations_reference:{id:'city-ke',canonical_name:'Nairobi',location_type:'inland',country_code:'KE',country_name:'Kenya',is_active:true}},
   {normalized_alias:'NBO',locations_reference:{id:'air-ke',canonical_name:'Nairobi airport',location_type:'air',country_code:'KE',country_name:'Kenya',is_active:true}}]):(tables[table] || []);
  for(const [key,filter] of u.searchParams){
   if(filter.startsWith('eq.')&&!key.includes('.'))rows=rows.filter(r=>String(r[key])===filter.slice(3));
   if(filter.startsWith('in.')){const values=filter.slice(4,-1).split(',');rows=rows.filter(r=>values.includes(String(r[key])));}
  }
  const single=req.headers.get('Accept')?.includes('vnd.pgrst.object');
  return new Response(JSON.stringify(single?rows[0]??null:rows),{headers:{'Content-Type':'application/json','Content-Range':'0-'+Math.max(0,rows.length-1)+'/'+(incomplete?rows.length+1:rows.length)}});
 }}});
 return {client,calls};
}
const source=(text:string,kind:LocationSource['kind']='email'):LocationSource=>({id:kind+'-1',kind,text});
Deno.test('location: inland and road transit cannot become sea destination port',async()=>{
 const {client}=db();for(const value of ['Goma','Goma via Rwanda']){
  const p=await assessLocationClaim(client,{key:'routing.destination_port',value,sourceExcerpt:'Place of delivery: '+value},[source('Place of delivery: '+value)]);
  assertEquals(p.status,'rejected');
 }
});
Deno.test('location: verified sea transshipment and bare gateway are not POD',async()=>{
 const {client}=db();for(const excerpt of ['Place of delivery: Kigali via Singapore','Transshipment: Singapore','Port of discharge: Singapore transshipment','POD: Singapore or Mombasa','POD: Singapore is NOT the port of discharge','Not POD: Singapore','POD: Singapore / Mombasa']){
  const p=await assessLocationClaim(client,{key:'routing.destination_port',value:'Singapore',sourceExcerpt:excerpt},[source(excerpt)]);
  assertEquals(p.status,'rejected');
 }
 assertEquals((await assessLocationClaim(client,{key:'routing.destination_port',value:'Singapore',sourceExcerpt:'POD: Singapore'},[source('Not POD: Singapore')])).status,'rejected');
});
Deno.test('location: explicit sea POD/POL and final city have distinct roles',async()=>{
 const {client}=db();
 for(const [key,value,excerpt,role] of [['routing.destination_port','Mombasa','Port of discharge: Mombasa','port_of_discharge'],
  ['routing.origin_port','Singapore','POL: Singapore','port_of_loading'],['routing.final_destination','Goma','Place of delivery: Goma via Rwanda','final_delivery_city']]){
  const p=await assessLocationClaim(client,{key,value,sourceExcerpt:excerpt},[source(excerpt)]);
  assertEquals(p.status,'accepted');assertEquals(p.role,role);
 }
});
Deno.test('location: sea alias on an airport field, unknown alias and unbound excerpt are refused',async()=>{
 const {client}=db();
 for(const [key,value,excerpt,actual] of [['routing.destination_airport','Mombasa','Arrival airport: Mombasa','Arrival airport: Mombasa'],
  ['routing.destination_port','Unknown','POD: Unknown','POD: Unknown'],['routing.destination_port','Mombasa','POD: Mombasa','Reminder only']]){
  assertEquals((await assessLocationClaim(client,{key,value,sourceExcerpt:excerpt},[source(actual)])).status,'rejected');
 }
});
Deno.test('location: correct field excerpt cannot borrow another lot discharge clause',async()=>{
 const {client}=db(),s=source('Lot1: delivery Goma\nPOD: Mombasa');
 const p=await assessLocationClaim(client,{key:'routing.destination_port',value:'Mombasa',sourceExcerpt:'Lot1: delivery Goma'},[s]);
 assertEquals(p.status,'rejected');
});
Deno.test('location: attachment claim stays attached; raw rejected proposal remains evidence',async()=>{
 const {client}=db(),text='Place of delivery: Goma via Rwanda';
 const r=await validateLineLocations(client,[{key:'routing.destination_port',value:'Goma via Rwanda'},{key:'routing.final_destination',value:'Goma'}],[source(text,'attachment'),source('Reminder')],text);
 assertEquals(r.facts.map(f=>f.key),['routing.final_destination']);
 assertEquals(r.proofs[0].rawValue,'Goma via Rwanda');assertEquals(r.proofs[0].sources[0].kind,'attachment');
});
Deno.test('location: exact foreign lot excerpt cannot supply this line port',async()=>{
 const {client}=db(),own='Lot1: delivery Goma via Rwanda',foreign='Lot2\nPOD: Mombasa';
 const result=await validateLineLocations(client,[{key:'routing.destination_port',value:'Mombasa',sourceExcerpt:'POD: Mombasa'}],[source(own),{id:'email-2',kind:'email',text:foreign}],own);
 assertEquals(result.facts,[]);assertEquals(result.proofs[0].reason,'outside_line_evidence');assertEquals(result.proofs[0].rawValue,'Mombasa');
});
Deno.test('location: explicit operator role still requires correct place type',async()=>{
 const {client}=db();
 assertEquals((await assessLocationClaim(client,{key:'routing.destination_port',value:'Mombasa',sourceType:'manual_input'},[])).status,'accepted');
 assertEquals((await assessLocationClaim(client,{key:'routing.destination_port',value:'Goma',validated:true},[])).status,'rejected');
});
Deno.test('location: attachment and parent email identifiers must agree',async()=>{
 const {client}=db(),text='POD: Mombasa',attachment={...source(text,'attachment'),emailId:'parent'};
 const claim={key:'routing.destination_port',value:'Mombasa',sourceExcerpt:text,sourceAttachmentId:'attachment-1',sourceEmailId:'parent'};
 assertEquals((await assessLocationClaim(client,claim,[attachment])).status,'accepted');
 assertEquals((await assessLocationClaim(client,{...claim,sourceEmailId:'other'},[attachment])).status,'rejected');
});
Deno.test('pricing route: global AIR or UNKNOWN cannot hide maritime lot values',async()=>{
 for(const type of ['AIR_IMPORT','UNKNOWN']){
  const {client}=db({quote_facts:[],quote_request_lines:[{case_id:'case',line_index:1,request_type_hint:'SEA_FCL_IMPORT',extracted_facts_json:[{key:'routing.destination_port',value:'Goma via Rwanda',valueType:'text'}]},
   {case_id:'case',line_index:2,request_type_hint:'SEA_FCL_IMPORT',extracted_facts_json:[]}]});
  assert((await pricingLocationPreflight(client,'case',type,mergeFactsForLot)).some(x=>x.startsWith('LOT_1:')));
 }
});
Deno.test('pricing route: foreign thread, outbound attachment and internal document are refused',async()=>{
 const fact={case_id:'case',fact_key:'routing.destination_port',is_current:true,value_text:'Mombasa',source_type:'email_body',source_excerpt:'POD: Mombasa'};
 const cases:Array<Record<string,Row[]>>=[
  {quote_facts:[{...fact,source_email_id:'email-1'}],emails:[{id:'email-1',thread_ref:'other',from_address:'client@fixture.invalid',body_text:'POD: Mombasa'}]},
  {quote_facts:[{...fact,source_attachment_id:'attachment-1'}],email_attachments:[{id:'attachment-1',email_id:'email-1',extracted_text:'POD: Mombasa'}],emails:[{id:'email-1',thread_ref:'thread',from_address:'ops@sodatra.sn'}]},
 ];
 for(const tables of cases)await assertRejects(()=>pricingLocationPreflight(db({...tables,quote_request_lines:[]}).client,'case','SEA_FCL_IMPORT',mergeFactsForLot,'thread'),Error,'Pricing route');
 const {sourceSha256}=await import('./email-fact-revisions.ts'),text='POD: Mombasa';
 const {client}=db({quote_facts:[],case_documents:[{id:'doc',case_id:'case',document_type:'quotation_draft',extracted_text:text}],quote_request_lines:[
  {case_id:'case',line_index:1,extracted_facts_json:[{key:'routing.destination_port',value:'Mombasa',valueType:'text',location_evidence:{excerpt:text,sources:[{id:'doc',kind:'document',sha256:await sourceSha256(text)}]}}]},
  {case_id:'case',line_index:2,extracted_facts_json:[]}]});
 await assertRejects(()=>pricingLocationPreflight(client,'case','SEA_FCL_IMPORT',mergeFactsForLot,'thread'),Error,'internal document');
});
Deno.test('location: reference errors are observable, not an empty successful result',async()=>{
 const {client}=db({},'location_aliases');
 await assertRejects(()=>assessLocationClaim(client,{key:'routing.destination_port',value:'Mombasa',sourceType:'operator'},[]),Error,'reference unavailable');
});
Deno.test('pricing route: historical bare via canonical port cannot bypass semantic guard',async()=>{
 const {client,calls}=db({quote_facts:[{case_id:'case',fact_key:'routing.destination_port',is_current:true,value_text:'Mombasa',source_type:'email_body',source_email_id:'email-1',source_excerpt:'Place of delivery: Goma via Mombasa'}],
  emails:[{id:'email-1',from_address:'client@fixture.invalid',body_text:'Place of delivery: Goma via Mombasa'}],quote_request_lines:[]});
 assert((await pricingLocationPreflight(client,'case','SEA_FCL_IMPORT',mergeFactsForLot)).some(x=>x.includes('transport_role_not_proven')));
 assert(calls.every(x=>x.startsWith('GET')));
});
Deno.test('pricing route: per-lot bad stored value must not borrow valid canonical Mombasa',async()=>{
 const {client}=db({quote_facts:[{case_id:'case',fact_key:'routing.destination_port',is_current:true,value_text:'Mombasa',source_type:'manual_input'}],
 quote_request_lines:[{case_id:'case',line_index:1,extracted_facts_json:[{key:'routing.destination_port',value:'Goma via Rwanda',valueType:'text'}]},
  {case_id:'case',line_index:2,extracted_facts_json:[]}]});
 assert((await pricingLocationPreflight(client,'case','SEA_FCL_IMPORT',mergeFactsForLot)).some(x=>x.startsWith('LOT_1:')));
});
Deno.test('pricing route: legitimate manual canonical sea port passes, incomplete reads fail',async()=>{
 const tables={quote_facts:[{case_id:'case',fact_key:'routing.destination_port',is_current:true,value_text:'Mombasa',source_type:'manual_input'}],quote_request_lines:[]};
 assertEquals(await pricingLocationPreflight(db(tables).client,'case','SEA_FCL_IMPORT',mergeFactsForLot),[]);
 await assertRejects(()=>pricingLocationPreflight(db(tables,undefined,true).client,'case','SEA_FCL_IMPORT',mergeFactsForLot),Error,'collection unavailable');
 await assertRejects(()=>pricingLocationPreflight(db(tables,'quote_request_lines').client,'case','SEA_FCL_IMPORT',mergeFactsForLot),Error,'collection unavailable');
});


Deno.test('location: delivery address retains raw source and accepts the terminal explicit city despite legacy UTF8 bytes',async()=>{
 const {client,calls}=db();
 const excerpt='DELIVERY ADRESS:\n14 Test Road - BP Nairobi – Kenya / 00100';
 const raw=Array.from(new TextEncoder().encode(excerpt),b=>String.fromCharCode(b)).join('');
 const p=await assessLocationClaim(client,{key:'routing.destination_city',value:'Nairobi',sourceExcerpt:excerpt,sourceEmailId:'email-1'},[source(raw)]);
 assertEquals(p.status,'accepted');assertEquals(p.role,'final_delivery_city');
 assertEquals(p.excerpt,raw);assertEquals(p.sources.map(s=>s.id),['email-1']);
 const {sourceSha256}=await import('./email-fact-revisions.ts');assertEquals(p.sources[0].sha256,await sourceSha256(raw));
 assert(calls.every(c=>c.startsWith('GET')));
});
Deno.test('location: delivery address city is not a street mention, signature, other source, or unproven country',async()=>{
 const {client}=db();
 for(const [excerpt,actual] of [
  ['DELIVERY ADDRESS:\n14 rue de Nairobi - Kenya','DELIVERY ADDRESS:\n14 rue de Nairobi - Kenya'],
  ['DELIVERY ADDRESS:\n14 Avenue Nairobi - Kenya','DELIVERY ADDRESS:\n14 Avenue Nairobi - Kenya'],
  ['DELIVERY ADDRESS:\n14 Nairobi Street - Mombasa – Kenya / 00100','DELIVERY ADDRESS:\n14 Nairobi Street - Mombasa – Kenya / 00100'],
  ['DELIVERY ADDRESS:\n14 Test Road - BP Nairobi – Rwanda / 00100','DELIVERY ADDRESS:\n14 Test Road - BP Nairobi – Rwanda / 00100'],
  ['Nairobi','Signature: Nairobi'],
  ['DELIVERY ADDRESS:\nBP Nairobi – Kenya','BILLING ADDRESS:\nBP Nairobi – Kenya'],
  ['DELIVERY ADDRESS:\nBP Nairobi or Mombasa – Kenya','DELIVERY ADDRESS:\nBP Nairobi or Mombasa – Kenya'],
  ['DELIVERY ADDRESS:\nNairobi – Kenya\nPICKUP ADDRESS:\nNairobi – Kenya','DELIVERY ADDRESS:\nNairobi – Kenya\nPICKUP ADDRESS:\nNairobi – Kenya'],
 ]){
  const p=await assessLocationClaim(client,{key:'routing.destination_city',value:'Nairobi',sourceExcerpt:excerpt,sourceEmailId:'email-1'},[source(actual)]);
  assertEquals(p.status,'rejected',excerpt);
 }
 const text='DELIVERY ADDRESS:\nBP Nairobi – Kenya';
 assertEquals((await assessLocationClaim(client,{key:'routing.destination_city',value:'Nairobi',sourceExcerpt:text,sourceEmailId:'other'},[source(text)])).status,'rejected');
});
Deno.test('location: clean address and explicit Airport of destination are distinct supported roles',async()=>{
 const {client}=db();
 for(const [key,value,excerpt,role] of [
  ['routing.final_destination','Nairobi','Delivery address:\nBP Nairobi - Kenya / 00100','final_delivery_city'],
  ['routing.destination_airport','NBO','Airport of destination: NBO','arrival_airport'],
 ]){
  const p=await assessLocationClaim(client,{key,value,sourceExcerpt:excerpt},[source(excerpt)]);
  assertEquals(p.status,'accepted');assertEquals(p.role,role);
 }
});
Deno.test('location: bare AOD remains a sourced airport proposal with an explicit role reservation',async()=>{
 const {client}=db(),text='AOD:\nNBO';
 const p=await assessLocationClaim(client,{key:'routing.destination_airport',value:'NBO',sourceExcerpt:text},[source(text)]);
 assertEquals(p.status,'rejected');assertEquals(p.reason,'ambiguous_airport_role');
 assertEquals(p.rawValue,'NBO');assertEquals(p.locationType,'air');assertEquals(p.sources[0].id,'email-1');
 assertEquals((await assessLocationClaim(client,{key:'routing.origin_airport',value:'NBO',sourceExcerpt:text},[source(text)])).status,'rejected');
});

Deno.test('location: truncated or partly unknown address reference cannot establish a final city',async()=>{
 const text='Delivery address:\nBP Nairobi - Kenya / 00100';
 const claim={key:'routing.destination_city',value:'Nairobi',sourceExcerpt:text};
 await assertRejects(()=>assessLocationClaim(db({},undefined,true).client,claim,[source(text)]),Error,'reference incomplete');
 await assertRejects(()=>assessLocationClaim(db({},'location_aliases').client,claim,[source(text)]),Error,'reference unavailable');
 const known={normalized_alias:'NAIROBI',locations_reference:{id:'known',is_active:true,country_code:'KE',country_name:'Kenya'}};
 for(const unknown of [null,{id:'unknown',is_active:true,country_code:null,country_name:null}]){
  const {client}=db({location_aliases:[known,{normalized_alias:'NAIROBI',locations_reference:unknown}]});
  assertEquals((await assessLocationClaim(client,claim,[source(text)])).status,'rejected');
 }
});
