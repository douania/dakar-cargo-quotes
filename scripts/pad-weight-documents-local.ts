// Explicit offline integration runner, never part of ordinary CI or live tests.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadPadGroupState } from "../supabase/functions/_shared/pad-group-store.ts";
import { resolveSnapshotQualification } from "../supabase/functions/generate-quotation-version/qqm-resolver.ts";
import { normalizeLinePricing, resolveSnapshotInputs } from "../supabase/functions/generate-quotation-version/snapshot-normalizer.ts";
import { generateDraftPdf } from "../supabase/functions/export-quotation-version-pdf/index.ts";
import { buildDeterministicBody } from "../supabase/functions/create-quotation-email-draft/index.ts";
const container="dcq-pad-v3-full-20260915", database="pad_v3_full_weight";
const output=Deno.args[0]; assert(output && /pad-weight-integration\.pdf$/.test(output));
const inspection=await new Deno.Command("docker",{args:["inspect",container],stdout:"piped"}).output();
assertEquals(JSON.parse(new TextDecoder().decode(inspection.stdout))[0].HostConfig.NetworkMode,"none");
async function sql(input:string):Promise<string>{
 const child=new Deno.Command("docker",{args:["exec","-i",container,"psql","-X","-qAt","-U","postgres","-d",database,"-v","ON_ERROR_STOP=1","-v","VERBOSITY=terse"],stdin:"piped",stdout:"piped",stderr:"piped"}).spawn();
 const writer=child.stdin.getWriter();await writer.write(new TextEncoder().encode(input));await writer.close();
 const result=await child.output();if(!result.success)throw new Error("LOCAL_SQL_FAILED");
 return new TextDecoder().decode(result.stdout).trim();
}
const email="weight-documents@example.invalid";
assertEquals(await sql(`SELECT count(*) FROM auth.users WHERE email='${email}'`),"0","Existing fixture must not be overwritten");
const fixture=(await Deno.readTextFile("supabase/tests/pad_weight_reconciliation_full.sql")).replace(/^begin;$/m,`begin;\nSET LOCAL dcq.weight_fixture_email='${email}';`).replace(/^rollback;$/m,"commit;");
await sql(fixture);
const cid=await sql(`SELECT c.id FROM public.quote_cases c JOIN public.email_threads t ON t.id=c.thread_id WHERE t.client_email='${email}'`);
assert(/^[a-f0-9-]{36}$/.test(cid));
await sql(`UPDATE public.quote_facts SET source_type='ai_extraction' WHERE case_id='${cid}' AND fact_key='cargo.weight_kg';`);
// All reads are backed by the restored database; only the transport adapter is local.
const db={rpc:async(name:string)=>{assertEquals(name,"read_pad_weight_context");return {data:JSON.parse(await sql(`SELECT public.read_pad_weight_context('${cid}')`)),error:null};},
 from:(table:string)=>{assertEquals(table,"port_tariffs");const chain={select:()=>chain,eq:()=>chain,limit:async()=>{
  const data=JSON.parse(await sql("SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM public.port_tariffs t WHERE provider='PAD' AND category='DROIT_PASSAGE' AND operation_type='IMPORT' AND cargo_type='CONTENEUR' AND is_active"));
  return {data,error:null,count:data.length};}};return chain;}};
const state=await loadPadGroupState(db,cid);assertEquals(state.ready,true);assertEquals(state.retained_weight?.total_weight_kg,36000);
assertEquals(await sql(`SELECT value_number FROM public.quote_facts WHERE case_id='${cid}' AND fact_key='cargo.weight_kg'`),"35000");
const raw_lines=state.lines.map(line=>({category:"PAD_DROIT_PASSAGE",label:`Passage portuaire ${line.category}`,amount:line.amount,currency:"XOF",quantity:line.quantity,unitPrice:line.unit_price,
 source:{unit_ref:line.unit_ref,weight_basis:line.weight_basis,weight_reservation:line.weight_reservation,weight_reconciliation:state.retained_weight}}));
assertEquals(raw_lines.reduce((s,l)=>s+l.amount,0),state.total);
const qualification=resolveSnapshotQualification({level:"firm",reasons:[]},raw_lines);assertEquals(qualification.level,"provisional");
const inputs={cargoWeight:36,containers:[{type:"20HQ",quantity:2}],finalDestination:"SYNTHETIC"};
const snapshot={meta:{version_number:1,created_at:"2026-09-18T00:00:00Z",quoteQualification:qualification},
 client:{company:"SYNTHETIC LOCAL TEST - NOT FOR SENDING"},inputs:resolveSnapshotInputs(inputs,[],{}),raw_lines,
 lines:raw_lines.map(l=>({service_code:"PAD",description:l.label,...normalizeLinePricing(l),currency:"XOF"})),
 totals:{total_ht:state.total,total_ttc:state.total,currency:"XOF"},sources:[]};
const before=JSON.stringify(snapshot);
const body=buildDeterministicBody(snapshot,1,false,[],true,qualification);
assert(body.includes("36 tonnes"));assert(body.includes(state.retained_weight!.reservation));assert(!body.includes("HT ferme"));
const pdf=await generateDraftPdf(snapshot,"SYNTHETIC");assertEquals(JSON.stringify(snapshot),before);
await Deno.writeFile(output,pdf);
console.log(JSON.stringify({status:"PASS_LOCAL_PAD_TO_DOCUMENTS",groupWeightKg:36000,extractedWeightKg:35000,padTotal:state.total,pdfBytes:pdf.length,
 limits:["PAD domain calculation, not full run-pricing HTTP orchestration","No live Auth session","No Cloud writes or sends"]}));
