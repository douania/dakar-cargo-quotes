/**
 * P1-C1 — Résolveur PUR de la demande commerciale consolidée ("final request state").
 *
 * PORTÉE STRICTE :
 *   - Aucune I/O, aucun accès réseau/DB/Supabase/Auth, aucune horloge courante
 *     (`Date.now()`/`new Date()` sans arguments), aucun aléa. Fonction pure :
 *     mêmes entrées => mêmes sorties, aucune mutation de l'entrée.
 *   - Ne fait AUCUN parsing d'email ni appel LLM : il consomme un inventaire déjà
 *     structuré de sources et d'assertions (fournies par un futur adaptateur de
 *     confiance, hors périmètre de ce module).
 *   - roleVerified est une précondition attestée par cet adaptateur, PAS une
 *     preuve Auth. Ne jamais exposer ce résolveur comme endpoint à entrées libres.
 *     Les champs descriptifs ne sont pas des mutations de quote_facts ou de
 *     service.overrides ; leur mapping futur reste un chantier séparé.
 *   - N'émet jamais de statut `ready_to_price`/`pricingAllowed` ni aucune valeur
 *     monétaire/tarifaire : le vocabulaire de champs autorisé (voir `FIELD_KEYS`)
 *     est fermé et exclut toute clé money/pricing.
 *   - `schemaVersion: 1` désigne uniquement la version du FORMAT de sortie de ce
 *     module. Ce n'est ni une révision de base de données, ni une garantie
 *     transactionnelle/CAS, ni une preuve de persistance : P1-C2 portera le
 *     stockage/versionnement/approbations humaines, P1-C3 la projection
 *     contrôlée vers puzzle/pricing. Aucun des deux n'est implémenté ici.
 *
 * MODÈLE :
 *   - Une "source" est un email/document/note opérateur déjà classé : rôle de
 *     l'auteur, attestation (`roleVerified`), classe de contenu
 *     (current/quoted/historical/hypothesis) et date d'envoi explicite (ISO avec
 *     fuseau horaire) ou `null`. La date d'ingestion/analyse n'existe pas dans ce
 *     modèle : seule `sentAt` peut ordonner les instructions commerciales.
 *   - Une "assertion" cite verbatim un extrait (`excerpt`) de sa source et porte
 *     une opération explicite (set/remove/cancel_request/resume_request/
 *     accept_quote/reject_quote/acknowledge) sur un champ ou sur le cycle de vie
 *     de la demande.
 *   - Les "protectedFacts" sont des faits opérateur déjà validés/sourcés
 *     ailleurs : ce module ne les écrase jamais automatiquement. Toute
 *     contradiction (y compris un `remove`) devient `needs_review` ; P1-C1 ne
 *     résout pas ce conflit et ne promeut aucune hypothèse.
 *
 * Voir `outputs/p1b-selection-sync-20260830/AUDIT_P1C.md` (hors dépôt) pour
 * l'audit ayant motivé ce contrat.
 */

// ── Constantes & limites ────────────────────────────────────────────────────

export const SCHEMA_VERSION = 1 as const;

const MAX_ID_LEN = 128;
const MAX_TEXT_LEN = 20000;
const MAX_TOTAL_TEXT_LEN = 1000000;
const MAX_EXCERPT_LEN = 2000;
const MAX_STRING_FIELD_LEN = 500;
const MAX_REFERENCE_LEN = 300;
const MAX_LOTS = 200;
const MAX_QUOTATION_VERSIONS = 200;
const MAX_SOURCES = 500;
const MAX_ASSERTIONS = 3000;
const MAX_PROTECTED_FACTS = 500;

// ── Vocabulaire de champs fermé (version 1) ─────────────────────────────────
// Toute extension de cette liste doit être approuvée explicitement (cf. header).
// Aucune clé monétaire/tarifaire/Auth/runtime n'est acceptée.

export const FIELD_KEYS = [
  "cargo.description",
  "cargo.weight_kg",
  "cargo.volume_cbm",
  "cargo.pieces_count",
  "cargo.container_type",
  "routing.origin_port",
  "routing.destination_port",
  "routing.destination_city",
  "routing.incoterm",
  "transport.mode",
  "movement.direction",
  "terminal.operation_mode",
  "lot.in_scope",
  "service.TRUCKING",
  "service.DTHC",
  "service.CUSTOMS_DAKAR",
  "service.SEA_FREIGHT",
] as const;

export type FieldKey = typeof FIELD_KEYS[number];

const FIELD_KEY_SET: ReadonlySet<string> = new Set(FIELD_KEYS);

const CONTAINER_TYPES = new Set([
  "20GP",
  "40GP",
  "40HC",
  "20RF",
  "40RF",
  "20OT",
  "40OT",
  "20FR",
  "40FR",
]);
const INCOTERMS = new Set([
  "EXW",
  "FCA",
  "FAS",
  "FOB",
  "CFR",
  "CIF",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
]);
const TRANSPORT_MODES = new Set(["AIR", "MARITIME", "ROUTE", "MULTIMODAL"]);
const MOVEMENT_DIRECTIONS = new Set([
  "IMPORT",
  "EXPORT",
  "REEXPORT",
  "TRANSIT",
  "CROSS_TRADE",
]);
const TERMINAL_OPERATION_MODES = new Set(["LOLO", "RORO", "CONRO"]);

const SOURCE_KINDS = new Set(["email", "document", "operator"]);
const AUTHOR_ROLES = new Set(["client", "operator", "partner", "unknown"]);
const CONTENT_CLASSES = new Set([
  "current",
  "quoted",
  "historical",
  "hypothesis",
]);
const OPERATIONS = new Set([
  "set",
  "remove",
  "cancel_request",
  "resume_request",
  "accept_quote",
  "reject_quote",
  "acknowledge",
]);

const ENVELOPE_ALLOWED_KEYS = [
  "caseId",
  "lotIds",
  "quotationVersionIds",
  "sources",
  "assertions",
  "protectedFacts",
] as const;
const ENVELOPE_REQUIRED_KEYS = [
  "caseId",
  "lotIds",
  "quotationVersionIds",
  "sources",
  "assertions",
] as const;
const SOURCE_KEYS = [
  "id",
  "caseId",
  "kind",
  "authorRole",
  "roleVerified",
  "contentClass",
  "sentAt",
  "text",
] as const;
const ASSERTION_ALLOWED_KEYS = [
  "id",
  "sourceId",
  "scope",
  "operation",
  "field",
  "value",
  "quotationVersionId",
  "excerpt",
] as const;
const PROTECTED_FACT_KEYS = [
  "scope",
  "field",
  "value",
  "reference",
  "validatedBy",
] as const;

// ── Types publics ────────────────────────────────────────────────────────────

export type FieldValue = string | number | boolean;
export type FieldScope = "case" | { lotId: string };

export type SourceKind = "email" | "document" | "operator";
export type AuthorRole = "client" | "operator" | "partner" | "unknown";
export type ContentClass = "current" | "quoted" | "historical" | "hypothesis";
export type Operation =
  | "set"
  | "remove"
  | "cancel_request"
  | "resume_request"
  | "accept_quote"
  | "reject_quote"
  | "acknowledge";

export interface FinalRequestStateSourceInput {
  id: string;
  caseId: string;
  kind: SourceKind;
  authorRole: AuthorRole;
  roleVerified: boolean;
  contentClass: ContentClass;
  sentAt: string | null;
  text: string;
}

export interface FinalRequestStateAssertionInput {
  id: string;
  sourceId: string;
  scope: FieldScope;
  operation: Operation;
  field?: FieldKey;
  value?: FieldValue;
  quotationVersionId?: string;
  excerpt: string;
}

export interface FinalRequestStateProtectedFactInput {
  scope: FieldScope;
  field: FieldKey;
  value: FieldValue;
  reference: string;
  validatedBy: string;
}

export interface FinalRequestStateInput {
  caseId: string;
  lotIds: string[];
  quotationVersionIds: string[];
  sources: FinalRequestStateSourceInput[];
  assertions: FinalRequestStateAssertionInput[];
  protectedFacts?: FinalRequestStateProtectedFactInput[];
}

export interface ProtectedFactRecord {
  scope: FieldScope;
  field: FieldKey;
  value: FieldValue;
  reference: string;
  validatedBy: string;
}

export interface ProtectedFactConflict {
  scope: FieldScope;
  field: FieldKey;
  protectedValue: FieldValue;
  conflictingAssertionId: string;
  conflictingSourceId: string;
  reason: string;
}

export type ResolvedField =
  | {
    scope: FieldScope;
    field: FieldKey;
    status: "set";
    value: FieldValue;
    sourceId: string;
    assertionId: string;
    sentAt: string;
    excerpt: string;
  }
  | {
    scope: FieldScope;
    field: FieldKey;
    status: "removed";
    sourceId: string;
    assertionId: string;
    sentAt: string;
    excerpt: string;
  };

export interface RequestStatus {
  state: "open" | "cancelled" | "undetermined";
  sourceId?: string;
  assertionId?: string;
  sentAt?: string;
  excerpt?: string;
}

export interface ResolvedQuoteResponse {
  quotationVersionId: string;
  response: "accepted" | "rejected";
  sourceId: string;
  assertionId: string;
  sentAt: string;
  excerpt: string;
}

interface JournalDecision {
  assertionId: string;
  outcome: "applied" | "superseded" | "ignored" | "conflict";
  reason: string;
}

export interface JournalEntry extends JournalDecision {
  sourceId: string;
  excerpt: string;
  scope: FieldScope;
  operation: Operation;
  field?: FieldKey;
  value?: FieldValue;
  quotationVersionId?: string;
}

export type FinalRequestStateResult =
  | { schemaVersion: 1; kind: "invalid_input"; reason: string }
  | {
    schemaVersion: 1;
    caseId: string;
    kind: "no_request";
    journal: JournalEntry[];
    protectedFacts: ProtectedFactRecord[];
  }
  | {
    schemaVersion: 1;
    caseId: string;
    kind: "needs_review";
    reasons: string[];
    requestStatus: RequestStatus;
    fields: ResolvedField[];
    protectedFacts: ProtectedFactRecord[];
    protectedFactConflicts: ProtectedFactConflict[];
    quoteResponses: ResolvedQuoteResponse[];
    journal: JournalEntry[];
  }
  | {
    schemaVersion: 1;
    caseId: string;
    kind: "cancelled";
    requestStatus: RequestStatus;
    fields: ResolvedField[];
    protectedFacts: ProtectedFactRecord[];
    quoteResponses: ResolvedQuoteResponse[];
    journal: JournalEntry[];
  }
  | {
    schemaVersion: 1;
    caseId: string;
    kind: "consistent";
    requestStatus: RequestStatus;
    fields: ResolvedField[];
    protectedFacts: ProtectedFactRecord[];
    quoteResponses: ResolvedQuoteResponse[];
    journal: JournalEntry[];
  };

// ── Helpers structurels purs ─────────────────────────────────────────────────

type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

function err(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

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

function hasOnlyAllowedKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) return false;
  }
  return true;
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

function isBoundedId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_ID_LEN &&
    value.trim() === value && !/[\s\p{Cc}]/u.test(value);
}

function stringCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Comparaison structurelle profonde, indépendante de l'ordre des clés. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (
    typeof a === "object" && a !== null && !Array.isArray(a) &&
    typeof b === "object" && b !== null && !Array.isArray(b)
  ) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao).sort();
    const bk = Object.keys(bo).sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i++) {
      if (ak[i] !== bk[i]) return false;
    }
    for (const k of ak) {
      if (!deepEqual(ao[k], bo[k])) return false;
    }
    return true;
  }
  return false;
}

function scopeKey(scope: FieldScope): string {
  return scope === "case" ? "case" : `lot:${scope.lotId}`;
}

function groupKey(scope: FieldScope, field: FieldKey): string {
  return JSON.stringify([scopeKey(scope), field]);
}

function fieldScopeIsValid(field: FieldKey, scope: FieldScope): boolean {
  // lot.in_scope n'a de sens qu'au périmètre d'un lot précis ; aucun autre
  // champ n'est restreint par construction (cf. header : cas/lots distincts).
  if (field === "lot.in_scope") return scope !== "case";
  return true;
}

// ── Date source stricte (ISO 8601, fuseau explicite, sans horloge courante) ──

const ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function parseStrictIsoInstant(
  raw: string,
): { ok: true; instant: number } | { ok: false } {
  const match = ISO_DATETIME_RE.exec(raw);
  if (!match) return { ok: false };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetRaw = match[8];

  if (month < 1 || month > 12) return { ok: false };
  const maxDay = month === 2 && isLeapYear(year)
    ? 29
    : DAYS_IN_MONTH[month - 1];
  if (day < 1 || day > maxDay) return { ok: false };
  if (hour > 23 || minute > 59 || second > 59) return { ok: false };

  if (offsetRaw !== "Z") {
    const offH = Number(offsetRaw.slice(1, 3));
    const offM = Number(offsetRaw.slice(4, 6));
    if (offH > 14 || offM > 59 || (offH === 14 && offM !== 0)) {
      return { ok: false };
    }
  }

  // Le calendrier a été validé explicitement. Date.parse conserve les années
  // 0000..0099, contrairement au raccourci Date.UTC qui les déplace de 1900 ans.
  const instant = Date.parse(raw);
  if (!Number.isFinite(instant)) return { ok: false };
  return { ok: true, instant };
}

// ── Validation des valeurs de champ (vocabulaire fermé v1) ──────────────────

function validateFieldValue(
  field: FieldKey,
  raw: unknown,
): { ok: true; value: FieldValue } | { ok: false; reason: string } {
  switch (field) {
    case "cargo.description":
    case "routing.origin_port":
    case "routing.destination_port":
    case "routing.destination_city": {
      if (
        typeof raw !== "string" || raw.trim().length === 0 ||
        raw.length > MAX_STRING_FIELD_LEN
      ) {
        return {
          ok: false,
          reason:
            `${field} must be a non-empty string up to ${MAX_STRING_FIELD_LEN} chars`,
        };
      }
      return { ok: true, value: raw };
    }
    case "cargo.weight_kg":
    case "cargo.volume_cbm": {
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
        return {
          ok: false,
          reason: `${field} must be a positive finite number`,
        };
      }
      return { ok: true, value: raw };
    }
    case "cargo.pieces_count": {
      if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw <= 0) {
        return { ok: false, reason: `${field} must be a positive integer` };
      }
      return { ok: true, value: raw };
    }
    case "cargo.container_type": {
      if (typeof raw !== "string" || !CONTAINER_TYPES.has(raw)) {
        return { ok: false, reason: `${field} must be a known container type` };
      }
      return { ok: true, value: raw };
    }
    case "routing.incoterm": {
      if (typeof raw !== "string" || !INCOTERMS.has(raw)) {
        return { ok: false, reason: `${field} must be a known incoterm` };
      }
      return { ok: true, value: raw };
    }
    case "transport.mode": {
      if (typeof raw !== "string" || !TRANSPORT_MODES.has(raw)) {
        return { ok: false, reason: `${field} must be a known transport mode` };
      }
      return { ok: true, value: raw };
    }
    case "movement.direction": {
      if (typeof raw !== "string" || !MOVEMENT_DIRECTIONS.has(raw)) {
        return {
          ok: false,
          reason: `${field} must be a known movement direction`,
        };
      }
      return { ok: true, value: raw };
    }
    case "terminal.operation_mode": {
      if (typeof raw !== "string" || !TERMINAL_OPERATION_MODES.has(raw)) {
        return {
          ok: false,
          reason: `${field} must be a known terminal operation mode`,
        };
      }
      return { ok: true, value: raw };
    }
    case "lot.in_scope":
    case "service.TRUCKING":
    case "service.DTHC":
    case "service.CUSTOMS_DAKAR":
    case "service.SEA_FREIGHT": {
      if (typeof raw !== "boolean") {
        return { ok: false, reason: `${field} must be a boolean` };
      }
      return { ok: true, value: raw };
    }
  }
}

// ── Validation de l'enveloppe ────────────────────────────────────────────────

interface ValidatedSource {
  id: string;
  caseId: string;
  kind: SourceKind;
  authorRole: AuthorRole;
  roleVerified: boolean;
  contentClass: ContentClass;
  sentAtRaw: string | null;
  sentAtInstant: number | null;
  text: string;
}

type ValidatedAssertion =
  | {
    id: string;
    sourceId: string;
    scope: FieldScope;
    operation: "set";
    field: FieldKey;
    value: FieldValue;
    excerpt: string;
  }
  | {
    id: string;
    sourceId: string;
    scope: FieldScope;
    operation: "remove";
    field: FieldKey;
    excerpt: string;
  }
  | {
    id: string;
    sourceId: string;
    scope: FieldScope;
    operation: "cancel_request" | "resume_request";
    excerpt: string;
  }
  | {
    id: string;
    sourceId: string;
    scope: FieldScope;
    operation: "accept_quote" | "reject_quote";
    quotationVersionId: string;
    excerpt: string;
  }
  | {
    id: string;
    sourceId: string;
    scope: FieldScope;
    operation: "acknowledge";
    excerpt: string;
  };

interface ParsedEnvelope {
  caseId: string;
  lotIds: ReadonlySet<string>;
  quotationVersionIds: ReadonlySet<string>;
  sources: ValidatedSource[];
  assertions: ValidatedAssertion[];
  protectedFacts: ProtectedFactRecord[];
}

function validateScope(
  raw: unknown,
  lotIds: ReadonlySet<string>,
): Result<FieldScope> {
  if (raw === "case") return { ok: true, value: "case" };
  if (!isPlainObject(raw)) return err('scope must be "case" or { lotId }');
  if (!hasExactKeys(raw, ["lotId"])) {
    return err("scope has missing or unknown keys");
  }
  const lotId = raw.lotId;
  if (!isBoundedId(lotId) || !lotIds.has(lotId)) {
    return err("scope.lotId is not a known lot of this case");
  }
  return { ok: true, value: { lotId } };
}

function validateSource(
  raw: Record<string, unknown>,
  caseId: string,
): Result<ValidatedSource> {
  if (!hasExactKeys(raw, SOURCE_KEYS)) {
    return err("source has missing or unknown keys");
  }

  const id = raw.id;
  if (!isBoundedId(id)) return err("source.id is invalid");
  if (raw.caseId !== caseId) {
    return err(`source ${id} does not belong to this case`);
  }
  if (typeof raw.kind !== "string" || !SOURCE_KINDS.has(raw.kind)) {
    return err(`source ${id} has an invalid kind`);
  }
  if (typeof raw.authorRole !== "string" || !AUTHOR_ROLES.has(raw.authorRole)) {
    return err(`source ${id} has an invalid authorRole`);
  }
  if (raw.kind === "operator" && raw.authorRole !== "operator") {
    return err(`source ${id} has inconsistent kind/authorRole`);
  }
  if (typeof raw.roleVerified !== "boolean") {
    return err(`source ${id}.roleVerified must be a boolean`);
  }
  if (
    typeof raw.contentClass !== "string" ||
    !CONTENT_CLASSES.has(raw.contentClass)
  ) {
    return err(`source ${id} has an invalid contentClass`);
  }

  let sentAtRaw: string | null = null;
  if (raw.sentAt !== null) {
    if (typeof raw.sentAt !== "string" || raw.sentAt.length > 35) {
      return err(`source ${id}.sentAt must be a bounded ISO string or null`);
    }
    sentAtRaw = raw.sentAt;
  }
  let sentAtInstant: number | null = null;
  if (sentAtRaw !== null) {
    const parsed = parseStrictIsoInstant(sentAtRaw);
    sentAtInstant = parsed.ok ? parsed.instant : null;
  }

  if (typeof raw.text !== "string" || raw.text.length > MAX_TEXT_LEN) {
    return err(`source ${id}.text must be a string within the size limit`);
  }

  return {
    ok: true,
    value: {
      id,
      caseId,
      kind: raw.kind as SourceKind,
      authorRole: raw.authorRole as AuthorRole,
      roleVerified: raw.roleVerified,
      contentClass: raw.contentClass as ContentClass,
      sentAtRaw,
      sentAtInstant,
      text: raw.text,
    },
  };
}

function validateAssertion(
  raw: Record<string, unknown>,
  ctx: {
    lotIds: ReadonlySet<string>;
    sourceById: ReadonlyMap<string, ValidatedSource>;
  },
): Result<ValidatedAssertion> {
  if (!hasOnlyAllowedKeys(raw, ASSERTION_ALLOWED_KEYS)) {
    return err("assertion has unknown keys");
  }

  const id = raw.id;
  if (!isBoundedId(id)) return err("assertion.id is invalid");

  const sourceIdRaw = raw.sourceId;
  if (!isBoundedId(sourceIdRaw)) {
    return err(`assertion ${id}.sourceId is invalid`);
  }
  const source = ctx.sourceById.get(sourceIdRaw);
  if (source === undefined) {
    return err(`assertion ${id} references an unknown source`);
  }

  const scopeResult = validateScope(raw.scope, ctx.lotIds);
  if (!scopeResult.ok) return scopeResult;
  const scope = scopeResult.value;

  if (typeof raw.operation !== "string" || !OPERATIONS.has(raw.operation)) {
    return err(`assertion ${id}.operation is invalid`);
  }
  const operation = raw.operation as Operation;

  if (
    typeof raw.excerpt !== "string" || raw.excerpt.trim().length === 0 ||
    raw.excerpt.length > MAX_EXCERPT_LEN
  ) {
    return err(`assertion ${id}.excerpt must be a non-empty bounded string`);
  }
  if (!source.text.includes(raw.excerpt)) {
    return err(
      `assertion ${id} excerpt is not present verbatim in its source text`,
    );
  }
  const excerpt = raw.excerpt;

  const hasField = Object.prototype.hasOwnProperty.call(raw, "field");
  const hasValue = Object.prototype.hasOwnProperty.call(raw, "value");
  const hasQuotationVersionId = Object.prototype.hasOwnProperty.call(
    raw,
    "quotationVersionId",
  );

  switch (operation) {
    case "set": {
      if (!hasField || hasQuotationVersionId || !hasValue) {
        return err(
          `assertion ${id} (set) requires field and value, and forbids quotationVersionId`,
        );
      }
      if (typeof raw.field !== "string" || !FIELD_KEY_SET.has(raw.field)) {
        return err(`assertion ${id}.field is not a recognized field key`);
      }
      const field = raw.field as FieldKey;
      if (!fieldScopeIsValid(field, scope)) {
        return err(`assertion ${id}: ${field} requires a lot scope`);
      }
      const valueResult = validateFieldValue(field, raw.value);
      if (!valueResult.ok) return err(`assertion ${id}: ${valueResult.reason}`);
      return {
        ok: true,
        value: {
          id,
          sourceId: sourceIdRaw,
          scope,
          operation,
          field,
          value: valueResult.value,
          excerpt,
        },
      };
    }
    case "remove": {
      if (!hasField || hasValue || hasQuotationVersionId) {
        return err(
          `assertion ${id} (remove) requires field only, forbids value and quotationVersionId`,
        );
      }
      if (typeof raw.field !== "string" || !FIELD_KEY_SET.has(raw.field)) {
        return err(`assertion ${id}.field is not a recognized field key`);
      }
      const field = raw.field as FieldKey;
      if (!fieldScopeIsValid(field, scope)) {
        return err(`assertion ${id}: ${field} requires a lot scope`);
      }
      return {
        ok: true,
        value: { id, sourceId: sourceIdRaw, scope, operation, field, excerpt },
      };
    }
    case "cancel_request":
    case "resume_request": {
      if (hasField || hasValue || hasQuotationVersionId) {
        return err(
          `assertion ${id} (${operation}) forbids field, value and quotationVersionId`,
        );
      }
      if (scope !== "case") {
        return err(`assertion ${id}: ${operation} is only valid at case scope`);
      }
      return {
        ok: true,
        value: { id, sourceId: sourceIdRaw, scope, operation, excerpt },
      };
    }
    case "accept_quote":
    case "reject_quote": {
      if (hasField || hasValue) {
        return err(`assertion ${id} (${operation}) forbids field and value`);
      }
      if (scope !== "case") {
        return err(`assertion ${id}: ${operation} is only valid at case scope`);
      }
      if (!hasQuotationVersionId || !isBoundedId(raw.quotationVersionId)) {
        return err(
          `assertion ${id} (${operation}) requires a quotationVersionId`,
        );
      }
      return {
        ok: true,
        value: {
          id,
          sourceId: sourceIdRaw,
          scope,
          operation,
          quotationVersionId: raw.quotationVersionId,
          excerpt,
        },
      };
    }
    case "acknowledge": {
      if (hasField || hasValue || hasQuotationVersionId) {
        return err(
          `assertion ${id} (acknowledge) forbids field, value and quotationVersionId`,
        );
      }
      return {
        ok: true,
        value: { id, sourceId: sourceIdRaw, scope, operation, excerpt },
      };
    }
  }
}

function validateProtectedFact(
  raw: unknown,
  lotIds: ReadonlySet<string>,
): Result<ProtectedFactRecord> {
  if (!isPlainObject(raw)) return err("protectedFact must be a plain object");
  if (!hasExactKeys(raw, PROTECTED_FACT_KEYS)) {
    return err("protectedFact has missing or unknown keys");
  }

  const scopeResult = validateScope(raw.scope, lotIds);
  if (!scopeResult.ok) return scopeResult;
  const scope = scopeResult.value;

  if (typeof raw.field !== "string" || !FIELD_KEY_SET.has(raw.field)) {
    return err("protectedFact.field is not a recognized field key");
  }
  const field = raw.field as FieldKey;
  if (!fieldScopeIsValid(field, scope)) {
    return err(`protectedFact: ${field} requires a lot scope`);
  }

  const valueResult = validateFieldValue(field, raw.value);
  if (!valueResult.ok) return err(`protectedFact: ${valueResult.reason}`);

  if (
    typeof raw.reference !== "string" || raw.reference.trim().length === 0 ||
    raw.reference.length > MAX_REFERENCE_LEN
  ) {
    return err("protectedFact.reference must be a non-empty bounded string");
  }
  if (!isBoundedId(raw.validatedBy)) {
    return err("protectedFact.validatedBy is invalid");
  }

  return {
    ok: true,
    value: {
      scope,
      field,
      value: valueResult.value,
      reference: raw.reference,
      validatedBy: raw.validatedBy,
    },
  };
}

function parseEnvelope(raw: unknown): Result<ParsedEnvelope> {
  if (!isPlainObject(raw)) return err("input must be a plain JSON object");
  if (!hasOnlyAllowedKeys(raw, ENVELOPE_ALLOWED_KEYS)) {
    return err("input has unknown top-level keys");
  }
  for (const key of ENVELOPE_REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      return err(`input is missing required field: ${key}`);
    }
  }

  const caseIdRaw = raw.caseId;
  if (!isBoundedId(caseIdRaw)) return err("caseId is invalid");
  const caseId = caseIdRaw;

  if (!isPlainArray(raw.lotIds) || raw.lotIds.length > MAX_LOTS) {
    return err("lotIds must be a bounded array");
  }
  const lotIds = new Set<string>();
  for (const lot of raw.lotIds) {
    if (!isBoundedId(lot) || lotIds.has(lot)) {
      return err("lotIds must contain unique bounded identifiers");
    }
    lotIds.add(lot);
  }

  if (
    !isPlainArray(raw.quotationVersionIds) ||
    raw.quotationVersionIds.length > MAX_QUOTATION_VERSIONS
  ) {
    return err("quotationVersionIds must be a bounded array");
  }
  const quotationVersionIds = new Set<string>();
  for (const qv of raw.quotationVersionIds) {
    if (!isBoundedId(qv) || quotationVersionIds.has(qv)) {
      return err("quotationVersionIds must contain unique bounded identifiers");
    }
    quotationVersionIds.add(qv);
  }

  if (!isPlainArray(raw.sources) || raw.sources.length > MAX_SOURCES) {
    return err("sources must be a bounded array");
  }
  const sourceById = new Map<string, ValidatedSource>();
  const rawSourceById = new Map<string, unknown>();
  let totalTextLength = 0;
  for (const rawSource of raw.sources) {
    if (!isPlainObject(rawSource)) {
      return err("each source must be a plain object");
    }
    const sourceId = rawSource.id;
    if (!isBoundedId(sourceId)) return err("each source must have a valid id");
    const existingRaw = rawSourceById.get(sourceId);
    if (existingRaw !== undefined) {
      if (!deepEqual(existingRaw, rawSource)) {
        return err(`source id ${sourceId} is reused with different content`);
      }
      continue;
    }
    const validated = validateSource(rawSource, caseId);
    if (!validated.ok) return validated;
    totalTextLength += validated.value.text.length;
    if (totalTextLength > MAX_TOTAL_TEXT_LEN) {
      return err("source texts exceed the aggregate size limit");
    }
    rawSourceById.set(sourceId, rawSource);
    sourceById.set(sourceId, validated.value);
  }

  if (!isPlainArray(raw.assertions) || raw.assertions.length > MAX_ASSERTIONS) {
    return err("assertions must be a bounded array");
  }
  const assertionById = new Map<string, ValidatedAssertion>();
  const rawAssertionById = new Map<string, unknown>();
  for (const rawAssertion of raw.assertions) {
    if (!isPlainObject(rawAssertion)) {
      return err("each assertion must be a plain object");
    }
    const assertionId = rawAssertion.id;
    if (!isBoundedId(assertionId)) {
      return err("each assertion must have a valid id");
    }
    // Valider aussi les replays AVANT de lire profondément leur contenu : un
    // scope avec accesseur/prototype non JSON ne doit pas contourner le garde.
    const validated = validateAssertion(rawAssertion, { lotIds, sourceById });
    if (!validated.ok) return validated;
    const existingRaw = rawAssertionById.get(assertionId);
    if (existingRaw !== undefined) {
      if (!deepEqual(existingRaw, rawAssertion)) {
        return err(
          `assertion id ${assertionId} is reused with different content`,
        );
      }
      continue;
    }
    rawAssertionById.set(assertionId, rawAssertion);
    assertionById.set(assertionId, validated.value);
  }

  let protectedFacts: ProtectedFactRecord[] = [];
  if (Object.prototype.hasOwnProperty.call(raw, "protectedFacts")) {
    if (
      !isPlainArray(raw.protectedFacts) ||
      raw.protectedFacts.length > MAX_PROTECTED_FACTS
    ) {
      return err("protectedFacts must be a bounded array");
    }
    const seen: ProtectedFactRecord[] = [];
    for (const rawPf of raw.protectedFacts) {
      const validated = validateProtectedFact(rawPf, lotIds);
      if (!validated.ok) return validated;
      const dupe = seen.find(
        (s) =>
          scopeKey(s.scope) === scopeKey(validated.value.scope) &&
          s.field === validated.value.field,
      );
      if (dupe !== undefined) {
        if (!deepEqual(dupe, validated.value)) {
          return err("conflicting protectedFacts for the same scope/field");
        }
        continue;
      }
      seen.push(validated.value);
    }
    protectedFacts = seen;
  }

  return {
    ok: true,
    value: {
      caseId,
      lotIds,
      quotationVersionIds,
      sources: [...sourceById.values()],
      assertions: [...assertionById.values()],
      protectedFacts,
    },
  };
}

// ── Résolution ───────────────────────────────────────────────────────────────

type Eligibility =
  | { kind: "candidate" }
  | { kind: "ignored"; reason: string }
  | { kind: "ambiguous"; reason: string };

/**
 * Seules les sources courantes (contentClass="current") ET attestées
 * (roleVerified=true) d'un client deviennent des
 * instructions actives. Un partenaire attesté ne devient jamais une
 * instruction client (context conservé). Auteur inconnu/non attesté sur une
 * opération potentiellement active => ambigu (needs_review), jamais ignoré
 * silencieusement.
 */
function classifySource(source: ValidatedSource): Eligibility {
  if (source.contentClass !== "current") {
    return {
      kind: "ignored",
      reason:
        `source content is ${source.contentClass}, not a live instruction`,
    };
  }
  if (
    (source.authorRole === "partner" || source.authorRole === "operator") &&
    source.roleVerified
  ) {
    return {
      kind: "ignored",
      reason:
        "attested partner/operator source is context, never a client instruction",
    };
  }
  if (source.authorRole === "client" && source.roleVerified) {
    return { kind: "candidate" };
  }
  return {
    kind: "ambiguous",
    reason:
      "author is unknown or not attested for a potentially active instruction",
  };
}

interface FieldCandidate {
  scope: FieldScope;
  field: FieldKey;
  payload: { op: "set"; value: FieldValue } | { op: "remove" };
  instant: number;
  sourceId: string;
  assertionId: string;
  sentAtRaw: string;
}

interface QuoteEvent {
  payload: "accepted" | "rejected";
  instant: number;
  sourceId: string;
  assertionId: string;
  sentAtRaw: string;
}

interface LifecycleEvent {
  payload: "cancel" | "resume";
  instant: number;
  sourceId: string;
  assertionId: string;
  sentAtRaw: string;
}

interface TimelineResolution<E> {
  winner: E | null;
  appliedIds: string[];
  supersededIds: string[];
  conflictIds: string[];
  conflict: boolean;
}

/**
 * Ordonne un ensemble d'évènements datés par instant (jamais par ordre
 * d'insertion/id/ingestion). Contradiction au même instant => conflit
 * explicite (aucun gagnant choisi lexicalement).
 */
function resolveTimeline<E extends { instant: number; assertionId: string }>(
  events: E[],
  equalsEvent: (a: E, b: E) => boolean,
): TimelineResolution<E> {
  if (events.length === 0) {
    return {
      winner: null,
      appliedIds: [],
      supersededIds: [],
      conflictIds: [],
      conflict: false,
    };
  }
  const maxInstant = Math.max(...events.map((e) => e.instant));
  const topTier = events.filter((e) => e.instant === maxInstant);
  const rest = events.filter((e) => e.instant !== maxInstant);
  const firstEvent = topTier[0];
  const allAgree = topTier.every((e) => equalsEvent(e, firstEvent));

  if (allAgree) {
    const winner = [...topTier].sort((a, b) =>
      stringCompare(a.assertionId, b.assertionId)
    )[0];
    return {
      winner,
      appliedIds: topTier.map((e) =>
        e.assertionId
      ),
      supersededIds: rest.map((e) => e.assertionId),
      conflictIds: [],
      conflict: false,
    };
  }

  return {
    winner: null,
    appliedIds: [],
    supersededIds: rest.map((e) => e.assertionId),
    conflictIds: topTier.map((e) => e.assertionId),
    conflict: true,
  };
}

function fieldCandidateEquals(a: FieldCandidate, b: FieldCandidate): boolean {
  if (a.payload.op !== b.payload.op) return false;
  if (a.payload.op === "set" && b.payload.op === "set") {
    return deepEqual(a.payload.value, b.payload.value);
  }
  return true;
}

function resolveLifecycle(
  events: LifecycleEvent[],
  journal: JournalDecision[],
  reasons: string[],
): { finalState: "open" | "cancelled"; lastValidEvent: LifecycleEvent | null } {
  if (events.length === 0) return { finalState: "open", lastValidEvent: null };

  const instants = [...new Set(events.map((e) => e.instant))].sort((a, b) =>
    a - b
  );
  let state: "open" | "cancelled" = "open";
  const validGroupsInOrder: LifecycleEvent[][] = [];

  for (const instant of instants) {
    const group = events.filter((e) => e.instant === instant)
      .sort((a, b) => stringCompare(a.assertionId, b.assertionId));
    const distinctPayloads = new Set(group.map((e) => e.payload));
    if (distinctPayloads.size > 1) {
      const reason = "cancel_request and resume_request at the same instant";
      for (const e of group) {
        journal.push({
          assertionId: e.assertionId,
          outcome: "conflict",
          reason,
        });
      }
      reasons.push(reason);
      continue;
    }
    const payload = group[0].payload;
    if (payload === "resume" && state !== "cancelled") {
      const reason = "resume_request without an established cancel_request";
      for (const e of group) {
        journal.push({
          assertionId: e.assertionId,
          outcome: "conflict",
          reason,
        });
      }
      reasons.push(reason);
      continue;
    }
    state = payload === "cancel" ? "cancelled" : "open";
    validGroupsInOrder.push(group);
  }

  for (let i = 0; i < validGroupsInOrder.length; i++) {
    const isLast = i === validGroupsInOrder.length - 1;
    const outcome: JournalDecision["outcome"] = isLast
      ? "applied"
      : "superseded";
    const reason = isLast
      ? "latest request lifecycle instruction"
      : "an earlier request lifecycle instruction was later changed";
    for (const e of validGroupsInOrder[i]) {
      journal.push({ assertionId: e.assertionId, outcome, reason });
    }
  }

  const lastGroup = validGroupsInOrder[validGroupsInOrder.length - 1];
  return {
    finalState: state,
    lastValidEvent: lastGroup !== undefined ? lastGroup[0] : null,
  };
}

function resolve(envelope: ParsedEnvelope): FinalRequestStateResult {
  const sourceById = new Map(envelope.sources.map((s) => [s.id, s] as const));
  const protectedByKey = new Map<string, ProtectedFactRecord>();
  for (const pf of envelope.protectedFacts) {
    protectedByKey.set(groupKey(pf.scope, pf.field), pf);
  }

  const journal: JournalDecision[] = [];
  const reasons: string[] = [];
  const protectedFactConflicts: ProtectedFactConflict[] = [];
  const fieldCandidatesByKey = new Map<string, FieldCandidate[]>();
  const lifecycleEvents: LifecycleEvent[] = [];
  const quoteEventsByVersion = new Map<string, QuoteEvent[]>();
  const ambiguousFields = new Set<string>();
  const ambiguousQuotes = new Set<string>();
  let ambiguousLifecycle = false;
  const flagAmbiguousTarget = (a: ValidatedAssertion): void => {
    if (a.operation === "set" || a.operation === "remove") {
      ambiguousFields.add(groupKey(a.scope, a.field));
    } else if (
      a.operation === "accept_quote" || a.operation === "reject_quote"
    ) ambiguousQuotes.add(a.quotationVersionId);
    else if (
      a.operation === "cancel_request" || a.operation === "resume_request"
    ) ambiguousLifecycle = true;
  };

  for (const assertion of envelope.assertions) {
    if (assertion.operation === "acknowledge") {
      journal.push({
        assertionId: assertion.id,
        outcome: "applied",
        reason: "acknowledge: no state effect",
      });
      continue;
    }

    const source = sourceById.get(assertion.sourceId);
    if (source === undefined) continue; // structurellement impossible après validation

    const eligibility = classifySource(source);
    if (eligibility.kind === "ignored") {
      journal.push({
        assertionId: assertion.id,
        outcome: "ignored",
        reason: eligibility.reason,
      });
      continue;
    }
    if (eligibility.kind === "ambiguous") {
      flagAmbiguousTarget(assertion);
      journal.push({
        assertionId: assertion.id,
        outcome: "conflict",
        reason: eligibility.reason,
      });
      reasons.push(`assertion ${assertion.id}: ${eligibility.reason}`);
      continue;
    }

    if (source.sentAtInstant === null || source.sentAtRaw === null) {
      flagAmbiguousTarget(assertion);
      const reason = source.sentAtRaw === null
        ? "missing sentAt date for a potentially active instruction"
        : "invalid or timezone-less sentAt date for a potentially active instruction";
      journal.push({ assertionId: assertion.id, outcome: "conflict", reason });
      reasons.push(`assertion ${assertion.id}: ${reason}`);
      continue;
    }
    const instant = source.sentAtInstant;
    const sentAtRaw = source.sentAtRaw;

    switch (assertion.operation) {
      case "cancel_request":
      case "resume_request": {
        lifecycleEvents.push({
          payload: assertion.operation === "cancel_request"
            ? "cancel"
            : "resume",
          instant,
          sourceId: source.id,
          assertionId: assertion.id,
          sentAtRaw,
        });
        break;
      }
      case "accept_quote":
      case "reject_quote": {
        if (!envelope.quotationVersionIds.has(assertion.quotationVersionId)) {
          const reason =
            "quote response references an unknown quotation version";
          journal.push({
            assertionId: assertion.id,
            outcome: "conflict",
            reason,
          });
          reasons.push(`assertion ${assertion.id}: ${reason}`);
          break;
        }
        const list = quoteEventsByVersion.get(assertion.quotationVersionId) ??
          [];
        list.push({
          payload: assertion.operation === "accept_quote"
            ? "accepted"
            : "rejected",
          instant,
          sourceId: source.id,
          assertionId: assertion.id,
          sentAtRaw,
        });
        quoteEventsByVersion.set(assertion.quotationVersionId, list);
        break;
      }
      case "set":
      case "remove": {
        const key = groupKey(assertion.scope, assertion.field);
        const protectedFact = protectedByKey.get(key);
        if (protectedFact !== undefined) {
          const matches = assertion.operation === "set" &&
            deepEqual(protectedFact.value, assertion.value);
          if (matches) {
            journal.push({
              assertionId: assertion.id,
              outcome: "applied",
              reason: "matches the protected operator fact",
            });
          } else {
            const reason =
              "contradicts a protected operator fact and requires human review";
            protectedFactConflicts.push({
              scope: assertion.scope,
              field: assertion.field,
              protectedValue: protectedFact.value,
              conflictingAssertionId: assertion.id,
              conflictingSourceId: source.id,
              reason,
            });
            journal.push({
              assertionId: assertion.id,
              outcome: "conflict",
              reason,
            });
            reasons.push(`assertion ${assertion.id}: ${reason}`);
          }
          break;
        }
        const list = fieldCandidatesByKey.get(key) ?? [];
        list.push({
          scope: assertion.scope,
          field: assertion.field,
          payload: assertion.operation === "set"
            ? { op: "set", value: assertion.value }
            : { op: "remove" },
          instant,
          sourceId: source.id,
          assertionId: assertion.id,
          sentAtRaw,
        });
        fieldCandidatesByKey.set(key, list);
        break;
      }
    }
  }

  const fields: ResolvedField[] = [];
  const assertionById = new Map(
    envelope.assertions.map((a) => [a.id, a] as const),
  );
  const excerptFor = (id: string): string => assertionById.get(id)!.excerpt;
  for (const candidates of fieldCandidatesByKey.values()) {
    if (
      ambiguousFields.has(groupKey(candidates[0].scope, candidates[0].field))
    ) {
      for (const c of candidates) {
        journal.push({
          assertionId: c.assertionId,
          outcome: "conflict",
          reason:
            "another instruction for this field has unresolved provenance or date",
        });
      }
      continue;
    }
    const resolution = resolveTimeline(candidates, fieldCandidateEquals);
    for (const id of resolution.appliedIds) {
      journal.push({
        assertionId: id,
        outcome: "applied",
        reason: "latest confirmed instruction for this field",
      });
    }
    for (const id of resolution.supersededIds) {
      journal.push({
        assertionId: id,
        outcome: "superseded",
        reason: "a later instruction changed this field",
      });
    }
    for (const id of resolution.conflictIds) {
      journal.push({
        assertionId: id,
        outcome: "conflict",
        reason: "contradictory instructions at the same instant for this field",
      });
    }
    if (resolution.conflict) {
      const first = candidates[0];
      reasons.push(
        `conflicting instructions at the same instant for ${first.field} at scope ${
          scopeKey(first.scope)
        }`,
      );
      continue;
    }
    const winner = resolution.winner;
    if (winner === null) continue;
    if (winner.payload.op === "set") {
      fields.push({
        scope: winner.scope,
        field: winner.field,
        status: "set",
        value: winner.payload.value,
        sourceId: winner.sourceId,
        assertionId: winner.assertionId,
        sentAt: winner.sentAtRaw,
        excerpt: excerptFor(winner.assertionId),
      });
    } else {
      fields.push({
        scope: winner.scope,
        field: winner.field,
        status: "removed",
        sourceId: winner.sourceId,
        assertionId: winner.assertionId,
        sentAt: winner.sentAtRaw,
        excerpt: excerptFor(winner.assertionId),
      });
    }
  }

  const quoteResponses: ResolvedQuoteResponse[] = [];
  for (const [quotationVersionId, events] of quoteEventsByVersion) {
    if (ambiguousQuotes.has(quotationVersionId)) {
      for (const e of events) {
        journal.push({
          assertionId: e.assertionId,
          outcome: "conflict",
          reason:
            "another response for this version has unresolved provenance or date",
        });
      }
      continue;
    }
    const resolution = resolveTimeline(
      events,
      (a, b) => a.payload === b.payload,
    );
    for (const id of resolution.appliedIds) {
      journal.push({
        assertionId: id,
        outcome: "applied",
        reason: "latest response for this quotation version",
      });
    }
    for (const id of resolution.supersededIds) {
      journal.push({
        assertionId: id,
        outcome: "superseded",
        reason: "a later response for this quotation version",
      });
    }
    for (const id of resolution.conflictIds) {
      journal.push({
        assertionId: id,
        outcome: "conflict",
        reason: "contradictory accept/reject at the same instant",
      });
    }
    if (resolution.conflict) {
      reasons.push(
        `conflicting accept/reject for quotation version ${quotationVersionId}`,
      );
      continue;
    }
    const winner = resolution.winner;
    if (winner === null) continue;
    quoteResponses.push({
      quotationVersionId,
      response: winner.payload,
      sourceId: winner.sourceId,
      assertionId: winner.assertionId,
      sentAt: winner.sentAtRaw,
      excerpt: excerptFor(winner.assertionId),
    });
  }

  const reasonsBeforeLifecycle = reasons.length;
  const lifecycle = resolveLifecycle(lifecycleEvents, journal, reasons);
  const requestStatus: RequestStatus =
    ambiguousLifecycle || reasons.length > reasonsBeforeLifecycle
      ? { state: "undetermined" }
      : lifecycle.lastValidEvent !== null
      ? {
        state: lifecycle.finalState,
        sourceId: lifecycle.lastValidEvent.sourceId,
        assertionId: lifecycle.lastValidEvent.assertionId,
        sentAt: lifecycle.lastValidEvent.sentAtRaw,
        excerpt: excerptFor(lifecycle.lastValidEvent.assertionId),
      }
      : { state: lifecycle.finalState };

  fields.sort((a, b) =>
    stringCompare(groupKey(a.scope, a.field), groupKey(b.scope, b.field))
  );
  quoteResponses.sort((a, b) =>
    stringCompare(a.quotationVersionId, b.quotationVersionId)
  );
  protectedFactConflicts.sort((a, b) =>
    stringCompare(
      `${groupKey(a.scope, a.field)}::${a.conflictingAssertionId}`,
      `${groupKey(b.scope, b.field)}::${b.conflictingAssertionId}`,
    )
  );
  const sortedProtectedFacts = [...envelope.protectedFacts].sort((a, b) =>
    stringCompare(groupKey(a.scope, a.field), groupKey(b.scope, b.field))
  );
  journal.sort((a, b) => stringCompare(a.assertionId, b.assertionId));
  reasons.sort(stringCompare);
  const provenanceJournal: JournalEntry[] = journal.map((entry) => {
    const a = assertionById.get(entry.assertionId)!;
    return {
      ...entry,
      sourceId: a.sourceId,
      scope: a.scope,
      operation: a.operation,
      excerpt: a.excerpt,
      ...("field" in a ? { field: a.field } : {}),
      ...("value" in a ? { value: a.value } : {}),
      ...("quotationVersionId" in a
        ? { quotationVersionId: a.quotationVersionId }
        : {}),
    };
  });

  const hasConfirmedFieldInstruction = provenanceJournal.some((j) =>
    j.outcome === "applied" &&
    (j.operation === "set" || j.operation === "remove")
  );
  const hasEffect = fields.length > 0 || lifecycle.lastValidEvent !== null ||
    quoteResponses.length > 0 || hasConfirmedFieldInstruction;
  const hasReview = reasons.length > 0;

  if (hasReview) {
    return {
      schemaVersion: SCHEMA_VERSION,
      caseId: envelope.caseId,
      kind: "needs_review",
      reasons,
      requestStatus,
      fields,
      protectedFacts: sortedProtectedFacts,
      protectedFactConflicts,
      quoteResponses,
      journal: provenanceJournal,
    };
  }
  if (!hasEffect) {
    return {
      schemaVersion: SCHEMA_VERSION,
      caseId: envelope.caseId,
      kind: "no_request",
      protectedFacts: sortedProtectedFacts,
      journal: provenanceJournal,
    };
  }
  if (requestStatus.state === "cancelled") {
    return {
      schemaVersion: SCHEMA_VERSION,
      caseId: envelope.caseId,
      kind: "cancelled",
      requestStatus,
      fields,
      protectedFacts: sortedProtectedFacts,
      quoteResponses,
      journal: provenanceJournal,
    };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    caseId: envelope.caseId,
    kind: "consistent",
    requestStatus,
    fields,
    protectedFacts: sortedProtectedFacts,
    quoteResponses,
    journal: provenanceJournal,
  };
}

/**
 * Résolveur pur : produit la demande commerciale consolidée à partir d'un
 * inventaire de sources/assertions/protectedFacts. Ne persiste rien, ne lit
 * rien, ne dépend d'aucune horloge. Voir header de fichier pour la frontière
 * exacte de ce contrat (P1-C1).
 */
export function resolveFinalRequestState(
  raw: unknown,
): FinalRequestStateResult {
  const parsed = parseEnvelope(raw);
  if (!parsed.ok) {
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: "invalid_input",
      reason: parsed.reason,
    };
  }
  return resolve(parsed.value);
}
