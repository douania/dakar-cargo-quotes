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
  revisions: FactRevision[];
}
export interface FactRevision {
  id: string; revisionId: string; key: string; status: string; reason: string;
  at: string | null; oldValue: unknown; newValue: unknown;
  emailId: string | null; excerpt: string | null; sentAt: string | null; manualExcerpt: string | null;
  proposals: Array<{value:unknown; emailId:string|null; excerpt:string|null}>;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function sourceRevisionHistory(rows: Array<{id:string; created_at:string|null; event_data:unknown}>): FactRevision[] {
  return rows.flatMap(row => {
    const d = record(row.event_data);
    if (d.source !== 'email-fact-revision') return [];
    if (typeof d.revision_id !== 'string' || typeof d.fact_key !== 'string' || typeof d.reason !== 'string' ||
      !['applied','confirmed','unchanged','ignored','conflict','protected','resolved'].includes(String(d.status))) {
      throw new Error('Historique des corrections incomplet');
    }
    const old = record(d.old_fact), evidence = record(d.source_evidence), selected = record(evidence.selected), manual = record(evidence.manual);
    const sources = Array.isArray(evidence.sources) ? evidence.sources.map(record) : [];
    const emailId = typeof selected.email_id === 'string' ? selected.email_id : null;
    const proposals = Array.isArray(evidence.candidates) ? evidence.candidates.map(record).map(c => ({value:c.value,
      emailId:typeof c.email_id === 'string' ? c.email_id : null, excerpt:typeof c.excerpt === 'string' ? c.excerpt : null})) : [];
    return [{id:row.id, revisionId:d.revision_id, key:d.fact_key, status:String(d.status), reason:d.reason, at:row.created_at,
      oldValue:old.value_text ?? old.value_number ?? old.value_json ?? old.value_date ?? null, newValue:d.new_value ?? null,
      emailId, proposals, manualExcerpt:typeof manual.excerpt === 'string' ? manual.excerpt : null, excerpt:typeof selected.excerpt === 'string' ? selected.excerpt : null,
      sentAt:typeof sources.find(s => s.id === emailId)?.sent_at === 'string' ? String(sources.find(s => s.id === emailId)!.sent_at) : null}];
  });
}
export function unresolvedSourceRevisions(revisions: FactRevision[]): FactRevision[] {
  const resolved = new Set(revisions.filter(r => r.status === 'resolved').map(r => r.revisionId));
  return revisions.filter(r => ['conflict','protected'].includes(r.status) && !resolved.has(r.revisionId));
}

/** Read metadata under the current user's RLS. No body, analysis or fact mutation.
 * created_at measures registration, not the sender's Date header. Historical
 * adoption and later edits have no general source manifest: coverage stays unknown.
 */
export async function readCaseSourceChanges(caseId: string): Promise<CaseSourceChanges> {
  const { data: dossier, error } = await supabase.from('quote_cases').select('id,thread_id').eq('id', caseId).single();
  if (error) throw error;
  if (!dossier) throw new Error('Dossier inaccessible');
  const [runs, documents, emails, events] = await Promise.all([
    readAllPages((from, to) => supabase.from('pricing_runs').select('id,created_at', { count: 'exact' })
      .eq('case_id', caseId).order('created_at', { ascending: false }).order('id').range(from, to)),
    readAllPages((from, to) => supabase.from('case_documents').select('id,file_name,created_at', { count: 'exact' })
      .eq('case_id', caseId).order('id').range(from, to)),
    dossier.thread_id ? readAllPages((from, to) => supabase.from('emails').select('id,subject,created_at', { count: 'exact' })
      .eq('thread_ref', dossier.thread_id!).order('id').range(from, to)) : Promise.resolve([]),
    readAllPages((from, to) => supabase.from('case_timeline_events').select('id,created_at,event_data', {count:'exact'})
      .eq('case_id',caseId).eq('event_type','fact_updated').order('created_at').order('id').range(from,to)),
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
  return { sources, runs, revisions: sourceRevisionHistory(events) };
}

export function changesAfterRun(data: CaseSourceChanges, runId?: string | null) {
  const run = runId ? data.runs.find(row => row.id === runId) : undefined;
  const time = Date.parse(run?.created_at ?? '');
  const comparable = Number.isFinite(time);
  return {
    comparable,
    later: comparable ? data.sources.filter(source => Date.parse(source.recordedAt ?? '') > time) : [],
    undated: data.sources.filter(source => !Number.isFinite(Date.parse(source.recordedAt ?? ''))).length,
    revisions: comparable ? data.revisions.filter(r => ['applied','confirmed'].includes(r.status) && Date.parse(r.at ?? '') > time) : [],
  };
}
