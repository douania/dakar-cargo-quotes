/** Candidate endpoint: method -> existing Auth/admission -> bounded JSON ->
 * server derivation -> ONE JWT RPC -> verified durable receipt. No business I/O
 * apart from the injected RPC. Does not log source, headers or upstream errors. */
import { corsHeaders, handleCors, jsonResponse } from '../_shared/cors.ts';
import { prepareManualIntake, createDurableIntake, ReplacementContractError, validateIntakeBatchCommand, MAX_MANUAL_BYTES } from './prepare.generated.js';
export interface ManualDependencies {
  authenticate(req: Request): Promise<{ token: string } | Response>;
  record(token: string, params: Record<string, unknown>): Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
}
const failure = (code: string, status: number, outcome: 'BLOCKED' | 'UNKNOWN' = 'BLOCKED') => jsonResponse({ ok: false, error: { code, outcome } }, status);
async function readBody(req: Request) {
  const reader = req.body?.getReader(); if (!reader) throw new ReplacementContractError('MANUAL_COMMAND_REQUIRED');
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > MAX_MANUAL_BYTES) { await reader.cancel(); throw new ReplacementContractError('MANUAL_PAYLOAD_LIMIT'); } chunks.push(value);
  } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ReplacementContractError('MANUAL_JSON_INVALID'); }
}
export function createManualIntakeHandler(deps: ManualDependencies) {
  return async (req: Request): Promise<Response> => {
    const cors = handleCors(req); if (cors) return cors;
    if (req.method !== 'POST') return new Response(JSON.stringify({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', outcome: 'BLOCKED' } }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json', Allow: 'POST' } });
    let auth;
    try { auth = await deps.authenticate(req); } catch { return failure('AUTH_UNAVAILABLE', 503); }
    if (auth instanceof Response) return failure(auth.status === 401 ? 'AUTH_REQUIRED' : auth.status === 403 ? 'WORKSPACE_ACCESS_DENIED' : 'AUTH_UNAVAILABLE', [401,403,503].includes(auth.status) ? auth.status : 503);
    if (req.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return failure('JSON_REQUIRED', 415);
    let prepared;
    try { prepared = prepareManualIntake(await readBody(req)); validateIntakeBatchCommand(prepared.batch); }
    catch (error) { return failure(error instanceof ReplacementContractError && error.code === 'MANUAL_PAYLOAD_LIMIT' ? 'PAYLOAD_LIMIT' : 'VALIDATION_FAILED', error instanceof ReplacementContractError && error.code === 'MANUAL_PAYLOAD_LIMIT' ? 413 : 400); }
    const rpcState: { error: { message?: string; code?: string } | null } = { error: null }; let rpcStarted = false;
    try {
      const result = await createDurableIntake({ record: async (params: Record<string, unknown>) => {
        rpcStarted = true; const response = await deps.record(auth.token, params); rpcState.error = response.error;
        if (rpcState.error) throw new Error('RPC_REFUSED'); return response.data;
      } }, prepared.request, prepared.batch);
      return jsonResponse({ ok: true, data: result });
    } catch {
      // Known SQL exceptions roll back the transaction. Never expose SQL messages.
      const message = rpcState.error?.message || '', code = rpcState.error?.code;
      if (code === '42501' && /^(DIS|SIFB)_AUTH_REQUIRED$/.test(message)) return failure('AUTH_REQUIRED', 403);
      if (code === '42501' && /^(DIS|SIFB)_CASE_ACCESS_DENIED$/.test(message)) return failure('CASE_ACCESS_DENIED', 403);
      if ((code === '23505' && /^(DIS|SIFB)_IDEMPOTENCY_CONFLICT$|^DIS_LEGACY_BATCH_COLLISION$/.test(message)) || (code === 'P0001' && message === 'PROTECTED_FACT_REQUIRES_OPERATOR')) return failure('INTAKE_CONFLICT', 409);
      if (code === 'PT409' && /^(Automatic source revision requires the ordered writer|Ordered source values require a successor|Ordered source fact requires an explicit or ordered successor)$/.test(message)) return failure('SOURCE_REVISION_CONFLICT', 409);
      if (code === '23505' && /^duplicate key value violates unique constraint "(case_documents_case_id_file_name_unique|uq_quote_facts_current_key|intake_fact_batches_case_id_batch_key_key)"$/.test(message)) return failure('INTAKE_CONFLICT', 409);
      if (code === '22023' && /^DIS_(SOURCE|CLASSIFICATION|BATCH|IDENTITY|IDENTITY_FIELD)_INVALID$/.test(message)) return failure('VALIDATION_FAILED', 400);
      if (code === '42883' && /^function public\.record_intake_snapshot\([^\r\n]*\) does not exist$/.test(message)) return failure('BASELINE_UNAVAILABLE', 503);
      // Lost transport or malformed receipt can follow a commit. Same key must be retained.
      return failure(rpcStarted ? 'RECEIPT_UNCONFIRMED' : 'VALIDATION_FAILED', rpcStarted ? 503 : 400, rpcStarted ? 'UNKNOWN' : 'BLOCKED');
    }
  };
}
