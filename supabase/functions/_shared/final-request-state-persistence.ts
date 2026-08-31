/**
 * P1-C2-A — Adaptateur PUR de persistance pour la demande commerciale
 * consolidée ("final request state capture"), tel que fourni par une future
 * couche DB service-only (jamais par le navigateur).
 *
 * PORTÉE STRICTE :
 *   - Aucune I/O, aucun accès réseau/DB/Supabase/Auth, aucune horloge courante,
 *     aucun aléa. Fonction pure : mêmes entrées => mêmes sorties, aucune
 *     mutation de l'entrée ni de la sortie retournée (détachement profond).
 *   - N'établit ni identité authentifiée, ni complétude d'inventaire, ni
 *     fraîcheur DB : ce module consomme une capture déjà persistée par une
 *     couche service-only et ne fait que la valider/reprojeter.
 *   - N'implémente ni stockage ni versionnement transactionnel (CAS) : ce
 *     chantier reste dans un adaptateur storage/RPC séparé.
 *   - `reviewTargets` sont des métadonnées PURES dérivées, destinées à une
 *     vérification SQL ultérieure : ce module n'approuve et ne résout jamais
 *     un conflit lui-même.
 *   - N'émet jamais de valeur `pricingAuthorized` autre que `false` littéral.
 *
 * Contrat fil (wire contract) fixe, jamais fourni par un client non fiable :
 *   { schemaVersion:1, captureId:uuid, caseId:uuid, headRevisionId:uuid|null,
 *     generation:entier>=0, inventoryHash:sha256-hex-64-minuscules,
 *     resolverVersion:"p1c1-...", baseInput:{caseId,lotIds,
 *     quotationVersionIds,sources,protectedFacts}, limitations:string[] }
 *
 * `baseInput` est l'entrée C1 exacte SANS `assertions` : les assertions sont
 * fournies séparément (`rawAssertions`) et résolues par ce module lui-même,
 * jamais acceptées telles quelles depuis un résultat/rôle fourni par
 * l'appelant.
 */

import {
  type FieldKey,
  type FieldScope,
  type FieldValue,
  type FinalRequestStateAssertionInput,
  type FinalRequestStateInput,
  type FinalRequestStateProtectedFactInput,
  type FinalRequestStateResult,
  type FinalRequestStateSourceInput,
  type JournalEntry,
  resolveFinalRequestState,
} from "./final-request-state.ts";

// ── Contrat fil (constantes) ─────────────────────────────────────────────────

export const RESOLVER_VERSION =
  "p1c1-adfe04101c18aa63a6f2c5df3d79a5b44575a41cd0fa66ab0ba3c3012268fb0c";

export const PERSISTED_LIMITATION_CODES = [
  "SOURCE_UNATTESTED",
  "SOURCE_TRUNCATED",
  "SOURCE_EMPTY",
  "SOURCE_DATE_UNKNOWN",
  "PROTECTED_FACT_UNMAPPED",
  "PROTECTED_FACT_AMBIGUOUS",
  "LOT_MAPPING_AMBIGUOUS",
  "INVENTORY_LIMIT",
] as const;

const LIMITATION_CODE_SET: ReadonlySet<string> = new Set(
  PERSISTED_LIMITATION_CODES,
);

const CAPTURE_ALLOWED_KEYS = [
  "schemaVersion",
  "captureId",
  "caseId",
  "headRevisionId",
  "generation",
  "inventoryHash",
  "resolverVersion",
  "baseInput",
  "limitations",
] as const;

const BASE_INPUT_KEYS = [
  "caseId",
  "lotIds",
  "quotationVersionIds",
  "sources",
  "protectedFacts",
] as const;

// Up to four source limitations per 500 sources, plus 500 facts and 200 lots.
const MAX_LIMITATIONS = 3000;
const MAX_LIMITATION_CODE_LEN = 32;
const MAX_LIMITATION_REFERENCE_LEN = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

// ── Types publics ────────────────────────────────────────────────────────────

export interface PersistedFinalRequestCaptureInput {
  schemaVersion: 1;
  captureId: string;
  caseId: string;
  headRevisionId: string | null;
  generation: number;
  inventoryHash: string;
  resolverVersion: string;
  baseInput: {
    caseId: string;
    lotIds: string[];
    quotationVersionIds: string[];
    sources: FinalRequestStateSourceInput[];
    protectedFacts: FinalRequestStateProtectedFactInput[];
  };
  limitations: string[];
}

export type PersistedCaptureRejectionCode =
  | "INVALID_CAPTURE"
  | "RESOLVER_VERSION_MISMATCH"
  | "UNKNOWN_QUOTATION_REFERENCE"
  | "INVALID_REQUEST_INPUT";

export type ReviewTargetAction =
  | "confirm_instruction"
  | "keep_protected_fact"
  | "request_clarification";

export interface ReviewTargetCandidate {
  assertionId: string;
  sourceId: string;
  actions: ReviewTargetAction[];
  needsFactReconciliation: boolean;
}

export type ReviewTarget =
  | {
    targetId: string;
    kind: "field";
    scope: FieldScope;
    field: FieldKey;
    protectedFact:
      | { value: FieldValue; reference: string; validatedBy: string }
      | null;
    candidates: ReviewTargetCandidate[];
  }
  | {
    targetId: string;
    kind: "lifecycle";
    candidates: ReviewTargetCandidate[];
  }
  | {
    targetId: string;
    kind: "quote";
    quotationVersionId: string;
    candidates: ReviewTargetCandidate[];
  };

export interface RejectedFinalRequestCapture {
  kind: "rejected";
  code: PersistedCaptureRejectionCode;
}

export interface CalculatedFinalRequestCapture {
  kind: "calculated";
  captureId: string;
  caseId: string;
  headRevisionId: string | null;
  generation: number;
  inventoryHash: string;
  resolverVersion: string;
  input: FinalRequestStateInput;
  result: FinalRequestStateResult;
  limitations: string[];
  reviewTargets: ReviewTarget[];
  pricingAuthorized: false;
}

export type PersistedFinalRequestCaptureResolution =
  | RejectedFinalRequestCapture
  | CalculatedFinalRequestCapture;

// ── Helpers structurels purs (copie volontairement isolée de C1) ────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).every((key) => {
      const d = Object.getOwnPropertyDescriptor(value, key);
      return typeof key === "string" && d?.enumerable === true && "value" in d;
    })
  );
}

function isPlainArray(value: unknown): value is unknown[] {
  return Array.isArray(value) &&
    Object.getPrototypeOf(value) === Array.prototype &&
    Reflect.ownKeys(value).every((key) => {
      if (key === "length") return true;
      if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) return false;
      const d = Object.getOwnPropertyDescriptor(value, key);
      return d?.enumerable === true && "value" in d;
    }) && Object.keys(value).length === value.length;
}

function hasExactKeys(
  obj: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const objKeys = Object.keys(obj);
  if (objKeys.length !== keys.length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) return false;
  }
  return true;
}

function deepClonePlain<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => deepClonePlain(v)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = deepClonePlain((value as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return value;
}

function scopeKey(scope: FieldScope): string {
  return scope === "case" ? "case" : `lot:${scope.lotId}`;
}

// ── Date source stricte (identique en esprit à C1, jamais Date.parse seul) ──

const ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isValidAttestedInstant(raw: string): boolean {
  const match = ISO_DATETIME_RE.exec(raw);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetRaw = match[8];

  if (month < 1 || month > 12) return false;
  const maxDay = month === 2 && isLeapYear(year)
    ? 29
    : DAYS_IN_MONTH[month - 1];
  if (day < 1 || day > maxDay) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;

  if (offsetRaw !== "Z") {
    const offH = Number(offsetRaw.slice(1, 3));
    const offM = Number(offsetRaw.slice(4, 6));
    if (offH > 14 || offM > 59 || (offH === 14 && offM !== 0)) return false;
  }

  return Number.isFinite(Date.parse(raw));
}

// ── Validation de la capture persistée ───────────────────────────────────────

interface ValidatedCapture {
  captureId: string;
  caseId: string;
  headRevisionId: string | null;
  generation: number;
  inventoryHash: string;
  baseInput: Record<string, unknown>;
  limitations: string[];
}

type CaptureResult =
  | { ok: true; value: ValidatedCapture }
  | { ok: false; code: PersistedCaptureRejectionCode };

function validateLimitation(el: unknown): boolean {
  if (typeof el !== "string") return false;
  if (
    el.length === 0 ||
    el.length > MAX_LIMITATION_CODE_LEN + 1 + MAX_LIMITATION_REFERENCE_LEN
  ) {
    return false;
  }
  const idx = el.indexOf(":");
  const code = idx === -1 ? el : el.slice(0, idx);
  if (!LIMITATION_CODE_SET.has(code)) return false;
  if (idx !== -1) {
    const reference = el.slice(idx + 1);
    if (
      reference.length === 0 || reference.length > MAX_LIMITATION_REFERENCE_LEN
    ) {
      return false;
    }
    if (
      [...reference].some((char) => {
        const codePoint = char.charCodeAt(0);
        return codePoint < 32 || codePoint === 127;
      })
    ) return false;
  }
  return true;
}

function validateCapture(raw: unknown): CaptureResult {
  if (!isPlainObject(raw)) return { ok: false, code: "INVALID_CAPTURE" };
  if (!hasExactKeys(raw, CAPTURE_ALLOWED_KEYS)) {
    return { ok: false, code: "INVALID_CAPTURE" };
  }
  if (raw.schemaVersion !== 1) return { ok: false, code: "INVALID_CAPTURE" };

  const captureId = raw.captureId;
  if (typeof captureId !== "string" || !UUID_RE.test(captureId)) {
    return { ok: false, code: "INVALID_CAPTURE" };
  }

  const caseId = raw.caseId;
  if (typeof caseId !== "string" || !UUID_RE.test(caseId)) {
    return { ok: false, code: "INVALID_CAPTURE" };
  }

  let headRevisionId: string | null;
  if (raw.headRevisionId === null) {
    headRevisionId = null;
  } else if (
    typeof raw.headRevisionId === "string" && UUID_RE.test(raw.headRevisionId)
  ) {
    headRevisionId = raw.headRevisionId;
  } else {
    return { ok: false, code: "INVALID_CAPTURE" };
  }

  const generation = raw.generation;
  if (
    typeof generation !== "number" || !Number.isSafeInteger(generation) ||
    generation < 0
  ) {
    return { ok: false, code: "INVALID_CAPTURE" };
  }

  const inventoryHash = raw.inventoryHash;
  if (
    typeof inventoryHash !== "string" || !SHA256_HEX_RE.test(inventoryHash)
  ) {
    return { ok: false, code: "INVALID_CAPTURE" };
  }

  const resolverVersion = raw.resolverVersion;
  if (typeof resolverVersion !== "string") {
    return { ok: false, code: "INVALID_CAPTURE" };
  }
  if (resolverVersion !== RESOLVER_VERSION) {
    return { ok: false, code: "RESOLVER_VERSION_MISMATCH" };
  }

  const baseInputRaw = raw.baseInput;
  if (
    !isPlainObject(baseInputRaw) ||
    !hasExactKeys(baseInputRaw, BASE_INPUT_KEYS)
  ) {
    return { ok: false, code: "INVALID_CAPTURE" };
  }
  if (baseInputRaw.caseId !== caseId) {
    return { ok: false, code: "INVALID_CAPTURE" };
  }

  const limitationsRaw = raw.limitations;
  if (
    !isPlainArray(limitationsRaw) || limitationsRaw.length > MAX_LIMITATIONS
  ) {
    return { ok: false, code: "INVALID_CAPTURE" };
  }
  const limitations: string[] = [];
  for (const el of limitationsRaw) {
    if (!validateLimitation(el)) return { ok: false, code: "INVALID_CAPTURE" };
    limitations.push(el as string);
  }

  return {
    ok: true,
    value: {
      captureId,
      caseId,
      headRevisionId,
      generation,
      inventoryHash,
      baseInput: baseInputRaw,
      limitations,
    },
  };
}

// ── Vérification frontière adaptateur : références de devis canoniques ──────

function extractCanonicalQuoteIds(
  rawQuotationVersionIds: unknown,
): ReadonlySet<string> {
  const set = new Set<string>();
  if (!isPlainArray(rawQuotationVersionIds)) return set;
  for (const el of rawQuotationVersionIds) {
    if (typeof el === "string") set.add(el);
  }
  return set;
}

function hasUnknownQuoteReference(
  rawAssertions: unknown,
  canonicalQuoteIds: ReadonlySet<string>,
): boolean {
  if (!isPlainArray(rawAssertions)) return false;
  for (const el of rawAssertions) {
    if (!isPlainObject(el)) continue;
    const operation = el.operation;
    if (operation !== "accept_quote" && operation !== "reject_quote") continue;
    const quotationVersionId = el.quotationVersionId;
    if (typeof quotationVersionId !== "string") continue;
    if (!canonicalQuoteIds.has(quotationVersionId)) return true;
  }
  return false;
}

// ── Éligibilité "instruction client courante attestée" par source ───────────

interface RawSourceView {
  authorRole: unknown;
  roleVerified: unknown;
  contentClass: unknown;
  sentAt: unknown;
}

function buildSourceById(rawSources: unknown): Map<string, RawSourceView> {
  const map = new Map<string, RawSourceView>();
  if (!isPlainArray(rawSources)) return map;
  for (const el of rawSources) {
    if (!isPlainObject(el)) continue;
    const id = el.id;
    if (typeof id !== "string") continue;
    map.set(id, {
      authorRole: el.authorRole,
      roleVerified: el.roleVerified,
      contentClass: el.contentClass,
      sentAt: el.sentAt,
    });
  }
  return map;
}

function isEligibleCurrentClientSource(source: RawSourceView): boolean {
  if (source.authorRole !== "client") return false;
  if (source.roleVerified !== true) return false;
  if (source.contentClass !== "current") return false;
  if (typeof source.sentAt !== "string") return false;
  return isValidAttestedInstant(source.sentAt);
}

// ── Construction des reviewTargets (métadonnées pures, non une revue) ───────

type NonInvalidResult = Exclude<
  FinalRequestStateResult,
  { kind: "invalid_input" }
>;

function targetIdForEntry(entry: JournalEntry): string | null {
  if (entry.operation === "set" || entry.operation === "remove") {
    if (entry.field === undefined) return null;
    return JSON.stringify(["field", scopeKey(entry.scope), entry.field]);
  }
  if (
    entry.operation === "cancel_request" || entry.operation === "resume_request"
  ) {
    return JSON.stringify(["lifecycle"]);
  }
  if (
    entry.operation === "accept_quote" || entry.operation === "reject_quote"
  ) {
    if (entry.quotationVersionId === undefined) return null;
    return JSON.stringify(["quote", entry.quotationVersionId]);
  }
  return null;
}

function buildReviewTargets(
  result: NonInvalidResult,
  sourceById: ReadonlyMap<string, RawSourceView>,
): ReviewTarget[] {
  const protectedConflictAssertionIds = new Set<string>();
  if ("protectedFactConflicts" in result) {
    for (const c of result.protectedFactConflicts) {
      protectedConflictAssertionIds.add(c.conflictingAssertionId);
    }
  }

  const protectedByKey = new Map<
    string,
    { value: FieldValue; reference: string; validatedBy: string }
  >();
  for (const pf of result.protectedFacts) {
    protectedByKey.set(`${scopeKey(pf.scope)}\u0000${pf.field}`, {
      value: pf.value,
      reference: pf.reference,
      validatedBy: pf.validatedBy,
    });
  }

  const targets = new Map<string, ReviewTarget>();

  for (const entry of result.journal) {
    if (entry.outcome !== "conflict") continue;
    const targetId = targetIdForEntry(entry);
    if (targetId === null) continue;

    let target = targets.get(targetId);
    if (target === undefined) {
      if (entry.operation === "set" || entry.operation === "remove") {
        const pf = protectedByKey.get(
          `${scopeKey(entry.scope)}\u0000${entry.field}`,
        ) ?? null;
        target = {
          targetId,
          kind: "field",
          scope: entry.scope,
          field: entry.field as FieldKey,
          protectedFact: pf,
          candidates: [],
        };
      } else if (
        entry.operation === "cancel_request" ||
        entry.operation === "resume_request"
      ) {
        target = { targetId, kind: "lifecycle", candidates: [] };
      } else {
        target = {
          targetId,
          kind: "quote",
          quotationVersionId: entry.quotationVersionId as string,
          candidates: [],
        };
      }
      targets.set(targetId, target);
    }

    const source = sourceById.get(entry.sourceId);
    const eligible = source !== undefined &&
      isEligibleCurrentClientSource(source);
    const isProtectedConflict = protectedConflictAssertionIds.has(
      entry.assertionId,
    );
    const actions: ReviewTargetAction[] = [];
    if (eligible) actions.push("confirm_instruction");
    if (isProtectedConflict) actions.push("keep_protected_fact");
    actions.push("request_clarification");

    target.candidates.push({
      assertionId: entry.assertionId,
      sourceId: entry.sourceId,
      actions,
      needsFactReconciliation: isProtectedConflict,
    });
  }

  const list = [...targets.values()];
  for (const t of list) {
    t.candidates.sort((a, b) =>
      a.assertionId < b.assertionId ? -1 : a.assertionId > b.assertionId ? 1 : 0
    );
  }
  list.sort((
    a,
    b,
  ) => (a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0));
  return list;
}

// ── Point d'entrée ────────────────────────────────────────────────────────────

/**
 * Adaptateur pur : reprojette une capture DB déjà persistée (service-only) et
 * ses assertions associées vers le résultat C1 correspondant, augmenté de
 * métadonnées de revue dérivées. Ne persiste rien, ne lit rien, ne dépend
 * d'aucune horloge, et ne promeut jamais une hypothèse d'autorité/date.
 */
export function resolvePersistedFinalRequestCapture(
  rawCapture: unknown,
  rawAssertions: unknown,
): PersistedFinalRequestCaptureResolution {
  const captureResult = validateCapture(rawCapture);
  if (!captureResult.ok) {
    return { kind: "rejected", code: captureResult.code };
  }
  const capture = captureResult.value;

  const canonicalQuoteIds = extractCanonicalQuoteIds(
    capture.baseInput.quotationVersionIds,
  );
  if (hasUnknownQuoteReference(rawAssertions, canonicalQuoteIds)) {
    return { kind: "rejected", code: "UNKNOWN_QUOTATION_REFERENCE" };
  }

  const c1Input: Record<string, unknown> = {
    caseId: capture.baseInput.caseId,
    lotIds: capture.baseInput.lotIds,
    quotationVersionIds: capture.baseInput.quotationVersionIds,
    sources: capture.baseInput.sources,
    assertions: rawAssertions,
    protectedFacts: capture.baseInput.protectedFacts,
  };

  const result = resolveFinalRequestState(c1Input);
  if (result.kind === "invalid_input") {
    return { kind: "rejected", code: "INVALID_REQUEST_INPUT" };
  }

  const sourceById = buildSourceById(capture.baseInput.sources);
  const reviewTargets = buildReviewTargets(
    result as NonInvalidResult,
    sourceById,
  );

  return {
    kind: "calculated",
    captureId: capture.captureId,
    caseId: capture.caseId,
    headRevisionId: capture.headRevisionId,
    generation: capture.generation,
    inventoryHash: capture.inventoryHash,
    resolverVersion: RESOLVER_VERSION,
    input: deepClonePlain(c1Input) as unknown as FinalRequestStateInput,
    result: deepClonePlain(result),
    limitations: deepClonePlain(capture.limitations),
    reviewTargets: deepClonePlain(reviewTargets),
    pricingAuthorized: false,
  };
}

export type {
  FinalRequestStateAssertionInput,
  FinalRequestStateInput,
  FinalRequestStateProtectedFactInput,
  FinalRequestStateResult,
  FinalRequestStateSourceInput,
};
