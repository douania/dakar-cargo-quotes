import { assert,assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { generateDraftPdf } from './index.ts';
import { composeCommercialSnapshot } from '../_shared/commercial-snapshot.ts';
import { prepareCommercialQuote,reviseCommercialPreparation } from '../_shared/commercial-preparation.ts';
import { PDFDocument,PDFName,PDFRawStream,decodePDFRawStream } from 'https://esm.sh/pdf-lib@1.17.1';
async function textOf(bytes:Uint8Array){const doc=await PDFDocument.load(bytes);const texts:string[]=[];for(const [,obj] of doc.context.enumerateIndirectObjects()){if(obj instanceof PDFRawStream&&obj.dict.get(PDFName.of('Filter'))){const text=new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode());for(const match of text.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)){const data=Uint8Array.from(match[1].match(/../g)!.map(h=>parseInt(h,16)));texts.push(new TextDecoder('windows-1252').decode(data));}}}return texts.join(' ');}
const base={meta:{version_number:2},client:{},inputs:{},totals:{currency:'XOF',subtotal_before_sodatra_vat:1000,honoraires_ht:1000,honoraires_tva:180},raw_lines:[{label:'Honoraires',amount:1000,bloc:'honoraires',currency:'XOF'},{label:'Handling',amount:null,currency:'XOF',source:{type:'TO_CONFIRM',air_handling:{supplier_known_ht_xof:34420,private_proof:'SECRET_SUPPLIER_DOCUMENT'}}}]};
Deno.test('saved commercial PDF keeps customer amounts, VAT, estimates and hides supplier proof',async()=>{
 let draft=prepareCommercialQuote('fixture','version',base);
 draft=reviseCommercialPreparation(draft,{type:'edit',line_id:'source:1',amount:40000,basis:'taxes_included',reason:'PRIVATE_NEGOTIATION_REASON'},{expected_revision:0,operation_id:'op',actor_id:'actor',occurred_at:'2026-10-17T12:00:00Z'});
 const snap=JSON.parse(JSON.stringify(composeCommercialSnapshot(draft,'revision'))),before=JSON.stringify(snap),bytes=await generateDraftPdf(snap,'SYNTHETIC');
 assertEquals(JSON.stringify(snap),before);const text=await textOf(bytes);
 for(const expected of ['40 000','41 180','180','DRAFT','estim'])assert(text.toLowerCase().includes(expected.toLowerCase()),expected+' '+text);
 for(const forbidden of ['34 420','34420','SECRET_SUPPLIER_DOCUMENT','PRIVATE_NEGOTIATION_REASON'])assert(!text.includes(forbidden),forbidden);
});
Deno.test('all-unpriced commercial PDF prints to-confirm total, never a zero payable',async()=>{
 const draft=prepareCommercialQuote('fixture','version',base);
 const changed=reviseCommercialPreparation(draft,{type:'remove',line_id:'source:0',reason:'Remove explicitly in synthetic fixture'},{expected_revision:0,operation_id:'op',actor_id:'actor',occurred_at:'2026-10-17T12:00:00Z'});
 const snap=composeCommercialSnapshot(changed,'revision');const text=await textOf(await generateDraftPdf(snap,'SYNTHETIC'));
 assert(text.includes('TOTAL A PAYER : A CONFIRMER'));assert(!text.includes('TOTAL A PAYER: 0'));
});
