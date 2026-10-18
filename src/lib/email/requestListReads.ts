import { supabase } from '@/integrations/supabase/client';
import { literalEmailSearch, readAllPages, readPage } from './readPages';
import type { RawEmail } from './threadGroups';

export async function readActiveCases() {
  return readAllPages((from, to) => supabase.from('quote_cases')
    .select('id, thread_id, status, request_type, priority, puzzle_completeness, created_at, updated_at', { count: 'exact' })
    .not('status', 'in', '(SENT,ARCHIVED,ACCEPTED,REJECTED)')
    .order('updated_at', { ascending: false }).order('id').range(from, to));
}

export async function readSentEmailIds() {
  // Owner scoped by the existing RLS contract; other operators' sent drafts stay invisible.
  const rows = await readAllPages((from, to) => supabase.from('email_drafts')
    .select('original_email_id', { count: 'exact' }).eq('status', 'sent')
    .not('original_email_id', 'is', null).order('id').range(from, to));
  return new Set(rows.map(row => row.original_email_id));
}

export async function readRequestPage(offset: number, query = '') {
  let request = supabase.from('emails')
    .select('id, subject, from_address, received_at, sent_at, created_at, extracted_data, thread_id, thread_ref, body_text', { count: 'exact' })
    .eq('is_quotation_request', true);
  if (query.trim()) request = request.or(literalEmailSearch(['subject', 'from_address', 'body_text', 'body_html'], query));
  const page = await readPage(request.order('received_at', { ascending: false }).order('id').range(offset, offset + 99), offset);
  return { ...page, rows: page.rows as RawEmail[] };
}

export async function readRequestAttachmentCounts(ids: string[]) {
  const counts: Record<string, number> = {};
  for (let at = 0; at < ids.length; at += 100) {
    const rows = await readAllPages((from, to) => supabase.from('email_attachments')
      .select('email_id', { count: 'exact' }).in('email_id', ids.slice(at, at + 100))
      .order('id').range(from, to));
    for (const row of rows) if (row.email_id) counts[row.email_id] = (counts[row.email_id] || 0) + 1;
  }
  return counts;
}

export async function readCaseClientNames(ids: string[]) {
  const names: Record<string, string> = {};
  for (let at = 0; at < ids.length; at += 100) {
    const rows = await readAllPages((from, to) => supabase.from('quote_facts')
      .select('case_id, value_text', { count: 'exact' }).in('case_id', ids.slice(at, at + 100))
      .eq('fact_key', 'contacts.client_company').eq('is_current', true).order('id').range(from, to));
    for (const row of rows) if (row.case_id && row.value_text) names[row.case_id] = row.value_text;
  }
  return names;
}

export function pendingRequests(rows: RawEmail[], cases: Array<{ thread_id: string | null }>, sent: Set<string | null>) {
  const covered = new Set(cases.map(item => item.thread_id).filter(Boolean));
  return rows.filter(row => !sent.has(row.id) && !(row.thread_ref && covered.has(row.thread_ref))
    && !(row.thread_id && covered.has(row.thread_id)));
}
