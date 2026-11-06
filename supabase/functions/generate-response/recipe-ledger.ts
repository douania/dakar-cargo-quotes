import { OPTIONAL_ZONE_REPLY_CONTRACT } from '../_shared/zone-reply-contract.ts';

export const IDEMPOTENT_RECIPE = 'no_files_idempotent_v2';
export const LEDGER_POLICY_ENV = 'GENERATE_RESPONSE_RECIPE_V2_POLICY';
export const LEDGER_READY_ENV = 'GENERATE_RESPONSE_RECIPE_V2_READY';
export const LEGACY_BLOCK_ENV = 'GENERATE_RESPONSE_RECIPE_BLOCKED_EMAILS';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): string | null => typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null;
export class RecipeLedgerError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); this.name = 'RecipeLedgerError'; }
}
function fail(code: string, status: number, message: string): never { throw new RecipeLedgerError(code, status, message); }
export interface RecipeTarget { grantId: string; actorId: string; caseId: string; emailId: string }
export interface RecipeRun extends RecipeTarget { action: 'run'; attemptId: string; startsAt: string; expiresAt: string }
export type LedgerRequest = RecipeRun | (RecipeTarget & { action: 'status' | 'revoke' });
export interface ActiveRecipe extends RecipeTarget { attemptId: string; fence: string }
export interface EmailLease { id: string; actorId: string; fence: string }
export interface RecipeReceipt {
  kind: 'receipt'; grant_id: string; actor_id: string; case_id: string; email_id: string;
  state: 'authorized' | 'running' | 'uncertain' | 'completed'; attempt_id: string | null;
  draft_id: string | null; engine_verified: boolean | null; revoked: boolean;
}
export interface LedgerDb {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
function instant(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const n = Date.parse(value); if (!Number.isFinite(n)) return null;
  return new Date(n).toISOString() === value.replace(/(?<!\.\d{3})Z$/, '.000Z') ? n : null;
}

/** Status/revocation do not require a policy or READY and never admit AI work. */
export function resolveLedgerRequest(body: Record<string, unknown>, actor: string, policyText: string | undefined, ready: string | undefined, blockedText: string | undefined, now = Date.now()): LedgerRequest | null {
  const mode = body.recipe_mode;
  if (mode === IDEMPOTENT_RECIPE && (Object.hasOwn(body, 'emailId') || Object.hasOwn(body, 'quotationData'))) fail('RECIPE_PAYLOAD_INVALID', 400, 'La recette interdit les sélecteurs de production.');
  let target: RecipeTarget | null = null;
  if (mode === IDEMPOTENT_RECIPE) {
    const grantId = uuid(body.recipe_grant_id), emailId = uuid(body.recipe_email_id), caseId = uuid(body.recipe_case_id), actorId = uuid(actor);
    if (!grantId || !emailId || !caseId || !actorId) fail('RECIPE_PAYLOAD_INVALID', 400, 'Les identifiants de recette sont incomplets.');
    target = { grantId, emailId, caseId, actorId };
    if (body.recipe_action === 'status' || body.recipe_action === 'revoke') return { ...target, action: body.recipe_action };
    if (body.recipe_action !== undefined && body.recipe_action !== 'run') fail('RECIPE_MODE_INVALID', 400, 'Action de recette non reconnue.');
  }
  let blocked: unknown;
  if (blockedText !== undefined) {
    try { blocked = JSON.parse(blockedText); } catch { blocked = null; }
    if (!Array.isArray(blocked) || blocked.length > 1000 || blocked.some(v => !uuid(v))) fail('RECIPE_QUARANTINE_INVALID', 503, 'La réserve des anciennes exécutions ne peut pas être vérifiée.');
    const selected = uuid(mode === undefined ? body.emailId : body.recipe_email_id);
    if (selected && blocked.some(v => uuid(v) === selected)) fail('RECIPE_PRIOR_EXECUTION_UNCONFIRMED', 409, 'Une ancienne exécution reste non confirmée pour ce courriel.');
  }
  let policy: Record<string, unknown> | null = null;
  if (policyText !== undefined) {
    let value: unknown; try { value = JSON.parse(policyText); } catch { value = null; }
    const keys = ['grant_id', 'actor_user_id', 'case_id', 'email_id', 'starts_at', 'expires_at'];
    if (!record(value) || Object.keys(value).length !== keys.length || !keys.every(k => Object.hasOwn(value, k)) ||
        !uuid(value.grant_id) || !uuid(value.actor_user_id) || !uuid(value.case_id) || !uuid(value.email_id)) fail('RECIPE_POLICY_INVALID', 503, 'Configuration de recette invalide.');
    const starts = instant(value.starts_at), expires = instant(value.expires_at);
    if (starts === null || expires === null || expires <= starts || expires - starts > 3_600_000) fail('RECIPE_POLICY_INVALID', 503, 'Fenêtre de recette invalide.');
    policy = value;
    // Reserve the email across all operators, including after policy expiry.
    const selected = uuid(mode === undefined ? body.emailId : body.recipe_email_id);
    if (mode !== IDEMPOTENT_RECIPE && selected === uuid(policy.email_id)) fail('RECIPE_MODE_REQUIRED', 409, 'Ce courriel est réservé à la recette avec reçu durable.');
  }
  if (mode !== IDEMPOTENT_RECIPE) return null;
  if (ready !== '1') fail('RECIPE_LEDGER_NOT_READY', 503, 'Le registre de recette n’est pas activé.');
  if (!policy) fail('RECIPE_DISABLED', 403, 'La recette serveur n’est pas activée.');
  if (!target || target.actorId !== uuid(policy.actor_user_id) || target.grantId !== uuid(policy.grant_id) || target.caseId !== uuid(policy.case_id) || target.emailId !== uuid(policy.email_id)) fail('RECIPE_SCOPE_FORBIDDEN', 403, 'Recette non autorisée pour cette cible.');
  const attemptId = uuid(body.recipe_attempt_id);
  if (!attemptId) fail('RECIPE_PAYLOAD_INVALID', 400, 'Une clé de tentative est requise.');
  if (now < instant(policy.starts_at)! || now >= instant(policy.expires_at)!) fail('RECIPE_WINDOW_CLOSED', 403, 'La fenêtre de recette est fermée.');
  if (body.zone_reply_contract !== OPTIONAL_ZONE_REPLY_CONTRACT) fail('RECIPE_PAYLOAD_INVALID', 400, 'Le contrat de zone de la recette est requis.');
  for (const [key, max] of [['customInstructions', 4000], ['expertStyle', 100]] as const) {
    if (body[key] !== undefined && (typeof body[key] !== 'string' || (body[key] as string).length > max)) fail('RECIPE_PAYLOAD_INVALID', 400, 'Consigne de recette invalide.');
  }
  return Object.freeze({ ...target, action: 'run', attemptId, startsAt: policy.starts_at as string, expiresAt: policy.expires_at as string });
}
export async function recipeIntentHash(context: RecipeTarget, body: Record<string, unknown>): Promise<string> {
  const intent = JSON.stringify({ mode: IDEMPOTENT_RECIPE, grant: context.grantId, actor: context.actorId, case: context.caseId, email: context.emailId,
    instructions: body.customInstructions ?? '', style: body.expertStyle ?? 'auto', language: body.reply_language_override ?? 'AUTO', zone: body.zone_reply_contract });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(intent));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}
async function rpc(db: LedgerDb, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await db.rpc(name, args);
  if (result.error || !record(result.data) || typeof result.data.kind !== 'string') {
    const code = record(result.error) ? result.error.code : null;
    if (code === '42501') fail('RECIPE_SCOPE_FORBIDDEN', 403, 'L’admission actuelle ne permet pas cette opération.');
    fail('RECIPE_LEDGER_UNCONFIRMED', 503, 'Le résultat du registre ne peut pas être confirmé. Vérifiez le reçu sans relancer.');
  }
  return result.data;
}
function requireKind(value: Record<string, unknown>, kinds: string[]): void {
  if (kinds.includes(String(value.kind))) return;
  const codes: Record<string, [string, number, string]> = {
    unresolved: ['RECIPE_TARGET_UNRESOLVED', 409, 'Une génération non confirmée réserve encore ce courriel.'],
    conflict: ['RECIPE_GRANT_CONFLICT', 409, 'L’autorisation appartient à une autre demande.'],
    revoked: ['RECIPE_GRANT_REVOKED', 403, 'L’autorisation de recette est fermée.'],
    forbidden: ['RECIPE_SCOPE_FORBIDDEN', 403, 'Cette opération n’est pas autorisée.'],
    window_closed: ['RECIPE_WINDOW_CLOSED', 403, 'La fenêtre de recette est fermée.'],
    draft_exists: ['RECIPE_DRAFT_EXISTS', 409, 'Un brouillon existe déjà pour ce courriel.'],
    not_found: ['RECIPE_RECEIPT_NOT_FOUND', 404, 'Aucun reçu correspondant n’est accessible.'],
  };
  const reason = codes[String(value.kind)] ?? ['RECIPE_LEDGER_UNCONFIRMED', 503, 'Le registre n’a pas confirmé cette opération.'];
  fail(reason[0], reason[1], reason[2]);
}
export async function registerRecipeGrant(db: LedgerDb, context: RecipeRun, body: Record<string, unknown>): Promise<string> {
  const hash = await recipeIntentHash(context, body);
  const result = await rpc(db, 'register_generation_recipe_grant', { p_grant: context.grantId, p_actor: context.actorId, p_case: context.caseId, p_email: context.emailId, p_hash: hash, p_starts: context.startsAt, p_expires: context.expiresAt });
  requireKind(result, ['registered']); return hash;
}
export async function claimRecipeAttempt(db: LedgerDb, active: ActiveRecipe, hash: string): Promise<'started' | 'replay'> {
  const result = await rpc(db, 'claim_generation_recipe_attempt', { p_grant: active.grantId, p_attempt: active.attemptId, p_actor: active.actorId, p_hash: hash, p_fence: active.fence });
  requireKind(result, ['started', 'replay']); return result.kind as 'started' | 'replay';
}
export async function readRecipeReceipt(db: LedgerDb, target: RecipeTarget): Promise<RecipeReceipt> {
  const r = await rpc(db, 'read_generation_recipe_receipt', { p_grant: target.grantId, p_actor: target.actorId, p_case: target.caseId, p_email: target.emailId });
  requireKind(r, ['receipt']);
  if (r.grant_id !== target.grantId || r.actor_id !== target.actorId || r.case_id !== target.caseId || r.email_id !== target.emailId ||
      !['authorized', 'running', 'uncertain', 'completed'].includes(String(r.state)) || typeof r.revoked !== 'boolean' ||
      (r.state === 'authorized' ? r.attempt_id !== null : !uuid(r.attempt_id)) ||
      (r.state === 'completed' ? !uuid(r.draft_id) || typeof r.engine_verified !== 'boolean' : r.draft_id !== null || r.engine_verified !== null)) {
    fail('RECIPE_LEDGER_UNCONFIRMED', 503, 'Le reçu de recette est incohérent.');
  }
  return { kind: 'receipt', grant_id: target.grantId, actor_id: target.actorId, case_id: target.caseId, email_id: target.emailId,
    state: r.state as RecipeReceipt['state'], attempt_id: r.attempt_id as string | null,
    draft_id: r.draft_id as string | null, engine_verified: r.engine_verified as boolean | null, revoked: r.revoked };
}
export async function revokeRecipeGrant(db: LedgerDb, target: RecipeTarget): Promise<RecipeReceipt> {
  const result = await rpc(db, 'revoke_generation_recipe_grant', { p_grant: target.grantId, p_actor: target.actorId, p_case: target.caseId, p_email: target.emailId });
  requireKind(result, ['revoked']); return await readRecipeReceipt(db, target);
}
export async function finishRecipeAttempt(db: LedgerDb, active: ActiveRecipe, subject: string, body: string, to: string, engineVerified: boolean): Promise<RecipeReceipt> {
  const result = await rpc(db, 'finish_generation_recipe_attempt', { p_attempt: active.attemptId, p_actor: active.actorId, p_fence: active.fence, p_subject: subject, p_body: body, p_to: to, p_engine_verified: engineVerified });
  requireKind(result, ['completed']); return await readRecipeReceipt(db, active);
}
export async function retainUncertainRecipe(db: LedgerDb, active: ActiveRecipe): Promise<void> {
  await rpc(db, 'mark_generation_recipe_uncertain', { p_attempt: active.attemptId, p_actor: active.actorId, p_fence: active.fence });
}
export async function beginEmailLease(db: LedgerDb, lease: EmailLease, email: string): Promise<void> {
  const result = await rpc(db, 'begin_generation_email_lease', { p_lease: lease.id, p_actor: lease.actorId, p_email: email, p_fence: lease.fence });
  requireKind(result, ['started']);
}
/** A structured PostgreSQL rejection of this single INSERT is an aborted statement,
 * unlike lost/malformed ACKs, transport errors, cancellations or generic failures.
 * Never infer rollback from a message or HTTP status alone. */
export function isDefiniteDraftInsertRejection(error: unknown): boolean {
  return record(error) && typeof error.code === 'string' &&
    ['42501', '23502', '23503', '23505', '23514', '22001', '22P02'].includes(error.code);
}
/** The persisted draft key is UUID; an arbitrary nonempty string is not an ACK. */
export function isConfirmedDraftId(value: unknown): value is string { return uuid(value) !== null; }
export async function finishEmailLease(db: LedgerDb, lease: EmailLease): Promise<void> {
  const result = await rpc(db, 'finish_generation_email_lease', { p_lease: lease.id, p_actor: lease.actorId, p_fence: lease.fence });
  requireKind(result, ['retained']);
}
export function recipeReceiptPayload(receipt: RecipeReceipt) {
  return { success: true, recipe_mode: IDEMPOTENT_RECIPE, recipe_receipt: receipt, zone_reply_contract: OPTIONAL_ZONE_REPLY_CONTRACT,
    ...(receipt.state === 'completed' ? { recipe_effects: { draft_persisted: true, application_ai_calls_occurred: true, usage_counters_may_change: true, attachment_analysis_performed: false, files_created: false, download_links_created: false } } : {}),
    attachment_needed: false, attachment_data: null, generated_attachment: null };
}
export function ledgerErrorResponse(error: RecipeLedgerError, correlationId: string, headers: HeadersInit): Response {
  return Response.json({ ok: false, error: { code: error.code, message: error.message, retryable: false }, correlation_id: correlationId }, { status: error.status, headers });
}
