import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateDraftPdf } from "./index.ts";
import { fullAirFixture } from "../_shared/air-tariff_test.ts";
import { resolveAirTariff } from "../_shared/air-tariff.ts";
import { airHandlingSource } from "../_shared/air-handling.ts";
async function texts(bytes:Uint8Array){
 const raw=new TextDecoder("latin1").decode(bytes),out:string[]=[];
 for(const m of raw.matchAll(/\/Length (\d+)[^>]*>>\s*stream\r?\n/g)){try{
 const start=m.index!+m[0].length,content=new TextDecoder("latin1").decode(await new Response(new Blob([bytes.slice(start,start+Number(m[1]))]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
 for(const t of content.matchAll(/<([0-9A-Fa-f]*)> Tj/g))out.push(t[1].replace(/../g,h=>String.fromCharCode(parseInt(h,16))));
 }catch{/* Other PDF streams are not text. */}}
 return out.join(" ");
}
Deno.test("AIR catalogue PDF: unknown weighted bases stay partial; private known purchase is never billed as client handling",async()=>{
 const state=fullAirFixture();state.basis!.ordinary_storage.enabled=false;
 const resolution=resolveAirTariff(state,"2026-10-19")!;assertEquals(resolution.supplier_known_ht_xof,32500);
 const handling={label:"Handling aeroportuaire",description:"Handling aeroportuaire",category:"AIR_HANDLING",amount:0,quantity:null,unit_price:0,source:airHandlingSource(resolution)};
 const snapshot={meta:{quoteQualification:{level:"partial",firmTotalPolicy:"excludes_reserved_items",reasons:[{code:"RATE_PENDING_CONFIRMATION",message:"Handling a confirmer"}]}},
 inputs:{incoterm:"DDP",origin:"Synthetic origin",destination:"Synthetic destination"},client:{},
 lines:[handling,{label:"Honoraires",description:"Honoraires",category:"AGENCY",amount:12000,quantity:1,unit_price:12000,source:{type:"OFFICIAL",reference:"SYNTHETIC"}}],
 raw_lines:[handling],totals:{currency:"XOF",honoraires_ht:12000,total_ht:12000,total_payable:12000,total_ttc:12000}};
 const before=JSON.stringify(snapshot),bytes=await generateDraftPdf(snapshot,"SYNTHETIC"),all=await texts(bytes);
 assertEquals(JSON.stringify(snapshot),before);assert(bytes.length>1000);
 assert(all.includes("OFFRE PARTIELLE")&&all.includes("TOTAL HT PARTIEL"),all);assert(all.includes("12 000"),all);assert(all.includes("confirmer"),all);
 for(const privateValue of ["32 500","catalogue-v2","Synthetic full catalogue source","supplier_known_ht_xof","poids taxable LTA"])assertFalse(all.includes(privateValue),privateValue);
});

