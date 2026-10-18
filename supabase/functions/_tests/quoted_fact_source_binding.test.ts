import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
Deno.env.set('BUILD_CASE_PUZZLE_DISABLE_SERVE','1');
const {bindExtractedFactSources,buildFactEmailContext,extractFactsWithAI,collectEmailContainerCandidates,detectRequestType,ownFactEmailBody,ownEvidenceEmailId}=await import('../build-case-puzzle/index.ts');
const old={id:'original',from_address:'client@fixture.invalid',sent_at:'2026-01-01T08:00:00Z',body_text:'Please quote 2x40HC. Commodity: equipment.'};
const follow={id:'follow-up',from_address:'client@fixture.invalid',sent_at:'2026-01-02T08:00:00Z',body_text:'Any update?\nOn Tuesday, Client wrote:\n> Please quote 2x40HC. Commodity: equipment.'};
const container=(quantity:number,sourceEmailId='follow-up')=>({key:'cargo.containers',category:'cargo',value:[{type:'40HC',quantity}],valueType:'json' as const,sourceType:'ai_extraction',sourceEmailId,sourceExcerpt:'2x40HC',confidence:.95});
Deno.test('quote source binding: actual original own source replaces false latest attribution',()=>{
 const r=bindExtractedFactSources([container(2)],[old,follow],[]);
 assertEquals(r.length,1);assertEquals(r[0].sourceEmailId,'original');assert(r[0].sourceExcerpt?.includes('Please quote 2x40HC'));
});
Deno.test('quote source binding: AI sum of a request and its quoted copy is repaired from one explicit source',()=>{
 const r=bindExtractedFactSources([container(4)],[old,follow],[]);
 assertEquals(r.map(f=>[f.value,f.sourceEmailId]),[[[{quantity:2,type:'40HC'}],'original']]);
});
Deno.test('quote source binding: quoted-only request creates no new container or incoterm fact',()=>{
 const fact={key:'routing.incoterm',category:'routing',value:'FOB',valueType:'text' as const,sourceType:'ai_extraction',sourceEmailId:'follow-up',sourceExcerpt:'FOB',confidence:.95};
 assertEquals(bindExtractedFactSources([container(2),fact],[{...follow,body_text:follow.body_text+' FOB'}],[]),[]);
});
Deno.test('quote source binding: contradictory own inventories stay candidates, no winner or sum',()=>{
 const newer={...follow,body_text:'Please quote 3x40HC instead.'};
 assertEquals(bindExtractedFactSources([container(3)],[old,newer],[]),[]);
 assertEquals(collectEmailContainerCandidates([old,newer]).map(c=>[c.emailId,c.containers]),[['original',[{type:'40HC',quantity:2}]],['follow-up',[{type:'40HC',quantity:3}]]]);
});
Deno.test('quote source binding: no-provider fallback also declines contradictory own inventories',async()=>{
 const newer={...follow,body_text:'Please quote 3x40HC instead.'};
 const r=await extractFactsWithAI('','',[old,newer],[]);assertEquals(r.filter(f=>f.key==='cargo.containers'),[]);
});
for(const failure of ['http','json','exception'])Deno.test('quote source binding: '+failure+' fallback does not pick a contradictory own inventory',async()=>{
 const saved=globalThis.fetch;globalThis.fetch=async()=>{if(failure==='exception')throw new Error('synthetic provider failure');return new Response(failure==='json'?'malformed':'unavailable',{status:failure==='http'?503:200,headers:{'Content-Type':'application/json'}});};
 try{const r=await extractFactsWithAI('','',[old,{...follow,body_text:'Please quote 3x40HC instead.'}],[],'synthetic-provider-only');assertEquals(r.filter(f=>f.key==='cargo.containers'),[]);}finally{globalThis.fetch=saved;}
});
Deno.test('quote source binding: two identical own lots remain two declarations after an AI merge',()=>{
 const mail={...old,body_text:'Lot A: 2x40HC\nLot B: 2x40HC'};
 const r=bindExtractedFactSources([container(4,'original')],[mail],[]);
 assertEquals(r[0].value,[{quantity:2,type:'40HC'},{quantity:2,type:'40HC'}]);
});
Deno.test('quote source binding: equal totals cannot redistribute quantities between own lots',()=>{
 const mail={...old,body_text:'Lot A: 5x40HC\nLot B: 5x40HC'};
 const f={...container(10,'original'),value:[{type:'40HC',quantity:3},{type:'40HC',quantity:7}]};
 const r=bindExtractedFactSources([f],[mail],[]);assertEquals(r[0].value,[{quantity:5,type:'40HC'},{quantity:5,type:'40HC'}]);
});
Deno.test('quote source binding: attachment proof keeps its actual attachment and parent email',()=>{
 const f={key:'cargo.description',category:'cargo',value:'Medical equipment',valueType:'text' as const,sourceType:'ai_extraction',sourceEmailId:'follow-up',sourceAttachmentId:'invoice',sourceExcerpt:'Medical equipment',confidence:.95};
 const r=bindExtractedFactSources([f],[old,follow],[{id:'invoice',email_id:'original',extracted_text:'Medical equipment'}]);
 assertEquals(r[0].sourceEmailId,'original');assertEquals(r[0].sourceAttachmentId,'invoice');
});
Deno.test('quote source binding: explicit attachment provenance survives overlapping own excerpts',()=>{
 const f={key:'cargo.description',category:'cargo',value:'Medical equipment',valueType:'text' as const,sourceType:'ai_extraction',sourceEmailId:'original',sourceAttachmentId:'invoice',sourceExcerpt:'Medical equipment',confidence:.95};
 const r=bindExtractedFactSources([f],[{...old,body_text:'Please quote Medical equipment.'}],[{id:'invoice',email_id:'document-email',extracted_text:'Medical equipment'}]);
 assertEquals(r[0].sourceEmailId,'document-email');assertEquals(r[0].sourceAttachmentId,'invoice');
});
Deno.test('quote source binding: intake document evidence is not falsely attached to a later email',()=>{
 const f={key:'cargo.description',category:'cargo',value:'Medical equipment',valueType:'text' as const,sourceType:'ai_extraction',sourceEmailId:'follow-up',sourceExcerpt:'Medical equipment',confidence:.95};
 const r=bindExtractedFactSources([f],[old,follow],[],'[Document: packing list]\nMedical equipment');
 assertEquals(r[0].sourceEmailId,undefined);assertEquals(r[0].sourceAttachmentId,undefined);
});
Deno.test('quote source binding: active prompt excludes historic quantities and outbound offers',()=>{
 const ctx=buildFactEmailContext([old,{...follow,body_text:'Any news?\nOn Tuesday, Client wrote:\n> 999x20GP'},{...old,id:'operator',from_address:'ops@sodatra.sn',body_text:'Our offer: 888x20GP'}]);
 assert(ctx.includes('source_id=original'));assert(ctx.includes('2x40HC'));assert(!ctx.includes('999x20GP'));assert(!ctx.includes('888x20GP'));assert(ctx.includes('not a new instruction'));
});
Deno.test('quote source binding: own subject remains source metadata for classification',()=>{
 const ctx=buildFactEmailContext([{...old,subject:'Air freight',body_text:'Please quote.'}]);assert(ctx.includes('subject_metadata="Air freight"'));assert(ctx.includes('Please quote.'));assertEquals(detectRequestType(ctx,[]).type,'AIR_IMPORT');
});
Deno.test('quote source binding: deterministic excerpt belongs to original own message, never quoted copy',()=>{
 const emails=[{...old,body_text:'Weight:22 tons per container.'},{...follow,body_text:'Any news?\nOn Tuesday, Client wrote:\n> Weight:22 tons per container.'}];
 const sources=emails.map(e=>({id:e.id,text:ownFactEmailBody(e.body_text)}));assertEquals(ownEvidenceEmailId('22 tons per container',sources),'original');
 assertEquals(ownEvidenceEmailId('99 tons per container',sources),null);
 assertEquals(ownEvidenceEmailId('22 tons per container',[sources[0],{id:'another-own',text:sources[0].text}]),null);
});
Deno.test('quote source binding: real AI extraction adapter sends own context and rejects duplicated output',async()=>{
 const saved=globalThis.fetch;let called=0;
 globalThis.fetch=async(_input,options)=>{called++;const payload=JSON.parse(String((options as {body?:unknown}|undefined)?.body));const prompt=payload.messages[1].content;assert(!prompt.includes('999x20GP'));assert(prompt.includes('source_id=original'));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({facts:[container(4)]})}}]}),{headers:{'Content-Type':'application/json'}});};
 try{const r=await extractFactsWithAI('UNSAFE RAW 999x20GP','',[old,follow],[],'synthetic-provider-only');assertEquals(called,1);assertEquals(r[0].sourceEmailId,'original');assertEquals(r[0].value,[{quantity:2,type:'40HC'}]);}finally{globalThis.fetch=saved;}
});
