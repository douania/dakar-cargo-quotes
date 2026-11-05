/** Server-owned, temporary restriction for an admitted caller. No access is granted here. */
export const NO_FILES_RECIPE = "no_files_v1";
export const RECIPE_POLICY_ENV = "GENERATE_RESPONSE_RECIPE_POLICY";
const MAX_WINDOW_MS = 60 * 60 * 1000;
export const MAX_RECIPE_ATTACHMENTS = 1000;
type ProductionContext = Readonly<{ mode: "production" }>;
export type NoFilesContext = Readonly<{ mode: typeof NO_FILES_RECIPE; actorId: string; emailId: string; caseId: string }>;
export type RecipeContext = ProductionContext | NoFilesContext;
export type RecipeRefusal = Readonly<{ allowed: false; status: 400 | 403 | 409 | 503; code: string; message: string }>;
type Admission = RecipeRefusal | Readonly<{ allowed: true; context: RecipeContext }>;
const production: Admission = Object.freeze({ allowed: true, context: Object.freeze({ mode: "production" }) });
const refuse = (status: RecipeRefusal["status"], code: string, message: string): RecipeRefusal => ({ allowed: false, status, code, message });
function uuid(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function instant(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const canonical = new Date(time).toISOString();
  return canonical === value || canonical === value.replace(/Z$/, ".000Z") ? time : null;
}

/** Decide once before any AI or mutation. Retain context even if the policy expires mid-request.
 * Removal of the policy explicitly returns a target to production; expiry alone never does.
 * A nonempty corrupt policy cannot safely identify its target and refuses all generation.
 */
export function resolveRecipeMode(body: Record<string, unknown>, userId: string, policyText: string | undefined, now = Date.now()): Admission {
  const requested = body.recipe_mode;
  if (requested !== undefined && requested !== NO_FILES_RECIPE) return refuse(400, "RECIPE_MODE_INVALID", "Mode de recette non reconnu.");
  if (Object.hasOwn(body, "recipe_email_id") && requested !== NO_FILES_RECIPE) return refuse(400, "RECIPE_MODE_INVALID", "Le courriel de recette exige son mode explicite.");
  // An old runtime cannot generate from this wire: it has neither legacy selector.
  if (requested === NO_FILES_RECIPE && (Object.hasOwn(body, "emailId") || Object.hasOwn(body, "quotationData"))) {
    return refuse(400, "RECIPE_PAYLOAD_INVALID", "La recette interdit les champs du parcours de production.");
  }
  if (policyText === undefined) return requested === undefined ? production : refuse(403, "RECIPE_DISABLED", "La recette serveur n'est pas activée.");
  let policy: unknown;
  try { policy = JSON.parse(policyText); } catch { policy = null; }
  const keys = ["actor_user_id", "email_id", "case_id", "starts_at", "expires_at"];
  if (!record(policy) || Object.keys(policy).length !== keys.length || !keys.every(key => Object.hasOwn(policy, key))) {
    return refuse(503, "RECIPE_POLICY_INVALID", "Configuration de recette invalide : génération suspendue.");
  }
  const actorId = uuid(policy.actor_user_id), emailId = uuid(policy.email_id), caseId = uuid(policy.case_id);
  const starts = instant(policy.starts_at), expires = instant(policy.expires_at);
  if (!actorId || !emailId || !caseId || starts === null || expires === null || expires <= starts || expires - starts > MAX_WINDOW_MS || !Number.isFinite(now)) {
    return refuse(503, "RECIPE_POLICY_INVALID", "Configuration de recette invalide : génération suspendue.");
  }
  if (uuid(userId) !== actorId) return requested === undefined ? production : refuse(403, "RECIPE_SCOPE_FORBIDDEN", "Recette non autorisée pour cette demande.");
  const requestedEmailId = uuid(requested === NO_FILES_RECIPE ? body.recipe_email_id : body.emailId);
  if (!requestedEmailId) {
    if (requested === undefined && body.emailId === undefined) return production;
    return refuse(400, "RECIPE_EMAIL_REQUIRED", "Un courriel identifié est requis pour cette recette.");
  }
  if (requestedEmailId !== emailId) return requested === undefined ? production : refuse(403, "RECIPE_SCOPE_FORBIDDEN", "Recette non autorisée pour cette demande.");
  if (now < starts || now >= expires) return refuse(403, "RECIPE_WINDOW_CLOSED", "La fenêtre de recette est fermée pour ce courriel.");
  if (requested === undefined) return refuse(409, "RECIPE_MODE_REQUIRED", "Ce courriel est réservé à la recette serveur : mode explicite requis.");
  return Object.freeze({ allowed: true, context: Object.freeze({ mode: NO_FILES_RECIPE, actorId, emailId, caseId }) });
}

export function recipeCaseReadRefusal(context: NoFilesContext, email: unknown, result: { data: unknown; error: unknown }): RecipeRefusal | null {
  if (result.error || !Array.isArray(result.data)) return refuse(503, "RECIPE_CASE_READ_FAILED", "Le rattachement de recette ne peut pas être vérifié.");
  if (!record(email) || uuid(email.id) !== context.emailId || !uuid(email.thread_ref) || result.data.length !== 1) {
    return refuse(403, "RECIPE_CASE_MISMATCH", "Le courriel ne correspond pas au dossier de recette.");
  }
  const linked = result.data[0];
  if (!record(linked) || uuid(linked.id) !== context.caseId || uuid(linked.thread_id) !== uuid(email.thread_ref)) {
    return refuse(403, "RECIPE_CASE_MISMATCH", "Le courriel ne correspond pas au dossier de recette.");
  }
  return null;
}

export function recipeAttachmentReadRefusal(context: NoFilesContext, result: { data: unknown; error: unknown; count?: number | null }): RecipeRefusal | null {
  if (result.error || !Array.isArray(result.data) || !Number.isSafeInteger(result.count) || result.count! < 0 || result.count! > MAX_RECIPE_ATTACHMENTS || result.data.length !== result.count) {
    return refuse(503, "RECIPE_ATTACHMENT_READ_FAILED", "La lecture complète des pièces de recette ne peut pas être attestée.");
  }
  const seen = new Set<string>();
  for (const attachment of result.data) {
    if (!record(attachment) || !uuid(attachment.id) || uuid(attachment.email_id) !== context.emailId || seen.has(uuid(attachment.id)!)) {
      return refuse(503, "RECIPE_ATTACHMENT_READ_FAILED", "La lecture complète des pièces de recette ne peut pas être attestée.");
    }
    seen.add(uuid(attachment.id)!);
    if (attachment.is_analyzed !== true) return refuse(409, "RECIPE_ATTACHMENT_NOT_READY", "Une pièce requiert une analyse : la recette est arrêtée avant toute modification.");
  }
  return null;
}

/** No URL is minted or fetched here. Extra fail-closed guard for AI-authored links in retained output.
 * Discarded attachment payloads cannot cause a refusal or leak back into the response.
 */
export function recipeGeneratedLinkRefusal(value: unknown): RecipeRefusal | null {
  const seen = new Set<object>();
  let nodes = 0;
  const hasLink = (item: unknown, depth: number, root = false): boolean => {
    if (++nodes > 10000 || depth > 64) return true;
    if (typeof item === "string") return /(?:https?|ftp|s3|file|data|javascript|blob|mailto):|www\.|\[[^\]]*\]\s*\(|\b(?:href|src)\s*=|<a(?:\s|>)/i.test(item);
    if (item === null || typeof item !== "object") return false;
    if (seen.has(item)) return true;
    seen.add(item);
    return Object.entries(item).some(([key, child]) => !(root && (key === "attachment_data" || key === "attachment_needed")) && hasLink(child, depth + 1));
  };
  return hasLink(value, 0, true) ? refuse(409, "RECIPE_LINK_OUTPUT_BLOCKED", "Le contenu IA propose un lien : aucun brouillon de recette n'est enregistré.") : null;
}

export function recipeRefusalResponse(reason: RecipeRefusal, correlationId: string, headers: HeadersInit): Response {
  return Response.json({ ok: false, error: { code: reason.code, message: reason.message, retryable: false }, correlation_id: correlationId }, { status: reason.status, headers });
}
