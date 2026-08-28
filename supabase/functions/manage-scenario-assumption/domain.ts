/**
 * Phase P1-A1 — Domaine PUR de l'Edge Function manage-scenario-assumption.
 *
 * Aucune I/O, aucun accès Deno.env, aucun client Supabase : tout est testable
 * hors runtime. index.ts n'ajoute que l'auth, le contrôle d'accès au dossier et
 * l'appel RPC.
 *
 * Contrat P1-A1 :
 *   - opérations autorisées : create | revise | confirm_client | refute ;
 *   - AUCUNE promotion vers quote_facts (rejet explicite et nommé) ;
 *   - aucune identité ni aucun état ne peut être fourni par l'appelant :
 *     created_by / resolved_by / status / id / promoted_fact_id … sont refusés ;
 *   - la valeur d'hypothèse est explicitement typée, en une seule représentation ;
 *   - l'empreinte de requête est calculée SERVEUR à partir du payload normalisé,
 *     jamais transmise par le client.
 */

// ── Vocabulaires fermés ────────────────────────────────────────────────────

export const ASSUMPTION_OPERATIONS = [
  "create",
  "revise",
  "confirm_client",
  "refute",
] as const;
export type AssumptionOperation = (typeof ASSUMPTION_OPERATIONS)[number];

/**
 * Opérations nommant une promotion. Elles ne sont pas « inconnues » : elles sont
 * refusées avec un code dédié, pour que le refus soit lisible côté appelant et
 * ne puisse pas être confondu avec une faute de frappe.
 */
export const PROMOTION_OPERATIONS = [
  "promote",
  "promote_to_fact",
  "promote_to_facts",
  "promotion",
] as const;

export const ASSUMPTION_VALUE_TYPES = [
  "text",
  "number",
  "boolean",
  "date",
  "json",
] as const;
export type AssumptionValueType = (typeof ASSUMPTION_VALUE_TYPES)[number];

/** Aligné sur quote_scenario_assumptions_type_check (20260624120000). */
export const ASSUMPTION_TYPES = [
  "value",
  "hs",
  "pad",
  "weight",
  "dimensions",
  "quantity",
  "category",
  "partner_cost",
  "service_scope",
  "other",
] as const;

/** Aligné sur quote_scenario_assumptions_source_type_check. */
export const ASSUMPTION_SOURCE_TYPES = [
  "operator_guidance",
  "document_analogy",
  "prior_client_info",
  "internal_experience",
  "other",
] as const;

export const ASSUMPTION_RISK_LEVELS = ["low", "medium", "high"] as const;

/**
 * Clés qu'un appelant ne peut JAMAIS fournir. Elles sont soit fixées par le
 * serveur (identité, horodatage, statut), soit hors périmètre P1-A1
 * (promotion), soit dérivées (empreinte, liens de supersession).
 * Refus explicite plutôt que silencieux : un client qui les envoie a un modèle
 * mental faux, le lui dire vaut mieux que de l'ignorer.
 */
export const FORBIDDEN_PAYLOAD_KEYS = [
  "id",
  "created_by",
  "resolved_by",
  "actor_user_id",
  "user_id",
  "status",
  "resolved_at",
  "created_at",
  "updated_at",
  "promoted_fact_id",
  "superseded_by_assumption_id",
  "supersedes_assumption_id",
  "request_fingerprint",
] as const;

/** Champs de contenu interdits sur une transition terminale (confirm/refute). */
const CONTENT_KEYS = [
  "scope_key",
  "assumption_type",
  "assumed_fact_key",
  "gap_key",
  "client_gap_request_id",
  "statement",
  "basis",
  "source_type",
  "source_refs",
  "assumed_value_type",
  "assumed_value",
  "client_visible",
  "risk_level",
  "metadata",
] as const;

/** Champs de périmètre : posés à la création, HÉRITÉS par toute révision. */
const PERIMETER_KEYS = [
  "scope_key",
  "assumption_type",
  "assumed_fact_key",
  "gap_key",
  "client_gap_request_id",
] as const;

export const MAX_STATEMENT_LENGTH = 2000;
export const MAX_BASIS_LENGTH = 2000;
export const MAX_TEXT_VALUE_LENGTH = 2000;
export const MAX_JSON_VALUE_CHARS = 8000;
export const MAX_SOURCE_REFS = 20;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Doit rester le miroir exact de quote_scenario_assumptions_scope_key_format. */
const SCOPE_KEY_RE = /^[a-z][a-z0-9_]*(:[A-Za-z0-9._-]{1,64})?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Types ──────────────────────────────────────────────────────────────────

export type ValidationErrorCode =
  | "VALIDATION_FAILED"
  | "PROMOTION_NOT_ALLOWED";

export interface NormalizedAssumptionRequest {
  case_id: string;
  operation: AssumptionOperation;
  idempotency_key: string;
  assumption_id: string | null;
  scope_key: string | null;
  assumption_type: string | null;
  assumed_fact_key: string | null;
  gap_key: string | null;
  client_gap_request_id: string | null;
  statement: string | null;
  basis: string | null;
  source_type: string | null;
  source_refs: unknown[] | null;
  assumed_value_type: AssumptionValueType | null;
  assumed_value: unknown;
  client_visible: boolean | null;
  risk_level: string | null;
  metadata: Record<string, unknown> | null;
}

export type ValidationResult =
  | { ok: true; value: NormalizedAssumptionRequest }
  | { ok: false; code: ValidationErrorCode; message: string };

// ── Helpers ────────────────────────────────────────────────────────────────

const fail = (message: string): ValidationResult => ({
  ok: false,
  code: "VALIDATION_FAILED",
  message,
});

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function optionalTrimmed(
  raw: unknown,
  field: string,
  max: number,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, message: `${field} doit être une chaîne` };
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (trimmed.length > max) {
    return { ok: false, message: `${field} dépasse ${max} caractères` };
  }
  return { ok: true, value: trimmed };
}

/** Valide qu'une chaîne ISO `YYYY-MM-DD` désigne une date réelle du calendrier. */
export function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= daysInMonth;
}

/**
 * Valide la valeur d'hypothèse contre son type déclaré et renvoie la forme
 * exacte qui sera stockée dans le jsonb `assumed_value`.
 * Miroir applicatif du CHECK quote_scenario_assumptions_value_typed : la base
 * reste l'autorité, cette fonction ne fait que produire une erreur lisible.
 */
export function normalizeAssumptionValue(
  valueType: AssumptionValueType,
  raw: unknown,
): { ok: true; value: unknown } | { ok: false; message: string } {
  switch (valueType) {
    case "text": {
      if (typeof raw !== "string") return { ok: false, message: "assumed_value doit être une chaîne pour le type text" };
      const trimmed = raw.trim();
      if (trimmed === "") return { ok: false, message: "assumed_value ne peut pas être vide pour le type text" };
      if (trimmed.length > MAX_TEXT_VALUE_LENGTH) {
        return { ok: false, message: `assumed_value dépasse ${MAX_TEXT_VALUE_LENGTH} caractères` };
      }
      return { ok: true, value: trimmed };
    }
    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return { ok: false, message: "assumed_value doit être un nombre fini pour le type number" };
      }
      return { ok: true, value: raw };
    }
    case "boolean": {
      if (typeof raw !== "boolean") {
        return { ok: false, message: "assumed_value doit être un booléen pour le type boolean" };
      }
      return { ok: true, value: raw };
    }
    case "date": {
      if (typeof raw !== "string" || !isRealIsoDate(raw.trim())) {
        return { ok: false, message: "assumed_value doit être une date calendaire ISO YYYY-MM-DD pour le type date" };
      }
      return { ok: true, value: raw.trim() };
    }
    case "json": {
      if (raw === null || typeof raw !== "object") {
        return { ok: false, message: "assumed_value doit être un objet ou un tableau pour le type json" };
      }
      let serialized: string;
      try {
        serialized = JSON.stringify(raw);
      } catch {
        return { ok: false, message: "assumed_value n'est pas sérialisable en JSON" };
      }
      if (serialized === undefined || serialized.length > MAX_JSON_VALUE_CHARS) {
        return { ok: false, message: `assumed_value dépasse ${MAX_JSON_VALUE_CHARS} caractères sérialisés` };
      }
      return { ok: true, value: raw };
    }
  }
}

// ── Validation du payload ──────────────────────────────────────────────────

export function validateManageAssumptionPayload(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) return fail("Le corps de la requête doit être un objet JSON");

  // 1. Promotion : refus nommé, AVANT toute autre analyse.
  const rawOperation = raw.operation;
  if (typeof rawOperation === "string" && (PROMOTION_OPERATIONS as readonly string[]).includes(rawOperation)) {
    return {
      ok: false,
      code: "PROMOTION_NOT_ALLOWED",
      message:
        "La promotion d'une hypothèse vers quote_facts est hors périmètre P1-A1. " +
        "PAD, HS, droits, taxes et coûts partenaires passent par leurs workflows dédiés.",
    };
  }

  // 2. Identité / état / liens : jamais fournis par l'appelant.
  const forbidden = FORBIDDEN_PAYLOAD_KEYS.filter((k) => k in raw);
  if (forbidden.length > 0) {
    return fail(
      `Champs interdits dans le payload : ${forbidden.join(", ")}. ` +
        "L'identité et l'état sont fixés côté serveur.",
    );
  }

  // 3. Opération.
  if (typeof rawOperation !== "string" || !(ASSUMPTION_OPERATIONS as readonly string[]).includes(rawOperation)) {
    return fail(`operation invalide. Autorisées : ${ASSUMPTION_OPERATIONS.join(", ")}`);
  }
  const operation = rawOperation as AssumptionOperation;

  // 4. Dossier.
  if (typeof raw.case_id !== "string" || !UUID_RE.test(raw.case_id)) {
    return fail("case_id doit être un UUID");
  }

  // 5. Clé d'idempotence (fournie par l'appelant, l'empreinte ne l'est jamais).
  if (typeof raw.idempotency_key !== "string") return fail("idempotency_key est obligatoire");
  const idempotencyKey = raw.idempotency_key.trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return fail("idempotency_key doit faire 8 à 128 caractères");
  }

  // 6. Cible.
  let assumptionId: string | null = null;
  if (operation === "create") {
    if ("assumption_id" in raw && raw.assumption_id !== null && raw.assumption_id !== undefined) {
      return fail("assumption_id n'a pas de sens pour operation=create");
    }
  } else {
    if (typeof raw.assumption_id !== "string" || !UUID_RE.test(raw.assumption_id)) {
      return fail(`assumption_id (UUID) est obligatoire pour operation=${operation}`);
    }
    assumptionId = raw.assumption_id;
  }

  const base: NormalizedAssumptionRequest = {
    case_id: raw.case_id,
    operation,
    idempotency_key: idempotencyKey,
    assumption_id: assumptionId,
    scope_key: null,
    assumption_type: null,
    assumed_fact_key: null,
    gap_key: null,
    client_gap_request_id: null,
    statement: null,
    basis: null,
    source_type: null,
    source_refs: null,
    assumed_value_type: null,
    assumed_value: undefined,
    client_visible: null,
    risk_level: null,
    metadata: null,
  };

  // 7. Transitions terminales : aucun contenu, sinon l'appelant croit modifier
  //    l'hypothèse alors que confirm/refute ne changent que le statut.
  if (operation === "confirm_client" || operation === "refute") {
    const extra = CONTENT_KEYS.filter((k) => k in raw);
    if (extra.length > 0) {
      return fail(
        `operation=${operation} ne modifie que le statut : champs non autorisés ${extra.join(", ")}`,
      );
    }
    return { ok: true, value: base };
  }

  // 8. Le périmètre est posé à la création et HÉRITÉ par toute révision
  //    (arbitrage CTO n°4 : une révision remplace une valeur, elle ne déplace
  //    jamais ce sur quoi l'hypothèse porte).
  if (operation === "revise") {
    const moved = PERIMETER_KEYS.filter((k) => k in raw);
    if (moved.length > 0) {
      return fail(
        `operation=revise hérite du périmètre de l'hypothèse révisée : champs non autorisés ${moved.join(", ")}`,
      );
    }
  }

  // 9. Contenu commun create/revise.
  const statement = optionalTrimmed(raw.statement, "statement", MAX_STATEMENT_LENGTH);
  if (!statement.ok) return fail(statement.message);
  if (statement.value === null) return fail("statement est obligatoire et ne peut pas être vide");
  base.statement = statement.value;

  const basis = optionalTrimmed(raw.basis, "basis", MAX_BASIS_LENGTH);
  if (!basis.ok) return fail(basis.message);
  base.basis = basis.value;

  if (typeof raw.assumed_value_type !== "string" ||
      !(ASSUMPTION_VALUE_TYPES as readonly string[]).includes(raw.assumed_value_type)) {
    return fail(`assumed_value_type est obligatoire. Autorisés : ${ASSUMPTION_VALUE_TYPES.join(", ")}`);
  }
  const valueType = raw.assumed_value_type as AssumptionValueType;
  if (!("assumed_value" in raw)) return fail("assumed_value est obligatoire");
  const normalizedValue = normalizeAssumptionValue(valueType, raw.assumed_value);
  if (!normalizedValue.ok) return fail(normalizedValue.message);
  base.assumed_value_type = valueType;
  base.assumed_value = normalizedValue.value;

  if (raw.client_visible !== undefined) {
    if (typeof raw.client_visible !== "boolean") return fail("client_visible doit être un booléen");
    base.client_visible = raw.client_visible;
  } else {
    // Une création est fail-closed. Une révision sans valeur explicite hérite
    // de la visibilité précédente dans la RPC au lieu de la modifier en silence.
    base.client_visible = operation === "create" ? false : null;
  }

  if (raw.risk_level !== undefined) {
    if (typeof raw.risk_level !== "string" ||
        !(ASSUMPTION_RISK_LEVELS as readonly string[]).includes(raw.risk_level)) {
      return fail(`risk_level invalide. Autorisés : ${ASSUMPTION_RISK_LEVELS.join(", ")}`);
    }
    base.risk_level = raw.risk_level;
  }

  if (raw.source_type !== undefined) {
    if (typeof raw.source_type !== "string" ||
        !(ASSUMPTION_SOURCE_TYPES as readonly string[]).includes(raw.source_type)) {
      return fail(`source_type invalide. Autorisés : ${ASSUMPTION_SOURCE_TYPES.join(", ")}`);
    }
    base.source_type = raw.source_type;
  }

  if (raw.source_refs !== undefined && raw.source_refs !== null) {
    if (!Array.isArray(raw.source_refs)) return fail("source_refs doit être un tableau");
    if (raw.source_refs.length > MAX_SOURCE_REFS) {
      return fail(`source_refs dépasse ${MAX_SOURCE_REFS} entrées`);
    }
    base.source_refs = raw.source_refs;
  }

  if (raw.metadata !== undefined && raw.metadata !== null) {
    if (!isPlainObject(raw.metadata)) return fail("metadata doit être un objet");
    base.metadata = raw.metadata;
  }

  if (operation === "revise") return { ok: true, value: base };

  // Normaliser les valeurs par défaut de create avant l'empreinte : omettre
  // `source_type` et envoyer explicitement `operator_guidance` doivent décrire
  // la même requête sémantique et produire la même empreinte.
  base.source_type ??= "operator_guidance";
  base.source_refs ??= [];
  base.risk_level ??= "medium";
  base.metadata ??= {};

  // 10. Périmètre, création uniquement.
  if (typeof raw.assumption_type !== "string" ||
      !(ASSUMPTION_TYPES as readonly string[]).includes(raw.assumption_type)) {
    return fail(`assumption_type est obligatoire. Autorisés : ${ASSUMPTION_TYPES.join(", ")}`);
  }
  base.assumption_type = raw.assumption_type;

  if (raw.scope_key !== undefined && raw.scope_key !== null) {
    if (typeof raw.scope_key !== "string") return fail("scope_key doit être une chaîne");
    const scope = raw.scope_key.trim();
    if (scope.length > 120 || !SCOPE_KEY_RE.test(scope)) {
      return fail(
        "scope_key invalide : attendu `domaine` ou `domaine:suffixe` (minuscules, 120 caractères max)",
      );
    }
    if (UUID_RE.test(scope) || UUID_RE.test(scope.split(":")[1] ?? "")) {
      return fail(
        "scope_key ne peut pas contenir d'identifiant technique : le périmètre d'un scénario " +
          "sera un snapshot immuable, jamais un identifiant de ligne.",
      );
    }
    base.scope_key = scope;
  } else {
    base.scope_key = "case";
  }

  const factKey = optionalTrimmed(raw.assumed_fact_key, "assumed_fact_key", 200);
  if (!factKey.ok) return fail(factKey.message);
  base.assumed_fact_key = factKey.value;

  const gapKey = optionalTrimmed(raw.gap_key, "gap_key", 200);
  if (!gapKey.ok) return fail(gapKey.message);
  base.gap_key = gapKey.value;

  if (raw.client_gap_request_id !== undefined && raw.client_gap_request_id !== null) {
    if (typeof raw.client_gap_request_id !== "string" || !UUID_RE.test(raw.client_gap_request_id)) {
      return fail("client_gap_request_id doit être un UUID");
    }
    base.client_gap_request_id = raw.client_gap_request_id;
  }

  return { ok: true, value: base };
}

// ── Empreinte de requête ───────────────────────────────────────────────────

/**
 * Sérialisation canonique : clés triées récursivement, `undefined` normalisé.
 *
 * Volontairement PAS `_shared/canonical-hash.ts` : son `normalizeValue` reparse
 * toute chaîne qui ressemble à du JSON, donc deux `statement` distincts
 * (`'{"a":1}'` et `'{ "a" : 1 }'`) produiraient la même empreinte — un rejeu
 * serait accepté à la place d'un IDEMPOTENCY_CONFLICT. Ici, une chaîne reste
 * une chaîne.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

/**
 * Contenu couvert par l'empreinte : tout le payload normalisé SAUF la clé
 * d'idempotence. Même clé + même contenu → rejeu ; même clé + contenu différent
 * → conflit.
 */
export function buildFingerprintInput(
  request: NormalizedAssumptionRequest,
): Record<string, unknown> {
  return {
    assumed_fact_key: request.assumed_fact_key,
    assumed_value: request.assumed_value === undefined ? null : request.assumed_value,
    assumed_value_type: request.assumed_value_type,
    assumption_id: request.assumption_id,
    assumption_type: request.assumption_type,
    basis: request.basis,
    case_id: request.case_id,
    client_gap_request_id: request.client_gap_request_id,
    client_visible: request.client_visible,
    gap_key: request.gap_key,
    metadata: request.metadata,
    operation: request.operation,
    risk_level: request.risk_level,
    scope_key: request.scope_key,
    source_refs: request.source_refs,
    source_type: request.source_type,
    statement: request.statement,
  };
}

/** SHA-256 hexadécimal minuscule — format exigé par le CHECK de la table. */
export async function computeRequestFingerprint(
  request: NormalizedAssumptionRequest,
): Promise<string> {
  const canonical = stableStringify(buildFingerprintInput(request));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Arguments RPC ──────────────────────────────────────────────────────────

/**
 * `actorUserId` provient EXCLUSIVEMENT du JWT vérifié (auth.user.id), jamais du
 * payload : c'est ce qui rend created_by non forgeable.
 */
export function buildRpcArgs(
  request: NormalizedAssumptionRequest,
  actorUserId: string,
  fingerprint: string,
): Record<string, unknown> {
  return {
    p_case_id: request.case_id,
    p_operation: request.operation,
    p_actor_user_id: actorUserId,
    p_idempotency_key: request.idempotency_key,
    p_request_fingerprint: fingerprint,
    p_assumption_id: request.assumption_id,
    p_scope_key: request.scope_key ?? "case",
    p_assumption_type: request.assumption_type,
    p_assumed_fact_key: request.assumed_fact_key,
    p_gap_key: request.gap_key,
    p_client_gap_request_id: request.client_gap_request_id,
    p_statement: request.statement,
    p_basis: request.basis,
    // `null` est intentionnel pour revise : la RPC hérite alors de la
    // provenance de la révision précédente au lieu de l'effacer en silence.
    // Pour create, la RPC applique ses valeurs fail-closed explicites.
    p_source_type: request.source_type,
    p_source_refs: request.source_refs,
    p_assumed_value_type: request.assumed_value_type,
    p_assumed_value: request.assumed_value === undefined ? null : request.assumed_value,
    p_client_visible: request.client_visible,
    p_risk_level: request.risk_level,
    p_metadata: request.metadata,
  };
}

/**
 * Traduction message PostgreSQL → code d'erreur runtime du projet.
 * La RPC préfixe ses exceptions par un code stable ; on ne devine jamais.
 */
export function mapRpcErrorCode(
  message: string,
): "VALIDATION_FAILED" | "FORBIDDEN_OWNER" | "CONFLICT_INVALID_STATE" | "UPSTREAM_DB_ERROR" {
  if (message.includes("PROMOTION_NOT_ALLOWED")) return "VALIDATION_FAILED";
  if (message.includes("VALIDATION_FAILED")) return "VALIDATION_FAILED";
  if (message.includes("NOT_FOUND")) return "VALIDATION_FAILED";
  if (message.includes("FORBIDDEN_CROSS_CASE")) return "FORBIDDEN_OWNER";
  if (message.includes("FORBIDDEN_IDENTITY")) return "FORBIDDEN_OWNER";
  if (message.includes("IDEMPOTENCY_CONFLICT")) return "CONFLICT_INVALID_STATE";
  if (message.includes("CONFLICT_INVALID_STATE")) return "CONFLICT_INVALID_STATE";
  return "UPSTREAM_DB_ERROR";
}
