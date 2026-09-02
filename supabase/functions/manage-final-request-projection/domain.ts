/**
 * P1-C3-B — contrat pur de l'orchestrateur `final-request-projection`.
 *
 * L'artefact de projection est une PREUVE destinée à P1-C3-C, rien d'autre.
 * Ce module ne le calcule pas : il ne fait que valider une commande, la
 * transmettre à `frp_mutate`/`frp_read` et refuser toute réponse qui sortirait
 * du contrat. La dérivation vit dans PostgreSQL, sous le même verrou par
 * dossier que P1-C2, parce que c'est le seul endroit où l'inventaire courant,
 * la tête, la révision, la revue active et les empreintes sont cohérents dans
 * une seule transaction.
 *
 * Ce que le navigateur ne fournit JAMAIS :
 *   - l'acteur (dérivé du JWT vérifié par l'Edge) ;
 *   - un champ, une valeur, un extrait, une source, un `sentAt` : la preuve est
 *     dérivée des tables P1-C2 persistées, jamais d'un corps HTTP ;
 *   - une empreinte PostgreSQL (`frs_hash` n'est pas reproductible ici) ;
 *   - une autorisation : `pricingAuthorized` est un littéral `false` imposé au
 *     retour, et toute réponse qui prétendrait autre chose est rejetée.
 *
 * Vocabulaire de promotion INTERDIT de bout en bout : ni `targetFactKey`, ni
 * `target_fact_key`, ni `factKey`, ni `readyToPrice`, ni `pricingAllowed`, en
 * entrée comme en sortie. La correspondance vers `quote_facts` est le chantier
 * P1-C3-C ; la pré-décider ici la rendrait irréversible.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_GENERATION = 9_007_199_254_740_991;
const MAX_RESPONSE_DEPTH = 12;

type JsonRecord = Record<string, unknown>;

export type ProjectionOperation = "read" | "project" | "revoke";

export type OrchestratorErrorCode =
  | "VALIDATION_FAILED"
  | "FORBIDDEN_OWNER"
  | "CONFLICT_INVALID_STATE"
  | "UPSTREAM_DB_ERROR";

/**
 * Clés que le serveur seul peut produire. Leur simple présence dans le corps
 * reçu est un refus : mieux vaut une commande rejetée qu'une preuve dont on ne
 * saurait plus dire si elle vient du dossier ou du navigateur.
 */
const SERVER_ONLY_KEYS = [
  "actor",
  "actor_id",
  "artifact",
  "artifact_hash",
  "evidence",
  "fields",
  "field",
  "value",
  "excerpt",
  "source_id",
  "sent_at",
  "assertion_id",
  "result",
  "result_hash",
  "input_hash",
  "inventory",
  "inventory_hash",
  "resolver_version",
  "review_event_id",
  "state",
  "version",
  "pricingAuthorized",
  "pricing_authorized",
] as const;

/**
 * Vocabulaire de promotion, refusé en entrée comme en sortie. La comparaison
 * ignore casse et `_` pour qu'aucune variante d'écriture ne passe.
 */
const PROMOTION_KEYS = new Set([
  "targetfactkey",
  "factkey",
  "readytoprice",
  "pricingallowed",
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().split("_").join("");
}

interface BaseRequest {
  operation: ProjectionOperation;
  caseId: string;
}

interface MutationBase extends BaseRequest {
  idempotencyKey: string;
  /** CAS sur la pointe de chaîne d'artefacts (null = aucune projection). */
  expectedProjectionId: string | null;
  reason: string;
}

export type ProjectionCommand =
  | (BaseRequest & { operation: "read" })
  | (MutationBase & {
    operation: "project";
    /** CAS sur la tête P1-C2 ; jamais incrémentée par ce chantier. */
    expectedRevisionId: string;
    expectedGeneration: number;
  })
  | (MutationBase & { operation: "revoke" });

export interface ProjectionDeps {
  read(actorId: string, caseId: string): Promise<unknown>;
  mutate(args: {
    actorId: string;
    caseId: string;
    key: string;
    action: "project" | "revoke";
    expectedProjectionId: string | null;
    expectedRevisionId: string | null;
    expectedGeneration: number | null;
    payload: JsonRecord;
  }): Promise<unknown>;
}

export class OrchestratorError extends Error {
  readonly code: OrchestratorErrorCode;

  constructor(code: OrchestratorErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function exact(
  raw: JsonRecord,
  required: string[],
  optional: string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(raw, key)) &&
    Object.keys(raw).every((key) => allowed.has(key));
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function nullableUuid(value: unknown): value is string | null {
  return value === null || uuid(value);
}

function boundedText(
  value: unknown,
  min: number,
  max: number,
): value is string {
  return typeof value === "string" && value === value.trim() &&
    value.length >= min && value.length <= max &&
    ![...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
}

/** Refus récursif du vocabulaire de promotion, à n'importe quelle profondeur. */
function containsPromotionKey(value: unknown, depth = 0): boolean {
  if (depth > MAX_RESPONSE_DEPTH) return true;
  if (Array.isArray(value)) {
    return value.some((item) => containsPromotionKey(item, depth + 1));
  }
  const raw = record(value);
  if (!raw) return false;
  return Object.keys(raw).some((key) =>
    PROMOTION_KEYS.has(normalizeKey(key)) ||
    containsPromotionKey(raw[key], depth + 1)
  );
}

export function validateProjectionCommand(
  rawValue: unknown,
): ProjectionCommand {
  const raw = record(rawValue);
  if (!raw || typeof raw.operation !== "string") {
    throw new OrchestratorError("VALIDATION_FAILED", "Corps JSON invalide");
  }
  if (SERVER_ONLY_KEYS.some((key) => key in raw)) {
    throw new OrchestratorError(
      "VALIDATION_FAILED",
      "Champ réservé au serveur",
    );
  }
  if (containsPromotionKey(raw)) {
    throw new OrchestratorError(
      "VALIDATION_FAILED",
      "Vocabulaire de promotion refusé",
    );
  }

  if (raw.operation === "read") {
    if (!exact(raw, ["operation", "case_id"]) || !uuid(raw.case_id)) {
      throw new OrchestratorError("VALIDATION_FAILED", "Lecture invalide");
    }
    return { operation: "read", caseId: raw.case_id };
  }

  const common = [
    "operation",
    "case_id",
    "idempotency_key",
    "expected_projection_id",
    "reason",
  ];
  if (
    !uuid(raw.case_id) || !boundedText(raw.idempotency_key, 8, 128) ||
    !nullableUuid(raw.expected_projection_id) ||
    !boundedText(raw.reason, 3, 1000)
  ) {
    throw new OrchestratorError(
      "VALIDATION_FAILED",
      "Commande ou CAS invalide",
    );
  }
  const base: MutationBase = {
    operation: raw.operation as ProjectionOperation,
    caseId: raw.case_id,
    idempotencyKey: raw.idempotency_key,
    expectedProjectionId: raw.expected_projection_id,
    reason: raw.reason,
  };

  if (raw.operation === "project") {
    if (
      !exact(raw, [...common, "expected_revision_id", "expected_generation"]) ||
      !uuid(raw.expected_revision_id) ||
      !Number.isSafeInteger(raw.expected_generation) ||
      (raw.expected_generation as number) < 1 ||
      (raw.expected_generation as number) > MAX_GENERATION
    ) {
      throw new OrchestratorError("VALIDATION_FAILED", "Projection invalide");
    }
    return {
      ...base,
      operation: "project",
      expectedRevisionId: raw.expected_revision_id,
      expectedGeneration: raw.expected_generation as number,
    };
  }

  if (raw.operation === "revoke") {
    // La révocation ne porte AUCUN CAS de tête P1-C2 : une preuve doit rester
    // révocable même après que le dossier a avancé. Accepter ces champs ici
    // laisserait croire l'inverse.
    if (!exact(raw, common)) {
      throw new OrchestratorError("VALIDATION_FAILED", "Révocation invalide");
    }
    if (base.expectedProjectionId === null) {
      throw new OrchestratorError(
        "VALIDATION_FAILED",
        "Aucune projection à révoquer",
      );
    }
    return { ...base, operation: "revoke" };
  }

  throw new OrchestratorError("VALIDATION_FAILED", "Opération inconnue");
}

/**
 * Une réponse serveur n'est acceptée que si elle porte explicitement
 * `pricingAuthorized: false` et aucun vocabulaire de promotion. On ne
 * « corrige » pas une réponse douteuse : on la refuse.
 */
function projectionResult(value: unknown): JsonRecord {
  const raw = record(value);
  if (!raw || raw.pricingAuthorized !== false || containsPromotionKey(raw)) {
    throw new OrchestratorError(
      "UPSTREAM_DB_ERROR",
      "Réponse serveur invalide",
    );
  }
  return { ...raw, pricingAuthorized: false };
}

export async function executeProjectionCommand(
  command: ProjectionCommand,
  actorId: string,
  deps: ProjectionDeps,
): Promise<JsonRecord> {
  if (!uuid(actorId)) {
    throw new OrchestratorError("FORBIDDEN_OWNER", "Identité invalide");
  }
  if (command.operation === "read") {
    return projectionResult(await deps.read(actorId, command.caseId));
  }
  const base = {
    actorId,
    caseId: command.caseId,
    key: command.idempotencyKey,
    expectedProjectionId: command.expectedProjectionId,
    payload: { reason: command.reason } as JsonRecord,
  };
  if (command.operation === "project") {
    return projectionResult(
      await deps.mutate({
        ...base,
        action: "project",
        expectedRevisionId: command.expectedRevisionId,
        expectedGeneration: command.expectedGeneration,
      }),
    );
  }
  return projectionResult(
    await deps.mutate({
      ...base,
      action: "revoke",
      expectedRevisionId: null,
      expectedGeneration: null,
    }),
  );
}

export function mapProjectionRpcError(message: string): OrchestratorError {
  if (/FRP_REVIEWER_REQUIRED|FRP_ACTOR_REQUIRED/.test(message)) {
    return new OrchestratorError(
      "FORBIDDEN_OWNER",
      "Habilitation de revue requise",
    );
  }
  if (
    /FRP_STALE|FRP_UPSTREAM_CHANGED|FRP_IDEMPOTENCY_CONFLICT|FRP_ALREADY_PROJECTED/
      .test(message)
  ) {
    return new OrchestratorError(
      "CONFLICT_INVALID_STATE",
      "La demande a changé ; rechargez-la",
    );
  }
  if (/FRP_[A-Z_]+/.test(message)) {
    return new OrchestratorError(
      "VALIDATION_FAILED",
      "Projection refusée par le contrat",
    );
  }
  return new OrchestratorError(
    "UPSTREAM_DB_ERROR",
    "Service de projection indisponible",
  );
}
