import { hasExtractedText } from './document-extraction.ts';

export const DOCUMENT_COVERAGE_GAP = 'documents.analysis_coverage';
export type DocumentAnalysisRequest = { mode: 'complete' | 'readable'; context_hash: string };
export type DocumentSource = { id: string; name: string; readable: boolean; text_hash: string; source_hash: string };
export type DocumentAnalysisInventory = {
  contract: 1; scope: 'manual_case_documents'; context_hash: string; documents: DocumentSource[];
  readable_email_count: number;
  latest: null | { id: string; mode: 'complete' | 'readable'; state: 'pending' | 'failed' | 'partial' | 'complete';
    context_hash: string; documents: DocumentSource[]; sources_changed: boolean; created_at: string; completed_at: string | null; actor_user_id: string };
};
type RpcResult = { data: unknown; error: { message?: string; code?: string } | null };
export type DocumentAnalysisClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult> };
const object = (x: unknown): Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
const hash = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{32}$/.test(x);
const textHash = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
export class DocumentAnalysisError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export function documentAnalysisRequest(value: unknown): DocumentAnalysisRequest | undefined {
  if (value === undefined) return undefined;
  const v = object(value);
  if (!['complete','readable'].includes(String(v.mode)) || !hash(v.context_hash) ||
      Object.keys(v).some(key => !['mode','context_hash'].includes(key))) {
    throw new DocumentAnalysisError('Le choix des sources doit être actualisé avant cette analyse.',400);
  }
  return {mode:v.mode as DocumentAnalysisRequest['mode'],context_hash:v.context_hash as string};
}
export function documentAnalysisInventory(value: unknown): DocumentAnalysisInventory {
  const v = object(value);
  const validDocs = (docs: unknown) => Array.isArray(docs) && docs.every(d => {
    const x = object(d);
    return typeof x.id === 'string' && typeof x.name === 'string' && typeof x.readable === 'boolean' && textHash(x.text_hash) && hash(x.source_hash);
  }) && new Set(docs.map(d => d.id)).size === docs.length;
  const latest = object(v.latest);
  if (v.contract !== 1 || v.scope !== 'manual_case_documents' || !hash(v.context_hash) || !validDocs(v.documents) ||
      !Number.isSafeInteger(v.readable_email_count) || Number(v.readable_email_count) < 0 ||
      (v.latest !== null && (typeof latest.id !== 'string' || !['complete','readable'].includes(String(latest.mode)) ||
       !['pending','failed','partial','complete'].includes(String(latest.state)) || !hash(latest.context_hash) ||
       typeof latest.sources_changed !== 'boolean' || !validDocs(latest.documents)))) {
    throw new DocumentAnalysisError('La couverture documentaire n’a pas pu être vérifiée.',503);
  }
  return v as DocumentAnalysisInventory;
}
export function readableSourceAvailable(inventory: DocumentAnalysisInventory): boolean {
  return inventory.readable_email_count > 0 || inventory.documents.some(d => d.readable);
}
export function completeAnalysisRequest(inventory: DocumentAnalysisInventory): DocumentAnalysisRequest | undefined {
  // Email attachment workflows without manually added documents retain their existing contract.
  return inventory.documents.length || inventory.latest ? { mode:'complete', context_hash:inventory.context_hash } : undefined;
}
async function rpc(client: DocumentAnalysisClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name,args);
  if (error) throw new DocumentAnalysisError(
    error.code === '42501' ? 'L’accès au dossier n’est plus autorisé.' :
      ['40001','PT409'].includes(error.code || '') ? (error.message || 'Les sources ont changé. Actualisez puis relancez l’analyse.') :
        'La couverture documentaire n’a pas pu être enregistrée. Aucun succès d’analyse confirmé.',
    error.code === '42501' ? 403 : ['40001','PT409'].includes(error.code || '') ? 409 : 503);
  return data;
}
export async function inspectDocumentAnalysis(client: DocumentAnalysisClient, actor: string, caseId: string) {
  return documentAnalysisInventory(await rpc(client,'case_document_analysis_inspect',{p_actor:actor,p_case:caseId}));
}
export async function beginDocumentAnalysis(client: DocumentAnalysisClient, actor: string, caseId: string, request: DocumentAnalysisRequest, jobId?: string) {
  const id = crypto.randomUUID();
  const result = object(await rpc(client,'case_document_analysis_begin',{
    p_actor:actor,p_case:caseId,p_id:id,p_hash:request.context_hash,p_mode:request.mode,p_job:jobId || null,
  }));
  if (result.id !== id || result.mode !== request.mode || result.context_hash !== request.context_hash) {
    throw new DocumentAnalysisError('Le démarrage de l’analyse documentaire n’a pas pu être confirmé.',503);
  }
  return { id, request, sources:result };
}
export async function assertLoadedDocumentSources(sources:Record<string,unknown>, documents:Array<Record<string,unknown>>, emails:Array<Record<string,unknown>>) {
  const digest = async (text:unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof text === 'string' ? text : '<NULL>')))]
    .map(x=>x.toString(16).padStart(2,'0')).join('');
  const expectedDocs = Array.isArray(sources.documents) ? sources.documents.map(object).filter(d=>d.readable === true) : [];
  const usedDocs = readableCaseDocuments(documents);
  const expectedEmails = Array.isArray(sources.emails) ? sources.emails.map(object) : [];
  if (expectedDocs.length !== usedDocs.length || expectedEmails.length !== emails.length) {
    throw new DocumentAnalysisError('Les sources chargées ne correspondent pas à l’inventaire. Actualisez puis relancez.',409);
  }
  for (const doc of usedDocs) {
    const expected = expectedDocs.find(d=>d.id === doc.id);
    if (!expected || expected.name !== doc.file_name || expected.document_type !== doc.document_type || expected.text_hash !== await digest(doc.extracted_text)) {
      throw new DocumentAnalysisError('Le texte documentaire a changé avant l’analyse. Actualisez puis relancez.',409);
    }
  }
  for (const email of emails) {
    const expected = expectedEmails.find(e=>e.id === email.id);
    if (!expected || expected.text_hash !== await digest(email.body_text) ||
        ['from_address','to_addresses','subject','sent_at','is_quotation_request'].some(key=>JSON.stringify(expected[key]) !== JSON.stringify(email[key]))) {
      throw new DocumentAnalysisError('Un courriel a changé avant l’analyse. Actualisez puis relancez.',409);
    }
  }
}
export async function finishDocumentAnalysis(client: DocumentAnalysisClient, actor: string, caseId: string, id: string,
  patch: Record<string, unknown>, result: Record<string, unknown>) {
  const saved = object(await rpc(client,'case_document_analysis_finish',{p_actor:actor,p_case:caseId,p_id:id,p_patch:patch,p_result:result}));
  const coverage = object(saved.document_analysis);
  if (saved.case_id !== caseId || coverage.id !== id || !['complete','partial'].includes(String(coverage.state)) ||
      (coverage.state === 'partial' && saved.ready_to_price !== false)) {
    throw new DocumentAnalysisError('La fin de l’analyse documentaire n’a pas pu être confirmée.',503);
  }
  return saved;
}
export async function failDocumentAnalysis(client: DocumentAnalysisClient, actor: string, caseId: string, id: string) {
  await rpc(client,'case_document_analysis_fail',{p_actor:actor,p_case:caseId,p_id:id});
}
export async function documentAnalysisJob(client: DocumentAnalysisClient, actor: string, jobId: string) {
  const value = object(await rpc(client,'case_document_analysis_job',{p_actor:actor,p_job:jobId}));
  if (typeof value.managed !== 'boolean' || typeof value.pending !== 'boolean' ||
      ![null,'complete','partial','failed'].includes(value.outcome as string|null)) {
    throw new DocumentAnalysisError('L’état documentaire de cette analyse n’a pas pu être confirmé.',503);
  }
  return value as {managed:boolean;pending:boolean;outcome:'complete'|'partial'|'failed'|null;result:Record<string,unknown>|null};
}
export function readableCaseDocuments<T extends { extracted_text?: unknown }>(documents: T[]): T[] {
  return documents.filter(d => hasExtractedText(d.extracted_text));
}
