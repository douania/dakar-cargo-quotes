import {assert,assertEquals} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {syntheticCustoms} from './customs-basis-fixture.ts';
import {customsBasisSnapshot} from '../_shared/customs-basis.ts';
import {resolveSnapshotQualification} from '../generate-quotation-version/qqm-resolver.ts';
import {generateDraftPdf} from '../export-quotation-version-pdf/index.ts';
import {buildDeterministicBody} from '../create-quotation-email-draft/index.ts';
const f=syntheticCustoms(),basis=customsBasisSnapshot(f.record,f.context),known={category:'Droits & Taxes',description:'Droits fictifs',amount:13420,unit_price:13420,quantity:1,currency:'XOF',source:{type:'CALCULATED'}},pending={category:'Transport',description:'Transport',amount:null,source:{type:'TO_CONFIRM'}};
const resolve=resolveSnapshotQualification;
async function pdfText(snapshot:Record<string,unknown>){const bytes=await generateDraftPdf(snapshot,'SYNTHETIC');const raw=new TextDecoder('latin1').decode(bytes),texts:string[]=[];for(const m of raw.matchAll(/\/Length (\d+)[^>]*>>\s*stream\r?\n/g)){const start=m.index!+m[0].length;try{const s=new TextDecoder('latin1').decode(await new Response(new Blob([bytes.slice(start,start+Number(m[1]))]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());for(const t of s.matchAll(/<([0-9A-Fa-f]+)> Tj/g))texts.push(t[1].replace(/../g,h=>String.fromCharCode(parseInt(h,16))));}catch{/* non-content stream */}}return texts.join('\n');}
const snapshot=(lines:unknown[],qualification?:unknown)=>({customs_basis:basis,meta:{version_number:1,created_at:'2026-10-17T00:00:00Z',quoteQualification:qualification},inputs:{},raw_lines:lines,lines,totals:{subtotal_before_sodatra_vat:13420,total_payable:13420,honoraires_tva:0,currency:'XOF'}});
Deno.test('Estimated customs proof without an initial qualification cannot become firm',()=>{
 const q=resolve(undefined,[known],basis);assertEquals(q.level,'provisional');assert(q.reasons.some(r=>r.code==='CUSTOMS_OPERATOR_ESTIMATE'));
});
Deno.test('Estimated customs proof keeps partial and pending qualifications without duplicate reasons',()=>{
 const q=resolve({level:'partial',reasons:[],firmTotalPolicy:'excludes_reserved_items'},[known,pending],basis);assertEquals(q.level,'partial');assert(q.reasons.some(r=>r.code==='CUSTOMS_OPERATOR_ESTIMATE'));
 const replay=resolve(q,[known,pending],basis);assertEquals(replay.reasons.filter(r=>r.code==='CUSTOMS_OPERATOR_ESTIMATE').length,1);
});
Deno.test('Confirmed or absent customs proof keeps the existing firm decision',()=>{
 const confirmed=customsBasisSnapshot({...f.record,decision:{...f.decision,commitment:'confirmed'}},f.context);
 assertEquals(resolve(undefined,[known],confirmed).level,'firm');assertEquals(resolve(undefined,[known]).level,'firm');
});
Deno.test('Actual PDF never labels estimated customs firm, even when the persisted reason was lost',async()=>{
 for(const q of [undefined,{level:'firm',reasons:[],firmTotalPolicy:'all_included'},{level:'provisional',reasons:[{code:'RATE_PENDING_CONFIRMATION',message:'Pending'}],firmTotalPolicy:'excludes_reserved_items'}]){
  const text=await pdfText(snapshot(q&&q.level==='provisional'?[known,pending]:[known],q));assert(!text.includes('FERME'),text);assert(text.includes('PROVISOIRE'),text);assert(text.includes('13 420'),text);
 }
});
Deno.test('Deterministic email retains provisional customs wording with detailed and legacy totals',()=>{
 for(const totals of [{total_ht:13420,total_ttc:13420,currency:'XOF'},snapshot([known]).totals]){
  const s={...snapshot([known]),totals};
  const text=buildDeterministicBody(s,1,false,[],false,{level:'provisional',reasons:[],firmTotalPolicy:'excludes_reserved_items'});
  assert(!/\bferme\b/i.test(text),text);assert(text.includes('provisoire'),text);assert(text.includes('13'),text);
 }
});
