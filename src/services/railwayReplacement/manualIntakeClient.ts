/** Inactive explicit transport. No import of the production Supabase client,
 * default URL, feature flag, retry, Railway fallback or client-side success. */
import { boundedJson, prepareManualIntake, newManualIntakeOperation, type ManualIntakeForm } from './manualIntakeCommand';
import { createDurableIntake } from './durableIntake';
export type ManualOutcome = 'BLOCKED' | 'UNKNOWN';
export class ManualIntakeSubmissionError extends Error {
  constructor(readonly code: string, readonly outcome: ManualOutcome) { super(`Saisie manuelle : ${code} (${outcome})`); }
}
export interface ManualTransport {
  auth: { getSession(): Promise<{ data: { session: { access_token: string } | null }; error?: unknown }> };
  functions: { invoke(name: string, options: { body: unknown; headers: Record<string, string> }): Promise<{ data: unknown; error: unknown }> };
}
/** Only an HTTP error with an actual Response can carry our structured refusal.
 * Fetch/relay exceptions, HTTP status alone and oversized/invalid JSON stay UNKNOWN. */
export async function httpRefusal(error: unknown): Promise<unknown> {
  if (!error || typeof error !== 'object' || !('name' in error) || error.name !== 'FunctionsHttpError' || !('context' in error) || !(error.context instanceof Response) || error.context.ok) return null;
  const response = error.context;
  if (response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return null;
  const reader = response.body?.getReader(); if (!reader) return null;
  let text = ''; const decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength;
    if (bytes > 4096) { void reader.cancel().catch(() => {}); return null; } text += decoder.decode(value, { stream: true });
  } text += decoder.decode(); return JSON.parse(text); } catch { return null; } finally { reader.releaseLock(); }
}
export function createManualIntakeSubmitter(transport: ManualTransport) {
  let busy = false;
  return async (operation: unknown) => {
    if (busy) throw new ManualIntakeSubmissionError('SUBMISSION_IN_PROGRESS', 'BLOCKED');
    busy = true;
    try {
      // Capture the submitted bytes before awaiting Auth; later edits cannot alter a pending command.
      const body = JSON.parse(boundedJson(operation)); const prepared = prepareManualIntake(body);
      let session;
      try { session = await transport.auth.getSession(); } catch { throw new ManualIntakeSubmissionError('SESSION_UNAVAILABLE', 'BLOCKED'); }
      if (session.error || !session.data.session?.access_token) throw new ManualIntakeSubmissionError('AUTH_REQUIRED', 'BLOCKED');
      let response;
      try { response = await transport.functions.invoke('manual-intake', { body, headers: { Authorization: `Bearer ${session.data.session.access_token}` } }); }
      catch { throw new ManualIntakeSubmissionError('RECEIPT_UNCONFIRMED', 'UNKNOWN'); }
      // Only a structured refusal produced by our handler proves no business write.
      // SDK transport errors alone can also mean a committed response was lost.
      const envelope = (response.data ?? await httpRefusal(response.error)) as { ok?: unknown; data?: unknown; error?: { code?: unknown; outcome?: unknown } } | null;
      if (envelope?.ok === false && envelope.error?.outcome === 'BLOCKED' && typeof envelope.error.code === 'string' && /^[A-Z_]{1,64}$/.test(envelope.error.code)) throw new ManualIntakeSubmissionError(envelope.error.code, 'BLOCKED');
      if (response.error || envelope?.ok !== true) throw new ManualIntakeSubmissionError('RECEIPT_UNCONFIRMED', 'UNKNOWN');
      try { return await createDurableIntake({ record: async () => envelope.data }, prepared.request, prepared.batch); }
      catch { throw new ManualIntakeSubmissionError('RECEIPT_INVALID', 'UNKNOWN'); }
    } finally { busy = false; }
  };
}

/** Explicit test/integration session. Pending source stays in memory only.
 * Unknown/conflict locks edits; identical explicit replay keeps the same UUID.
 * Reload recovery still needs an approved durable intent design before rollout. */
export function createManualFormSession(transport: ManualTransport, randomUUID: () => string) {
  const submit = createManualIntakeSubmitter(transport);
  let current: { json: string; operation: ReturnType<typeof newManualIntakeOperation> } | undefined;
  let unresolved = false;
  return {
    hasUnresolved: () => unresolved,
    startNew() {
      if (unresolved) throw new ManualIntakeSubmissionError('PREVIOUS_INTAKE_UNCONFIRMED', 'UNKNOWN');
      current = undefined;
    },
    async submit(form: ManualIntakeForm) {
      const json = boundedJson(form);
      if (current && current.json !== json && unresolved) throw new ManualIntakeSubmissionError('PREVIOUS_INTAKE_UNCONFIRMED', 'UNKNOWN');
      if (!current || current.json !== json) current = { json, operation: newManualIntakeOperation(form, randomUUID) };
      const wasUnresolved = unresolved;
      unresolved = true;
      try { const result = await submit(current.operation); unresolved = false; return result; }
      catch (error) {
        if (!wasUnresolved && error instanceof ManualIntakeSubmissionError && error.outcome === 'BLOCKED' && !['INTAKE_CONFLICT','SUBMISSION_IN_PROGRESS'].includes(error.code)) unresolved = false;
        throw error;
      }
    },
  };
}
export type ManualFormSession = ReturnType<typeof createManualFormSession>;
