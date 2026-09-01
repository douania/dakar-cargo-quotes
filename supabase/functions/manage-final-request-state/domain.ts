/**
 * P1-C2-B — contrat pur de l'orchestrateur final-request-state.
 *
 * L'identité est un argument de confiance injecté par l'Edge après requireUser.
 * Le navigateur ne fournit jamais acteur, empreinte PostgreSQL, résultat C1,
 * version du résolveur, inventaire ou autorisation de pricing.
 */
import {
  resolvePersistedFinalRequestCapture,
  type ReviewTarget,
} from "../_shared/final-request-state-persistence.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;
const MAX_GENERATION = 9_007_199_254_740_990;

type JsonRecord = Record<string, unknown>;
export type FinalRequestOperation =
  | "read"
  | "capture"
  | "attest_source"
  | "commit"
  | "review";
export type OrchestratorErrorCode =
  | "VALIDATION_FAILED"
  | "FORBIDDEN_OWNER"
  | "CONFLICT_INVALID_STATE"
  | "UPSTREAM_DB_ERROR";

interface BaseRequest {
  operation: FinalRequestOperation;
  caseId: string;
}
interface MutationBase extends BaseRequest {
  idempotencyKey: string;
  expectedRevisionId: string | null;
  expectedGeneration: number;
}
export type FinalRequestCommand =
  | (BaseRequest & { operation: "read"; revisionId: string | null })
  | (MutationBase & { operation: "capture" })
  | (MutationBase & {
    operation: "attest_source";
    originKind: "email" | "attachment" | "document";
    originId: string;
    authorRole: "client" | "operator" | "partner" | "unknown";
    contentClass: "current" | "quoted" | "historical" | "hypothesis";
    sentAt?: string | null;
    reason: string;
  })
  | (MutationBase & {
    operation: "commit";
    captureId: string;
    assertions: unknown[];
  })
  | (MutationBase & {
    operation: "review";
    decision:
      | "confirm_instruction"
      | "keep_protected_fact"
      | "request_clarification"
      | "revoke_decision"
      | "review_capture";
    targetId: string;
    candidateRef: string | null;
    previousEventId: string | null;
    reason: string;
  });

export interface FinalRequestDeps {
  read(
    actorId: string,
    caseId: string,
    revisionId: string | null,
  ): Promise<unknown>;
  mutate(args: {
    actorId: string;
    caseId: string;
    key: string;
    action: "capture" | "attest_source" | "commit" | "review";
    expectedRevisionId: string | null;
    expectedGeneration: number;
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
// frs_read's plpgsql %ROWTYPE locals (`h`, `r`) stay non-null after a
// no-match SELECT INTO; to_jsonb() then serializes them as an object whose
// every column is null instead of a JSON null. Collapse that empty
// PostgreSQL composite back to null so "no head yet" / "no revision yet"
// reach the frontend (and expected_generation/expected_revision_id) as null
// heads, not as a truthy fake head/revision.
function normalizedComposite(value: unknown): JsonRecord | null {
  const raw = record(value);
  if (!raw) return null;
  const keys = Object.keys(raw);
  return keys.length > 0 && keys.every((key) => raw[key] === null)
    ? null
    : raw;
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
    value.length >= min &&
    value.length <= max &&
    ![...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
}
function mutationBase(raw: JsonRecord): MutationBase | null {
  if (
    !uuid(raw.case_id) || !boundedText(raw.idempotency_key, 8, 128) ||
    !nullableUuid(raw.expected_revision_id) ||
    !Number.isSafeInteger(raw.expected_generation) ||
    (raw.expected_generation as number) < 0 ||
    (raw.expected_generation as number) > MAX_GENERATION
  ) return null;
  return {
    operation: raw.operation as FinalRequestOperation,
    caseId: raw.case_id,
    idempotencyKey: raw.idempotency_key,
    expectedRevisionId: raw.expected_revision_id,
    expectedGeneration: raw.expected_generation as number,
  } as MutationBase;
}

export function validateFinalRequestCommand(
  rawValue: unknown,
): FinalRequestCommand {
  const raw = record(rawValue);
  if (!raw || typeof raw.operation !== "string") {
    throw new OrchestratorError("VALIDATION_FAILED", "Corps JSON invalide");
  }
  if (
    [
      "actor",
      "actor_id",
      "result",
      "resolverVersion",
      "resolver_version",
      "inventory",
      "sourceHash",
      "source_hash",
      "expectedSourceHash",
      "pricingAuthorized",
    ].some((k) => k in raw)
  ) {
    throw new OrchestratorError(
      "VALIDATION_FAILED",
      "Champ réservé au serveur",
    );
  }
  if (raw.operation === "read") {
    if (
      !exact(raw, ["operation", "case_id"], ["revision_id"]) ||
      !uuid(raw.case_id) ||
      !(raw.revision_id === undefined || nullableUuid(raw.revision_id))
    ) {
      throw new OrchestratorError("VALIDATION_FAILED", "Lecture invalide");
    }
    return {
      operation: "read",
      caseId: raw.case_id,
      revisionId: raw.revision_id as string ?? null,
    };
  }
  const common = [
    "operation",
    "case_id",
    "idempotency_key",
    "expected_revision_id",
    "expected_generation",
  ];
  const base = mutationBase(raw);
  if (!base) {
    throw new OrchestratorError(
      "VALIDATION_FAILED",
      "Commande ou CAS invalide",
    );
  }
  if (raw.operation === "capture") {
    if (!exact(raw, common)) {
      throw new OrchestratorError("VALIDATION_FAILED", "Capture invalide");
    }
    return { ...base, operation: "capture" };
  }
  if (raw.operation === "attest_source") {
    const fields = [
      "origin_kind",
      "origin_id",
      "author_role",
      "content_class",
      "reason",
    ];
    if (
      !exact(raw, [...common, ...fields], ["sent_at"]) ||
      !["email", "attachment", "document"].includes(String(raw.origin_kind)) ||
      !uuid(raw.origin_id) ||
      !["client", "operator", "partner", "unknown"].includes(
        String(raw.author_role),
      ) ||
      !["current", "quoted", "historical", "hypothesis"].includes(
        String(raw.content_class),
      ) ||
      !boundedText(raw.reason, 3, 1000) ||
      !(raw.sent_at === undefined || raw.sent_at === null ||
        boundedText(raw.sent_at, 20, 40))
    ) {
      throw new OrchestratorError("VALIDATION_FAILED", "Attestation invalide");
    }
    return {
      ...base,
      operation: "attest_source",
      originKind: raw.origin_kind as "email",
      originId: raw.origin_id,
      authorRole: raw.author_role as "client",
      contentClass: raw.content_class as "current",
      reason: raw.reason,
      ...(raw.sent_at !== undefined
        ? { sentAt: raw.sent_at as string | null }
        : {}),
    };
  }
  if (raw.operation === "commit") {
    if (
      !exact(raw, [...common, "capture_id", "assertions"]) ||
      !uuid(raw.capture_id) ||
      !Array.isArray(raw.assertions) || raw.assertions.length > 3000
    ) {
      throw new OrchestratorError(
        "VALIDATION_FAILED",
        "Calcul à enregistrer invalide",
      );
    }
    return {
      ...base,
      operation: "commit",
      captureId: raw.capture_id,
      assertions: raw.assertions,
    };
  }
  if (raw.operation === "review") {
    const decisions = [
      "confirm_instruction",
      "keep_protected_fact",
      "request_clarification",
      "revoke_decision",
      "review_capture",
    ] as const;
    if (
      !exact(raw, [
        ...common,
        "decision",
        "target_id",
        "candidate_ref",
        "previous_event_id",
        "reason",
      ]) ||
      !decisions.includes(raw.decision as typeof decisions[number]) ||
      !boundedText(raw.target_id, 3, 500) ||
      !(raw.candidate_ref === null || boundedText(raw.candidate_ref, 1, 300)) ||
      !nullableUuid(raw.previous_event_id) || !boundedText(raw.reason, 3, 1000)
    ) {
      throw new OrchestratorError(
        "VALIDATION_FAILED",
        "Décision de revue invalide",
      );
    }
    return {
      ...base,
      operation: "review",
      decision: raw.decision as typeof decisions[number],
      targetId: raw.target_id,
      candidateRef: raw.candidate_ref as string | null,
      previousEventId: raw.previous_event_id as string | null,
      reason: raw.reason,
    };
  }
  throw new OrchestratorError("VALIDATION_FAILED", "Opération inconnue");
}

function withoutAttestationHashes(value: unknown): unknown {
  const raw = record(value);
  if (!raw) return value;
  const capture = record(raw.capture);
  const sanitizedCapture = capture
    ? Object.fromEntries(
      Object.entries(capture).filter(([key]) => key !== "inventoryHash"),
    )
    : raw.capture;
  const sanitizedRefs = Array.isArray(raw.sourceAttestationRefs)
    ? raw.sourceAttestationRefs.map(record).filter((
      v,
    ): v is JsonRecord => v !== null)
      .map((v) => ({ originKind: v.originKind, originId: v.originId }))
    : raw.sourceAttestationRefs;
  return {
    ...raw,
    capture: sanitizedCapture,
    sourceAttestationRefs: sanitizedRefs,
  };
}

function readModel(rawValue: unknown, internal = false): JsonRecord {
  const raw = record(rawValue);
  if (!raw) {
    throw new OrchestratorError("UPSTREAM_DB_ERROR", "Lecture indisponible");
  }
  const head = normalizedComposite(raw.head);
  const revision = normalizedComposite(raw.revision);
  const captureRecord = record(raw.captureRecord);
  const capture = captureRecord?.capture;
  const input = record(revision?.input);
  let reviewTargets: ReviewTarget[] = [];
  let calculationStatus: JsonRecord = { kind: "not_calculated" };
  if (capture && Array.isArray(input?.assertions)) {
    const calculated = resolvePersistedFinalRequestCapture(
      capture,
      input.assertions,
    );
    calculationStatus = calculated.kind === "calculated"
      ? { kind: "calculated" }
      : { kind: "rejected", code: calculated.code };
    if (calculated.kind === "calculated") {
      reviewTargets = calculated.reviewTargets;
    }
  }
  return {
    head,
    revision,
    captureRecord: internal
      ? raw.captureRecord ?? null
      : withoutAttestationHashes(raw.captureRecord ?? null),
    reviews: Array.isArray(raw.reviews) ? raw.reviews : [],
    history: Array.isArray(raw.history) ? raw.history : [],
    historyTruncated: raw.historyTruncated === true,
    selectedRevisionMatchesHeadCapture:
      raw.selectedRevisionMatchesHeadCapture === true,
    calculationStatus,
    reviewTargets,
    pricingAuthorized: false,
  };
}

function currentState(
  raw: unknown,
  expectedRevisionId: string | null,
  expectedGeneration: number,
): JsonRecord {
  const model = readModel(raw, true);
  const head = record(model.head);
  const generation = head?.generation ?? 0;
  const revisionId = head?.revision_id ?? null;
  if (generation !== expectedGeneration || revisionId !== expectedRevisionId) {
    throw new OrchestratorError(
      "CONFLICT_INVALID_STATE",
      "La demande a changé ; rechargez-la",
    );
  }
  return model;
}

function mutationResult(value: unknown): JsonRecord {
  const r = record(value);
  if (!r || r.pricingAuthorized !== false) {
    throw new OrchestratorError(
      "UPSTREAM_DB_ERROR",
      "Réponse serveur invalide",
    );
  }
  return {
    ...withoutAttestationHashes(r) as JsonRecord,
    pricingAuthorized: false,
  };
}

export async function executeFinalRequestCommand(
  command: FinalRequestCommand,
  actorId: string,
  deps: FinalRequestDeps,
): Promise<JsonRecord> {
  if (!uuid(actorId)) {
    throw new OrchestratorError("FORBIDDEN_OWNER", "Identité invalide");
  }
  if (command.operation === "read") {
    return readModel(
      await deps.read(actorId, command.caseId, command.revisionId),
    );
  }
  const base = {
    actorId,
    caseId: command.caseId,
    key: command.idempotencyKey,
    expectedRevisionId: command.expectedRevisionId,
    expectedGeneration: command.expectedGeneration,
  };
  if (command.operation === "capture") {
    return mutationResult(
      await deps.mutate({ ...base, action: "capture", payload: {} }),
    );
  }
  const state = currentState(
    await deps.read(actorId, command.caseId, null),
    command.expectedRevisionId,
    command.expectedGeneration,
  );
  if (command.operation === "attest_source") {
    const captureRecord = record(state.captureRecord);
    const refs = Array.isArray(captureRecord?.sourceAttestationRefs)
      ? captureRecord.sourceAttestationRefs.map(record).filter((
        v,
      ): v is JsonRecord => v !== null)
      : [];
    const ref = refs.find((v) =>
      v.originKind === command.originKind && v.originId === command.originId
    );
    if (
      !ref || typeof ref.sourceHash !== "string" ||
      !HASH_RE.test(ref.sourceHash)
    ) {
      throw new OrchestratorError(
        "CONFLICT_INVALID_STATE",
        "Source absente de la capture courante",
      );
    }
    const payload: JsonRecord = {
      originKind: command.originKind,
      originId: command.originId,
      expectedSourceHash: ref.sourceHash,
      authorRole: command.authorRole,
      contentClass: command.contentClass,
      reason: command.reason,
    };
    if (Object.hasOwn(command, "sentAt")) {
      payload.sentAt = command.sentAt ?? null;
    }
    return mutationResult(
      await deps.mutate({ ...base, action: "attest_source", payload }),
    );
  }
  if (command.operation === "commit") {
    const captureRecord = record(state.captureRecord);
    const capture = record(captureRecord?.capture);
    if (!capture || capture.captureId !== command.captureId) {
      throw new OrchestratorError("CONFLICT_INVALID_STATE", "Capture périmée");
    }
    const calculation = resolvePersistedFinalRequestCapture(
      capture,
      command.assertions,
    );
    if (calculation.kind !== "calculated") {
      throw new OrchestratorError(
        "VALIDATION_FAILED",
        `Calcul refusé : ${calculation.code}`,
      );
    }
    return mutationResult(
      await deps.mutate({
        ...base,
        action: "commit",
        payload: {
          captureId: calculation.captureId,
          assertions: calculation.input.assertions,
          result: calculation.result,
          resolverVersion: calculation.resolverVersion,
        },
      }),
    );
  }
  const targets = state.reviewTargets as ReviewTarget[];
  const target = command.targetId === '["capture"]'
    ? null
    : targets.find((item) => item.targetId === command.targetId);
  if (command.targetId !== '["capture"]' && !target) {
    throw new OrchestratorError(
      "CONFLICT_INVALID_STATE",
      "Cible de revue périmée",
    );
  }
  if (
    command.decision === "confirm_instruction" &&
    !target?.candidates.some((candidate) =>
      candidate.assertionId === command.candidateRef &&
      candidate.actions.includes("confirm_instruction")
    )
  ) {
    throw new OrchestratorError(
      "CONFLICT_INVALID_STATE",
      "Instruction candidate périmée",
    );
  }
  if (
    command.decision === "keep_protected_fact" &&
    (!(target && target.kind === "field") ||
      target.protectedFact?.reference !== command.candidateRef)
  ) {
    throw new OrchestratorError(
      "CONFLICT_INVALID_STATE",
      "Fait protégé candidat périmé",
    );
  }
  let parsedTarget: unknown;
  try {
    parsedTarget = JSON.parse(command.targetId);
  } catch {
    throw new OrchestratorError(
      "VALIDATION_FAILED",
      "Identifiant de cible invalide",
    );
  }
  return mutationResult(
    await deps.mutate({
      ...base,
      action: "review",
      payload: {
        decision: command.decision,
        target: parsedTarget,
        candidateRef: command.candidateRef,
        previousEventId: command.previousEventId,
        reason: command.reason,
      },
    }),
  );
}

export function mapFinalRequestRpcError(message: string): OrchestratorError {
  if (/FRS_REVIEWER_REQUIRED|FRS_ACTOR_REQUIRED/.test(message)) {
    return new OrchestratorError(
      "FORBIDDEN_OWNER",
      "Habilitation de revue requise",
    );
  }
  if (
    /FRS_STALE|FRS_IDEMPOTENCY_CONFLICT|FRS_UPSTREAM_CHANGED|FRS_SOURCE_REATTESTATION_REQUIRED/
      .test(message)
  ) {
    return new OrchestratorError(
      "CONFLICT_INVALID_STATE",
      "La demande a changé ; rechargez-la",
    );
  }
  if (
    /FRS_.*(INVALID|REQUIRED|TARGET|CANDIDATE|REVIEWABLE|UNRESOLVED)|FRS_CALCULATION_CONTRACT/
      .test(message)
  ) {
    return new OrchestratorError(
      "VALIDATION_FAILED",
      "Commande refusée par le contrat",
    );
  }
  return new OrchestratorError(
    "UPSTREAM_DB_ERROR",
    "Service de demande consolidée indisponible",
  );
}
