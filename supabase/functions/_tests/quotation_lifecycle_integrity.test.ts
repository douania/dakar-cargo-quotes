import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { generateDraftPdf } from '../export-quotation-version-pdf/index.ts';
import { prepareCommercialQuote } from '../_shared/commercial-preparation.ts';
import { composeCommercialSnapshot } from '../_shared/commercial-snapshot.ts';
import { requiresDeterministicQuotationBody } from '../create-quotation-email-draft/index.ts';
import { commercialError } from '../_shared/commercial-service.ts';

const snapshot=(quantity:number)=>({meta:{version_number:1,created_at:'2026-10-18T00:00:00Z',quoteQualification:{level:'provisional',reasons:[],firmTotalPolicy:'all_included'}},inputs:{},client:{company:'TEST ONLY'},sources:[],
 lines:[{service_code:'TEST',description:'Explicit source quantity',quantity,unit_price:100,amount:quantity*100,currency:'XOF'}],
 raw_lines:[{service_code:'TEST',description:'Explicit source quantity',quantity,unit_price:100,amount:quantity*100,currency:'XOF',bloc:'debours'}],
 totals:{currency:'XOF',total_ht:quantity*100,total_ttc:quantity*100,subtotal_before_sodatra_vat:quantity*100,honoraires_ht:0,honoraires_tva:0,total_payable:quantity*100}});

async function texts(bytes:Uint8Array){const out:Array<{text:string;x:number;y:number}>=[],raw=new TextDecoder('latin1').decode(bytes);
 for(const match of raw.matchAll(/\/Length (\d+)[^>]*>>\s*stream\r?\n/g)){const start=match.index!+match[0].length;let content:string;
  try{content=new TextDecoder('latin1').decode(await new Response(new Blob([bytes.slice(start,start+Number(match[1]))]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());}catch{continue;}
  for(const block of content.matchAll(/BT([\s\S]*?)ET/g)){const pos=block[1].match(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/),value=block[1].match(/<([0-9A-Fa-f]*)> Tj/);if(pos&&value)out.push({text:value[1].replace(/../g,h=>String.fromCharCode(parseInt(h,16))),x:Number(pos[1]),y:Number(pos[2])});}
 }return out;
}
Deno.test('quote lifecycle: PDF preserves an explicit zero quantity instead of inventing one',async()=>{
 const source=snapshot(0),before=structuredClone(source),drawn=await texts(await generateDraftPdf(source,'test-only'));
 const label=drawn.find(t=>t.text==='Explicit source quantity');assert(label,'actual PDF description not found');
 const quantity=drawn.find(t=>t.y===label.y&&t.x===330);assert(quantity,'actual PDF quantity cell not found');assertEquals(quantity.text,'0');assertEquals(source,before);
});
for(const quantity of [0,2])Deno.test(`quote lifecycle: unchanged inherited quantity${quantity} and unit price remain tied to source`,()=>{
 const source=snapshot(quantity),before=structuredClone(source),draft=prepareCommercialQuote('case','version',source),composed=composeCommercialSnapshot(draft,'revision');
 assertEquals(composed.lines[0].quantity,quantity);assertEquals(composed.lines[0].unit_price,100);assertEquals(composed.lines[0].amount,quantity*100);assertEquals(composed.totals.total_payable,quantity*100);assertEquals(source,before);
});

Deno.test('quote lifecycle: financial and reserved drafts cannot delegate saved commitments to AI',()=>{
 for(const source of [snapshot(0),snapshot(2),{lines:[],raw_lines:[],totals:{total_ttc:200}},
  {lines:[],raw_lines:[],totals:{total_payable:'200',subtotal_before_sodatra_vat:'200'}},
  {total_ttc:0},{lots:[{lines:[]}]},{meta:{quoteQualification:{level:'partial',reasons:[],firmTotalPolicy:'excludes_reserved_items'}}}]) {
  assertEquals(requiresDeterministicQuotationBody(source),true);
 }
});

Deno.test('quote lifecycle: inherited raw legacy quantity is preserved, an edited line stays a lump sum',()=>{
 const source=snapshot(2),legacy={...source,lines:[]},draft=prepareCommercialQuote('case','version',legacy);
 assertEquals(composeCommercialSnapshot(draft,'revision').lines[0].quantity,2);
 draft.lines[0].status='estimated';draft.lines[0].amount_basis='taxes_included';draft.lines[0].client_amount_xof=250;
 const edited=composeCommercialSnapshot(draft,'revision');assertEquals(edited.lines[0].quantity,1);assertEquals(edited.lines[0].unit_price,250);assertEquals(edited.lines[0].amount,250);
});

Deno.test('quote lifecycle: legacy rate follows the same saved pricing normalizer',()=>{
 const source=snapshot(2),raw={...source.raw_lines[0],rate:100} as Record<string,unknown>;
 delete raw.unit_price;
 const legacy={...source,lines:[],raw_lines:[raw]},draft=prepareCommercialQuote('case','version',legacy);
 const result=composeCommercialSnapshot(draft,'revision');assertEquals(result.lines[0].quantity,2);assertEquals(result.lines[0].unit_price,100);
});

Deno.test('quote lifecycle: deterministic database conflicts are exposed as HTTP409',()=>{
 try { commercialError({code:'PT409',message:'Pricing facts changed'}); } catch(error) {
  assertEquals((error as Error & {status:number}).status,409);assertEquals((error as Error).message,'Pricing facts changed');return;
 }
 throw new Error('Expected source conflict');
});
