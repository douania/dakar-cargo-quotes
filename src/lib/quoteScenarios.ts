/**
 * Phase P1-A2 — Contrat front des scénarios de périmètre.
 *
 * Module PUR : aucun accès Supabase, aucun DOM, aucun état React. Il traduit la
 * saisie STRUCTURÉE de l'opérateur vers le payload de l'Edge Function
 * `manage-quote-scenario`, et rend lisible ce que la base a persisté.
 *
 * IMPORTANT — ce module n'est PAS un contrôle de sécurité. Chaque règle ici a
 * son autorité côté serveur : `supabase/functions/manage-quote-scenario/domain.ts`
 * (validation Edge) puis la RPC service_role-only et les CHECK de la table
 * (migration 20260828200000). Ce qui vit ici n'existe que pour éviter un
 * aller-retour réseau perdu et afficher un message compréhensible.
 *
 * Autorité de schéma : `domain.ts` et ses six formes de périmètre anonymisées
 * (supabase/functions/_tests/manage_quote_scenario_domain.test.ts). Le snapshot
 * est un vocabulaire FERMÉ `schema_version = 1` : ce fichier n'invente aucune
 * dimension, n'émet aucune clé hors schéma et ne saisit jamais de donnée client
 * réelle dans une référence.
 *
 * HORS PÉRIMÈTRE, volontairement absent : tout prix, tout montant, toute
 * promotion (vers quote_facts ou `promoted_to_final`), toute propagation
 * d'hypothèse, toute suppression. RoRo et ConRo sont DESCRIPTIFS : ils sont
 * décrits ici sans jamais déclencher la moindre garde tarifaire.
 */

// ───────────────────────────────────────────────────────────────────────────
// Vocabulaires fermés (miroirs de domain.ts)
// ───────────────────────────────────────────────────────────────────────────

export const SCENARIO_OPERATIONS = ["create", "revise", "select"] as const;
export type ScenarioOperation = (typeof SCENARIO_OPERATIONS)[number];

export const SCENARIO_WRITABLE_STATUSES = ["draft", "blocked"] as const;
export type ScenarioWritableStatus = (typeof SCENARIO_WRITABLE_STATUSES)[number];

export const TRANSPORT_MODES = ["AIR", "MARITIME", "ROUTE", "MULTIMODAL"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const MOVEMENT_DIRECTIONS = [
  "IMPORT",
  "EXPORT",
  "REEXPORT",
  "TRANSIT",
  "CROSS_TRADE",
] as const;
export type MovementDirection = (typeof MOVEMENT_DIRECTIONS)[number];

export const TERMINAL_OPERATION_MODES = ["LOLO", "RORO", "CONRO"] as const;
export type TerminalOperationMode = (typeof TERMINAL_OPERATION_MODES)[number];

/** Valeur du sélecteur signifiant `terminal_operation_mode: null`. */
export const TERMINAL_MODE_UNSPECIFIED = "UNSPECIFIED";

export const LOCATION_KINDS = ["PORT", "AIRPORT", "CITY", "INLAND_POINT"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const LOCATION_STATUSES = ["confirmed", "to_propose", "alternatives_open"] as const;
export type LocationStatus = (typeof LOCATION_STATUSES)[number];

export const UNIT_KINDS = [
  "CONTAINER",
  "BREAKBULK",
  "VEHICLE",
  "PALLET",
  "PACKAGE",
  "BULK",
] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

export const PACKAGING_VALUES = [
  "unknown",
  "crated",
  "palletized",
  "loose",
  "bagged",
  "unpacked",
] as const;
export type PackagingValue = (typeof PACKAGING_VALUES)[number];

export const CLASSIFICATION_STATUSES = ["confirmed", "unknown", "conflict"] as const;
export type ClassificationStatus = (typeof CLASSIFICATION_STATUSES)[number];

export const ATTACHMENT_STATUSES = ["not_required", "provided", "missing"] as const;
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];

export const REGIME_STATUSES = ["known", "unknown"] as const;
export type RegimeStatus = (typeof REGIME_STATUSES)[number];

export const BOOKING_STAGES = ["none", "pre_booking", "booked"] as const;
export type BookingStage = (typeof BOOKING_STAGES)[number];

/** Whitelist doctrinale des réserves (docs/PROVISIONAL_SCENARIO_QUOTES.md §13). */
export const RESERVE_CODES = [
  "MISSING_CARGO_VALUE",
  "MISSING_HS_CODE",
  "PAD_CATEGORY_UNRESOLVED",
  "PARTNER_COST_PENDING",
  "RATE_PENDING_CONFIRMATION",
] as const;
export type ReserveCode = (typeof RESERVE_CODES)[number];

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
 * Statuts d'hypothèse liables à un scénario. La RPC refuse tout autre statut
 * (`CONFLICT_INVALID_STATE: hypothèse non liable`).
 */
export const LINKABLE_ASSUMPTION_STATUSES = ["active", "client_confirmed"] as const;

/**
 * Clés que l'appelant ne peut JAMAIS émettre. Reprises telles quelles de
 * `domain.ts` pour que le contrat front soit vérifiable par un test plutôt que
 * par relecture.
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

// ───────────────────────────────────────────────────────────────────────────
// Bornes (miroirs de domain.ts et des CHECK de la table)
// ───────────────────────────────────────────────────────────────────────────

export const MAX_TITLE_LENGTH = 200;
export const MAX_REASON_LENGTH = 500;
export const MAX_SNAPSHOT_BYTES = 16 * 1024;
export const MIN_CARGO_UNITS = 1;
export const MAX_CARGO_UNITS = 12;
export const MAX_ALTERNATIVES = 8;
export const MAX_LINKS = 40;
export const MIN_TEMPERATURE_CELSIUS = -60;
export const MAX_TEMPERATURE_CELSIUS = 60;
export const MAX_SNAPSHOT_INTEGER = 1_000_000_000_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Références ANONYMES : jamais de donnée client réelle, jamais d'identifiant technique. */
const REF_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const INTEGER_RE = /^-?\d+$/;

// ───────────────────────────────────────────────────────────────────────────
// Libellés
// ───────────────────────────────────────────────────────────────────────────

export const SCENARIO_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  provisional_estimated: "Estimation provisoire",
  partial_scoped: "Périmètre partiel",
  blocked: "Bloqué",
  superseded: "Remplacé",
  promoted_to_final: "Promu en final",
};

export const TRANSPORT_MODE_LABELS: Record<TransportMode, string> = {
  AIR: "Aérien",
  MARITIME: "Maritime",
  ROUTE: "Route",
  MULTIMODAL: "Multimodal",
};

export const MOVEMENT_DIRECTION_LABELS: Record<MovementDirection, string> = {
  IMPORT: "Import",
  EXPORT: "Export",
  REEXPORT: "Réexport",
  TRANSIT: "Transit",
  CROSS_TRADE: "Cross-trade",
};

export const TERMINAL_OPERATION_MODE_LABELS: Record<TerminalOperationMode, string> = {
  LOLO: "LoLo (levage)",
  RORO: "RoRo (roulage)",
  CONRO: "ConRo (mixte)",
};

export const LOCATION_KIND_LABELS: Record<LocationKind, string> = {
  PORT: "Port",
  AIRPORT: "Aéroport",
  CITY: "Ville",
  INLAND_POINT: "Point intérieur",
};

export const LOCATION_STATUS_LABELS: Record<LocationStatus, string> = {
  confirmed: "Confirmé",
  to_propose: "À proposer",
  alternatives_open: "Alternatives ouvertes",
};

export const UNIT_KIND_LABELS: Record<UnitKind, string> = {
  CONTAINER: "Conteneur",
  BREAKBULK: "Conventionnel",
  VEHICLE: "Véhicule",
  PALLET: "Palette",
  PACKAGE: "Colis",
  BULK: "Vrac",
};

export const PACKAGING_LABELS: Record<PackagingValue, string> = {
  unknown: "Inconnu",
  crated: "Caissé",
  palletized: "Palettisé",
  loose: "Non groupé",
  bagged: "En sacs",
  unpacked: "Non emballé",
};

export const CLASSIFICATION_STATUS_LABELS: Record<ClassificationStatus, string> = {
  confirmed: "Confirmée",
  unknown: "Inconnue",
  conflict: "En conflit",
};

export const ATTACHMENT_STATUS_LABELS: Record<AttachmentStatus, string> = {
  not_required: "Non requise",
  provided: "Fournie",
  missing: "Manquante",
};

export const REGIME_STATUS_LABELS: Record<RegimeStatus, string> = {
  known: "Connu",
  unknown: "Inconnu",
};

export const BOOKING_STAGE_LABELS: Record<BookingStage, string> = {
  none: "Aucun",
  pre_booking: "Pré-booking",
  booked: "Booké",
};

export const RESERVE_CODE_LABELS: Record<ReserveCode, string> = {
  MISSING_CARGO_VALUE: "Valeur marchandise manquante",
  MISSING_HS_CODE: "Code HS manquant",
  PAD_CATEGORY_UNRESOLVED: "Catégorie PAD non tranchée",
  PARTNER_COST_PENDING: "Élément partenaire en attente",
  RATE_PENDING_CONFIRMATION: "Élément en attente de confirmation",
};

export const OPEN_POINT_LABELS: Record<OpenPointCode, string> = {
  packaging_unknown: "Emballage inconnu",
  equipment_unknown: "Équipement inconnu",
  temperature_setpoint_missing: "Consigne de température manquante",
  commodity_classification_unknown: "Classification marchandise inconnue",
  classification_conflict: "Classification en conflit",
  attachment_required: "Pièce requise manquante",
  chargeable_basis_unconfirmed: "Base taxable non confirmée",
  port_to_propose: "Lieu à proposer",
  port_alternatives_open: "Alternatives de lieu ouvertes",
  customs_regime_unknown: "Régime douanier inconnu",
  booking_pre_booking: "Pré-booking à confirmer",
  destination_split_unknown: "Répartition multi-destination incomplète",
  terminal_operation_mode_unknown: "Mode d'opération terminal inconnu",
};

/** Référence d'un point ouvert rendue lisible (`origin`, `destination` ou un lot). */
export function formatOpenPointRef(ref: string | null): string | null {
  if (ref === null) return null;
  if (ref === "origin") return "origine";
  if (ref === "destination") return "destination";
  return ref;
}

export function formatOpenPoint(point: ScenarioOpenPoint): string {
  const label = OPEN_POINT_LABELS[point.code as OpenPointCode] ?? point.code;
  const ref = formatOpenPointRef(point.ref);
  return ref === null ? label : `${label} — ${ref}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Types de saisie (formulaire STRUCTURÉ, jamais de JSON brut)
// ───────────────────────────────────────────────────────────────────────────

export interface PlaceDraft {
  locationKind: LocationKind;
  locationStatus: LocationStatus;
  /** Vide ⇒ `location_code: null` (lieu non arrêté). */
  locationCode: string;
  /** Références séparées par virgule ou espace ; vide ⇒ clé absente. */
  alternatives: string;
}

export interface CargoUnitDraft {
  unitRef: string;
  unitKind: UnitKind;
  /** `false` ⇒ `equipment_code: null`, ce qui ouvre `equipment_unknown`. */
  equipmentKnown: boolean;
  equipmentCode: string;
  packaging: PackagingValue;
  /** Entier >= 1. */
  quantity: string;
  /** Entier >= 0, ou vide pour « inconnu » (`null`). */
  grossWeightKg: string;
  chargeableWeightKg: string;
  volumeDm3: string;
  temperatureControlRequired: boolean;
  /** Entier dans [-60, 60], ou vide pour « consigne non arrêtée ». */
  temperatureSetpointCelsius: string;
  classificationStatus: ClassificationStatus;
  /** Vide ⇒ lot non affecté à une destination. */
  destinationRef: string;
  dangerousGoods: boolean;
  requiredAttachmentStatus: AttachmentStatus;
}

export interface ScenarioLinkDraft {
  target: "assumption" | "reserve";
  assumptionId: string;
  reserveCode: ReserveCode;
  /** Vide ⇒ lien sans couverture de point ouvert (parfaitement légitime). */
  openPointKey: string;
}

export interface ScenarioDraft {
  title: string;
  status: ScenarioWritableStatus;
  blockedReason: string;
  revisionReason: string;
  transportMode: TransportMode;
  movementDirection: MovementDirection;
  /** `TERMINAL_MODE_UNSPECIFIED` ⇒ `null` : « inconnu » se dit explicitement. */
  terminalOperationMode: TerminalOperationMode | typeof TERMINAL_MODE_UNSPECIFIED;
  origin: PlaceDraft;
  destination: PlaceDraft;
  cargoUnits: CargoUnitDraft[];
  customsRegimeStatus: RegimeStatus;
  customsRegimeCode: string;
  customsSplitDeclarations: boolean;
  bookingStage: BookingStage;
  bookingCarrierRef: string;
  documentsSplitRequired: boolean;
  documentsSetsCount: string;
  partiesPayerIsShipper: boolean;
  partiesPayerRef: string;
  partiesConsigneeRef: string;
  constraintsMultiDestination: boolean;
  constraintsTransitCountryRefs: string;
  links: ScenarioLinkDraft[];
}

export interface ScenarioOpenPoint {
  key: string;
  code: string;
  ref: string | null;
}

/**
 * Les résultats suivent la forme utilisée par `scenarioAssumptions.ts` : le repo
 * compile en `strict: false`, où TypeScript ne réduit pas une union discriminée
 * par un booléen. Chaque branche déclare donc les clés de l'autre en
 * `?: undefined`.
 */
export type BuildSnapshotResult =
  | { ok: true; snapshot: Record<string, unknown>; message?: undefined }
  | { ok: false; snapshot?: undefined; message: string };

export type BuildScenarioBodyResult =
  | {
      ok: true;
      body: Record<string, unknown>;
      openPoints: ScenarioOpenPoint[];
      message?: undefined;
    }
  | { ok: false; body?: undefined; openPoints?: undefined; message: string };

// ───────────────────────────────────────────────────────────────────────────
// Valeurs par défaut : valides et ANONYMES
// ───────────────────────────────────────────────────────────────────────────

export function emptyCargoUnitDraft(index: number): CargoUnitDraft {
  return {
    unitRef: `lot-${index}`,
    unitKind: "CONTAINER",
    equipmentKnown: false,
    equipmentCode: "",
    packaging: "unknown",
    quantity: "1",
    grossWeightKg: "",
    chargeableWeightKg: "",
    volumeDm3: "",
    temperatureControlRequired: false,
    temperatureSetpointCelsius: "",
    classificationStatus: "unknown",
    destinationRef: "",
    dangerousGoods: false,
    requiredAttachmentStatus: "not_required",
  };
}

function emptyPlaceDraft(kind: LocationKind): PlaceDraft {
  return {
    locationKind: kind,
    locationStatus: "to_propose",
    locationCode: "",
    alternatives: "",
  };
}

/**
 * Périmètre vierge : rien n'est supposé connu. Les défauts ouvrent donc des
 * points ouverts (emballage, équipement, classification, lieux à proposer) —
 * c'est le comportement voulu : un périmètre neuf n'est pas un périmètre net.
 */
export function emptyScenarioDraft(): ScenarioDraft {
  return {
    title: "",
    status: "draft",
    blockedReason: "",
    revisionReason: "",
    transportMode: "MARITIME",
    movementDirection: "IMPORT",
    terminalOperationMode: TERMINAL_MODE_UNSPECIFIED,
    origin: emptyPlaceDraft("PORT"),
    destination: emptyPlaceDraft("PORT"),
    cargoUnits: [emptyCargoUnitDraft(1)],
    customsRegimeStatus: "unknown",
    customsRegimeCode: "",
    customsSplitDeclarations: false,
    bookingStage: "none",
    bookingCarrierRef: "",
    documentsSplitRequired: false,
    documentsSetsCount: "1",
    partiesPayerIsShipper: true,
    partiesPayerRef: "",
    partiesConsigneeRef: "",
    constraintsMultiDestination: false,
    constraintsTransitCountryRefs: "",
    links: [],
  };
}

export function emptyLinkDraft(): ScenarioLinkDraft {
  return {
    target: "reserve",
    assumptionId: "",
    reserveCode: "MISSING_HS_CODE",
    openPointKey: "",
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers de saisie
// ───────────────────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

type Parsed<T> = { ok: true; value: T; message?: undefined } | { ok: false; value?: undefined; message: string };

/**
 * Valide une référence ANONYME. Un identifiant technique (UUID) y est refusé
 * alors même qu'il satisferait le format : le périmètre ne porte jamais
 * d'identité de ligne, sinon son hash dépendrait d'un cycle de vie externe.
 */
function parseRef(raw: string, field: string): Parsed<string> {
  const value = raw.trim();
  if (!REF_RE.test(value)) {
    return {
      ok: false,
      message: `${field} doit être une référence anonyme en minuscules ([a-z0-9._-], 64 caractères max), sans donnée client réelle.`,
    };
  }
  if (UUID_RE.test(value)) {
    return { ok: false, message: `${field} ne peut pas être un identifiant technique.` };
  }
  return { ok: true, value };
}

function parseRefList(raw: string, field: string): Parsed<string[]> {
  const tokens = raw
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t !== "");
  if (tokens.length > MAX_ALTERNATIVES) {
    return { ok: false, message: `${field} : ${MAX_ALTERNATIVES} entrées au maximum.` };
  }
  const values: string[] = [];
  for (const token of tokens) {
    const parsed = parseRef(token, `${field} « ${token} »`);
    if (!parsed.ok) return { ok: false, message: parsed.message };
    if (!values.includes(parsed.value)) values.push(parsed.value);
  }
  return { ok: true, value: values };
}

/** Entier strict : ni décimal, ni notation exponentielle, ni espace interne. */
function parseInteger(raw: string, field: string, min: number, max: number): Parsed<number> {
  const text = raw.trim();
  if (!INTEGER_RE.test(text)) {
    return { ok: false, message: `${field} doit être un entier.` };
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_SNAPSHOT_INTEGER) {
    return { ok: false, message: `${field} est hors des bornes admises.` };
  }
  if (value < min || value > max) {
    return { ok: false, message: `${field} doit être compris entre ${min} et ${max}.` };
  }
  return { ok: true, value };
}

/** Vide ⇒ `null` : « inconnu » est une valeur du périmètre, pas une absence. */
function parseOptionalInteger(
  raw: string,
  field: string,
  min: number,
  max: number,
): Parsed<number | null> {
  if (raw.trim() === "") return { ok: true, value: null };
  const parsed = parseInteger(raw, field, min, max);
  return parsed.ok ? { ok: true, value: parsed.value } : { ok: false, message: parsed.message };
}

/**
 * Longueur en octets de `scope_snapshot::text` telle que PostgreSQL la mesure
 * (un espace après chaque `:` et chaque `,`). Miroir de `jsonbTextByteLength`
 * de `domain.ts` : mesurer la forme compacte laisserait passer un périmètre que
 * le CHECK refuserait ensuite avec une erreur base opaque.
 */
export function jsonbTextByteLength(value: unknown): number {
  const compact = JSON.stringify(value) ?? "null";
  let separators = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      separators += Math.max(0, node.length - 1);
      node.forEach(walk);
      return;
    }
    if (isPlainObject(node)) {
      const keys = Object.keys(node);
      separators += keys.length;
      separators += Math.max(0, keys.length - 1);
      for (const k of keys) walk(node[k]);
    }
  };
  walk(value);
  return new TextEncoder().encode(compact).length + separators;
}

// ───────────────────────────────────────────────────────────────────────────
// Construction du snapshot de périmètre (schéma FERMÉ v1)
// ───────────────────────────────────────────────────────────────────────────

function buildPlace(draft: PlaceDraft, field: string): Parsed<Record<string, unknown>> {
  const place: Record<string, unknown> = {
    location_kind: draft.locationKind,
    location_status: draft.locationStatus,
    location_code: null,
  };

  if (draft.locationCode.trim() !== "") {
    const code = parseRef(draft.locationCode, `${field} : code du lieu`);
    if (!code.ok) return { ok: false, message: code.message };
    place.location_code = code.value;
  }

  const alternatives = parseRefList(draft.alternatives, `${field} : alternatives`);
  if (!alternatives.ok) return { ok: false, message: alternatives.message };
  if (alternatives.value.length > 0) place.alternatives = alternatives.value;

  return { ok: true, value: place };
}

function buildCargoUnit(draft: CargoUnitDraft, position: number): Parsed<Record<string, unknown>> {
  const label = `Lot ${position}`;

  const unitRef = parseRef(draft.unitRef, `${label} : référence`);
  if (!unitRef.ok) return { ok: false, message: unitRef.message };

  const quantity = parseInteger(draft.quantity, `${label} : quantité`, 1, MAX_SNAPSHOT_INTEGER);
  if (!quantity.ok) return { ok: false, message: quantity.message };

  const gross = parseOptionalInteger(
    draft.grossWeightKg,
    `${label} : poids brut (kg)`,
    0,
    MAX_SNAPSHOT_INTEGER,
  );
  if (!gross.ok) return { ok: false, message: gross.message };

  const chargeable = parseOptionalInteger(
    draft.chargeableWeightKg,
    `${label} : poids taxable (kg)`,
    0,
    MAX_SNAPSHOT_INTEGER,
  );
  if (!chargeable.ok) return { ok: false, message: chargeable.message };

  const volume = parseOptionalInteger(
    draft.volumeDm3,
    `${label} : volume (dm³)`,
    0,
    MAX_SNAPSHOT_INTEGER,
  );
  if (!volume.ok) return { ok: false, message: volume.message };

  // Consigne ENTIÈRE en degrés Celsius : une consigne fractionnaire devrait
  // changer d'unité de base, sinon le hash de périmètre dépendrait du rendu
  // numérique.
  const setpoint = parseOptionalInteger(
    draft.temperatureSetpointCelsius,
    `${label} : consigne de température (°C)`,
    MIN_TEMPERATURE_CELSIUS,
    MAX_TEMPERATURE_CELSIUS,
  );
  if (!setpoint.ok) return { ok: false, message: setpoint.message };

  let equipmentCode: string | null = null;
  if (draft.equipmentKnown) {
    const parsed = parseRef(draft.equipmentCode, `${label} : code équipement`);
    if (!parsed.ok) return { ok: false, message: parsed.message };
    equipmentCode = parsed.value;
  }

  let destinationRef: string | null = null;
  if (draft.destinationRef.trim() !== "") {
    const parsed = parseRef(draft.destinationRef, `${label} : destination du lot`);
    if (!parsed.ok) return { ok: false, message: parsed.message };
    destinationRef = parsed.value;
  }

  return {
    ok: true,
    value: {
      unit_ref: unitRef.value,
      unit_kind: draft.unitKind,
      equipment_code: equipmentCode,
      packaging: draft.packaging,
      quantity: quantity.value,
      gross_weight_kg: gross.value,
      chargeable_weight_kg: chargeable.value,
      volume_dm3: volume.value,
      temperature_control_required: draft.temperatureControlRequired,
      temperature_setpoint_celsius: setpoint.value,
      classification_status: draft.classificationStatus,
      destination_ref: destinationRef,
      dangerous_goods: draft.dangerousGoods,
      required_attachment_status: draft.requiredAttachmentStatus,
    },
  };
}

/**
 * Construit le snapshot exactement tel qu'il sera envoyé : vocabulaire fermé,
 * aucune clé monétaire, aucun identifiant technique, aucun décimal.
 */
export function buildScopeSnapshot(draft: ScenarioDraft): BuildSnapshotResult {
  if (draft.cargoUnits.length < MIN_CARGO_UNITS || draft.cargoUnits.length > MAX_CARGO_UNITS) {
    return {
      ok: false,
      message: `Un périmètre décrit entre ${MIN_CARGO_UNITS} et ${MAX_CARGO_UNITS} lots (${draft.cargoUnits.length} saisi[s]). Au-delà, le scinder en plusieurs scénarios.`,
    };
  }

  const origin = buildPlace(draft.origin, "Origine");
  if (!origin.ok) return { ok: false, message: origin.message };

  const destination = buildPlace(draft.destination, "Destination");
  if (!destination.ok) return { ok: false, message: destination.message };

  const cargoUnits: Record<string, unknown>[] = [];
  const seenRefs = new Set<string>();
  for (let i = 0; i < draft.cargoUnits.length; i++) {
    const unit = buildCargoUnit(draft.cargoUnits[i], i + 1);
    if (!unit.ok) return { ok: false, message: unit.message };
    const ref = unit.value.unit_ref as string;
    if (seenRefs.has(ref)) {
      return { ok: false, message: `Référence de lot dupliquée : « ${ref} ». Chaque lot est distinct.` };
    }
    seenRefs.add(ref);
    cargoUnits.push(unit.value);
  }

  const customs: Record<string, unknown> = {
    regime_status: draft.customsRegimeStatus,
    split_declarations: draft.customsSplitDeclarations,
  };
  if (draft.customsRegimeCode.trim() !== "") {
    const code = parseRef(draft.customsRegimeCode, "Douane : code de régime");
    if (!code.ok) return { ok: false, message: code.message };
    customs.regime_code = code.value;
  }

  const booking: Record<string, unknown> = { stage: draft.bookingStage };
  if (draft.bookingCarrierRef.trim() !== "") {
    const carrier = parseRef(draft.bookingCarrierRef, "Booking : référence transporteur");
    if (!carrier.ok) return { ok: false, message: carrier.message };
    booking.carrier_ref = carrier.value;
  }

  const setsCount = parseInteger(
    draft.documentsSetsCount,
    "Documents : nombre de jeux",
    1,
    MAX_SNAPSHOT_INTEGER,
  );
  if (!setsCount.ok) return { ok: false, message: setsCount.message };

  const parties: Record<string, unknown> = { payer_is_shipper: draft.partiesPayerIsShipper };
  if (draft.partiesPayerRef.trim() !== "") {
    const payer = parseRef(draft.partiesPayerRef, "Parties : référence payeur");
    if (!payer.ok) return { ok: false, message: payer.message };
    parties.payer_ref = payer.value;
  }
  if (draft.partiesConsigneeRef.trim() !== "") {
    const consignee = parseRef(draft.partiesConsigneeRef, "Parties : référence destinataire");
    if (!consignee.ok) return { ok: false, message: consignee.message };
    parties.consignee_ref = consignee.value;
  }

  const transitRefs = parseRefList(
    draft.constraintsTransitCountryRefs,
    "Contraintes : pays de transit",
  );
  if (!transitRefs.ok) return { ok: false, message: transitRefs.message };

  const snapshot: Record<string, unknown> = {
    schema_version: 1,
    transport_mode: draft.transportMode,
    movement_direction: draft.movementDirection,
    terminal_operation_mode:
      draft.terminalOperationMode === TERMINAL_MODE_UNSPECIFIED ? null : draft.terminalOperationMode,
    origin: origin.value,
    destination: destination.value,
    cargo_units: cargoUnits,
    customs,
    booking,
    documents: { split_required: draft.documentsSplitRequired, sets_count: setsCount.value },
    parties,
    constraints: {
      multi_destination: draft.constraintsMultiDestination,
      transit_country_refs: transitRefs.value,
    },
  };

  const bytes = jsonbTextByteLength(snapshot);
  if (bytes > MAX_SNAPSHOT_BYTES) {
    return {
      ok: false,
      message: `Le périmètre dépasse ${MAX_SNAPSHOT_BYTES} octets (${bytes}). Le scinder en plusieurs scénarios.`,
    };
  }

  return { ok: true, snapshot };
}

// ───────────────────────────────────────────────────────────────────────────
// Points ouverts : APERÇU non autoritaire
// ───────────────────────────────────────────────────────────────────────────

function openPoint(code: OpenPointCode, ref: string | null): ScenarioOpenPoint {
  return { key: ref === null ? code : `${code}:${ref}`, code, ref };
}

/**
 * Miroir de `deriveOpenPoints` (domain.ts) pour l'APERÇU du formulaire et pour
 * proposer une couverture de point ouvert à un lien.
 *
 * Cette dérivation ne fait AUTORITÉ SUR RIEN : la base redérive les points
 * ouverts du périmètre et n'écrit que sa propre dérivation ; l'Edge Function
 * refuse tout `open_point_key` qui ne lui appartient pas. En cas d'écart, la
 * requête échoue avec un motif lisible — rien n'est deviné ni corrigé.
 *
 * Une contrainte CONNUE n'est jamais un point ouvert : marchandises
 * dangereuses, transit, payeur distinct, jeux documentaires séparés,
 * multi-destination entièrement affectée, RoRo/ConRo n'ouvrent rien.
 */
export function deriveScenarioOpenPoints(snapshot: Record<string, unknown>): ScenarioOpenPoint[] {
  const points: ScenarioOpenPoint[] = [];
  const transportMode = snapshot.transport_mode;

  for (const place of ["origin", "destination"] as const) {
    const value = snapshot[place];
    if (!isPlainObject(value)) continue;
    if (value.location_status === "to_propose") points.push(openPoint("port_to_propose", place));
    if (value.location_status === "alternatives_open") {
      points.push(openPoint("port_alternatives_open", place));
    }
  }

  // Le mode terminal n'est un manque réel que sur un périmètre maritime.
  if (transportMode === "MARITIME" && snapshot.terminal_operation_mode === null) {
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

    if (rawUnit.packaging === "unknown") points.push(openPoint("packaging_unknown", ref));
    if (rawUnit.equipment_code === null) points.push(openPoint("equipment_unknown", ref));
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

    if (transportMode === "AIR") {
      const gross = rawUnit.gross_weight_kg;
      const chargeable = rawUnit.chargeable_weight_kg;
      const missing = chargeable === null || chargeable === undefined;
      const contradictory =
        typeof gross === "number" && typeof chargeable === "number" && chargeable < gross;
      if (missing || contradictory) points.push(openPoint("chargeable_basis_unconfirmed", ref));
    }

    if (rawUnit.destination_ref === null || rawUnit.destination_ref === undefined) {
      unassignedDestination = true;
    }
  }

  if (multiDestination && unassignedDestination) {
    points.push(openPoint("destination_split_unknown", null));
  }

  if (isPlainObject(snapshot.customs) && snapshot.customs.regime_status === "unknown") {
    points.push(openPoint("customs_regime_unknown", null));
  }

  if (isPlainObject(snapshot.booking) && snapshot.booking.stage === "pre_booking") {
    points.push(openPoint("booking_pre_booking", null));
  }

  points.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return points;
}

/** Lit les points ouverts PERSISTÉS (colonne `open_points`), seule autorité. */
export function readStoredOpenPoints(raw: unknown): ScenarioOpenPoint[] {
  if (!Array.isArray(raw)) return [];
  const points: ScenarioOpenPoint[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    if (typeof item.key !== "string" || typeof item.code !== "string") continue;
    points.push({
      key: item.key,
      code: item.code,
      ref: typeof item.ref === "string" ? item.ref : null,
    });
  }
  return points;
}

// ───────────────────────────────────────────────────────────────────────────
// Construction du payload de l'Edge Function
// ───────────────────────────────────────────────────────────────────────────

function linkIdentity(link: Record<string, unknown>): string {
  return `${(link.assumption_id as string) ?? ""}|${(link.reserve_code as string) ?? ""}|${
    (link.open_point_key as string) ?? ""
  }`;
}

function buildLinks(
  drafts: ScenarioLinkDraft[],
  openPoints: ScenarioOpenPoint[],
): Parsed<Record<string, unknown>[]> {
  if (drafts.length > MAX_LINKS) {
    return { ok: false, message: `Un scénario porte au maximum ${MAX_LINKS} liens.` };
  }

  const openPointKeys = new Set(openPoints.map((p) => p.key));
  const seen = new Set<string>();
  const links: Record<string, unknown>[] = [];

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    const label = `Lien ${i + 1}`;
    const link: Record<string, unknown> = {};

    // EXACTEMENT une cible : une hypothèse OU une réserve doctrinale.
    if (draft.target === "assumption") {
      const id = draft.assumptionId.trim();
      if (!UUID_RE.test(id)) {
        return { ok: false, message: `${label} : sélectionner une hypothèse.` };
      }
      link.assumption_id = id;
    } else {
      if (!(RESERVE_CODES as readonly string[]).includes(draft.reserveCode)) {
        return { ok: false, message: `${label} : réserve hors whitelist doctrinale.` };
      }
      link.reserve_code = draft.reserveCode;
    }

    const openPointKey = draft.openPointKey.trim();
    if (openPointKey !== "") {
      // Les points ouverts sont dérivés du périmètre, jamais déclarés : un lien
      // ne peut couvrir qu'un point que ce périmètre ouvre réellement.
      if (!openPointKeys.has(openPointKey)) {
        return {
          ok: false,
          message: `${label} : « ${openPointKey} » n'est pas un point ouvert de ce périmètre. Les points ouverts sont dérivés du périmètre, jamais déclarés.`,
        };
      }
      link.open_point_key = openPointKey;
    }

    const identity = linkIdentity(link);
    if (seen.has(identity)) {
      return { ok: false, message: `${label} : lien en doublon exact.` };
    }
    seen.add(identity);
    links.push(link);
  }

  // Ordre canonique : le jeu de liens est un ENSEMBLE. Le trier rend l'empreinte
  // de requête insensible à l'ordre de saisie, comme le fait `domain.ts`.
  links.sort((a, b) => {
    const ka = linkIdentity(a);
    const kb = linkIdentity(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return { ok: true, value: links };
}

/**
 * Construit le corps envoyé à `manage-quote-scenario`.
 *
 * N'émet JAMAIS d'identité, d'état dérivé, de chaîne de révision, de hash ni de
 * points ouverts : l'Edge Function refuse ces champs et le serveur les fixe
 * lui-même. `idempotency_key` est fourni par l'appelant ; l'empreinte de requête
 * est calculée côté serveur.
 */
export function buildScenarioRequestBody(
  caseId: string,
  operation: ScenarioOperation,
  idempotencyKey: string,
  draft: ScenarioDraft | null,
  scenarioId?: string,
): BuildScenarioBodyResult {
  if (!UUID_RE.test(caseId)) return { ok: false, message: "Dossier invalide." };

  const key = idempotencyKey.trim();
  if (key.length < 8 || key.length > 128) {
    return { ok: false, message: "Clé d'idempotence invalide." };
  }

  // Sélectionner est un acte SÉPARÉ : il ne redéfinit ni périmètre, ni titre,
  // ni statut, ni liens.
  if (operation === "select") {
    if (!scenarioId || !UUID_RE.test(scenarioId)) {
      return { ok: false, message: "Scénario cible manquant." };
    }
    return {
      ok: true,
      openPoints: [],
      body: {
        case_id: caseId,
        operation,
        idempotency_key: key,
        scenario_id: scenarioId,
      },
    };
  }

  if (!draft) return { ok: false, message: "Contenu du scénario manquant." };

  const title = draft.title.trim();
  if (title === "") return { ok: false, message: "Le titre du scénario est obligatoire." };
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, message: `Le titre dépasse ${MAX_TITLE_LENGTH} caractères.` };
  }

  const snapshot = buildScopeSnapshot(draft);
  if (!snapshot.ok) return { ok: false, message: snapshot.message };

  const openPoints = deriveScenarioOpenPoints(snapshot.snapshot);

  const links = buildLinks(draft.links, openPoints);
  if (!links.ok) return { ok: false, message: links.message };

  const body: Record<string, unknown> = {
    case_id: caseId,
    operation,
    idempotency_key: key,
    title,
    scope_snapshot: snapshot.snapshot,
    status: draft.status,
    links: links.value,
  };

  // `blocked` est un statut assumé et légitime — mais jamais muet.
  if (draft.status === "blocked") {
    const reason = draft.blockedReason.trim();
    if (reason === "") {
      return { ok: false, message: "Un scénario bloqué doit dire pourquoi il l'est." };
    }
    if (reason.length > MAX_REASON_LENGTH) {
      return { ok: false, message: `Le motif de blocage dépasse ${MAX_REASON_LENGTH} caractères.` };
    }
    body.blocked_reason = reason;
  }

  if (operation === "create") {
    if (scenarioId) {
      return { ok: false, message: "Une création ne désigne aucun scénario existant." };
    }
    return { ok: true, body, openPoints };
  }

  if (!scenarioId || !UUID_RE.test(scenarioId)) {
    return { ok: false, message: "Scénario révisé manquant." };
  }

  // Une révision est un acte tracé : elle dit POURQUOI.
  const revisionReason = draft.revisionReason.trim();
  if (revisionReason === "") {
    return { ok: false, message: "Le motif de révision est obligatoire." };
  }
  if (revisionReason.length > MAX_REASON_LENGTH) {
    return { ok: false, message: `Le motif de révision dépasse ${MAX_REASON_LENGTH} caractères.` };
  }

  body.scenario_id = scenarioId;
  body.revision_reason = revisionReason;
  return { ok: true, body, openPoints };
}

/**
 * Identité locale d'une mutation logique.
 *
 * Elle ne quitte jamais le navigateur et ne remplace ni l'empreinte serveur ni
 * la clé d'idempotence. Elle permet seulement à l'UI de retrouver la MÊME clé
 * après une réponse réseau perdue. Modifier le contenu, l'opération ou la cible
 * produit une nouvelle identité, donc une nouvelle mutation logique.
 */
export function scenarioMutationSignature(
  caseId: string,
  operation: ScenarioOperation,
  draft: ScenarioDraft | null,
  scenarioId?: string,
): string {
  return JSON.stringify({
    case_id: caseId,
    operation,
    scenario_id: scenarioId ?? null,
    draft,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Préremplissage d'une révision
// ───────────────────────────────────────────────────────────────────────────

function enumOr<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function intText(raw: unknown): string {
  return typeof raw === "number" && Number.isInteger(raw) ? String(raw) : "";
}

function refText(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

function placeDraftFrom(raw: unknown, fallbackKind: LocationKind): PlaceDraft {
  if (!isPlainObject(raw)) return emptyPlaceDraft(fallbackKind);
  const alternatives = Array.isArray(raw.alternatives)
    ? raw.alternatives.filter((a): a is string => typeof a === "string")
    : [];
  return {
    locationKind: enumOr(raw.location_kind, LOCATION_KINDS, fallbackKind),
    locationStatus: enumOr(raw.location_status, LOCATION_STATUSES, "to_propose"),
    locationCode: refText(raw.location_code),
    alternatives: alternatives.join(", "),
  };
}

function cargoUnitDraftFrom(raw: unknown, index: number): CargoUnitDraft {
  if (!isPlainObject(raw)) return emptyCargoUnitDraft(index);
  const equipmentCode = raw.equipment_code;
  return {
    unitRef: refText(raw.unit_ref) || `lot-${index}`,
    unitKind: enumOr(raw.unit_kind, UNIT_KINDS, "CONTAINER"),
    equipmentKnown: typeof equipmentCode === "string" && equipmentCode !== "",
    equipmentCode: refText(equipmentCode),
    packaging: enumOr(raw.packaging, PACKAGING_VALUES, "unknown"),
    quantity: intText(raw.quantity) || "1",
    grossWeightKg: intText(raw.gross_weight_kg),
    chargeableWeightKg: intText(raw.chargeable_weight_kg),
    volumeDm3: intText(raw.volume_dm3),
    temperatureControlRequired: raw.temperature_control_required === true,
    temperatureSetpointCelsius: intText(raw.temperature_setpoint_celsius),
    classificationStatus: enumOr(raw.classification_status, CLASSIFICATION_STATUSES, "unknown"),
    destinationRef: refText(raw.destination_ref),
    dangerousGoods: raw.dangerous_goods === true,
    requiredAttachmentStatus: enumOr(
      raw.required_attachment_status,
      ATTACHMENT_STATUSES,
      "not_required",
    ),
  };
}

export interface StoredScenarioLink {
  assumption_id: string | null;
  reserve_code: string | null;
  open_point_key: string | null;
}

/**
 * Préremplit un NOUVEAU brouillon depuis un scénario existant. Le scénario
 * source n'est jamais modifié : réviser produit une nouvelle version, et le
 * motif de révision reste à saisir.
 *
 * Les liens sont recopiés dans le brouillon parce qu'une révision REDÉCLARE son
 * jeu de liens : la RPC n'en reporte aucun automatiquement. Un lien dont le
 * point ouvert disparaît du nouveau périmètre est signalé à la construction du
 * payload, jamais rattrapé en silence.
 */
export function draftFromScenario(
  scenario: { title: string; status: string; blocked_reason: string | null; scope_snapshot: unknown },
  links: StoredScenarioLink[] = [],
): ScenarioDraft {
  const base = emptyScenarioDraft();
  const snapshot = isPlainObject(scenario.scope_snapshot) ? scenario.scope_snapshot : {};

  const rawUnits = Array.isArray(snapshot.cargo_units) ? snapshot.cargo_units : [];
  const cargoUnits =
    rawUnits.length > 0
      ? rawUnits.slice(0, MAX_CARGO_UNITS).map((u, i) => cargoUnitDraftFrom(u, i + 1))
      : base.cargoUnits;

  const customs = isPlainObject(snapshot.customs) ? snapshot.customs : {};
  const booking = isPlainObject(snapshot.booking) ? snapshot.booking : {};
  const documents = isPlainObject(snapshot.documents) ? snapshot.documents : {};
  const parties = isPlainObject(snapshot.parties) ? snapshot.parties : {};
  const constraints = isPlainObject(snapshot.constraints) ? snapshot.constraints : {};
  const transitRefs = Array.isArray(constraints.transit_country_refs)
    ? constraints.transit_country_refs.filter((r): r is string => typeof r === "string")
    : [];

  const terminalMode = snapshot.terminal_operation_mode;

  return {
    ...base,
    title: scenario.title,
    status: enumOr(scenario.status, SCENARIO_WRITABLE_STATUSES, "draft"),
    blockedReason: scenario.blocked_reason ?? "",
    // Un motif de révision ne se recopie jamais : chaque révision dit le sien.
    revisionReason: "",
    transportMode: enumOr(snapshot.transport_mode, TRANSPORT_MODES, base.transportMode),
    movementDirection: enumOr(
      snapshot.movement_direction,
      MOVEMENT_DIRECTIONS,
      base.movementDirection,
    ),
    terminalOperationMode:
      typeof terminalMode === "string" &&
      (TERMINAL_OPERATION_MODES as readonly string[]).includes(terminalMode)
        ? (terminalMode as TerminalOperationMode)
        : TERMINAL_MODE_UNSPECIFIED,
    origin: placeDraftFrom(snapshot.origin, "PORT"),
    destination: placeDraftFrom(snapshot.destination, "PORT"),
    cargoUnits,
    customsRegimeStatus: enumOr(customs.regime_status, REGIME_STATUSES, "unknown"),
    customsRegimeCode: refText(customs.regime_code),
    customsSplitDeclarations: customs.split_declarations === true,
    bookingStage: enumOr(booking.stage, BOOKING_STAGES, "none"),
    bookingCarrierRef: refText(booking.carrier_ref),
    documentsSplitRequired: documents.split_required === true,
    documentsSetsCount: intText(documents.sets_count) || "1",
    partiesPayerIsShipper: parties.payer_is_shipper !== false,
    partiesPayerRef: refText(parties.payer_ref),
    partiesConsigneeRef: refText(parties.consignee_ref),
    constraintsMultiDestination: constraints.multi_destination === true,
    constraintsTransitCountryRefs: transitRefs.join(", "),
    links: links.map((link) => ({
      target: link.assumption_id ? "assumption" : "reserve",
      assumptionId: link.assumption_id ?? "",
      reserveCode: enumOr(link.reserve_code, RESERVE_CODES, "MISSING_HS_CODE"),
      openPointKey: link.open_point_key ?? "",
    })),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// État d'un scénario
// ───────────────────────────────────────────────────────────────────────────

export interface ScenarioStateRow {
  status: string;
  superseded_by_scenario_id: string | null;
}

/** P1-A2 ne révise que draft et blocked, et jamais une version déjà remplacée. */
export function canReviseScenario(scenario: ScenarioStateRow): boolean {
  if (scenario.superseded_by_scenario_id) return false;
  return (SCENARIO_WRITABLE_STATUSES as readonly string[]).includes(scenario.status);
}

/** Un scénario remplacé ne peut pas être sélectionné : son successeur le peut. */
export function canSelectScenario(scenario: ScenarioStateRow): boolean {
  return scenario.status !== "superseded" && !scenario.superseded_by_scenario_id;
}

// ───────────────────────────────────────────────────────────────────────────
// Comparaison lisible de deux périmètres
// ───────────────────────────────────────────────────────────────────────────

export interface ScopeFieldValue {
  /** Chemin MÉTIER stable, indépendant de l'ordre des tableaux. */
  path: string;
  label: string;
  value: string;
}

export interface ScopeDifference {
  path: string;
  label: string;
  kind: "added" | "removed" | "changed";
  before: string | null;
  after: string | null;
}

export interface ScopeComparison {
  differences: ScopeDifference[];
  identical: boolean;
  addedUnitRefs: string[];
  removedUnitRefs: string[];
  commonUnitRefs: string[];
}

const ABSENT = "—";

function labelOf<T extends string>(raw: unknown, labels: Record<T, string>): string {
  if (typeof raw !== "string") return ABSENT;
  return labels[raw as T] ?? raw;
}

function boolText(raw: unknown): string {
  if (raw === true) return "Oui";
  if (raw === false) return "Non";
  return ABSENT;
}

function numberText(raw: unknown, suffix: string): string {
  if (typeof raw !== "number") return "Inconnu";
  return suffix === "" ? String(raw) : `${raw} ${suffix}`;
}

function refValue(raw: unknown): string {
  return typeof raw === "string" && raw !== "" ? raw : ABSENT;
}

function listValue(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return ABSENT;
  return raw.filter((v): v is string => typeof v === "string").join(", ");
}

function placeFields(raw: unknown, prefix: string, label: string): ScopeFieldValue[] {
  const place = isPlainObject(raw) ? raw : {};
  return [
    {
      path: `${prefix}.location_kind`,
      label: `${label} · Nature du lieu`,
      value: labelOf(place.location_kind, LOCATION_KIND_LABELS),
    },
    {
      path: `${prefix}.location_code`,
      label: `${label} · Code du lieu`,
      value: refValue(place.location_code),
    },
    {
      path: `${prefix}.location_status`,
      label: `${label} · Statut du lieu`,
      value: labelOf(place.location_status, LOCATION_STATUS_LABELS),
    },
    {
      path: `${prefix}.alternatives`,
      label: `${label} · Alternatives`,
      value: listValue(place.alternatives),
    },
  ];
}

/**
 * Projection LISIBLE d'un périmètre, hors lots. Ordre fixe : la comparaison est
 * donc stable d'une exécution à l'autre.
 */
export function projectScopeFields(raw: unknown): ScopeFieldValue[] {
  const s = isPlainObject(raw) ? raw : {};
  const customs = isPlainObject(s.customs) ? s.customs : {};
  const booking = isPlainObject(s.booking) ? s.booking : {};
  const documents = isPlainObject(s.documents) ? s.documents : {};
  const parties = isPlainObject(s.parties) ? s.parties : {};
  const constraints = isPlainObject(s.constraints) ? s.constraints : {};

  return [
    {
      path: "transport_mode",
      label: "Mode de transport",
      value: labelOf(s.transport_mode, TRANSPORT_MODE_LABELS),
    },
    {
      path: "movement_direction",
      label: "Sens du mouvement",
      value: labelOf(s.movement_direction, MOVEMENT_DIRECTION_LABELS),
    },
    {
      path: "terminal_operation_mode",
      label: "Mode d'opération terminal",
      value:
        s.terminal_operation_mode === null || s.terminal_operation_mode === undefined
          ? "Non renseigné"
          : labelOf(s.terminal_operation_mode, TERMINAL_OPERATION_MODE_LABELS),
    },
    ...placeFields(s.origin, "origin", "Origine"),
    ...placeFields(s.destination, "destination", "Destination"),
    {
      path: "customs.regime_status",
      label: "Douane · Régime",
      value: labelOf(customs.regime_status, REGIME_STATUS_LABELS),
    },
    {
      path: "customs.regime_code",
      label: "Douane · Code de régime",
      value: refValue(customs.regime_code),
    },
    {
      path: "customs.split_declarations",
      label: "Douane · Déclarations scindées",
      value: boolText(customs.split_declarations),
    },
    {
      path: "booking.stage",
      label: "Booking · Étape",
      value: labelOf(booking.stage, BOOKING_STAGE_LABELS),
    },
    {
      path: "booking.carrier_ref",
      label: "Booking · Transporteur",
      value: refValue(booking.carrier_ref),
    },
    {
      path: "documents.split_required",
      label: "Documents · Jeux séparés",
      value: boolText(documents.split_required),
    },
    {
      path: "documents.sets_count",
      label: "Documents · Nombre de jeux",
      value: numberText(documents.sets_count, ""),
    },
    {
      path: "parties.payer_is_shipper",
      label: "Parties · Payeur = chargeur",
      value: boolText(parties.payer_is_shipper),
    },
    { path: "parties.payer_ref", label: "Parties · Payeur", value: refValue(parties.payer_ref) },
    {
      path: "parties.consignee_ref",
      label: "Parties · Destinataire",
      value: refValue(parties.consignee_ref),
    },
    {
      path: "constraints.multi_destination",
      label: "Contraintes · Multi-destination",
      value: boolText(constraints.multi_destination),
    },
    {
      path: "constraints.transit_country_refs",
      label: "Contraintes · Pays de transit",
      value: listValue(constraints.transit_country_refs),
    },
  ];
}

/** Projection LISIBLE d'un lot. Chemins relatifs : le préfixe porte l'`unit_ref`. */
export function projectCargoUnitFields(raw: unknown): ScopeFieldValue[] {
  const u = isPlainObject(raw) ? raw : {};
  return [
    { path: "unit_kind", label: "Type", value: labelOf(u.unit_kind, UNIT_KIND_LABELS) },
    {
      path: "equipment_code",
      label: "Équipement",
      value: u.equipment_code === null || u.equipment_code === undefined
        ? "Inconnu"
        : refValue(u.equipment_code),
    },
    { path: "packaging", label: "Emballage", value: labelOf(u.packaging, PACKAGING_LABELS) },
    { path: "quantity", label: "Quantité", value: numberText(u.quantity, "") },
    { path: "gross_weight_kg", label: "Poids brut", value: numberText(u.gross_weight_kg, "kg") },
    {
      path: "chargeable_weight_kg",
      label: "Poids taxable",
      value: numberText(u.chargeable_weight_kg, "kg"),
    },
    { path: "volume_dm3", label: "Volume", value: numberText(u.volume_dm3, "dm³") },
    {
      path: "temperature_control_required",
      label: "Température dirigée",
      value: boolText(u.temperature_control_required),
    },
    {
      path: "temperature_setpoint_celsius",
      label: "Consigne",
      value: u.temperature_setpoint_celsius === null || u.temperature_setpoint_celsius === undefined
        ? "Non arrêtée"
        : numberText(u.temperature_setpoint_celsius, "°C"),
    },
    {
      path: "classification_status",
      label: "Classification",
      value: labelOf(u.classification_status, CLASSIFICATION_STATUS_LABELS),
    },
    {
      path: "destination_ref",
      label: "Destination du lot",
      value: u.destination_ref === null || u.destination_ref === undefined
        ? "Non affectée"
        : refValue(u.destination_ref),
    },
    { path: "dangerous_goods", label: "Marchandise dangereuse", value: boolText(u.dangerous_goods) },
    {
      path: "required_attachment_status",
      label: "Pièce requise",
      value: labelOf(u.required_attachment_status, ATTACHMENT_STATUS_LABELS),
    },
  ];
}

function indexUnitsByRef(raw: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (!Array.isArray(raw)) return map;
  for (const unit of raw) {
    if (!isPlainObject(unit)) continue;
    const ref = unit.unit_ref;
    if (typeof ref !== "string" || ref === "") continue;
    if (!map.has(ref)) map.set(ref, unit);
  }
  return map;
}

function unitSummary(raw: unknown): string {
  const fields = projectCargoUnitFields(raw);
  const pick = (path: string) => fields.find((f) => f.path === path)?.value ?? ABSENT;
  return `${pick("unit_kind")} · ${pick("quantity")} · ${pick("packaging")}`;
}

/**
 * Compare deux périmètres selon des chemins MÉTIER.
 *
 * Les lots sont appariés par `unit_ref`, JAMAIS par position : permuter deux
 * lots dans le tableau ne produit aucune différence. Un lot présent d'un seul
 * côté est un ajout ou un retrait, jamais une avalanche de changements de
 * champs. Aucun dump JSON : chaque écart est nommé et rendu lisible.
 */
export function compareScenarioScopes(before: unknown, after: unknown): ScopeComparison {
  const differences: ScopeDifference[] = [];

  const beforeFields = projectScopeFields(before);
  const afterFields = projectScopeFields(after);
  const afterByPath = new Map(afterFields.map((f) => [f.path, f]));

  for (const field of beforeFields) {
    const other = afterByPath.get(field.path);
    if (!other || other.value === field.value) continue;
    differences.push({
      path: field.path,
      label: field.label,
      kind: "changed",
      before: field.value,
      after: other.value,
    });
  }

  const beforeUnits = indexUnitsByRef(isPlainObject(before) ? before.cargo_units : null);
  const afterUnits = indexUnitsByRef(isPlainObject(after) ? after.cargo_units : null);

  const allRefs = Array.from(new Set([...beforeUnits.keys(), ...afterUnits.keys()])).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  const addedUnitRefs: string[] = [];
  const removedUnitRefs: string[] = [];
  const commonUnitRefs: string[] = [];

  for (const ref of allRefs) {
    const inBefore = beforeUnits.has(ref);
    const inAfter = afterUnits.has(ref);

    if (inBefore && !inAfter) {
      removedUnitRefs.push(ref);
      differences.push({
        path: `cargo_units[${ref}]`,
        label: `Lot ${ref}`,
        kind: "removed",
        before: unitSummary(beforeUnits.get(ref)),
        after: null,
      });
      continue;
    }
    if (!inBefore && inAfter) {
      addedUnitRefs.push(ref);
      differences.push({
        path: `cargo_units[${ref}]`,
        label: `Lot ${ref}`,
        kind: "added",
        before: null,
        after: unitSummary(afterUnits.get(ref)),
      });
      continue;
    }

    commonUnitRefs.push(ref);
    const beforeUnitFields = projectCargoUnitFields(beforeUnits.get(ref));
    const afterUnitFields = projectCargoUnitFields(afterUnits.get(ref));
    const afterUnitByPath = new Map(afterUnitFields.map((f) => [f.path, f]));
    for (const field of beforeUnitFields) {
      const other = afterUnitByPath.get(field.path);
      if (!other || other.value === field.value) continue;
      differences.push({
        path: `cargo_units[${ref}].${field.path}`,
        label: `Lot ${ref} · ${field.label}`,
        kind: "changed",
        before: field.value,
        after: other.value,
      });
    }
  }

  return {
    differences,
    identical: differences.length === 0,
    addedUnitRefs,
    removedUnitRefs,
    commonUnitRefs,
  };
}

/** Écart de points ouverts entre deux versions, lisible et trié. */
export function compareOpenPoints(
  before: ScenarioOpenPoint[],
  after: ScenarioOpenPoint[],
): { resolved: ScenarioOpenPoint[]; opened: ScenarioOpenPoint[] } {
  const beforeKeys = new Set(before.map((p) => p.key));
  const afterKeys = new Set(after.map((p) => p.key));
  const byKey = (a: ScenarioOpenPoint, b: ScenarioOpenPoint) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  return {
    resolved: before.filter((p) => !afterKeys.has(p.key)).sort(byKey),
    opened: after.filter((p) => !beforeKeys.has(p.key)).sort(byKey),
  };
}
