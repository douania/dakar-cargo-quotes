import { supabase } from '@/integrations/supabase/client';
import { readAllPages } from '@/lib/email/readPages';

export interface CaseSource {
  id: string;
  kind: 'email' | 'attachment' | 'document';
  label: string;
  recordedAt: string | null;
}
export interface CaseSourceChanges {
  sources: CaseSource[];
  runs: Array<{ id: string; created_at: string | null }>;
}

/** Read metadata under the current user's RLS. No body, analysis or fact mutation.
 * created_at measures registration, not the sender's Date header. Historical
 * adoption and later edits have no general source manifest: coverage stays unknown.
 */
export async function readCaseSourceChanges(caseId: string): Promise<CaseSourceChanges> {
  const { data: dossier, error } = await supabase.from('quote_cases').select('id,thread_id').eq('id', caseId).single();
  if (error) throw error;
  if (!dossier) throw new Error('Dossier inaccessible');
  const [runs, documents, emails] = await Promise.all([
    readAllPages((from, to) => supabase.from('pricing_runs').select('id,created_at', { count: 'exact' })
      .eq('case_id', caseId).order('created_at', { ascending: false }).order('id').range(from, to)),
    readAllPages((from, to) => supabase.from('case_documents').select('id,file_name,created_at', { count: 'exact' })
      .eq('case_id', caseId).order('id').range(from, to)),
    dossier.thread_id ? readAllPages((from, to) => supabase.from('emails').select('id,subject,created_at', { count: 'exact' })
      .eq('thread_ref', dossier.thread_id!).order('id').range(from, to)) : Promise.resolve([]),
  ]);
  const sources: CaseSource[] = [
    ...emails.map(row => ({ id: row.id, kind: 'email' as const, label: row.subject || 'Courriel sans objet', recordedAt: row.created_at })),
    ...documents.map(row => ({ id: row.id, kind: 'document' as const, label: row.file_name, recordedAt: row.created_at })),
  ];
  for (let offset = 0; offset < emails.length; offset += 100) {
    const ids = emails.slice(offset, offset + 100).map(row => row.id);
    const attachments = await readAllPages((from, to) => supabase.from('email_attachments')
      .select('id,filename,created_at', { count: 'exact' }).in('email_id', ids).order('id').range(from, to));
    sources.push(...attachments.map(row => ({ id: row.id, kind: 'attachment' as const, label: row.filename, recordedAt: row.created_at })));
  }
  return { sources, runs };
}

export function changesAfterRun(data: CaseSourceChanges, runId?: string | null) {
  const run = runId ? data.runs.find(row => row.id === runId) : undefined;
  const time = Date.parse(run?.created_at ?? '');
  const comparable = Number.isFinite(time);
  return {
    comparable,
    later: comparable ? data.sources.filter(source => Date.parse(source.recordedAt ?? '') > time) : [],
    undated: data.sources.filter(source => !Number.isFinite(Date.parse(source.recordedAt ?? ''))).length,
  };
}
