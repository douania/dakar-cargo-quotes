// Synthetic local provenance fixtures only. No real mail/contact or Cloud call.
import {assert,assertEquals} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {createClient} from 'jsr:@supabase/supabase-js@2';
import {assessLocationClaim,bindAcceptedLocationProof,validateLineLocations,type LocationSource} from './request-location-evidence.ts';
function fixture(type='air',ambiguous=false){
 const calls:string[]=[];
 const row={id:'airport-fixture',canonical_name:'Fixture airport',location_type:type,is_active:true,country_code:'KE',country_name:'Kenya'};
 const client=createClient('https://airport-evidence.fixture.invalid','synthetic-key',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
  const req=new Request(input,init);assertEquals(new URL(req.url).hostname,'airport-evidence.fixture.invalid');assertEquals(req.method,'GET');calls.push(req.url);
  const rows=[{locations_reference:row},...(ambiguous?[{locations_reference:{...row,id:'other'}}]:[])];return Response.json(rows);
 }}});
 return {client,calls};
}
const source=(text:string):LocationSource=>({id:'fixture-mail',kind:'email',text});
const claim=(excerpt:string,key='routing.destination_airport')=>({key,value:'NBO',sourceExcerpt:excerpt,sourceEmailId:'fixture-mail'});
for(const line of ['Ship to: NBO airport (Kenya)','   - Ship to: NBO airport'])Deno.test('airport evidence: explicit shipping label is retained: '+line.trim(),async()=>{
 const {client}=fixture(),sources=[source('Synthetic freight request\n'+line+'\nOne package.')];
 const p=await assessLocationClaim(client,claim(line.trim()),sources);
 assertEquals(p.status,'accepted');assertEquals(p.role,'arrival_airport');assertEquals(p.reason,'explicit_transport_role');
 const bound=await bindAcceptedLocationProof(claim(line.trim()),p,sources);assertEquals(bound.length,1);assertEquals(bound[0].sourceEmailId,'fixture-mail');assertEquals(bound[0].sourceExcerpt,line.trim().replace(/^[-•]\s*/,''));
});
Deno.test('airport evidence: shipping shorthand does not manufacture city or departure role',async()=>{
 const {client}=fixture(),text='Ship to: NBO airport';
 for(const key of ['routing.destination_city','routing.final_destination','routing.origin_airport'])assertEquals((await assessLocationClaim(client,claim(text,key),[source(text)])).status,'rejected');
});
Deno.test('airport evidence: alternatives, questions, uncertain labels and nonairport deliveries stay unproven',async()=>{
 const {client}=fixture();
 for(const text of ['Ship to: NBO airport or ADD airport','Ship to: NBO airport?','Ship to: NBO airport if possible','Ship to: NBO airport maybe','Ship to: NBO warehouse','Ship to: NBO city','Could we ship to: NBO airport?','Ship to NBO airport','Ship to: NBO airport / ADD airport','Ship to: NBO airport, not confirmed','Ship to: NBO airport, no confirmation']) {
  assertEquals((await assessLocationClaim(client,claim(text),[source(text)])).status,'rejected',text);
 }
});
Deno.test('airport evidence: foreign/quoted line or conflicting declarations cannot bind a destination',async()=>{
 const {client}=fixture(),line='Ship to: NBO airport';
 for(const text of ['No destination provided','> '+line,'Ship to: ADD airport\n'+line]) {
  const p=await assessLocationClaim(client,claim(line),[source(text)]);
  assertEquals(p.status,'rejected',text);
 }
 const p=await assessLocationClaim(client,{...claim(line),sourceEmailId:'other-mail'},[source(line)]);assertEquals(p.status,'rejected');
});
Deno.test('airport evidence: reference type, ambiguity and protected operator choice remain enforced',async()=>{
 const text='Ship to: NBO airport';
 for(const f of [fixture('sea'),fixture('air',true)])assertEquals((await assessLocationClaim(f.client,claim(text),[source(text)])).status,'rejected');
 const {client}=fixture();assertEquals((await assessLocationClaim(client,{...claim(text),sourceType:'manual_input'},[])).reason,'operator_decision');
});

Deno.test('airport evidence: delayed reservation and conflicting arrival cannot be hidden by a short excerpt',async()=>{
 const {client}=fixture(),line='Ship to: NBO airport';
 for(const text of ['Arrival airport: ADD\n'+line,'Destination airport: ADD\n'+line,
  line+' (to be confirmed)',line+'; not confirmed',line+'\nor ADD airport',line+'\nsubject to availability',line+'; TBC']) {
  assertEquals((await assessLocationClaim(client,claim(line),[source(text)])).status,'rejected',text);
 }
});
Deno.test('airport evidence: unrelated later field does not reserve an explicit arrival; agreeing arrival stays usable',async()=>{
 const {client}=fixture(),line='Ship to: NBO airport';
 for(const text of [line+'\nTemperature option: -5 C preferred if possible','Arrival airport: NBO\n'+line,line+'; Pieces: 1; Temperature option: -5 C if possible']) {
  assertEquals((await assessLocationClaim(client,claim(line),[source(text)])).status,'accepted',text);
 }
});

Deno.test('airport evidence: a short lot excerpt cannot hide reservations in the actual source field',async()=>{
 const {client}=fixture(),line='Ship to: NBO airport';
 for(const suffix of ['; not confirmed','\nor ADD airport']){
  const result=await validateLineLocations(client,[{key:'routing.destination_airport',value:'NBO',sourceExcerpt:line}],[source(line+suffix)],line);
  assertEquals(result.facts,[]);assertEquals(result.proofs[0].status,'rejected');
 }
});
