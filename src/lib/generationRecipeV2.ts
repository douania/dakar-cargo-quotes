export const IDEMPOTENT_RECIPE = 'no_files_idempotent_v2';
export const RECIPE_V2_MARKER = 'dcq:recipe-attempt:no_files_idempotent_v2';
export const LEGACY_RECIPE_MARKER = 'dcq:recipe-attempt:no_files_v1';
export const RECIPE_INSTRUCTIONS = 'Recette technique d’authentification uniquement. Brouillon interne sans envoi.';
export const recipeUUID = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
export interface RecipeTargetV2 { actorId: string; caseId: string; emailId: string; grantId: string }
export interface RecipeMarkerV2 extends RecipeTargetV2 { attemptId: string; attemptedAt: string }
export interface ClientRecipeReceipt extends RecipeTargetV2 {
  state: 'authorized' | 'running' | 'uncertain' | 'completed'; draftId: string | null;
  attemptId: string | null; engineVerified: boolean | null; revoked: boolean;
}
export function readRecipeMarker(raw: string): RecipeMarkerV2 {
  const m: unknown = JSON.parse(raw);
  if (!object(m) || Object.keys(m).sort().join() !== ['actorId', 'attemptId', 'attemptedAt', 'caseId', 'emailId', 'grantId'].sort().join() ||
      ![m.actorId, m.caseId, m.emailId, m.grantId, m.attemptId].every(recipeUUID) || typeof m.attemptedAt !== 'string' || !Number.isFinite(Date.parse(m.attemptedAt))) throw new Error('Suivi de tentative incomplet ; aucune nouvelle génération permise.');
  return m as unknown as RecipeMarkerV2;
}
export function readRecipeReceiptV2(envelope: unknown, target: RecipeTargetV2): ClientRecipeReceipt {
  const fail = (): never => { throw new Error('Le reçu serveur est incomplet ou ne correspond pas à cette cible.'); };
  if (!object(envelope) || envelope.ok !== true || !object(envelope.data)) return fail();
  const p = envelope.data, r = p.recipe_receipt;
  if (p.success !== true || p.recipe_mode !== IDEMPOTENT_RECIPE || p.zone_reply_contract !== 'optional_factor_v1' ||
      p.attachment_needed !== false || p.attachment_data !== null || p.generated_attachment !== null || !object(r) ||
      r.kind !== 'receipt' || r.grant_id !== target.grantId || r.actor_id !== target.actorId || r.case_id !== target.caseId || r.email_id !== target.emailId ||
      !['authorized', 'running', 'uncertain', 'completed'].includes(String(r.state)) || typeof r.revoked !== 'boolean' ||
      (r.state === 'authorized' ? r.attempt_id !== null : !recipeUUID(r.attempt_id))) return fail();
  if (r.state === 'completed') {
    const e = p.recipe_effects;
    if (!recipeUUID(r.draft_id) || typeof r.engine_verified !== 'boolean' || !object(e) || e.draft_persisted !== true ||
        e.application_ai_calls_occurred !== true || e.usage_counters_may_change !== true || e.attachment_analysis_performed !== false || e.files_created !== false || e.download_links_created !== false) return fail();
  } else if (r.draft_id !== null || r.engine_verified !== null) return fail();
  return { ...target, state: r.state as ClientRecipeReceipt['state'], draftId: r.draft_id as string | null,
    attemptId: r.attempt_id as string | null, engineVerified: r.engine_verified as boolean | null, revoked: r.revoked };
}
