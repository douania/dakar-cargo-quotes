/**
 * Adaptateur de saisie humaine typée pour les assertions P1-C1.
 *
 * PORTÉE STRICTE :
 *   - Aucune extraction LLM/heuristique, aucun parsing d'email, aucune
 *     déduction métier. L'utilisateur choisit explicitement chaque champ ;
 *     ce module ne fait que valider/structurer ce choix selon le vocabulaire
 *     fermé du contrat C1 (voir supabase/functions/_shared/final-request-state.ts).
 *   - Fonctions pures, fail-closed : toute entrée ambiguë ou hors contrat
 *     est rejetée avec un message clair plutôt que corrigée/devinée.
 *   - N'accepte jamais une source qui n'est pas exactement
 *     authorRole=client, roleVerified=true, contentClass=current, avec une
 *     sentAt non nulle et un texte non vide.
 */

// ── Vocabulaire fermé (identique à C1) ──────────────────────────────────────

export const ASSERTION_FIELD_KEYS = [
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
export type AssertionFieldKey = typeof ASSERTION_FIELD_KEYS[number];
const FIELD_KEY_SET: ReadonlySet<string> = new Set(ASSERTION_FIELD_KEYS);

export const ASSERTION_OPERATIONS = [
  "set",
  "remove",
  "cancel_request",
  "resume_request",
  "accept_quote",
  "reject_quote",
  "acknowledge",
] as const;
export type AssertionOperation = typeof ASSERTION_OPERATIONS[number];
const OPERATION_SET: ReadonlySet<string> = new Set(ASSERTION_OPERATIONS);

export const CONTAINER_TYPES = [
  "20GP",
  "40GP",
  "40HC",
  "20RF",
  "40RF",
  "20OT",
  "40OT",
  "20FR",
  "40FR",
] as const;
export const INCOTERMS = [
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
] as const;
export const TRANSPORT_MODES = ["AIR", "MARITIME", "ROUTE", "MULTIMODAL"] as const;
export const MOVEMENT_DIRECTIONS = [
  "IMPORT",
  "EXPORT",
  "REEXPORT",
  "TRANSIT",
  "CROSS_TRADE",
] as const;
export const TERMINAL_OPERATION_MODES = ["LOLO", "RORO", "CONRO"] as const;

const MAX_STRING_FIELD_LEN = 500;
const MAX_EXCERPT_LEN = 2000;
export const MAX_DRAFT_ASSERTIONS = 100;

export type FieldValueKind =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "integer" }
  | { kind: "boolean" }
  | { kind: "enum"; options: readonly string[] };

const FIELD_VALUE_KIND: Record<AssertionFieldKey, FieldValueKind> = {
  "cargo.description": { kind: "string" },
  "routing.origin_port": { kind: "string" },
  "routing.destination_port": { kind: "string" },
  "routing.destination_city": { kind: "string" },
  "cargo.weight_kg": { kind: "number" },
  "cargo.volume_cbm": { kind: "number" },
  "cargo.pieces_count": { kind: "integer" },
  "cargo.container_type": { kind: "enum", options: CONTAINER_TYPES },
  "routing.incoterm": { kind: "enum", options: INCOTERMS },
  "transport.mode": { kind: "enum", options: TRANSPORT_MODES },
  "movement.direction": { kind: "enum", options: MOVEMENT_DIRECTIONS },
  "terminal.operation_mode": { kind: "enum", options: TERMINAL_OPERATION_MODES },
  "lot.in_scope": { kind: "boolean" },
  "service.TRUCKING": { kind: "boolean" },
  "service.DTHC": { kind: "boolean" },
  "service.CUSTOMS_DAKAR": { kind: "boolean" },
  "service.SEA_FREIGHT": { kind: "boolean" },
};

export function fieldValueKind(field: AssertionFieldKey): FieldValueKind {
  return FIELD_VALUE_KIND[field];
}

export function fieldRequiresLotScope(field: AssertionFieldKey): boolean {
  return field === "lot.in_scope";
}

export function operationRequiresCaseScope(operation: AssertionOperation): boolean {
  return operation === "cancel_request" || operation === "resume_request" ||
    operation === "accept_quote" || operation === "reject_quote";
}

// ── Types publics ────────────────────────────────────────────────────────────

export type AssertionScope = "case" | { lotId: string };

export type Assertion =
  | {
    id: string;
    sourceId: string;
    scope: AssertionScope;
    operation: "set";
    field: AssertionFieldKey;
    value: string | number | boolean;
    excerpt: string;
  }
  | {
    id: string;
    sourceId: string;
    scope: AssertionScope;
    operation: "remove";
    field: AssertionFieldKey;
    excerpt: string;
  }
  | {
    id: string;
    sourceId: string;
    scope: AssertionScope;
    operation: "cancel_request" | "resume_request";
    excerpt: string;
  }
  | {
    id: string;
    sourceId: string;
    scope: AssertionScope;
    operation: "accept_quote" | "reject_quote";
    quotationVersionId: string;
    excerpt: string;
  }
  | {
    id: string;
    sourceId: string;
    scope: AssertionScope;
    operation: "acknowledge";
    excerpt: string;
  };

export interface EligibleAssertionSource {
  id: string;
  kind: string;
  sentAt: string;
  text: string;
}

export interface BuildAssertionContext {
  sources: readonly EligibleAssertionSource[];
  lotIds: readonly string[];
  quotationVersionIds: readonly string[];
}

export interface BuildAssertionRequest {
  sourceId: string;
  operation: AssertionOperation;
  scopeKind: "case" | "lot";
  lotId?: string;
  field?: AssertionFieldKey;
  rawValue?: string;
  quotationVersionId?: string;
  excerpt: string;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}
function fail<T>(error: string): Result<T> {
  return { ok: false, error };
}

// ── Sources éligibles ────────────────────────────────────────────────────────

interface RawBaseInputSourceLike {
  id?: unknown;
  kind?: unknown;
  authorRole?: unknown;
  roleVerified?: unknown;
  contentClass?: unknown;
  sentAt?: unknown;
  text?: unknown;
}

const SOURCE_KIND_SET = new Set(["email", "document", "operator"]);
const EXPLICIT_INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function isBoundedId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    value.trim() === value && !/[\s\p{Cc}]/u.test(value);
}

function isExplicitInstant(value: unknown): value is string {
  return typeof value === "string" && value.length <= 35 &&
    EXPLICIT_INSTANT_RE.test(value) && Number.isFinite(Date.parse(value));
}

/**
 * Seules les sources courantes, attestées, du client sont saisissables.
 * Toute autre combinaison (partenaire, opérateur, historique, non attestée,
 * date manquante, texte vide) est exclue, jamais devinée.
 */
export function getEligibleSources(
  baseInputSources: readonly RawBaseInputSourceLike[] | undefined | null,
): EligibleAssertionSource[] {
  if (!Array.isArray(baseInputSources)) return [];
  const out: EligibleAssertionSource[] = [];
  for (const s of baseInputSources) {
    if (
      isBoundedId(s?.id) &&
      typeof s.kind === "string" && SOURCE_KIND_SET.has(s.kind) &&
      s.authorRole === "client" &&
      s.roleVerified === true &&
      s.contentClass === "current" &&
      isExplicitInstant(s.sentAt) &&
      typeof s.text === "string" && s.text.trim().length > 0 &&
      s.text.length <= 20000
    ) {
      out.push({ id: s.id, kind: s.kind, sentAt: s.sentAt, text: s.text });
    }
  }
  return out;
}

// ── Parsing de valeurs typées ────────────────────────────────────────────────

const DECIMAL_RE = /^\d+([.,]\d+)?$/;
const INTEGER_RE = /^\d+$/;

function parseDecimal(raw: string): Result<number> {
  if (!DECIMAL_RE.test(raw)) {
    return fail(
      "Nombre invalide : utilisez uniquement des chiffres et, si besoin, un séparateur décimal (. ou ,), sans notation scientifique ni séparateur de milliers.",
    );
  }
  const value = Number(raw.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) {
    return fail("La valeur doit être un nombre strictement positif.");
  }
  return ok(value);
}

function parsePositiveInteger(raw: string): Result<number> {
  if (!INTEGER_RE.test(raw)) {
    return fail(
      "Nombre de pièces invalide : entier positif uniquement, sans séparateur ni décimale.",
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    return fail("Le nombre de pièces doit être un entier strictement positif.");
  }
  return ok(value);
}

function parseFieldValue(
  field: AssertionFieldKey,
  raw: string | undefined,
): Result<string | number | boolean> {
  const value = raw ?? "";
  const kind = fieldValueKind(field);
  switch (kind.kind) {
    case "string": {
      if (value.trim().length === 0 || value.length > MAX_STRING_FIELD_LEN) {
        return fail(
          `${field} doit être un texte non vide d'au plus ${MAX_STRING_FIELD_LEN} caractères.`,
        );
      }
      return ok(value);
    }
    case "number":
      return parseDecimal(value);
    case "integer":
      return parsePositiveInteger(value);
    case "boolean": {
      if (value !== "true" && value !== "false") {
        return fail(`${field} doit être vrai ou faux.`);
      }
      return ok(value === "true");
    }
    case "enum": {
      if (!kind.options.includes(value)) {
        return fail(`${field} doit être une valeur reconnue.`);
      }
      return ok(value);
    }
  }
}

// ── Portée ───────────────────────────────────────────────────────────────────

function parseScope(
  scopeKind: "case" | "lot",
  lotId: string | undefined,
  lotIds: ReadonlySet<string>,
): Result<AssertionScope> {
  if (scopeKind === "case") return ok("case");
  if (!lotId || !lotIds.has(lotId)) {
    return fail("Ce lot n'appartient pas à la capture courante.");
  }
  return ok({ lotId });
}

// ── Extrait verbatim ─────────────────────────────────────────────────────────

function validateExcerpt(excerpt: string, sourceText: string): Result<string> {
  if (excerpt.trim().length === 0) {
    return fail("L'extrait ne peut pas être vide.");
  }
  if (excerpt.length > MAX_EXCERPT_LEN) {
    return fail(`L'extrait dépasse ${MAX_EXCERPT_LEN} caractères.`);
  }
  if (!sourceText.includes(excerpt)) {
    return fail(
      "L'extrait doit être présent exactement (mot pour mot) dans le texte capturé de la source choisie.",
    );
  }
  return ok(excerpt);
}

// ── Construction d'une assertion ─────────────────────────────────────────────

export function buildAssertion(
  request: BuildAssertionRequest,
  ctx: BuildAssertionContext,
): Result<Assertion> {
  const source = ctx.sources.find((s) => s.id === request.sourceId);
  if (!source) {
    return fail("Source introuvable ou non éligible dans la capture courante.");
  }
  if (!OPERATION_SET.has(request.operation)) {
    return fail("Opération inconnue.");
  }

  const excerptResult = validateExcerpt(request.excerpt, source.text);
  if (excerptResult.ok === false) return fail(excerptResult.error);
  const excerpt = excerptResult.value;

  const lotIdSet = new Set(ctx.lotIds);
  const quoteIdSet = new Set(ctx.quotationVersionIds);
  const id = crypto.randomUUID();

  if (operationRequiresCaseScope(request.operation) && request.scopeKind !== "case") {
    return fail("Cette opération exige le scope dossier (pas de lot).");
  }

  switch (request.operation) {
    case "set":
    case "remove": {
      if (!request.field || !FIELD_KEY_SET.has(request.field)) {
        return fail("Champ inconnu ou non sélectionné.");
      }
      const field = request.field;
      if (fieldRequiresLotScope(field) && request.scopeKind !== "lot") {
        return fail(`${field} exige un lot précis.`);
      }
      const scopeResult = parseScope(request.scopeKind, request.lotId, lotIdSet);
      if (scopeResult.ok === false) return fail(scopeResult.error);

      if (request.operation === "remove") {
        return ok({
          id,
          sourceId: source.id,
          scope: scopeResult.value,
          operation: "remove",
          field,
          excerpt,
        });
      }
      const valueResult = parseFieldValue(field, request.rawValue);
      if (valueResult.ok === false) return fail(valueResult.error);
      return ok({
        id,
        sourceId: source.id,
        scope: scopeResult.value,
        operation: "set",
        field,
        value: valueResult.value,
        excerpt,
      });
    }
    case "cancel_request":
    case "resume_request":
      return ok({
        id,
        sourceId: source.id,
        scope: "case",
        operation: request.operation,
        excerpt,
      });
    case "accept_quote":
    case "reject_quote": {
      if (!request.quotationVersionId || !quoteIdSet.has(request.quotationVersionId)) {
        return fail("Cette version de devis n'appartient pas à la capture courante.");
      }
      return ok({
        id,
        sourceId: source.id,
        scope: "case",
        operation: request.operation,
        quotationVersionId: request.quotationVersionId,
        excerpt,
      });
    }
    case "acknowledge": {
      const scopeResult = parseScope(request.scopeKind, request.lotId, lotIdSet);
      if (scopeResult.ok === false) return fail(scopeResult.error);
      return ok({
        id,
        sourceId: source.id,
        scope: scopeResult.value,
        operation: "acknowledge",
        excerpt,
      });
    }
  }
}

// ── Brouillon ────────────────────────────────────────────────────────────────

function canonicalScope(scope: AssertionScope): unknown {
  return scope === "case" ? "case" : { lotId: scope.lotId };
}

function signatureOf(a: Assertion): string {
  const base: Record<string, unknown> = {
    sourceId: a.sourceId,
    scope: canonicalScope(a.scope),
    operation: a.operation,
  };
  if ("field" in a) base.field = a.field;
  if ("value" in a) base.value = a.value;
  if ("quotationVersionId" in a) base.quotationVersionId = a.quotationVersionId;
  base.excerpt = a.excerpt;
  return JSON.stringify(base);
}

export function isDuplicateAssertion(
  draft: readonly Assertion[],
  candidate: Assertion,
): boolean {
  const sig = signatureOf(candidate);
  return draft.some((a) => signatureOf(a) === sig);
}

export function addAssertion(
  draft: readonly Assertion[],
  candidate: Assertion,
): Result<Assertion[]> {
  if (draft.length >= MAX_DRAFT_ASSERTIONS) {
    return fail(`Limite de ${MAX_DRAFT_ASSERTIONS} assertions par brouillon atteinte.`);
  }
  if (isDuplicateAssertion(draft, candidate)) {
    return fail("Cette assertion existe déjà dans le brouillon.");
  }
  return ok([...draft, candidate]);
}

export function removeAssertion(
  draft: readonly Assertion[],
  id: string,
): Assertion[] {
  return draft.filter((a) => a.id !== id);
}

export function describeAssertion(a: Assertion): string {
  const scopeLabel = a.scope === "case" ? "dossier" : `lot ${a.scope.lotId}`;
  switch (a.operation) {
    case "set":
      return `Définir ${a.field} = ${String(a.value)} (${scopeLabel})`;
    case "remove":
      return `Retirer ${a.field} (${scopeLabel})`;
    case "cancel_request":
      return "Annuler la demande (dossier)";
    case "resume_request":
      return "Reprendre la demande (dossier)";
    case "accept_quote":
      return `Accepter le devis ${a.quotationVersionId} (dossier)`;
    case "reject_quote":
      return `Refuser le devis ${a.quotationVersionId} (dossier)`;
    case "acknowledge":
      return `Accusé de réception (${scopeLabel})`;
  }
}

// ── Rechargement fail-closed depuis une révision courante ───────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ASSERTION_KEYS = [
  "id",
  "sourceId",
  "scope",
  "operation",
  "field",
  "value",
  "quotationVersionId",
  "excerpt",
] as const;

function parseLoadedAssertion(
  raw: unknown,
  ctx: BuildAssertionContext,
): Result<Assertion> {
  if (!isPlainObject(raw)) return fail("Assertion chargée invalide.");
  for (const key of Object.keys(raw)) {
    if (!(ASSERTION_KEYS as readonly string[]).includes(key)) {
      return fail("Assertion chargée invalide.");
    }
  }
  if (!isBoundedId(raw.id)) {
    return fail("Assertion chargée invalide.");
  }
  if (typeof raw.sourceId !== "string") {
    return fail("Assertion chargée invalide.");
  }
  const source = ctx.sources.find((s) => s.id === raw.sourceId);
  if (!source) return fail("Source de l'assertion chargée non éligible.");

  const lotIdSet = new Set(ctx.lotIds);
  let scope: AssertionScope;
  if (raw.scope === "case") {
    scope = "case";
  } else if (
    isPlainObject(raw.scope) && Object.keys(raw.scope).length === 1 &&
    typeof raw.scope.lotId === "string" && lotIdSet.has(raw.scope.lotId)
  ) {
    scope = { lotId: raw.scope.lotId };
  } else {
    return fail("Portée de l'assertion chargée invalide.");
  }

  if (typeof raw.operation !== "string" || !OPERATION_SET.has(raw.operation)) {
    return fail("Opération de l'assertion chargée invalide.");
  }
  const operation = raw.operation as AssertionOperation;
  if (operationRequiresCaseScope(operation) && scope !== "case") {
    return fail("Portée incompatible avec l'opération chargée.");
  }

  if (typeof raw.excerpt !== "string") return fail("Extrait chargé invalide.");
  const excerptResult = validateExcerpt(raw.excerpt, source.text);
  if (excerptResult.ok === false) return fail(excerptResult.error);
  const excerpt = excerptResult.value;

  const hasField = Object.prototype.hasOwnProperty.call(raw, "field");
  const hasValue = Object.prototype.hasOwnProperty.call(raw, "value");
  const hasQuote = Object.prototype.hasOwnProperty.call(raw, "quotationVersionId");

  if (operation === "set" || operation === "remove") {
    if (!hasField || hasQuote || (operation === "set" && !hasValue) ||
      (operation === "remove" && hasValue)) {
      return fail("Assertion chargée incohérente avec son opération.");
    }
    if (typeof raw.field !== "string" || !FIELD_KEY_SET.has(raw.field)) {
      return fail("Champ de l'assertion chargée invalide.");
    }
    const field = raw.field as AssertionFieldKey;
    if (fieldRequiresLotScope(field) && scope === "case") {
      return fail("Portée incompatible avec le champ chargé.");
    }
    if (operation === "remove") {
      return ok({ id: raw.id, sourceId: source.id, scope, operation, field, excerpt });
    }
    const kind = fieldValueKind(field);
    const rawValue = raw.value;
    let value: string | number | boolean;
    if (kind.kind === "string") {
      if (
        typeof rawValue !== "string" || rawValue.trim().length === 0 ||
        rawValue.length > MAX_STRING_FIELD_LEN
      ) return fail("Valeur de l'assertion chargée invalide.");
      value = rawValue;
    } else if (kind.kind === "number") {
      if (typeof rawValue !== "number" || !Number.isFinite(rawValue) || rawValue <= 0) {
        return fail("Valeur de l'assertion chargée invalide.");
      }
      value = rawValue;
    } else if (kind.kind === "integer") {
      if (typeof rawValue !== "number" || !Number.isSafeInteger(rawValue) || rawValue <= 0) {
        return fail("Valeur de l'assertion chargée invalide.");
      }
      value = rawValue;
    } else if (kind.kind === "boolean") {
      if (typeof rawValue !== "boolean") return fail("Valeur de l'assertion chargée invalide.");
      value = rawValue;
    } else {
      if (typeof rawValue !== "string" || !kind.options.includes(rawValue)) {
        return fail("Valeur de l'assertion chargée invalide.");
      }
      value = rawValue;
    }
    return ok({ id: raw.id, sourceId: source.id, scope, operation, field, value, excerpt });
  }

  if (operation === "cancel_request" || operation === "resume_request") {
    if (hasField || hasValue || hasQuote) {
      return fail("Assertion chargée incohérente avec son opération.");
    }
    return ok({ id: raw.id, sourceId: source.id, scope, operation, excerpt });
  }

  if (operation === "accept_quote" || operation === "reject_quote") {
    if (hasField || hasValue || !hasQuote) {
      return fail("Assertion chargée incohérente avec son opération.");
    }
    if (
      typeof raw.quotationVersionId !== "string" ||
      !ctx.quotationVersionIds.includes(raw.quotationVersionId)
    ) {
      return fail("Version de devis de l'assertion chargée invalide.");
    }
    return ok({
      id: raw.id,
      sourceId: source.id,
      scope,
      operation,
      quotationVersionId: raw.quotationVersionId,
      excerpt,
    });
  }

  // acknowledge
  if (hasField || hasValue || hasQuote) {
    return fail("Assertion chargée incohérente avec son opération.");
  }
  return ok({ id: raw.id, sourceId: source.id, scope, operation, excerpt });
}

/**
 * Recharge un brouillon depuis les assertions d'une révision déjà persistée
 * pour la MÊME capture. Fail-closed : toute incohérence structurelle
 * (source non éligible, champ/portée/valeur hors contrat, extrait non
 * verbatim) rejette le chargement entier plutôt que de le corriger.
 */
export function loadDraftFromRevisionAssertions(
  rawAssertions: unknown,
  ctx: BuildAssertionContext,
): Assertion[] | null {
  if (!Array.isArray(rawAssertions)) return null;
  if (rawAssertions.length > MAX_DRAFT_ASSERTIONS) return null;
  const seen = new Set<string>();
  const ids = new Set<string>();
  const out: Assertion[] = [];
  for (const raw of rawAssertions) {
    const parsed = parseLoadedAssertion(raw, ctx);
    if (!parsed.ok) return null;
    if (ids.has(parsed.value.id)) return null;
    ids.add(parsed.value.id);
    const sig = signatureOf(parsed.value);
    if (seen.has(sig)) return null;
    seen.add(sig);
    out.push(parsed.value);
  }
  return out;
}
