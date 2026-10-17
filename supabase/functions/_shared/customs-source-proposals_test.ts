import { assert, assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { assertDocumentarySources, documentaryCustomsProposals, customsSourceGroups } from './customs-source-proposals.ts';
import { customsBasisSnapshot, assessCustomsDecision } from './customs-basis.ts';
import { documentCargoEvidence } from './cargo-source-evidence.ts';
import { syntheticCustoms, syntheticId } from '../_tests/customs-basis-fixture.ts';

const invoice = (reference='SYNTHETIC-LOT-A', amount=321) => ({doc_type:'commercial_invoice',page_range:'2',extracted_info:{document_type:'NON-COMMERCIAL INVOICE',invoice_number:reference,document_date:'2026-10-07',payment_terms:'FOC',hs_code:'3004.9099',total_amount:amount,total_currency:'EUR'}});
const attachment = (n=1, document=invoice()) => ({id:syntheticId(n),filename:`SYNTHETIC-${n}.pdf`,email_id:syntheticId(n+100),email_sent_at:'2026-10-08T12:24:54Z',email_received_at:'2026-10-09T11:50:54Z',created_at:'2026-10-09T11:50:55Z',email_subject:`SYNTHETIC envoi ${n}`,email_body_text:`Please quote shipment ${n}.\nFrom: historical@example.invalid\nOLD LOT 999 EUR HS 999999`,extracted_data:{type:'invoice',documents:[document]}});

Deno.test('Customs sources: real-case-shaped twelve attachments yield only PL/invoice; image invoices remain documentary evidence',()=>{
  const packing={...attachment(2),filename:'SYNTHETIC-PL.pdf',extracted_data:{type:'document',documents:[{doc_type:'packing_list',page_range:'1-2',extracted_info:{invoice_no:'SYNTHETIC-LOT-A',document_date:'2026-10-07',hs_code:'3004.9099',total_cartons:30,total_gross_weight_kg:190}}]}};
  const images=Array.from({length:10},(_,i)=>({...attachment(i+3),extracted_data:i===0?{type:'logo',extracted_info:{hs_code:'999999',total_amount:999}}:i<5?{type:'skipped'}:{}}));
  const context={attachments:[attachment(),packing,...images]},before=JSON.stringify(context),proposals=documentaryCustomsProposals(context);
  assertEquals(proposals.map(p=>p.attachment_id),[syntheticId(1),syntheticId(2)]);assertEquals(JSON.stringify(context),before);
  const scanned={...attachment(),filename:'SYNTHETIC-scan.png'};assertEquals(documentaryCustomsProposals({attachments:[scanned]}).length,1);
  assertDocumentarySources([syntheticId(1),syntheticId(2)],context);
  assertEquals(customsSourceGroups(proposals),[{reference:'SYNTHETIC-LOT-A',attachment_ids:[syntheticId(1),syntheticId(2)],hs_declared:'30049099',recommended:true}]);
  assert(proposals[0].reasons.some(s=>s.includes('distincte de la valeur douanière')));assert(proposals[1].reasons.some(s=>s.includes('Poids')));
  assertThrows(()=>assertDocumentarySources([syntheticId(3)],context));
});

Deno.test('Customs sources: own email date/ID/context retained; quoted amounts never become documentary data',()=>{
  const source=attachment(),p=documentaryCustomsProposals({attachments:[source]})[0];
  assertEquals(p.email_id,source.email_id);assertEquals(p.email_sent_at,source.email_sent_at);assertEquals(p.email_received_at,source.email_received_at);
  assertEquals(p.email_excerpt,'Please quote shipment 1.');assertEquals(p.documents[0].document_date,'2026-10-07');
  assertEquals(p.documents[0].reference,'SYNTHETIC-LOT-A');assertEquals(p.documents[0].page_range,'2');assertEquals(p.documents[0].money[0].amount,321);
  const quotedOnly={...source,extracted_data:{},email_body_text:'> OLD LOT 999 EUR HS 999999'};
  assertEquals(documentaryCustomsProposals({attachments:[quotedOnly]}),[]);
});

Deno.test('Customs sources: coherent composite keeps packing/FOC evidence separate and never duplicates flattened totals',()=>{
  const packing={doc_type:'packing_list',page_range:'1',extracted_info:{invoice_no:'SYNTHETIC-LOT-A',hs_code:'3004.9099',total_cartons:30}};
  const source={...attachment(),extracted_data:{type:'document',extracted_info:{...invoice().extracted_info},documents:[packing,invoice()]}};
  const p=documentaryCustomsProposals({attachments:[source]})[0];assert(p.can_select);assertEquals(p.documents.length,2);
  assertEquals(p.documents.map(d=>d.document_index),[0,1]);assertEquals(p.documents[0].money,[]);assertEquals(p.documents[0].nonCommercial,false);
  assert(p.documents[1].nonCommercial);assertEquals(p.money,[]);assertEquals(p.hsDeclared,'3004.9099');
  assert(!JSON.stringify(p).includes('777'));assertDocumentarySources([source.id],{attachments:[source]});
});

Deno.test('Customs sources: a conflicting flattened extraction is visible and cannot silently override or certify a sub-document',()=>{
  const source={...attachment(),extracted_data:{extracted_info:{hs_code:'999999',total_amount:777,total_currency:'USD'},documents:[invoice()]}};
  const p=documentaryCustomsProposals({attachments:[source]})[0];assert(!p.can_select);assertEquals(p.documents[0].hsDeclared,'3004.9099');
  assertEquals(p.documents[0].money[0].amount,321);assert(p.issues.some(s=>s.includes('999999')));assert(p.issues.some(s=>s.includes('777 USD')));
  assertThrows(()=>assertDocumentarySources([source.id],{attachments:[source]}));
});

Deno.test('Customs sources: composite other lots, unknown association and conflicting extractions are not adoptable',()=>{
  for(const documents of [[invoice(),invoice('SYNTHETIC-LOT-B',999)],[{doc_type:'packing_list',extracted_info:{total_cartons:30}},invoice()]]){
    const source={...attachment(),extracted_data:{documents}},p=documentaryCustomsProposals({attachments:[source]})[0];
    assert(!p.can_select);assert(p.issues.length);assertThrows(()=>assertDocumentarySources([source.id],{attachments:[source]}));
  }
});

Deno.test('Customs sources: another email/lot cannot be adopted together; an unselected historical source does not block a coherent choice',()=>{
  const current=attachment(),old=attachment(2,invoice('SYNTHETIC-LOT-B',999));old.email_sent_at='2025-01-01T10:00:00Z';
  const context={attachments:[current,old]},proposals=documentaryCustomsProposals(context);
  assert(proposals.every(p=>p.can_select));assert(proposals.every(p=>p.issues.some(s=>s.includes('Références'))));
  assertThrows(()=>assertDocumentarySources([current.id,old.id],context));assertDocumentarySources([current.id],context);
  assertEquals(customsSourceGroups(proposals).map(g=>g.attachment_ids),[[current.id],[old.id]]); // Separate explicit choices, no first/newest wins.
  assertEquals(proposals[1].email_sent_at,'2025-01-01T10:00:00Z'); // No arbitrary age cutoff or newest-wins rule.
});

Deno.test('Customs sources: historical/cited labels are not selectable; dates/unknown currencies remain unknown',()=>{
  for(const content_class of ['quoted','historical','hypothesis']){
    const source={...attachment(),extracted_data:{content_class,documents:[{...invoice(),content_class:'current'}]}};
    assertThrows(()=>assertDocumentarySources([source.id],{attachments:[source]}));
    assertEquals(documentaryCustomsProposals({attachments:[source]})[0].documents[0].content_classes,[content_class,'current']);
  }
  for(const [raw,expected] of [['€','EUR'],['?', '?'],[null,null]] as const){
    const source={...attachment(),email_sent_at:null,extracted_data:{extracted_info:{total_amount:321,total_currency:raw}}};
    const p=documentaryCustomsProposals({attachments:[source]})[0];assertEquals(p.documents[0].money[0].currency,expected);assertEquals(p.documents[0].document_date,null);assertEquals(p.email_sent_at,null);
    if(raw!=='€')assert(p.documents[0].issues.some(s=>s.includes('Devise')));
  }
});

Deno.test('Customs sources: weight, dimensions, currency and arithmetic contradictions are explicit without choosing or summing documents',()=>{
  const first=invoice(),second=invoice();
  const a={...first,extracted_info:{...first.extracted_info,total_gross_weight_kg:190,total_cartons:30,line_items:[{no_of_cartons:30,dimensions_cm:'48x36x29'}]}};
  const b={...second,extracted_info:{...second.extracted_info,total_gross_weight_kg:200,total_currency:'USD',line_items:[{no_of_cartons:30,dimensions_cm:'44x27x24'}]}};
  const p=documentaryCustomsProposals({attachments:[{...attachment(),extracted_data:{documents:[a,b]}}]})[0];
  for(const token of ['poids','dimensions','devises'])assert(p.issues.some(s=>s.includes(token)));
  assert(p.can_select);assertEquals(p.documents.map(d=>d.money[0].amount),[321,321]);assertEquals(customsSourceGroups([p])[0].recommended,false);
  const raw={...invoice(),tariff_lines:[{service:'FOB',amount:10,currency:'EUR'},{service:'FREIGHT',amount:2,currency:'EUR'},{service:'INSURANCE',amount:1,currency:'EUR'}]};
  assert(documentaryCustomsProposals({attachments:[attachment(1,raw)]})[0].issues.some(s=>s.includes('FOB + fret')));
});

Deno.test('Customs sources: same-reference HS/money conflicts stay explicit and can be arbitrated by the existing retained decision, never by recommendation',()=>{
  const f=syntheticCustoms(),a=attachment(),b=attachment(2,{...invoice(),extracted_info:{...invoice().extracted_info,hs_code:'999999',total_amount:999}});
  f.context.proposal_schema_version=2;f.context.attachments=[a,b];f.decision.source_attachment_ids=[a.id,b.id];f.decision.note='SYNTHETIC explicit arbitration: retain documentary HS30049099, reject contradictory999999 and999EUR.';
  const p=documentaryCustomsProposals(f.context);assert(p.every(s=>s.issues.some(i=>i.includes('Classements HS'))));assertDocumentarySources([a.id,b.id],f.context);
  assertEquals(customsSourceGroups(p)[0].recommended,false);assertEquals(customsSourceGroups(p)[0].hs_declared,null);
  assert(assessCustomsDecision(f.decision,f.context).eligible);const proof=customsBasisSnapshot(f.record,f.context);
  assertEquals(proof.decision.note,f.decision.note);assertEquals(proof.sources.length,2);assertEquals(proof.decision.caf_xof,100000);assertEquals(proof.decision.hs_digits,'3004909000');
});

Deno.test('Customs sources: legacy proof remains identical, while version2 refuses calculation with ambiguous source provenance',()=>{
  const f=syntheticCustoms(),before=customsBasisSnapshot(f.record,f.context),a=f.context.attachments[0];
  assertEquals(before.sources,[{attachment_id:String(a.id),filename:String(a.filename),...documentCargoEvidence(a.extracted_data)}]);
  assertEquals(customsBasisSnapshot(f.record,structuredClone(f.context)),before);
  f.context.proposal_schema_version=2;f.context.attachments[0]={...attachment(),extracted_data:{documents:[invoice(),invoice('SYNTHETIC-LOT-B',999)]}};
  assertEquals(assessCustomsDecision(f.decision,f.context).eligible,false);
});
