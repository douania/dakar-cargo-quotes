// Synthetic dossier for the local handler harness (MULTI-LOT-TERMINAL-1). No customer data.
import { q, sql } from "./harness.ts";

export const ACTOR = "00000000-0000-4000-8000-0000000a0001";
export const BODY_A = "Lot 1 : 2 conteneurs 40HC de mobilier de bureau, 36000 kg, de Shanghai a Dakar, livraison DAP Dakar.";
export const BODY_B = "Lot 2 : 1 conteneur 20DV de pieces detachees, 12000 kg, de Ningbo a Dakar, livraison DAP Dakar.";
export const TWO_LINES = [
  { line_index: 1, line_label: "Lot A - mobilier Shanghai", segment_text: BODY_A, source_excerpt: BODY_A, request_type_hint: "SEA_FCL_IMPORT", confidence: 0.9,
    extracted_facts: [{ key: "cargo.containers", value: JSON.stringify([{ type: "40HC", quantity: 2, coc_soc: null }]), valueType: "json", confidence: 0.9 },
      { key: "cargo.weight_kg", value: "36000", valueType: "number", confidence: 0.9 }, { key: "routing.origin_port", value: "Shanghai", valueType: "text", confidence: 0.9 }] },
  { line_index: 2, line_label: "Lot B - pieces Ningbo", segment_text: BODY_B, source_excerpt: BODY_B, request_type_hint: "SEA_FCL_IMPORT", confidence: 0.9,
    extracted_facts: [{ key: "cargo.containers", value: JSON.stringify([{ type: "20DV", quantity: 1, coc_soc: null }]), valueType: "json", confidence: 0.9 },
      { key: "cargo.weight_kg", value: "12000", valueType: "number", confidence: 0.9 }, { key: "routing.origin_port", value: "Ningbo", valueType: "text", confidence: 0.9 }] },
];

/** Same lines with the container fact in the text form written by the real extraction
 * (observed on the deployed sandbox: "2x40HC" / "1x20DV", valueType text). */
export const TEXT_LINES = TWO_LINES.map((l, i) => ({ ...l, extracted_facts: l.extracted_facts.map(f => f.key === "cargo.containers"
  ? { key: f.key, value: i === 0 ? "2x40HC" : "1x20DV", valueType: "text", confidence: f.confidence } : f) }));

export async function seedCase(caseId: string, threadId: string, emailId: string, status = "NEED_INFO") {
  await sql(`insert into auth.users(id,email) values(${q(ACTOR)},'operator@example.invalid') on conflict do nothing;
insert into public.email_threads(id,subject_normalized,client_email) values(${q(threadId)},'SYNTHETIC MULTI LOT','client@example.invalid');
insert into public.emails(id,message_id,thread_ref,from_address,to_addresses,subject,body_text,sent_at,received_at,is_quotation_request)
 values(${q(emailId)},${q(`<${emailId}@example.invalid>`)},${q(threadId)},'client@example.invalid',array['ops@example.invalid'],'Demande de cotation deux lots',
 ${q(`Bonjour,\nMerci de nous coter deux envois distincts.\n${BODY_A}\n${BODY_B}\nCordialement,\nClient synthetique`)},now(),now(),true);
insert into public.quote_cases(id,thread_id,status,request_type,created_by) values(${q(caseId)},${q(threadId)},${q(status)},'SEA_FCL_IMPORT',${q(ACTOR)});`);
}

export async function operatorFact(caseId: string, key: string, category: string, value: string) {
  await sql(`update public.quote_facts set is_current=false where case_id=${q(caseId)} and fact_key=${q(key)} and is_current;
insert into public.quote_facts(case_id,fact_key,fact_category,value_text,source_type,is_current,confidence)
 values(${q(caseId)},${q(key)},${q(category)},${q(value)},'manual_input',true,1);`);
}

export async function snapshot(caseId: string) {
  const out = await sql(`select jsonb_build_object(
  'status',(select status::text from public.quote_cases where id=${q(caseId)}),
  'lines',(select count(*) from public.quote_request_lines where case_id=${q(caseId)}),
  'blocking',(select coalesce(jsonb_agg(gap_key order by gap_key),'[]') from public.quote_gaps where case_id=${q(caseId)} and status='open' and is_blocking),
  'open',(select coalesce(jsonb_agg(gap_key order by gap_key),'[]') from public.quote_gaps where case_id=${q(caseId)} and status='open'),
  'resolved_reasons',(select coalesce(jsonb_agg(event_data->>'gap_key' || ':' || (event_data->>'reason') order by created_at),'[]') from public.case_timeline_events
     where case_id=${q(caseId)} and event_type='gap_resolved' and event_data->>'gap_key' in ('routing.terminal_operation_mode','pricing.pad_category'))
)::text;`);
  return JSON.parse(out) as { status: string; lines: number; blocking: string[]; open: string[]; resolved_reasons: string[] };
}
