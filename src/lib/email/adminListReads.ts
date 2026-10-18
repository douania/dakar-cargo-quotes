import { supabase } from '@/integrations/supabase/client';
import { invokeWithRetry } from '@/lib/fetchWithRetry';
import type { Tables } from '@/integrations/supabase/types';
import { literalEmailSearch, readAllPages, readPage, uniqueRows } from './readPages';

export async function readAdminThreads() {
  const rows: Tables<'email_threads'>[] = [];
  for (let offset = 0; ;) {
    const { data, error } = await invokeWithRetry('email-admin', {
      action: 'get_threads_paginated', data: { offset, pageSize: 50 },
    });
    if (error) throw error;
    if (data?.success !== true || data.offset !== offset || !Array.isArray(data.threads) || !Number.isSafeInteger(data.totalCount)
      || data.totalCount < 0 || (data.threads.length === 0 && offset < data.totalCount)) throw new Error('Lecture des fils incomplète');
    rows.push(...data.threads);
    offset += data.threads.length;
    if (offset >= data.totalCount) return uniqueRows(rows);
  }
}

export async function readAdminEmailPage(offset: number, query: string, filter: string) {
  let request = supabase.from('emails').select('*', { count: 'exact' });
  if (query.trim()) request = request.or(literalEmailSearch(['subject', 'from_address', 'body_text'], query));
  if (filter === 'quotation' || filter === 'other') request = request.eq('is_quotation_request', filter === 'quotation');
  return readPage(request.order('sent_at', { ascending: false, nullsFirst: false }).order('id').range(offset, offset + 99), offset);
}

export async function readAdminAttachments(ids: string[]) {
  const rows: Array<Pick<Tables<'email_attachments'>, 'id' | 'email_id' | 'filename' | 'content_type' | 'is_analyzed' | 'storage_path' | 'extracted_data'>> = [];
  for (let at = 0; at < ids.length; at += 100) {
    rows.push(...await readAllPages((from, to) => supabase.from('email_attachments')
      .select('id, email_id, filename, content_type, is_analyzed, storage_path, extracted_data', { count: 'exact' })
      .in('email_id', ids.slice(at, at + 100)).order('id').range(from, to)));
  }
  return uniqueRows(rows);
}

export async function readAdminDraftPage(offset: number) {
  return readPage(supabase.from('email_drafts').select('*', { count: 'exact' })
    .order('created_at', { ascending: false }).order('id').range(offset, offset + 49), offset);
}

export function allVisibleSelected(selected: Set<string>, visible: string[]) {
  return visible.length > 0 && visible.every(id => selected.has(id));
}

export function selectVisible(selected: Set<string>, visible: string[]) {
  return allVisibleSelected(selected, visible) ? new Set<string>() : new Set(visible);
}
