/**
 * Phase P1-A2 — Domaine PUR de l'Edge Function manage-quote-scenario.
 *
 * Aucune I/O, aucun Deno.env, aucun client Supabase : tout est testable hors
 * runtime. `index.ts` n'ajoute que l'auth, le contrôle d'accès au dossier et
 * l'appel RPC.
 *
 * CONTRAT P1-A2
 *   - opérations : create | revise | select ;
 *   - AUCUNE promotion (vers quote_facts ou vers un scénario « final »), AUCUNE
 *     propagation d'hypothèse : refus explicites et nommés ;
 *   - AUCUN pricing, AUCUN montant : le snapshot de périmètre rejette
 *     récursivement toute clé monétaire et n'accepte que des entiers exprimés
 *     dans une unité de base ;
 *   - le périmètre est un SNAPSHOT FERMÉ `schema_version = 1` : vocabulaire
 *     borné, profondeur bornée, taille bornée ;
 *   - les `open_points` sont DÉRIVÉS du snapshot par une fonction pure : ils ne
 *     peuvent jamais être fournis par l'appelant. La base les REDÉRIVE de son
 *     côté (`quote_scenario_derive_open_points`) et n'écrit que sa propre
 *     dérivation : ce module produit l'erreur lisible, il ne fait pas autorité ;
 *   - identité, état, liens de supersession, hash et empreinte sont fixés côté
 *     serveur.
 *
 * CE QUI N'EST **PAS** UN OPEN POINT (arbitrage doctrinal) : une contrainte
 * connue et documentée n'est pas une ambiguïté. Marchandises dangereuses,
 * transit, payeur distinct du chargeur, jeux documentaires séparés,
 * multi-destination entièrement affectée, RoRo/ConRo : tout cela est
 * DESCRIPTIF et n'ouvre aucun point. Un open point ne naît que d'un manque ou
 * d'une contradiction réelle.
 */

// ───────────────────────────────────────────────────────────────────────────
// Vocabulaires fermés
// ───────────────────────────────────────────────────────────────────────────

export const SCENARIO_OPERATIONS = ["create", "revise", "select"] as const;
export type ScenarioOperation = (typeof SCENARIO_OPERATIONS)[number];

/**
 * Opérations nommant une promotion. Elles ne sont pas « inconnues » : elles sont
 * refusées avec un code dédié, pour que le refus soit lisible côté appelant.
 */
export const PROMOTION_OPERATIONS = [
  "promote",
  "promote_to_fact",
  "promote_to_facts",
  "promote_to_final",
  "promotion",
  "finalize",
] as const;

/**
 * Opérations nommant une propagation d'hypothèse d'un périmètre vers un autre.
 * Doctrine §9.5 : une information confirmée sur un périmètre ne se propage
 * jamais implicitement à un autre périmètre porteur d'une analogie.
 */
export const PROPAGATION_OPERATIONS = [
  "propagate",
  "propagate_assumption",
  "propagate_assumptions",
  "propagation",
] as const;

/**
 * Statuts que la RPC P1-A2 sait ÉCRIRE. Le vocabulaire doctrinal complet vit
 * dans la contrainte CHECK de la table (draft | provisional_estimated |
 * partial_scoped | blocked | superseded | promoted_to_final) : les statuts
 * d'estimation supposent un pricing par scénario (P1-A4) et la finalisation
 * suppose la promotion explicite (P1-A3). `superseded` n'est jamais demandé par
 * un appelant : il est posé par la RPC lors d'une révision.
 */
export const SCENARIO_WRITABLE_STATUSES = ["draft", "blocked"] as const;
export type ScenarioWritableStatus =
  (typeof SCENARIO_WRITABLE_STATUSES)[number];

export const TRANSPORT_MODES = [
  "AIR",
  "MARITIME",
  "ROUTE",
  "MULTIMODAL",
] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const MOVEMENT_DIRECTIONS = [
  "IMPORT",
  "EXPORT",
  "REEXPORT",
  "TRANSIT",
  "CROSS_TRADE",
] as const;
export type MovementDirection = (typeof MOVEMENT_DIRECTIONS)[number];

/**
 * Mode d'opération terminal. Miroir de `_shared/terminal-operation-mode.ts`,
 * repris ici comme donnée DESCRIPTIVE du périmètre : ce module n'appelle aucun
 * garde tarifaire, ne choisit aucun opérateur terminal et ne déclenche aucun
 * pricing. RoRo et ConRo sont des périmètres parfaitement légitimes.
 */
export const TERMINAL_OPERATION_MODES = ["LOLO", "RORO", "CONRO"] as const;
export type TerminalOperationMode = (typeof TERMINAL_OPERATION_MODES)[number];

/**
 * Réserves doctrinales (docs/PROVISIONAL_SCENARIO_QUOTES.md §13, whitelist
 * initiale des *reservation reason codes*). Ce lot ne fait que LIER un scénario
 * à un code existant : il n'en crée aucun, n'en émet aucun dans une version et
 * ne touche à aucun snapshot de version.
 */
export const RESERVE_CODES = [
  "MISSING_CARGO_VALUE",
  "MISSING_HS_CODE",
  "PAD_CATEGORY_UNRESOLVED",
  "PARTNER_COST_PENDING",
  "RATE_PENDING_CONFIRMATION",
] as const;
export type ReserveCode = (typeof RESERVE_CODES)[number];

/** Vocabulaire fermé des points ouverts dérivables. */
export const OPEN_POINT_CODES = [
  "packaging_unknown",
  "equipment_unknown",
  "temperature_setpoint_missing",
  "commodity_classification_unknown",
  "classification_conflict",
  "attachment_required",
  "chargeable_basis_unconfirmed",
  "port_to_propose",
  "port_alternatives_open",
  "customs_regime_unknown",
  "booking_pre_booking",
  "destination_split_unknown",
  "terminal_operation_mode_unknown",
] as const;
export type OpenPointCode = (typeof OPEN_POINT_CODES)[number];

/**
 * Clés qu'un appelant ne peut JAMAIS fournir : identité, horodatage, état,
 * chaîne de révision, dérivés (hash, points ouverts) et empreinte.
 */
export const FORBIDDEN_PAYLOAD_KEYS = [
  "id",
  "root_scenario_id",
  "revision_no",
  "supersedes_scenario_id",
  "superseded_by_scenario_id",
  "scope_hash",
  "open_points",
  "created_by",
  "created_at",
  "updated_at",
  "resolved_at",
  "resolved_by",
  "actor_user_id",
  "user_id",
  "request_fingerprint",
  "selection_id",
  "selected_by",
  "selected_at",
  "released_at",
  "released_by",
  "promoted_fact_id",
  "promoted_to_final",
] as const;

/**
 * Clés de contenu interdites sur `select` : sélectionner ne redéfinit rien.
 * Une sélection est un acte séparé du snapshot (table dédiée, historisée).
 */
const CONTENT_KEYS = [
  "title",
  "scope_snapshot",
  "status",
  "blocked_reason",
  "revision_reason",
  "links",
] as const;

// ───────────────────────────────────────────────────────────────────────────
// Bornes
// ───────────────────────────────────────────────────────────────────────────

export const MAX_TITLE_LENGTH = 200;
export const MAX_REASON_LENGTH = 500;
/** Miroir exact du CHECK `octet_length(scope_snapshot::text) <= 16384`. */
export const MAX_SNAPSHOT_BYTES = 16 * 1024;
export const MAX_SNAPSHOT_DEPTH = 6;
export const MAX_SNAPSHOT_STRING_LENGTH = 200;
/**
 * Bornes du nombre de lots décrits par un périmètre. Le minimum est 1 : un
 * scénario sans aucun lot ne décrit rien, et son hash porterait sur le vide.
 * Le maximum garde le snapshot lisible et borné ; au-delà, le périmètre doit
 * être scindé en plusieurs scénarios.
 */
export const MIN_CARGO_UNITS = 1;
export const MAX_CARGO_UNITS = 12;
export const MAX_ALTERNATIVES = 8;
export const MAX_LINKS = 40;
export const MAX_OPEN_POINTS = 200;
/** Bornes des entiers : le snapshot décrit des quantités, jamais des montants. */
export const MAX_SNAPSHOT_INTEGER = 1_000_000_000_000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Miroir exact du format de clé imposé par le validateur SQL. */
const SNAPSHOT_KEY_RE = /^[a-z][a-z0-9_]{0,48}$/;
/** Références anonymes (unités, lieux, tiers) : jamais de donnée client réelle. */
const REF_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/**
 * Caractères de contrôle ASCII, interdits dans toute chaîne du snapshot.
 * Construit via `new RegExp` pour que le fichier source reste exempt de tout
 * octet de contrôle littéral.
 */
function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Jetons monétaires interdits, comparés TOKEN À TOKEN sur les segments `_` de
 * chaque clé — jamais en sous-chaîne : `separate_documents` contient « rate » et
 * `chargeable_weight_kg` contient « charge », or ce sont des clés légitimes.
 * Miroir du même jeu côté SQL.
 */
export const MONETARY_KEY_TOKENS = new Set([
  "price",
  "prices",
  "pricing",
  "prix",
  "tarif",
  "tarifs",
  "tariff",
  "taux",
  "rate",
  "rates",
  "amount",
  "amounts",
  "montant",
  "montants",
  "total",
  "totals",
  "subtotal",
  "sum",
  "cost",
  "costs",
  "cout",
  "couts",
  "fee",
  "fees",
  "frais",
  "charge",
  "charges",
  "currency",
  "currencies",
  "devise",
  "devises",
  "money",
  "monnaie",
  "invoice",
  "facture",
  "billing",
  "margin",
  "marge",
  "discount",
  "remise",
  "surcharge",
  "tax",
  "taxes",
  "taxe",
  "duty",
  "duties",
  "droit",
  "droits",
  "vat",
  "tva",
  "usd",
  "eur",
  "xof",
  "fcfa",
  "cfa",
]);

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export type ValidationErrorCode =
  | "VALIDATION_FAILED"
  | "PROMOTION_NOT_ALLOWED"
  | "PROPAGATION_NOT_ALLOWED";

export interface OpenPoint {
  key: string;
  code: OpenPointCode;
  ref: string | null;
}

export interface ScenarioLink {
  assumption_id: string | null;
  reserve_code: ReserveCode | null;
  open_point_key: string | null;
}

export interface NormalizedScenarioRequest {
  case_id: string;
  operation: ScenarioOperation;
  idempotency_key: string;
  scenario_id: string | null;
  title: string | null;
  scope_snapshot: Record<string, unknown> | null;
  open_points: OpenPoint[] | null;
  links: ScenarioLink[] | null;
  status: ScenarioWritableStatus | null;
  blocked_reason: string | null;
  revision_reason: string | null;
}

export type ValidationResult =
  | { ok: true; value: NormalizedScenarioRequest }
  | { ok: false; code: ValidationErrorCode; message: string };

type Check<T> = { ok: true; value: T } | { ok: false; message: string };

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

const fail = (message: string): ValidationResult => ({
  ok: false,
  code: "VALIDATION_FAILED",
  message,
});

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isSnapshotInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) &&
    Math.abs(v) <= MAX_SNAPSHOT_INTEGER;
}

/** `true` si un segment `_` de la clé est un jeton monétaire. */
export function hasMonetaryKeyToken(key: string): boolean {
  return key.split("_").some((token) => MONETARY_KEY_TOKENS.has(token));
}

function requiredTrimmed(
  raw: unknown,
  field: string,
  max: number,
): Check<string> {
  if (typeof raw !== "string") {
    return { ok: false, message: `${field} doit être une chaîne` };
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return {
      ok: false,
      message: `${field} est obligatoire et ne peut pas être vide`,
    };
  }
  if (trimmed.length > max) {
    return { ok: false, message: `${field} dépasse ${max} caractères` };
  }
  return { ok: true, value: trimmed };
}

// ───────────────────────────────────────────────────────────────────────────
// Mesure de taille : miroir exact de la forme textuelle jsonb de PostgreSQL
// ───────────────────────────────────────────────────────────────────────────

/**
 * Longueur en octets de `scope_snapshot::text` tel que PostgreSQL le rendrait.
 *
 * PostgreSQL rend le jsonb avec un espace après chaque `:` et chaque `,` ;
 * `JSON.stringify` ne le fait pas. Mesurer la forme compacte laisserait passer
 * un payload que le CHECK SQL refuserait ensuite — l'appelant recevrait une
 * erreur base opaque au lieu d'une erreur de validation lisible. On mesure donc
 * exactement ce que la base mesurera. Les échappements coïncident : les
 * caractères de contrôle sont interdits par ailleurs dans le snapshot.
 */
export function jsonbTextByteLength(value: unknown): number {
  const compact = JSON.stringify(value) ?? "null";
  let separators = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      separators += Math.max(0, node.length - 1); // virgules
      node.forEach(walk);
      return;
    }
    if (isPlainObject(node)) {
      const keys = Object.keys(node);
      separators += keys.length; // deux-points
      separators += Math.max(0, keys.length - 1); // virgules
      for (const k of keys) walk(node[k]);
    }
  };
  walk(value);
  return new TextEncoder().encode(compact).length + separators;
}

// ───────────────────────────────────────────────────────────────────────────
// Garde générique du snapshot (miroir du validateur SQL)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Invariants STRUCTURELS, indépendants du schéma métier : clés disciplinées,
 * aucune clé monétaire, aucun nombre non entier, profondeur et chaînes bornées.
 * Renvoie `null` si conforme, sinon un motif stable.
 *
 * Ces mêmes invariants sont réimplémentés en SQL (`quote_scenario_snapshot_violation`)
 * et appliqués par un CHECK : la base reste l'autorité, cette fonction produit
 * l'erreur lisible.
 */
export function snapshotStructuralViolation(
  node: unknown,
  depth = 0,
): string | null {
  if (depth > MAX_SNAPSHOT_DEPTH) return `depth_exceeded:${MAX_SNAPSHOT_DEPTH}`;

  if (node === null) return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const child = snapshotStructuralViolation(item, depth + 1);
      if (child) return child;
    }
    return null;
  }

  if (isPlainObject(node)) {
    for (const key of Object.keys(node)) {
      if (!SNAPSHOT_KEY_RE.test(key)) return `key_format:${key}`;
      if (hasMonetaryKeyToken(key)) return `monetary_key:${key}`;
      const child = snapshotStructuralViolation(node[key], depth + 1);
      if (child) return child;
    }
    return null;
  }

  if (typeof node === "number") {
    if (!Number.isFinite(node)) return "non_finite_number";
    if (!Number.isInteger(node)) return `non_integer_number:${node}`;
    if (Math.abs(node) > MAX_SNAPSHOT_INTEGER) {
      return `integer_out_of_range:${node}`;
    }
    return null;
  }

  if (typeof node === "string") {
    if (node.length > MAX_SNAPSHOT_STRING_LENGTH) return "string_too_long";
    // Caractères de contrôle interdits : leur échappement JSON diverge de celui
    // de PostgreSQL, ce qui ferait diverger la mesure de taille et le hash.
    if (hasAsciiControlCharacter(node)) return "control_character";
    // Aucun identifiant de ligne dans le périmètre. Un snapshot décrit un
    // périmètre, pas un graphe de lignes : un UUID y ferait entrer une
    // référence dont ni le cycle de vie ni le dossier ne sont contrôlés, et
    // rendrait le hash de périmètre dépendant d'une identité technique.
    if (UUID_RE.test(node)) return "uuid_in_snapshot";
    return null;
  }

  if (typeof node === "boolean") return null;

  return `unsupported_type:${typeof node}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Schéma FERMÉ du snapshot, version 1
// ───────────────────────────────────────────────────────────────────────────

const SNAPSHOT_TOP_KEYS = [
  "schema_version",
  "transport_mode",
  "movement_direction",
  "terminal_operation_mode",
  "origin",
  "destination",
  "cargo_units",
  "customs",
  "booking",
  "documents",
  "parties",
  "constraints",
] as const;

const PLACE_KEYS = [
  "location_kind",
  "location_code",
  "location_status",
  "alternatives",
] as const;
const LOCATION_KINDS = ["PORT", "AIRPORT", "CITY", "INLAND_POINT"] as const;
const LOCATION_STATUSES = [
  "confirmed",
  "to_propose",
  "alternatives_open",
] as const;

const CARGO_UNIT_KEYS = [
  "unit_ref",
  "unit_kind",
  "equipment_code",
  "packaging",
  "quantity",
  "gross_weight_kg",
  "chargeable_weight_kg",
  "volume_dm3",
  "temperature_control_required",
  "temperature_setpoint_celsius",
  "classification_status",
  "destination_ref",
  "dangerous_goods",
  "required_attachment_status",
] as const;
const UNIT_KINDS = [
  "CONTAINER",
  "BREAKBULK",
  "VEHICLE",
  "PALLET",
  "PACKAGE",
  "BULK",
] as const;
const PACKAGING_VALUES = [
  "unknown",
  "crated",
  "palletized",
  "loose",
  "bagged",
  "unpacked",
] as const;
const CLASSIFICATION_STATUSES = ["confirmed", "unknown", "conflict"] as const;
const ATTACHMENT_STATUSES = ["not_required", "provided", "missing"] as const;

const CUSTOMS_KEYS = [
  "regime_status",
  "regime_code",
  "split_declarations",
] as const;
const REGIME_STATUSES = ["known", "unknown"] as const;

const BOOKING_KEYS = ["stage", "carrier_ref"] as const;
const BOOKING_STAGES = ["none", "pre_booking", "booked"] as const;

const DOCUMENTS_KEYS = ["split_required", "sets_count"] as const;
const PARTIES_KEYS = [
  "payer_is_shipper",
  "payer_ref",
  "consignee_ref",
] as const;
const CONSTRAINTS_KEYS = ["multi_destination", "transit_country_refs"] as const;

function closedObject(
  raw: unknown,
  path: string,
  allowed: readonly string[],
): Check<Record<string, unknown>> {
  if (!isPlainObject(raw)) {
    return { ok: false, message: `${path} doit être un objet` };
  }
  const unknownKeys = Object.keys(raw).filter((k) => !allowed.includes(k));
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      message: `${path} : clés inconnues ${unknownKeys.join(", ")}`,
    };
  }
  return { ok: true, value: raw };
}

function enumField<T extends string>(
  raw: unknown,
  path: string,
  allowed: readonly T[],
): Check<T> {
  if (
    typeof raw !== "string" || !(allowed as readonly string[]).includes(raw)
  ) {
    return {
      ok: false,
      message: `${path} invalide. Autorisés : ${allowed.join(", ")}`,
    };
  }
  return { ok: true, value: raw as T };
}

function boolField(raw: unknown, path: string): Check<boolean> {
  if (typeof raw !== "boolean") {
    return { ok: false, message: `${path} doit être un booléen` };
  }
  return { ok: true, value: raw };
}

function refField(raw: unknown, path: string): Check<string> {
  if (typeof raw !== "string" || !REF_RE.test(raw)) {
    return {
      ok: false,
      message:
        `${path} doit être une référence anonyme [a-z0-9._-] (aucune donnée client réelle)`,
    };
  }
  return { ok: true, value: raw };
}

function nullableIntField(
  raw: unknown,
  path: string,
  min: number,
): Check<number | null> {
  if (raw === null) return { ok: true, value: null };
  if (!isSnapshotInteger(raw)) {
    return {
      ok: false,
      message:
        `${path} doit être un entier dans l'unité de base indiquée par le nom du champ, ou null`,
    };
  }
  if (raw < min) return { ok: false, message: `${path} doit être >= ${min}` };
  return { ok: true, value: raw };
}

function validatePlace(raw: unknown, path: string): Check<null> {
  const obj = closedObject(raw, path, PLACE_KEYS);
  if (!obj.ok) return obj;
  const status = enumField(
    obj.value.location_status,
    `${path}.location_status`,
    LOCATION_STATUSES,
  );
  if (!status.ok) return status;

  if (obj.value.location_kind !== undefined) {
    const kind = enumField(
      obj.value.location_kind,
      `${path}.location_kind`,
      LOCATION_KINDS,
    );
    if (!kind.ok) return kind;
  }
  if (
    obj.value.location_code !== undefined && obj.value.location_code !== null
  ) {
    const code = refField(obj.value.location_code, `${path}.location_code`);
    if (!code.ok) return code;
  }
  if (obj.value.alternatives !== undefined) {
    const alts = obj.value.alternatives;
    if (!Array.isArray(alts)) {
      return {
        ok: false,
        message: `${path}.alternatives doit être un tableau`,
      };
    }
    if (alts.length > MAX_ALTERNATIVES) {
      return {
        ok: false,
        message: `${path}.alternatives dépasse ${MAX_ALTERNATIVES} entrées`,
      };
    }
    for (let i = 0; i < alts.length; i++) {
      const alt = refField(alts[i], `${path}.alternatives[${i}]`);
      if (!alt.ok) return alt;
    }
  }
  return { ok: true, value: null };
}

function validateCargoUnit(raw: unknown, path: string): Check<string> {
  const obj = closedObject(raw, path, CARGO_UNIT_KEYS);
  if (!obj.ok) return obj;
  const u = obj.value;

  const unitRef = refField(u.unit_ref, `${path}.unit_ref`);
  if (!unitRef.ok) return unitRef;

  const kind = enumField(u.unit_kind, `${path}.unit_kind`, UNIT_KINDS);
  if (!kind.ok) return kind;

  const packaging = enumField(
    u.packaging,
    `${path}.packaging`,
    PACKAGING_VALUES,
  );
  if (!packaging.ok) return packaging;

  const classification = enumField(
    u.classification_status,
    `${path}.classification_status`,
    CLASSIFICATION_STATUSES,
  );
  if (!classification.ok) return classification;

  const dg = boolField(u.dangerous_goods, `${path}.dangerous_goods`);
  if (!dg.ok) return dg;

  const tempRequired = boolField(
    u.temperature_control_required,
    `${path}.temperature_control_required`,
  );
  if (!tempRequired.ok) return tempRequired;

  const attachment = enumField(
    u.required_attachment_status,
    `${path}.required_attachment_status`,
    ATTACHMENT_STATUSES,
  );
  if (!attachment.ok) return attachment;

  if (u.equipment_code !== null) {
    const eq = refField(u.equipment_code, `${path}.equipment_code`);
    if (!eq.ok) return eq;
  }

  if (!isSnapshotInteger(u.quantity) || u.quantity < 1) {
    return { ok: false, message: `${path}.quantity doit être un entier >= 1` };
  }

  for (
    const field of [
      "gross_weight_kg",
      "chargeable_weight_kg",
      "volume_dm3",
    ] as const
  ) {
    const value = nullableIntField(u[field], `${path}.${field}`, 0);
    if (!value.ok) return value;
  }

  // Le setpoint est en degrés Celsius ENTIERS : une consigne fractionnaire doit
  // être exprimée dans une unité de base plus fine, jamais en décimal — sinon
  // le hash du périmètre dépendrait du rendu numérique.
  if (u.temperature_setpoint_celsius !== null) {
    if (!isSnapshotInteger(u.temperature_setpoint_celsius)) {
      return {
        ok: false,
        message:
          `${path}.temperature_setpoint_celsius doit être un entier ou null`,
      };
    }
    const c = u.temperature_setpoint_celsius as number;
    if (c < -60 || c > 60) {
      return {
        ok: false,
        message: `${path}.temperature_setpoint_celsius hors plage [-60, 60]`,
      };
    }
  }

  if (u.destination_ref !== null && u.destination_ref !== undefined) {
    const dest = refField(u.destination_ref, `${path}.destination_ref`);
    if (!dest.ok) return dest;
  }

  return { ok: true, value: unitRef.value };
}

/**
 * Valide le snapshot de périmètre contre le schéma FERMÉ v1 et renvoie l'objet
 * exactement tel qu'il sera persisté. Aucune valeur n'est inventée : les champs
 * absents restent absents.
 */
export function validateScopeSnapshot(
  raw: unknown,
): Check<Record<string, unknown>> {
  const structural = snapshotStructuralViolation(raw);
  if (structural) {
    return { ok: false, message: `scope_snapshot rejeté (${structural})` };
  }

  const top = closedObject(raw, "scope_snapshot", SNAPSHOT_TOP_KEYS);
  if (!top.ok) return top;
  const s = top.value;

  if (s.schema_version !== 1) {
    return {
      ok: false,
      message: "scope_snapshot.schema_version doit valoir 1",
    };
  }

  const mode = enumField(
    s.transport_mode,
    "scope_snapshot.transport_mode",
    TRANSPORT_MODES,
  );
  if (!mode.ok) return mode;

  const direction = enumField(
    s.movement_direction,
    "scope_snapshot.movement_direction",
    MOVEMENT_DIRECTIONS,
  );
  if (!direction.ok) return direction;

  // Clé OBLIGATOIREMENT présente, valeur `null` autorisée : « inconnu » doit
  // être dit explicitement, jamais déduit d'une clé absente.
  if (!("terminal_operation_mode" in s)) {
    return {
      ok: false,
      message:
        "scope_snapshot.terminal_operation_mode est obligatoire (null si inconnu)",
    };
  }
  if (s.terminal_operation_mode !== null) {
    const tom = enumField(
      s.terminal_operation_mode,
      "scope_snapshot.terminal_operation_mode",
      TERMINAL_OPERATION_MODES,
    );
    if (!tom.ok) return tom;
  }

  for (const place of ["origin", "destination"] as const) {
    if (s[place] !== undefined) {
      const checked = validatePlace(s[place], `scope_snapshot.${place}`);
      if (!checked.ok) return checked;
    }
  }

  if (!Array.isArray(s.cargo_units)) {
    return {
      ok: false,
      message: "scope_snapshot.cargo_units doit être un tableau",
    };
  }
  if (
    s.cargo_units.length < MIN_CARGO_UNITS ||
    s.cargo_units.length > MAX_CARGO_UNITS
  ) {
    return {
      ok: false,
      message:
        `scope_snapshot.cargo_units doit compter entre ${MIN_CARGO_UNITS} et ${MAX_CARGO_UNITS} lots ` +
        `(${s.cargo_units.length} fourni). Au-delà, scinder le périmètre en plusieurs scénarios.`,
    };
  }
  {
    const seen = new Set<string>();
    for (let i = 0; i < s.cargo_units.length; i++) {
      const unit = validateCargoUnit(
        s.cargo_units[i],
        `scope_snapshot.cargo_units[${i}]`,
      );
      if (!unit.ok) return unit;
      if (seen.has(unit.value)) {
        return {
          ok: false,
          message:
            `scope_snapshot.cargo_units : unit_ref dupliqué (${unit.value})`,
        };
      }
      seen.add(unit.value);
    }
  }

  if (s.customs !== undefined) {
    const customs = closedObject(
      s.customs,
      "scope_snapshot.customs",
      CUSTOMS_KEYS,
    );
    if (!customs.ok) return customs;
    const status = enumField(
      customs.value.regime_status,
      "scope_snapshot.customs.regime_status",
      REGIME_STATUSES,
    );
    if (!status.ok) return status;
    if (
      customs.value.regime_code !== undefined &&
      customs.value.regime_code !== null
    ) {
      const code = refField(
        customs.value.regime_code,
        "scope_snapshot.customs.regime_code",
      );
      if (!code.ok) return code;
    }
    if (customs.value.split_declarations !== undefined) {
      const split = boolField(
        customs.value.split_declarations,
        "scope_snapshot.customs.split_declarations",
      );
      if (!split.ok) return split;
    }
  }

  if (s.booking !== undefined) {
    const booking = closedObject(
      s.booking,
      "scope_snapshot.booking",
      BOOKING_KEYS,
    );
    if (!booking.ok) return booking;
    const stage = enumField(
      booking.value.stage,
      "scope_snapshot.booking.stage",
      BOOKING_STAGES,
    );
    if (!stage.ok) return stage;
    if (
      booking.value.carrier_ref !== undefined &&
      booking.value.carrier_ref !== null
    ) {
      const carrier = refField(
        booking.value.carrier_ref,
        "scope_snapshot.booking.carrier_ref",
      );
      if (!carrier.ok) return carrier;
    }
  }

  if (s.documents !== undefined) {
    const docs = closedObject(
      s.documents,
      "scope_snapshot.documents",
      DOCUMENTS_KEYS,
    );
    if (!docs.ok) return docs;
    const split = boolField(
      docs.value.split_required,
      "scope_snapshot.documents.split_required",
    );
    if (!split.ok) return split;
    if (docs.value.sets_count !== undefined) {
      if (
        !isSnapshotInteger(docs.value.sets_count) ||
        (docs.value.sets_count as number) < 1
      ) {
        return {
          ok: false,
          message:
            "scope_snapshot.documents.sets_count doit être un entier >= 1",
        };
      }
    }
  }

  if (s.parties !== undefined) {
    const parties = closedObject(
      s.parties,
      "scope_snapshot.parties",
      PARTIES_KEYS,
    );
    if (!parties.ok) return parties;
    const payer = boolField(
      parties.value.payer_is_shipper,
      "scope_snapshot.parties.payer_is_shipper",
    );
    if (!payer.ok) return payer;
    for (const field of ["payer_ref", "consignee_ref"] as const) {
      if (parties.value[field] !== undefined && parties.value[field] !== null) {
        const ref = refField(
          parties.value[field],
          `scope_snapshot.parties.${field}`,
        );
        if (!ref.ok) return ref;
      }
    }
  }

  if (s.constraints !== undefined) {
    const constraints = closedObject(
      s.constraints,
      "scope_snapshot.constraints",
      CONSTRAINTS_KEYS,
    );
    if (!constraints.ok) return constraints;
    const multi = boolField(
      constraints.value.multi_destination,
      "scope_snapshot.constraints.multi_destination",
    );
    if (!multi.ok) return multi;
    if (constraints.value.transit_country_refs !== undefined) {
      const refs = constraints.value.transit_country_refs;
      if (!Array.isArray(refs)) {
        return {
          ok: false,
          message:
            "scope_snapshot.constraints.transit_country_refs doit être un tableau",
        };
      }
      if (refs.length > MAX_ALTERNATIVES) {
        return {
          ok: false,
          message:
            `scope_snapshot.constraints.transit_country_refs dépasse ${MAX_ALTERNATIVES} entrées`,
        };
      }
      for (let i = 0; i < refs.length; i++) {
        const ref = refField(
          refs[i],
          `scope_snapshot.constraints.transit_country_refs[${i}]`,
        );
        if (!ref.ok) return ref;
      }
    }
  }

  const bytes = jsonbTextByteLength(s);
  if (bytes > MAX_SNAPSHOT_BYTES) {
    return {
      ok: false,
      message: `scope_snapshot dépasse ${MAX_SNAPSHOT_BYTES} octets (${bytes})`,
    };
  }

  return { ok: true, value: s };
}

// ───────────────────────────────────────────────────────────────────────────
// Dérivation des points ouverts
// ───────────────────────────────────────────────────────────────────────────

function openPoint(code: OpenPointCode, ref: string | null): OpenPoint {
  return { key: ref === null ? code : `${code}:${ref}`, code, ref };
}

/**
 * Dérive les points ouverts d'un snapshot VALIDÉ. Fonction PURE et totale :
 * même snapshot ⇒ mêmes points ouverts, triés par clé.
 *
 * Un point ouvert signale une AMBIGUÏTÉ ou un MANQUE réel. Les contraintes
 * connues — marchandises dangereuses, transit, payeur distinct, jeux
 * documentaires séparés, multi-destination entièrement affectée, RoRo/ConRo —
 * sont descriptives : elles n'ouvrent rien. P1-A2 se contente de tracer ces
 * points ; il n'exige pas qu'un `draft` les couvre tous et ne calcule aucun prix.
 */
export function deriveOpenPoints(
  snapshot: Record<string, unknown>,
): OpenPoint[] {
  const points: OpenPoint[] = [];
  const transportMode = snapshot.transport_mode as TransportMode;

  for (const place of ["origin", "destination"] as const) {
    const value = snapshot[place];
    if (!isPlainObject(value)) continue;
    if (value.location_status === "to_propose") {
      points.push(openPoint("port_to_propose", place));
    }
    if (value.location_status === "alternatives_open") {
      points.push(openPoint("port_alternatives_open", place));
    }
  }

  // Le mode terminal n'est requis que pour un périmètre maritime ; `null` y est
  // une information manquante réelle. RoRo et ConRo renseignés n'ouvrent rien.
  if (
    transportMode === "MARITIME" && snapshot.terminal_operation_mode === null
  ) {
    points.push(openPoint("terminal_operation_mode_unknown", null));
  }

  const units = Array.isArray(snapshot.cargo_units) ? snapshot.cargo_units : [];
  const multiDestination = isPlainObject(snapshot.constraints)
    ? snapshot.constraints.multi_destination === true
    : false;
  let unassignedDestination = false;

  for (const rawUnit of units) {
    if (!isPlainObject(rawUnit)) continue;
    const ref = String(rawUnit.unit_ref);

    if (rawUnit.packaging === "unknown") {
      points.push(openPoint("packaging_unknown", ref));
    }
    if (rawUnit.equipment_code === null) {
      points.push(openPoint("equipment_unknown", ref));
    }
    if (
      rawUnit.temperature_control_required === true &&
      rawUnit.temperature_setpoint_celsius === null
    ) {
      points.push(openPoint("temperature_setpoint_missing", ref));
    }
    if (rawUnit.classification_status === "unknown") {
      points.push(openPoint("commodity_classification_unknown", ref));
    }
    if (rawUnit.classification_status === "conflict") {
      points.push(openPoint("classification_conflict", ref));
    }
    if (rawUnit.required_attachment_status === "missing") {
      points.push(openPoint("attachment_required", ref));
    }

    // Aérien : la base de taxation dépend du couple poids brut / poids taxable.
    // Absence du taxable, ou taxable strictement inférieur au brut, est une
    // contradiction à lever — jamais un montant, jamais un tarif.
    if (transportMode === "AIR") {
      const gross = rawUnit.gross_weight_kg;
      const chargeable = rawUnit.chargeable_weight_kg;
      const missing = chargeable === null || chargeable === undefined;
      const contradictory = typeof gross === "number" &&
        typeof chargeable === "number" &&
        chargeable < gross;
      if (missing || contradictory) {
        points.push(openPoint("chargeable_basis_unconfirmed", ref));
      }
    }

    if (
      rawUnit.destination_ref === null || rawUnit.destination_ref === undefined
    ) {
      unassignedDestination = true;
    }
  }

  // Multi-destination ANNONCÉE mais répartition incomplète : ambiguïté réelle.
  // Multi-destination entièrement affectée : contrainte connue, aucun point.
  if (multiDestination && unassignedDestination) {
    points.push(openPoint("destination_split_unknown", null));
  }

  if (
    isPlainObject(snapshot.customs) &&
    snapshot.customs.regime_status === "unknown"
  ) {
    points.push(openPoint("customs_regime_unknown", null));
  }

  if (
    isPlainObject(snapshot.booking) && snapshot.booking.stage === "pre_booking"
  ) {
    points.push(openPoint("booking_pre_booking", null));
  }

  points.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return points;
}

// ───────────────────────────────────────────────────────────────────────────
// Liens
// ───────────────────────────────────────────────────────────────────────────

const LINK_KEYS = ["assumption_id", "reserve_code", "open_point_key"] as const;

function validateLinks(
  raw: unknown,
  openPoints: OpenPoint[],
): Check<ScenarioLink[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, message: "links doit être un tableau" };
  }
  if (raw.length > MAX_LINKS) {
    return { ok: false, message: `links dépasse ${MAX_LINKS} entrées` };
  }

  const openPointKeys = new Set(openPoints.map((p) => p.key));
  const seen = new Set<string>();
  const links: ScenarioLink[] = [];

  for (let i = 0; i < raw.length; i++) {
    const path = `links[${i}]`;
    const obj = closedObject(raw[i], path, LINK_KEYS);
    if (!obj.ok) return obj;

    const hasAssumption = obj.value.assumption_id !== undefined &&
      obj.value.assumption_id !== null;
    const hasReserve = obj.value.reserve_code !== undefined &&
      obj.value.reserve_code !== null;
    if (hasAssumption === hasReserve) {
      return {
        ok: false,
        message:
          `${path} doit porter EXACTEMENT un lien : assumption_id OU reserve_code`,
      };
    }

    let assumptionId: string | null = null;
    let reserveCode: ReserveCode | null = null;

    if (hasAssumption) {
      if (
        typeof obj.value.assumption_id !== "string" ||
        !UUID_RE.test(obj.value.assumption_id)
      ) {
        return {
          ok: false,
          message: `${path}.assumption_id doit être un UUID`,
        };
      }
      assumptionId = obj.value.assumption_id;
    } else {
      const code = enumField(
        obj.value.reserve_code,
        `${path}.reserve_code`,
        RESERVE_CODES,
      );
      if (!code.ok) return code;
      reserveCode = code.value;
    }

    let openPointKey: string | null = null;
    if (
      obj.value.open_point_key !== undefined &&
      obj.value.open_point_key !== null
    ) {
      if (typeof obj.value.open_point_key !== "string") {
        return {
          ok: false,
          message: `${path}.open_point_key doit être une chaîne`,
        };
      }
      if (!openPointKeys.has(obj.value.open_point_key)) {
        return {
          ok: false,
          message:
            `${path}.open_point_key « ${obj.value.open_point_key} » n'est pas un point ouvert de ce ` +
            "périmètre. Les points ouverts sont dérivés du snapshot, jamais déclarés.",
        };
      }
      openPointKey = obj.value.open_point_key;
    }

    const identity = `${assumptionId ?? ""}|${reserveCode ?? ""}|${
      openPointKey ?? ""
    }`;
    if (seen.has(identity)) {
      return { ok: false, message: `${path} est un doublon exact` };
    }
    seen.add(identity);

    links.push({
      assumption_id: assumptionId,
      reserve_code: reserveCode,
      open_point_key: openPointKey,
    });
  }

  // Ordre canonique : le jeu de liens est un ENSEMBLE. Le trier ici rend
  // l'empreinte insensible à l'ordre d'envoi, comme la comparaison SQL qui
  // décide si une révision est un no-op.
  links.sort((a, b) => {
    const ka = `${a.assumption_id ?? ""}|${a.reserve_code ?? ""}|${
      a.open_point_key ?? ""
    }`;
    const kb = `${b.assumption_id ?? ""}|${b.reserve_code ?? ""}|${
      b.open_point_key ?? ""
    }`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return { ok: true, value: links };
}

// ───────────────────────────────────────────────────────────────────────────
// Validation du payload
// ───────────────────────────────────────────────────────────────────────────

export function validateManageScenarioPayload(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) {
    return fail("Le corps de la requête doit être un objet JSON");
  }

  const rawOperation = raw.operation;

  // 1. Promotion et propagation : refus nommés, AVANT toute autre analyse.
  if (
    typeof rawOperation === "string" &&
    (PROMOTION_OPERATIONS as readonly string[]).includes(rawOperation)
  ) {
    return {
      ok: false,
      code: "PROMOTION_NOT_ALLOWED",
      message:
        "La promotion d'un scénario ou d'une hypothèse est hors périmètre P1-A2 : " +
        "aucune écriture dans quote_facts, aucun passage à promoted_to_final.",
    };
  }
  if (
    typeof rawOperation === "string" &&
    (PROPAGATION_OPERATIONS as readonly string[]).includes(rawOperation)
  ) {
    return {
      ok: false,
      code: "PROPAGATION_NOT_ALLOWED",
      message:
        "La propagation d'une hypothèse d'un périmètre vers un autre est interdite : " +
        "chaque analogie reste propre à son périmètre jusqu'à confirmation explicite.",
    };
  }

  // 2. Identité / état / dérivés : jamais fournis par l'appelant.
  const forbidden = FORBIDDEN_PAYLOAD_KEYS.filter((k) => k in raw);
  if (forbidden.length > 0) {
    return fail(
      `Champs interdits dans le payload : ${forbidden.join(", ")}. ` +
        "Identité, état, chaîne de révision, hash et points ouverts sont fixés côté serveur.",
    );
  }

  // 3. Opération.
  if (
    typeof rawOperation !== "string" ||
    !(SCENARIO_OPERATIONS as readonly string[]).includes(rawOperation)
  ) {
    return fail(
      `operation invalide. Autorisées : ${SCENARIO_OPERATIONS.join(", ")}`,
    );
  }
  const operation = rawOperation as ScenarioOperation;

  // 4. Dossier.
  if (typeof raw.case_id !== "string" || !UUID_RE.test(raw.case_id)) {
    return fail("case_id doit être un UUID");
  }

  // 5. Clé d'idempotence (l'empreinte, elle, n'est jamais fournie).
  if (typeof raw.idempotency_key !== "string") {
    return fail("idempotency_key est obligatoire");
  }
  const idempotencyKey = raw.idempotency_key.trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return fail("idempotency_key doit faire 8 à 128 caractères");
  }

  // 6. Cible.
  let scenarioId: string | null = null;
  if (operation === "create") {
    if (
      "scenario_id" in raw && raw.scenario_id !== null &&
      raw.scenario_id !== undefined
    ) {
      return fail("scenario_id n'a pas de sens pour operation=create");
    }
  } else {
    if (typeof raw.scenario_id !== "string" || !UUID_RE.test(raw.scenario_id)) {
      return fail(
        `scenario_id (UUID) est obligatoire pour operation=${operation}`,
      );
    }
    scenarioId = raw.scenario_id;
  }

  const base: NormalizedScenarioRequest = {
    case_id: raw.case_id,
    operation,
    idempotency_key: idempotencyKey,
    scenario_id: scenarioId,
    title: null,
    scope_snapshot: null,
    open_points: null,
    links: null,
    status: null,
    blocked_reason: null,
    revision_reason: null,
  };

  // 7. `select` ne redéfinit rien : la sélection est un acte SÉPARÉ du snapshot.
  if (operation === "select") {
    const extra = CONTENT_KEYS.filter((k) => k in raw);
    if (extra.length > 0) {
      return fail(
        `operation=select ne fait que sélectionner un scénario existant : champs non autorisés ${
          extra.join(", ")
        }`,
      );
    }
    return { ok: true, value: base };
  }

  // 8. Contenu commun create/revise.
  const title = requiredTrimmed(raw.title, "title", MAX_TITLE_LENGTH);
  if (!title.ok) return fail(title.message);
  base.title = title.value;

  const snapshot = validateScopeSnapshot(raw.scope_snapshot);
  if (!snapshot.ok) return fail(snapshot.message);
  base.scope_snapshot = snapshot.value;
  base.open_points = deriveOpenPoints(snapshot.value);
  if (base.open_points.length > MAX_OPEN_POINTS) {
    return fail(`open_points dérivés dépassent ${MAX_OPEN_POINTS} entrées`);
  }

  const status = raw.status === undefined
    ? ("draft" as ScenarioWritableStatus)
    : (() => {
      const checked = enumField(
        raw.status,
        "status",
        SCENARIO_WRITABLE_STATUSES,
      );
      return checked.ok ? checked.value : null;
    })();
  if (status === null) {
    return fail(
      `status invalide. P1-A2 n'écrit que : ${
        SCENARIO_WRITABLE_STATUSES.join(", ")
      }. ` +
        "Les statuts d'estimation supposent un pricing par scénario (hors périmètre).",
    );
  }
  base.status = status;

  // `blocked` est un statut assumé et légitime — mais jamais muet.
  if (status === "blocked") {
    const reason = requiredTrimmed(
      raw.blocked_reason,
      "blocked_reason",
      MAX_REASON_LENGTH,
    );
    if (!reason.ok) {
      return fail(`status=blocked exige blocked_reason : ${reason.message}`);
    }
    base.blocked_reason = reason.value;
  } else if (
    "blocked_reason" in raw && raw.blocked_reason !== null &&
    raw.blocked_reason !== undefined
  ) {
    return fail("blocked_reason n'a de sens que pour status=blocked");
  }

  const links = validateLinks(raw.links, base.open_points);
  if (!links.ok) return fail(links.message);
  base.links = links.value;

  if (operation === "create") {
    if (
      "revision_reason" in raw && raw.revision_reason !== null &&
      raw.revision_reason !== undefined
    ) {
      return fail("revision_reason n'a pas de sens pour operation=create");
    }
    return { ok: true, value: base };
  }

  // 9. Une révision est un acte tracé : elle dit POURQUOI.
  const revisionReason = requiredTrimmed(
    raw.revision_reason,
    "revision_reason",
    MAX_REASON_LENGTH,
  );
  if (!revisionReason.ok) return fail(revisionReason.message);
  base.revision_reason = revisionReason.value;

  return { ok: true, value: base };
}

// ───────────────────────────────────────────────────────────────────────────
// Empreinte de requête
// ───────────────────────────────────────────────────────────────────────────

/**
 * Sérialisation canonique : clés triées récursivement, `undefined` normalisé.
 *
 * Volontairement PAS `_shared/canonical-hash.ts` : son `normalizeValue` reparse
 * toute chaîne ressemblant à du JSON, donc deux titres distincts produiraient la
 * même empreinte et un rejeu serait accepté à la place d'un conflit. Ici, une
 * chaîne reste une chaîne.
 *
 * NOTE — ceci n'est PAS `scope_hash`. Le hash de périmètre est calculé dans la
 * RPC sur la forme jsonb normalisée par PostgreSQL (ordre des clés canonique,
 * doublons éliminés) : c'est la base qui fait autorité sur l'identité d'un
 * périmètre, pas l'appelant.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : "null";
  }
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) =>
      `${JSON.stringify(k)}:${
        stableStringify((value as Record<string, unknown>)[k])
      }`
    );
  return `{${entries.join(",")}}`;
}

/**
 * Contenu couvert par l'empreinte : tout le payload normalisé SAUF la clé
 * d'idempotence. Même clé + même contenu → rejeu ; même clé + contenu différent
 * → conflit.
 */
export function buildFingerprintInput(
  request: NormalizedScenarioRequest,
): Record<string, unknown> {
  return {
    blocked_reason: request.blocked_reason,
    case_id: request.case_id,
    links: request.links,
    open_points: request.open_points,
    operation: request.operation,
    revision_reason: request.revision_reason,
    scenario_id: request.scenario_id,
    scope_snapshot: request.scope_snapshot,
    status: request.status,
    title: request.title,
  };
}

/** SHA-256 hexadécimal minuscule — format exigé par le CHECK du registre. */
export async function computeRequestFingerprint(
  request: NormalizedScenarioRequest,
): Promise<string> {
  const canonical = stableStringify(buildFingerprintInput(request));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ───────────────────────────────────────────────────────────────────────────
// Arguments RPC
// ───────────────────────────────────────────────────────────────────────────

/**
 * `actorUserId` provient EXCLUSIVEMENT du JWT vérifié (auth.user.id), jamais du
 * payload : c'est ce qui rend `created_by` non forgeable.
 *
 * `p_open_points` est transmis pour que la base puisse CONSTATER un écart, pas
 * pour qu'elle l'écrive : elle redérive les points ouverts du périmètre et
 * n'écrit que sa propre dérivation. Un écart lève OPEN_POINTS_FORGED plutôt
 * que d'être absorbé en silence.
 */
export function buildRpcArgs(
  request: NormalizedScenarioRequest,
  actorUserId: string,
  fingerprint: string,
): Record<string, unknown> {
  return {
    p_case_id: request.case_id,
    p_operation: request.operation,
    p_actor_user_id: actorUserId,
    p_idempotency_key: request.idempotency_key,
    p_request_fingerprint: fingerprint,
    p_scenario_id: request.scenario_id,
    p_title: request.title,
    p_scope_snapshot: request.scope_snapshot,
    p_open_points: request.open_points,
    p_links: request.links,
    p_status: request.status,
    p_blocked_reason: request.blocked_reason,
    p_revision_reason: request.revision_reason,
  };
}

/**
 * Traduction message PostgreSQL → code d'erreur runtime du projet.
 * La RPC préfixe ses exceptions par un code stable ; on ne devine jamais.
 */
export function mapRpcErrorCode(
  message: string,
):
  | "VALIDATION_FAILED"
  | "FORBIDDEN_OWNER"
  | "CONFLICT_INVALID_STATE"
  | "UPSTREAM_DB_ERROR" {
  if (message.includes("PROMOTION_NOT_ALLOWED")) return "VALIDATION_FAILED";
  if (message.includes("PROPAGATION_NOT_ALLOWED")) return "VALIDATION_FAILED";
  if (message.includes("PRICING_NOT_ALLOWED")) return "VALIDATION_FAILED";
  if (message.includes("SNAPSHOT_REJECTED")) return "VALIDATION_FAILED";
  // La base a dérivé d'autres points ouverts que ceux transmis : requête forgée,
  // ou divergence entre `deriveOpenPoints` et `quote_scenario_derive_open_points`.
  // Dans les deux cas la requête échoue ; rien n'est deviné ni corrigé en silence.
  if (message.includes("OPEN_POINTS_FORGED")) return "VALIDATION_FAILED";
  if (message.includes("VALIDATION_FAILED")) return "VALIDATION_FAILED";
  if (message.includes("NOT_FOUND")) return "VALIDATION_FAILED";
  if (message.includes("FORBIDDEN_CROSS_CASE")) return "FORBIDDEN_OWNER";
  if (message.includes("FORBIDDEN_IDENTITY")) return "FORBIDDEN_OWNER";
  if (message.includes("IDEMPOTENCY_CONFLICT")) return "CONFLICT_INVALID_STATE";
  if (message.includes("CONFLICT_INVALID_STATE")) {
    return "CONFLICT_INVALID_STATE";
  }
  return "UPSTREAM_DB_ERROR";
}
