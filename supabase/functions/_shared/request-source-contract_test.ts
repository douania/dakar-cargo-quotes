import {assert,assertEquals,assertRejects} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {assessRequestSourceContract,explicitSeaGatewayClauses,seaGatewayAliasCandidates,syncRequestSourceContract,
 type ContractEvidence,type ContractGap,type ContractSource,type ContractStore} from './request-source-contract.ts';
const mail:ContractSource={id:'email-original',kind:'email',sentAt:'2026-10-16T05:00:00Z',text:"No. of containers: 1 x 40’HC'\nPlace of delivery: Bunia, DR Congo via Mombasa Kenya\nIncluded\nLoading/lashing of the container\nExcluded\nExport customs clearance\nImport customs clearance\nSubmission deadline: Monday 19h October, 12:00 AM UAE time"};
const pdf:ContractSource={id:'rfq',kind:'attachment',name:'RFQ-LOCAL.pdf',text:"1 Request for quotation\nBid Submission Deadline: 19 . 10 .2026 1 2 :00 U.A.E time\nIncoterms: DAP\nPlace of delivery: Bunia, DR Congo via Uganda\nI NCLUDED in the Offer\nAll local charges at origin\nE xport customs clearance\nEXCLUDED\nImport customs clearance\n\n3 SUBMISSION OF OFFER\nDeadline for submission: All offers must be submitted by Monday 19 th October 2026 1 0 :00 hrs U.A.E time."};
function memory(previous:ContractEvidence|null=null,gaps:ContractGap[]=[]){
 const evidence:ContractEvidence[]=[],writes:string[]=[];
 const store:ContractStore={readPrevious:()=>Promise.resolve(previous),readGaps:()=>Promise.resolve(gaps),
  ensureGap(c,g){writes.push(c.key);if(!g)gaps.push({id:c.key,gap_key:c.key,status:'open',is_blocking:true});return Promise.resolve();},
  appendEvidence(e){evidence.push(e);previous=e;return Promise.resolve();}};
 return{store,evidence,writes,gaps};
}
Deno.test('contract: export customs disagreement and all three deadline alternatives remain explicit',async()=>{
 const e=await assessRequestSourceContract([mail,pdf]);
 assertEquals(e.conflicts.map(c=>c.key),['source_contract.export_customs','source_contract.rfq_deadline']);
 assertEquals([...new Set(e.assertions.filter(a=>a.key==='export_customs').map(a=>a.value))].sort(),['excluded','included']);
 assertEquals([...new Set(e.assertions.filter(a=>a.key==='rfq_deadline').map(a=>a.value))].sort(),['2026-10-19 00:00 UAE','2026-10-19 10:00 UAE','2026-10-19 12:00 UAE']);
 assert(e.assertions.every(a=>a.sourceId&&a.excerpt));assert(e.conflicts[0].assertions.every(a=>a.key==='export_customs'));
});
Deno.test('contract: repeated identical attachment does not invent another disagreement',async()=>{
 const p={...pdf,text:'Included\nExport customs clearance'};const e=await assessRequestSourceContract([p,{...p,id:'duplicate'}]);assertEquals(e.conflicts,[]);
});
Deno.test('contract: import customs exclusions do not become export customs evidence',async()=>{
 const e=await assessRequestSourceContract([{...mail,text:'Excluded\nImport customs clearance'},{...pdf,text:'EXCLUDED\nImport customs clearance'}]);assertEquals(e.assertions,[]);
});
Deno.test('contract: following EXCLUDED heading does not negate the preceding INCLUDED service',async()=>{
 const e=await assessRequestSourceContract([{...pdf,text:'INCLUDED\nExport customs clearance\nEXCLUDED\nImport customs clearance'}]);
 assertEquals(e.assertions.map(a=>[a.key,a.value]),[['export_customs','included']]);
});
Deno.test('contract: explicit include/exclude sentences remain evidence without a section heading',async()=>{
 const e=await assessRequestSourceContract([{...mail,text:'Please include export customs clearance.'},{...pdf,text:'Export customs clearance is excluded.'}]);
 assertEquals(e.conflicts.map(c=>c.key),['source_contract.export_customs']);
});
Deno.test('contract: Not included heading and opposite consecutive clauses retain their own polarity',async()=>{
 const e=await assessRequestSourceContract([{...mail,text:'Not included: Export customs clearance'}]);assertEquals(e.assertions.map(a=>a.value),['excluded']);
 for(const text of ['Please include export customs clearance. Please exclude export customs clearance.','Please exclude export customs clearance. Please include export customs clearance.']){
  const x=await assessRequestSourceContract([{...mail,text}]);assertEquals(x.conflicts.length,1);assertEquals([...new Set(x.assertions.map(a=>a.value))].sort(),['excluded','included']);
 }
});
Deno.test('contract: input ordering is stable, source change/addition/removal invalidates fingerprint',async()=>{
 const a=await assessRequestSourceContract([mail,pdf]);assertEquals(a.fingerprint,(await assessRequestSourceContract([pdf,mail])).fingerprint);
 for(const changed of [[mail],[mail,{...pdf,text:pdf.text+' revised'}],[mail,pdf,{...pdf,id:'added'}]])assert(a.fingerprint!==(await assessRequestSourceContract(changed)).fingerprint);
 assert(a.fingerprint!==(await assessRequestSourceContract([{...mail,sentAt:'2027-10-16T05:00:00Z'},pdf])).fingerprint);
});
Deno.test('contract: records evidence and two blocking reviews once; identical replay is idempotent',async()=>{
 const e=await assessRequestSourceContract([mail,pdf]),m=memory();assertEquals(await syncRequestSourceContract(m.store,e),2);
 assertEquals(await syncRequestSourceContract(m.store,e),0);assertEquals(m.evidence.length,1);assertEquals(m.gaps.length,2);assert(m.gaps.every(g=>g.is_blocking));
});
Deno.test('contract: disappearing/incomplete evidence does not automatically close prior conflict',async()=>{
 const e=await assessRequestSourceContract([mail,pdf]),m=memory();await syncRequestSourceContract(m.store,e);
 await syncRequestSourceContract(m.store,await assessRequestSourceContract([],false));assert(m.gaps.every(g=>g.status==='open'));assertEquals(m.evidence.length,2);
});
Deno.test('contract: returning to a previously seen inventory appends a new transition',async()=>{
 const a=await assessRequestSourceContract([mail,pdf]),b=await assessRequestSourceContract([mail,{...pdf,text:pdf.text+' changed'}]),m=memory();
 for(const e of [a,b,a,a])await syncRequestSourceContract(m.store,e);assertEquals(m.evidence.map(e=>e.fingerprint),[a.fingerprint,b.fingerprint,a.fingerprint]);
});
Deno.test('contract: a resolved homonymous fact/action is not a resolution receipt',async()=>{
 const e=await assessRequestSourceContract([mail,pdf]),m=memory(e,[{id:'old',gap_key:'source_contract.export_customs',status:'resolved'}]);
 await syncRequestSourceContract(m.store,e);assert(m.writes.includes('source_contract.export_customs'));
});
Deno.test('contract: older waiver stays in history and is not inferred to be an inventory-bound contract decision',async()=>{
 const e=await assessRequestSourceContract([mail,pdf]),g={id:'waived',gap_key:'source_contract.export_customs',status:'waived',waived_by:'operator',waived_reason:'Explicit reviewed exception'};
 const m=memory(e,[g]);await syncRequestSourceContract(m.store,e);assert(m.writes.includes(g.gap_key));assertEquals(g.status,'waived');
 await syncRequestSourceContract(m.store,await assessRequestSourceContract([mail,{...pdf,text:pdf.text+' changed'}]));assert(m.writes.includes(g.gap_key));
});
for(const stage of ['readPrevious','readGaps','ensureGap','appendEvidence'] as const)Deno.test('contract: '+stage+' failure is not a confirmed analysis',async()=>{
 const e=await assessRequestSourceContract([mail,pdf]),m=memory();
 const failed:ContractStore={...m.store,[stage]:async()=>{throw new Error('synthetic '+stage);}};
 await assertRejects(()=>syncRequestSourceContract(failed,e),Error,'synthetic '+stage);
});
Deno.test('contract: irrelevant sources create no new workflow or reasoning event',async()=>{
 const e=await assessRequestSourceContract([{...mail,text:'Please quote general goods.'}]),m=memory();assertEquals(await syncRequestSourceContract(m.store,e),0);assertEquals(m.evidence,[]);assertEquals(m.writes,[]);
});
Deno.test('gateway: Mombasa clause and inland Uganda remain separate source proposals',()=>{
 const p=explicitSeaGatewayClauses([{id:mail.id,text:mail.text},{id:pdf.id,text:pdf.text}]);assertEquals(p.map(x=>[x.finalCity,x.gateway]),[['Bunia','Mombasa Kenya'],['Bunia','Uganda']]);
 assertEquals(seaGatewayAliasCandidates('Mombasa Kenya'),['MOMBASA KENYA','MOMBASA']);assertEquals(seaGatewayAliasCandidates('Uganda'),['UGANDA']);
 for(const s of ['Mombasa or Dar es Salaam','Mombasa / Durban','Mombasa and Durban'])assertEquals(seaGatewayAliasCandidates(s),[]);
});
