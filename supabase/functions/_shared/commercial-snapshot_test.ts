import { assert,assertEquals,assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { prepareCommercialQuote,reviseCommercialPreparation } from './commercial-preparation.ts';
import { composeCommercialSnapshot } from './commercial-snapshot.ts';
import { classifyClientLine,projectClientQuote } from './client-quote-projection.ts';
import { resolveCommercialTotalPresentation } from './commercial-total-presentation.ts';
const source=()=>({meta:{pricing_run_id:'run',quoteQualification:{reasons:[]}},inputs:{},client:{},
  totals:{currency:'XOF',subtotal_before_sodatra_vat:1000,honoraires_ht:1000,honoraires_tva:180,total_payable:1180},
  raw_lines:[{label:'Frais source',amount:1000,bloc:'honoraires',currency:'XOF'},{label:'Handling',amount:null,currency:'XOF',source:{type:'TO_CONFIRM',air_handling:{supplier_known_ht_xof:34420,secret_proof:'INTERNAL_PURCHASE_PROOF'}}}]});
function initial(){return prepareCommercialQuote('case','version',source());}
const change=(d:ReturnType<typeof initial>,action:Parameters<typeof reviseCommercialPreparation>[1])=>reviseCommercialPreparation(d,action,{actor_id:'server-actor',operation_id:`operation-${d.revision}`,expected_revision:d.revision,occurred_at:'2026-10-17T12:00:00Z'});
for(const currency of ['FCFA','CFA',' fcfa '])Deno.test(`commercial XOF aliases: ${currency} duties survive preparation and version without tax changes`,()=>{
 const value={...source(),raw_lines:[...source().raw_lines,
  {label:'Synthetic calculated duties',amount:13420,bloc:'debours',currency,source:{type:'CALCULATED'}},
  {label:'Synthetic pending charge',amount:13420,currency,source:{type:'TO_CONFIRM'}},
  {label:'Synthetic explicit free charge',amount:0,currency,source:{type:'CALCULATED'}}]};
 Object.assign(value.totals,{subtotal_before_sodatra_vat:14420,total_payable:14600});
 const before=structuredClone(value),draft=prepareCommercialQuote('case','version',value),snap=composeCommercialSnapshot(draft,'revision');
 assertEquals(draft.lines[2].client_amount_xof,13420);assertEquals(draft.lines[2].status,'source');
 assertEquals(draft.lines[3].client_amount_xof,null);assertEquals(draft.lines[4].client_amount_xof,0);
 assertEquals(snap.lines[2].amount,13420);assertEquals(snap.lines[3].amount,null);assertEquals(snap.lines[4].amount,0);
 assertEquals(snap.totals.total_payable,14600);assertEquals(snap.totals.honoraires_tva,180);
 assertEquals(value,before);assertEquals(draft.source_snapshot,before);
});
Deno.test('commercial foreign or ambiguous currency stays unknown despite XOF source totals',()=>{
 for(const currency of ['USD','EUR','XAF','','FCFA-West','FCFA USD']){
  const value={totals:{currency:'XOF'},raw_lines:[{label:'Synthetic foreign charge',amount:13420,currency,source:{type:'CALCULATED'}}]};
  const draft=prepareCommercialQuote('case','version',value);
  assertEquals(draft.lines[0].client_amount_xof,null,currency);assertEquals(draft.lines[0].status,'to_confirm');
  assertEquals(draft.source_snapshot,value);
 }
});
Deno.test('commercial totals reuse fee-only VAT, TTC adds no VAT, no enrichment double count',()=>{
 let draft=change(initial(),{type:'edit',line_id:'source:1',amount:40000,basis:'taxes_included',reason:'Private reason must not be shown to client'});
 draft=change(draft,{type:'add',line_id:'operator:fees',kind:'additional',label:'Prestation SODATRA',amount:2500,basis:'before_sodatra_vat',reason:'Additional explicit SODATRA service fee'});
 const snap=composeCommercialSnapshot(draft,'revision');
 assertEquals(snap.totals.subtotal_before_sodatra_vat,43500);assertEquals(snap.totals.honoraires_tva,630);assertEquals(snap.totals.total_payable,44130);
 assertEquals(snap.meta.quoteQualification.level,'provisional');assertEquals(source().raw_lines[1].amount,null);
 const serialized=JSON.stringify(snap);for(const text of ['INTERNAL_PURCHASE_PROOF','34420','Private reason','server-actor'])assert(!serialized.includes(text),text);
});
Deno.test('unknown stays null, source cost never becomes a sale, partial qualification and omitted amount',()=>{
 const snap=composeCommercialSnapshot(initial(),'revision');assertEquals(snap.lines[1].amount,null);assertEquals(snap.totals.total_payable,1180);assertEquals(snap.meta.quoteQualification.level,'partial');assertEquals(classifyClientLine(snap.lines[1],snap.raw_lines[1]).status,'to_confirm');
});
Deno.test('remove/restore creates a new projection without mutating the source and unknown total never becomes a free quote',()=>{
 const draft=change(initial(),{type:'remove',line_id:'source:0',reason:'Remove fee explicitly for this version'});
 const snap=composeCommercialSnapshot(draft,'revision');assertEquals(snap.totals.total_payable,null);assertEquals(resolveCommercialTotalPresentation(snap.totals).hasPayable,false);
 assertEquals(classifyClientLine(snap.lines[0],snap.raw_lines[0]).status,'excluded');assertEquals(draft.source_snapshot.raw_lines,source().raw_lines);
});
Deno.test('customs zero decision remains explicitly estimated and cannot validate official fiscal status',()=>{
 const draft=change(initial(),{type:'add',line_id:'operator:customs',kind:'customs_estimate',label:'Provision douanière',amount:0,basis:'taxes_included',reason:'Explicit zero provision only for testing'});
 const snap=composeCommercialSnapshot(draft,'revision'),projection=projectClientQuote(snap);
 assertEquals(projection.lines.at(-1)?.status,'estimated');assertEquals(projection.lines.at(-1)?.amountText,'0 (montant explicitement retenu)');assert(snap.lines.at(-1)!.explanation.includes('aucun classement'));
});
Deno.test('unreconciled or foreign source is rejected rather than inventing tax treatment',()=>{
 const a=initial();(a.source_snapshot.totals as Record<string,unknown>).honoraires_tva=100;assertThrows(()=>composeCommercialSnapshot(a,'r'),Error,'non rapprochable');
 const b=initial();(b.source_snapshot.totals as Record<string,unknown>).currency='EUR';assertThrows(()=>composeCommercialSnapshot(b,'r'),Error,'XOF');
});
Deno.test('editing the historical customs reserve becomes a qualified provision, never a validated duty',()=>{
 const value={...source(),raw_lines:[...source().raw_lines,{label:'Droits réservés',amount:null,currency:'XOF',category:'CUSTOMS_RESERVE',source:{type:'TO_CONFIRM'}}]};
 const draft=change(prepareCommercialQuote('case','version',value),{type:'edit',line_id:'source:2',amount:150000,basis:'taxes_included',reason:'Provision opérateur explicite, classement à confirmer'});
 const snap=composeCommercialSnapshot(draft,'r');assertEquals(snap.lines[2].commercial.customs_estimate,true);assertEquals(classifyClientLine(snap.lines[2],snap.raw_lines[2]).status,'estimated');assert(snap.lines[2].explanation.includes('aucun classement'));
});
