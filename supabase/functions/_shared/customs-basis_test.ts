import { assert, assertEquals, assertThrows, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { assessCustomsDecision, customsProposals, validateCustomsDecision, customsBasisSnapshot, customsBasisText, applyCustomsPricingFacts, assertCustomsRequest, loadCustomsBasis, type CustomsContext } from './customs-basis.ts';
import { HS_TAX_FIELDS, HS_TAX_BASIS_VERSION } from './hs-tax-profile.ts';
import { projectClientQuote } from './client-quote-projection.ts';
import { composeCommercialSnapshot } from './commercial-snapshot.ts';
import { prepareCommercialQuote } from './commercial-preparation.ts';
import {syntheticId,syntheticCustoms} from '../_tests/customs-basis-fixture.ts';
Deno.test('Customs proposals preserve FOC and HS8 without monetary or national classification promotion',()=>{
  const {context}=syntheticCustoms(),before=JSON.stringify(context),p=customsProposals(context)[0];
  assert(p.nonCommercial);assertEquals(p.hsDeclared,'3004.9099');assertEquals(p.money[0].amount,321);assertEquals(JSON.stringify(context),before);
});
for(const [field,value] of [['caf_xof',null],['caf_xof',0],['caf_xof',-1],['caf_xof',Infinity],['caf_xof',1.234],['exemptions_reviewed',false],['regime_code',null],['source_attachment_ids',[]],['created_by','forged'],['note','']] as const){
 Deno.test(`Customs closed decision rejects ${field}=${value}`,()=>{const f=syntheticCustoms();assertThrows(()=>validateCustomsDecision({...f.decision,[field]:value}));});
}
Deno.test('Customs HS8 must be expressly estimated; complete verified candidates required',()=>{
 const {context,decision}=syntheticCustoms();decision.hs_digits='30049099';assert(assessCustomsDecision(decision,context).eligible);
 assertThrows(()=>validateCustomsDecision({...decision,commitment:'confirmed'}));context.profiles[1].dd=null;assert(!assessCustomsDecision(decision,context).eligible);
});
for(const key of ['tax_profile_status','tax_evidence','uemoa','bic'])Deno.test(`Customs national adoption cannot use unverified/unsupported ${key}`,()=>{
 const {context,decision}=syntheticCustoms();context.profiles[2][key]=key==='tax_profile_status'?'legacy':key==='tax_evidence'?{}:key==='bic'?true:5;
 assert(!assessCustomsDecision(decision,context).eligible);
});
Deno.test('Customs exemptions, source isolation and scope are not bypassed by operator attestation',()=>{
 const f=syntheticCustoms();f.context.facts=[{fact_key:'regulatory.exemption_title',value_text:'SYNTHETIC EXEMPTION'}];assert(!assessCustomsDecision(f.decision,f.context).eligible);
 f.context.facts=[];f.context.scope.lot_count=2;assert(!assessCustomsDecision(f.decision,f.context).eligible);f.context.scope.lot_count=0;
 assertThrows(()=>assessCustomsDecision({...f.decision,source_attachment_ids:[syntheticId(99)]},f.context));
});
Deno.test('Customs opted-in overlay never mutates canonical facts or lets direct engine parameters override its proof',()=>{
 const f=syntheticCustoms(),b=customsBasisSnapshot(f.record,f.context),facts=[{fact_key:'cargo.value',value_number:1}],before=JSON.stringify(facts);
 assertEquals(applyCustomsPricingFacts(facts,b).find(f=>f.fact_key==='cargo.value')?.value_number,100000);assertEquals(JSON.stringify(facts),before);
 const request={transportMode:'aerien',incoterm:'DDP',cargoValue:100000,cargoCurrency:'XOF',hsCode:'3004909000',regimeCode:'TEST'};
 assertCustomsRequest(b,request);
 for(const extra of [{cargoValue:1},{regimeCode:'OTHER'},{scenarioPricingMode:'DAP_SERVICES_ONLY'},{scenarioCargoContext:{}},{isTransit:true},{cargoCurrency:'EUR'}])assertThrows(()=>assertCustomsRequest(b,{...request,...extra}));
});
Deno.test('Customs SQL read failure and unknown fiscal profile fail closed at the calculation boundary',async()=>{
 const f=syntheticCustoms();await assertRejects(()=>loadCustomsBasis({rpc:()=>Promise.resolve({data:null,error:{message:'private DB detail'}})},syntheticId(4),syntheticId(3),syntheticId(2)));
 f.context.profiles[2].tax_profile_status='unknown';await assertRejects(()=>loadCustomsBasis({rpc:()=>Promise.resolve({data:{head:f.record,context:f.context},error:null})},syntheticId(4),syntheticId(3),syntheticId(2)));
});
Deno.test('Customs proof survives commercial revision and client projection, while internal notes and old snapshots stay private and unchanged',()=>{
 const f=syntheticCustoms(),basis=customsBasisSnapshot(f.record,f.context);
 const snapshot={customs_basis:basis,inputs:{incoterm:'DDP'},client:{},totals:{currency:'XOF',total_payable:100,subtotal_before_sodatra_vat:100,honoraires_ht:0,honoraires_tva:0},raw_lines:[{label:'Droits et taxes',category:'duties',bloc:'debours',amount:100,currency:'XOF',source:{type:'CALCULATED'}}]};
 const before=JSON.stringify(snapshot),draft=prepareCommercialQuote(syntheticId(3),syntheticId(5),snapshot),next=composeCommercialSnapshot(draft,syntheticId(6));
 assertEquals(next.customs_basis,basis);assertEquals(JSON.stringify(snapshot),before);
 const prose=JSON.stringify(projectClientQuote(next));assert(prose.includes('CAF'));assert(!prose.includes('PRIVATE-SUPPLIER-COST-777'));assert(!prose.includes('real conversion'));
 assert(customsBasisText(basis).some(s=>s.includes('fret et assurance compris')));
});
