import { EXTRACTION_CONTRACT, extractionMessage, hasExtractedText, type ExtractionCode } from '../../supabase/functions/_shared/document-extraction';
import { documentAnalysisInventory, documentAnalysisRequest, type DocumentAnalysisInventory, type DocumentAnalysisRequest } from '../../supabase/functions/_shared/case-document-analysis';
export { hasExtractedText };
export class CaseDocumentPreparationError extends Error {
  constructor(message: string, public offer?: DocumentAnalysisInventory, public code?:ExtractionCode) { super(message); }
}
type Result = {data: unknown; error: unknown};
type Invoke = (name: string, options: {body: Record<string, unknown>}) => PromiseLike<Result>;
const codes: ExtractionCode[] = ['OCR_NOT_CONFIGURED','OCR_PROVIDER_FAILED','DOCUMENT_TEXT_EMPTY','DOCUMENT_FORMAT_UNSUPPORTED','DOCUMENT_READ_FAILED','DOCUMENT_WRITE_FAILED','DOCUMENT_CHANGED','EXTRACTION_UNAVAILABLE'];
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
export async function readCaseDocumentInventory(invoke:Invoke,caseId:string) {
  // Older deployments ignore mode. This impossible UUID makes them refuse before extraction.
  const {data,error}=await invoke('backfill-case-documents',{body:{case_id:caseId,mode:'inspect',document_id:'__inspect_only_no_extraction__'}});
  if(error || record(data).success !== true) throw new Error('La couverture documentaire n’a pas pu être vérifiée.');
  return documentAnalysisInventory(record(data).document_analysis_inventory);
}
export async function caseDocumentAnalysisOffer(error:unknown,invoke:Invoke,caseId:string) {
  if(!(error instanceof CaseDocumentPreparationError) ||
      !['OCR_NOT_CONFIGURED','OCR_PROVIDER_FAILED','DOCUMENT_TEXT_EMPTY','DOCUMENT_FORMAT_UNSUPPORTED'].includes(error.code||'')) return null;
  return error.offer || await readCaseDocumentInventory(invoke,caseId);
}
export function confirmedDocumentAnalysis(result: unknown, request?: DocumentAnalysisRequest): boolean {
  if (!request) return false;
  const data=record(result),coverage=record(data.document_analysis);
  if (coverage.context_hash !== request.context_hash || coverage.mode !== request.mode ||
      coverage.state !== (request.mode === 'readable' ? 'partial' : 'complete') ||
      (coverage.state === 'partial' && data.ready_to_price !== false)) {
    throw new Error('Le résultat documentaire de cette analyse n’a pas pu être confirmé.');
  }
  return coverage.state === 'partial';
}
export async function extractionPayload(data: unknown, error?: unknown) {
  const context = record(error).context;
  const body = record(context instanceof Response ? await context.clone().json().catch(() => null) : data);
  const extraction = record(body.extraction);
  const code = codes.find(code => code === extraction.code);
  if (error || body.success !== true || body.extraction_contract !== EXTRACTION_CONTRACT ||
      extraction.status !== 'extracted' || extraction.persisted !== true ||
      typeof extraction.text_length !== 'number' || !Number.isInteger(extraction.text_length) || extraction.text_length <= 0) {
    const canOffer = ['OCR_NOT_CONFIGURED','OCR_PROVIDER_FAILED','DOCUMENT_TEXT_EMPTY','DOCUMENT_FORMAT_UNSUPPORTED'].includes(code || '');
    let offer: DocumentAnalysisInventory | undefined;
    if (canOffer && body.analysis_offer) offer = documentAnalysisInventory(body.analysis_offer);
    throw new CaseDocumentPreparationError(extractionMessage(code ?? 'EXTRACTION_UNAVAILABLE'),offer,code);
  }
  return body;
}
/** Both normal and forced analysis use this bounded, fail-closed preparation. */
export async function prepareCaseDocuments(invoke: Invoke, caseId: string) {
  for (let pass = 0; pass < 5; pass++) {
    const result = await invoke('backfill-case-documents',{body:{case_id:caseId,analysis_contract:1}});
    const data = record(result.data), error = result.error;
    if (error || data.success !== true || data.status !== 'ok' || data.extraction_contract !== EXTRACTION_CONTRACT ||
        typeof data.remaining !== 'number' || !Number.isInteger(data.remaining) || data.remaining < 0 ||
        (data.processed_id && (typeof data.text_length !== 'number' || !Number.isInteger(data.text_length) || data.text_length <= 0))) {
      if (record(error).context instanceof Response || record(data.extraction).code) await extractionPayload(data,error);
      throw new Error(extractionMessage('EXTRACTION_UNAVAILABLE'));
    }
    if (data.remaining === 0) return documentAnalysisRequest(data.document_analysis);
  }
  throw new Error("Des documents restent à préparer. Les fichiers sont conservés ; relancez l'analyse pour poursuivre l'extraction avant toute analyse du dossier.");
}
