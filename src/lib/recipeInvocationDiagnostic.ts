/** Read only the current SDK error response; never fetch, log or persist its payload. */
const CODES = new Set([
  'RECIPE_QUARANTINE_INVALID', 'RECIPE_PRIOR_EXECUTION_UNCONFIRMED', 'RECIPE_LEDGER_NOT_READY',
  'RECIPE_LEDGER_UNCONFIRMED', 'RECIPE_TARGET_UNRESOLVED', 'RECIPE_GRANT_CONFLICT',
  'RECIPE_GRANT_REVOKED', 'RECIPE_DRAFT_EXISTS', 'RECIPE_RECEIPT_NOT_FOUND',
  'RECIPE_ATTACHMENT_NOT_READY', 'RECIPE_ATTACHMENT_READ_FAILED', 'RECIPE_CASE_MISMATCH',
  'RECIPE_CASE_READ_FAILED', 'RECIPE_DISABLED', 'RECIPE_EMAIL_REQUIRED', 'RECIPE_LINK_OUTPUT_BLOCKED',
  'RECIPE_MODE_INVALID', 'RECIPE_MODE_REQUIRED', 'RECIPE_PAYLOAD_INVALID', 'RECIPE_POLICY_INVALID',
  'RECIPE_SCOPE_FORBIDDEN', 'RECIPE_WINDOW_CLOSED', 'ZONE_CONFIRMATION_REQUIRED',
  'ZONE_ENGINE_CONTRACT_NOT_READY', 'VALIDATION_FAILED', 'UNKNOWN',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export async function recipeInvocationDiagnostic(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!(context instanceof Response)) return 'Réponse serveur indisponible.';
  const status = context.status >= 400 && context.status <= 599 ? `HTTP ${context.status}.` : 'Statut serveur indisponible.';
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    reader = context.clone().body?.getReader();
    if (!reader) return status;
    const read = async (): Promise<unknown> => {
      const chunks: Uint8Array[] = []; let length = 0;
      for (;;) {
        const next = await reader!.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > 8192) return null;
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return JSON.parse(new TextDecoder().decode(bytes));
    };
    const body = await Promise.race([read(), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2000); })]);
    if (!record(body)) return status;
    const code = record(body.error) && typeof body.error.code === 'string' && CODES.has(body.error.code) ? ` Code ${body.error.code}.` : '';
    const reference = typeof body.correlation_id === 'string' && UUID.test(body.correlation_id) ? ` Référence ${body.correlation_id.toLowerCase()}.` : '';
    return status + code + reference;
  } catch { return status; }
  finally { clearTimeout(timer); void reader?.cancel().catch(() => undefined); }
}
