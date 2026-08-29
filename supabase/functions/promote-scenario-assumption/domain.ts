/**
 * Phase P1-A3 — Domaine PUR de l'Edge Function promote-scenario-assumption.
 *
 * Aucune I/O, aucun accès Deno.env, aucun client Supabase : tout est testable
 * hors runtime. index.ts n'ajoute que l'auth, le contrôle d'accès au dossier et
 * l'appel RPC.
 *
 * Contrat P1-A3 :
 *   - UNE hypothèse par appel. Aucun batch, aucun « promouvoir tout » : les
 *     formes de masse sont refusées avec un code dédié (arbitrage CTO n°4) ;
 *   - allowlist de clés FERMÉE, sans aucune clé monétaire ni tarifaire
 *     (arbitrage CTO n°1), sans les classifications à workflow dédié (HS, PAD),
 *     et bornée aux types `text` et `number` — donc aucun json ne peut faire
 *     entrer un montant imbriqué dans quote_facts ;
 *   - base de promotion OBLIGATOIRE et fermée + attestation explicite vraie
 *     (arbitrage CTO n°2) : une promotion n'est jamais automatique ;
 *   - la VALEUR ÉCRITE est lue du ledger par la RPC. Ce module n'envoie qu'un
 *     ÉCHO de ce que l'opérateur a vu (statut, valeur, fait courant remplacé,
 *     périmètre de scénario) : ce sont des assertions d'égalité, pas des
 *     sources d'écriture ;
 *   - aucune identité, aucun état, aucun `confidence`, aucun `source_type` ne
 *     peut être fourni par l'appelant : le serveur les fixe (arbitrages n°3
 *     et n°9) ;
 *   - l'empreinte de requête est calculée SERVEUR, jamais transmise ;
 *   - aucune dé-promotion (arbitrage CTO n°6) : ce module n'en expose aucune.
 *
 * L'autorité reste la base : chaque règle ici a son miroir en SQL
 * (quote_fact_promotion_allowlist / quote_fact_promotion_violation, CHECK du
 * registre, RPC service_role-only). Ce module ne fait que rendre le refus
 * lisible et éviter un aller-retour perdu.
 */

// ── Vocabulaires fermés ────────────────────────────────────────────────────

/** Miroir de quote_fact_promotions_basis_check. */
export const PROMOTION_BASES = [
  "client_written_confirmation",
  "document_evidence",
  "partner_confirmation",
  "regulatory_reference",
  "operator_expertise",
] as const;
export type PromotionBasis = (typeof PROMOTION_BASES)[number];

/** Statuts depuis lesquels une promotion est recevable (arbitrage CTO n°2). */
export const PROMOTABLE_STATUSES = ["active", "client_confirmed"] as const;
export type PromotableStatus = (typeof PROMOTABLE_STATUSES)[number];

/** Types de valeur promouvables. `boolean`, `date` et `json` en sont exclus. */
export const PROMOTABLE_VALUE_TYPES = ["text", "number"] as const;
export type PromotableValueType = (typeof PROMOTABLE_VALUE_TYPES)[number];

/**
 * Formes de masse. Elles ne sont pas « inconnues » : elles sont refusées avec un
 * code dédié, pour que le refus soit lisible et ne puisse pas passer pour une
 * faute de frappe.
 */
export const BATCH_PAYLOAD_KEYS = [
  "assumption_ids",
  "assumptions",
  "promote_all",
  "all",
  "batch",
  "bulk",
] as const;

export const AUTOMATIC_PROMOTION_BASES = [
  "auto",
  "auto_promote",
  "promote_all",
  "bulk",
  "batch",
  "cascade",
  "on_confirm",
] as const;

/**
 * Clés qu'un appelant ne peut JAMAIS fournir : identité et état (fixés par le
 * serveur), provenance et confiance du fait (arbitrages CTO n°3 et n°9),
 * valeur écrite (lue du ledger), catégorie (dérivée de l'allowlist), empreinte
 * (dérivée). Refus explicite plutôt que silencieux.
 */
export const FORBIDDEN_PAYLOAD_KEYS = [
  "actor_user_id",
  "user_id",
  "created_by",
  "resolved_by",
  "resolved_at",
  "status",
  "confidence",
  "source_type",
  "source_excerpt",
  "fact_category",
  "value_text",
  "value_number",
  "value_json",
  "value_date",
  "assumed_value",
  "promoted_fact_id",
  "request_fingerprint",
  "is_current",
  "is_validated",
] as const;

/**
 * Jetons monétaires, comparés EXACTEMENT sur les segments `.` et `_` d'une clé
 * de fait. Miroir de quote_fact_promotion_monetary_token.
 *
 * Jamais en sous-chaîne : `chargeable` n'est pas `charge` et `container` n'est
 * pas `contain` — sans quoi `cargo.chargeable_weight_kg`, légitime, serait
 * rejeté.
 */
export const MONETARY_TOKENS: ReadonlySet<string> = new Set([
  "value", "values", "valeur", "valeurs",
  "price", "prices", "pricing", "prix",
  "tarif", "tarifs", "tariff", "taux",
  "rate", "rates",
  "amount", "amounts", "montant", "montants",
  "total", "totals", "subtotal", "sum",
  "cost", "costs", "cout", "couts",
  "fee", "fees", "frais",
  "charge", "charges",
  "currency", "currencies", "devise", "devises",
  "money", "monnaie", "invoice", "facture", "billing",
  "exchange", "change",
  "usd", "eur", "xof", "fcfa", "cfa",
  "margin", "marge", "discount", "remise", "surcharge",
  "tax", "taxes", "taxe", "duty", "duties", "droit", "droits", "vat", "tva",
  "caf", "cif", "fob", "exw", "ddp", "dap",
  "freight", "fret",
]);

export function isMonetaryFactKey(factKey: string): boolean {
  return factKey
    .toLowerCase()
    .split(/[._]/)
    .some((token) => MONETARY_TOKENS.has(token));
}

export interface PromotableFactKey {
  readonly factKey: string;
  readonly factCategory: string;
  readonly valueType: PromotableValueType;
  /** Vocabulaire fermé quand la dimension en a un ; `null` sinon. */
  readonly allowedValues: readonly string[] | null;
  readonly minValue: number | null;
  readonly maxValue: number | null;
  readonly integerOnly: boolean;
}

/**
 * ALLOWLIST FERMÉE — miroir EXACT de public.quote_fact_promotion_allowlist().
 *
 * Sous-ensemble strict de l'allowlist de set-case-fact, amputé de :
 *   - tout ce qui est monétaire ou tarifaire (cargo.value, cargo.caf_value,
 *     cargo.freight_cost, cargo.pad_rate_fcfa_per_ton,
 *     cargo.freight_exchange_rate) — arbitrage CTO n°1 ;
 *   - tout ce qui porte des montants imbriqués (cargo.articles_detail,
 *     cargo.containers, service.overrides) : un `unit_price` y voyagerait
 *     à l'intérieur d'un json, hors de portée d'un contrôle par clé ;
 *   - les classifications à workflow dédié (cargo.hs_code, cargo.pad_category),
 *     qui passent par commodity_classification_candidates →
 *     propagate_classification_candidate_to_fact ;
 *   - regulatory.exemption_title, qui modifie directement droits et taxes ;
 *   - client.code, identité de tiers et non hypothèse de périmètre.
 *
 * Ne restent que des dimensions de PÉRIMÈTRE — le vocabulaire que P1-A2 a déjà
 * déclaré non monétaire dans scope_snapshot.
 */
export const PROMOTABLE_FACT_KEYS: readonly PromotableFactKey[] = [
  { factKey: "cargo.weight_kg", factCategory: "cargo", valueType: "number", allowedValues: null, minValue: 0.001, maxValue: 1_000_000_000, integerOnly: false },
  { factKey: "cargo.chargeable_weight_kg", factCategory: "cargo", valueType: "number", allowedValues: null, minValue: 0.001, maxValue: 1_000_000_000, integerOnly: false },
  { factKey: "cargo.weight_per_container_kg", factCategory: "cargo", valueType: "number", allowedValues: null, minValue: 0.001, maxValue: 1_000_000_000, integerOnly: false },
  { factKey: "cargo.volume_cbm", factCategory: "cargo", valueType: "number", allowedValues: null, minValue: 0.001, maxValue: 1_000_000, integerOnly: false },
  { factKey: "cargo.pieces_count", factCategory: "cargo", valueType: "number", allowedValues: null, minValue: 1, maxValue: 100_000, integerOnly: true },
  { factKey: "cargo.container_count", factCategory: "cargo", valueType: "number", allowedValues: null, minValue: 1, maxValue: 500, integerOnly: true },
  { factKey: "cargo.container_type", factCategory: "cargo", valueType: "text", allowedValues: ["20DV", "20DC", "20GP", "20ST", "20RF", "20OT", "20FR", "40DV", "40DC", "40GP", "40ST", "40HC", "40HQ", "40RF", "40OT", "40FR", "45HC", "45HQ"], minValue: null, maxValue: null, integerOnly: false },
  { factKey: "cargo.description", factCategory: "cargo", valueType: "text", allowedValues: null, minValue: null, maxValue: null, integerOnly: false },
  { factKey: "routing.transport_mode", factCategory: "routing", valueType: "text", allowedValues: ["AIR", "MARITIME", "ROUTE", "MULTIMODAL"], minValue: null, maxValue: null, integerOnly: false },
  { factKey: "routing.incoterm", factCategory: "routing", valueType: "text", allowedValues: ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"], minValue: null, maxValue: null, integerOnly: false },
  { factKey: "routing.origin_port", factCategory: "routing", valueType: "text", allowedValues: null, minValue: null, maxValue: null, integerOnly: false },
  { factKey: "routing.origin_country", factCategory: "routing", valueType: "text", allowedValues: null, minValue: null, maxValue: null, integerOnly: false },
  { factKey: "routing.destination_port", factCategory: "routing", valueType: "text", allowedValues: null, minValue: null, maxValue: null, integerOnly: false },
  { factKey: "routing.destination_country", factCategory: "routing", valueType: "text", allowedValues: null, minValue: null, maxValue: null, integerOnly: false },
  { factKey: "routing.destination_city", factCategory: "routing", valueType: "text", allowedValues: null, minValue: null, maxValue: null, integerOnly: false },
  // TERMINAL-GAP : quel terminal opère l'envoi. Dimension de périmètre déjà
  // présente dans le scope_snapshot P1-A2 ; vocabulaire canonique fermé.
  { factKey: "routing.terminal_operation_mode", factCategory: "routing", valueType: "text", allowedValues: ["LOLO", "RORO", "CONRO"], minValue: null, maxValue: null, integerOnly: false },
  { factKey: "customs.regime_code", factCategory: "customs", valueType: "text", allowedValues: null, minValue: null, maxValue: null, integerOnly: false },
];

export const MAX_PROMOTED_TEXT_LENGTH = 200;

export function findPromotableFactKey(factKey: string): PromotableFactKey | null {
  return PROMOTABLE_FACT_KEYS.find((e) => e.factKey === factKey) ?? null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * Miroir du CHECK SQL `[\x01-\x1F\x7F]`. Écrit par code de caractère et non par
 * littéral d'expression régulière : le fichier source ne contient ainsi aucun
 * octet de contrôle, qu'un éditeur ou un diff pourrait mutiler en silence.
 */
export function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if ((code >= 1 && code <= 31) || code === 127) return true;
  }
  return false;
}

/**
 * Miroir EXACT de public.quote_fact_promotion_violation.
 * Renvoie `null` si le couple est promouvable, sinon un motif STABLE — les
 * mêmes chaînes que la fonction SQL, pour qu'un écart Edge/base soit visible.
 */
export function promotionViolation(
  factKey: unknown,
  valueType: unknown,
  value: unknown,
): string | null {
  if (typeof factKey !== "string" || factKey === "") return "missing:fact_key";

  const entry = findPromotableFactKey(factKey);
  if (!entry) return `fact_key_not_promotable:${factKey}`;

  // Défense en profondeur : même si l'allowlist dérivait, une clé monétaire ne
  // peut pas être promue.
  if (isMonetaryFactKey(factKey)) return `monetary_key:${factKey}`;

  if (valueType !== entry.valueType) {
    return `value_type_mismatch:${factKey}:attendu=${entry.valueType}:fourni=${
      typeof valueType === "string" ? valueType : "null"
    }`;
  }

  if (value === null || value === undefined) return "missing:value";

  if (entry.valueType === "text") {
    if (typeof value !== "string") {
      return `invalid_value_shape:${factKey}:string attendu`;
    }
    const trimmed = value.trim();
    if (trimmed === "") return `empty_value:${factKey}`;
    const maxLength = factKey === "cargo.description"
      ? 500
      : factKey === "routing.destination_city"
      ? 120
      : MAX_PROMOTED_TEXT_LENGTH;
    if (trimmed.length > maxLength) return `value_too_long:${factKey}`;
    if (hasControlCharacter(trimmed)) return `control_character:${factKey}`;
    if (entry.allowedValues !== null && !entry.allowedValues.includes(trimmed)) {
      return `value_not_allowed:${factKey}:${trimmed}`;
    }
    if (["routing.origin_port", "routing.destination_port"].includes(factKey) &&
        !/^[A-Z]{2}[A-Z2-9]{3}$/.test(trimmed)) {
      return `invalid_unlocode:${factKey}`;
    }
    if (["routing.origin_country", "routing.destination_country"].includes(factKey) &&
        !/^[A-Z]{2}$/.test(trimmed)) {
      return `invalid_country_code:${factKey}`;
    }
    if (factKey === "customs.regime_code" &&
        !/^[A-Z0-9][A-Z0-9._/-]{0,31}$/.test(trimmed)) {
      return `invalid_regime_code:${factKey}`;
    }
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `invalid_value_shape:${factKey}:number attendu`;
  }
  if (entry.integerOnly && !Number.isInteger(value)) {
    return `non_integer_value:${factKey}`;
  }
  if (!entry.integerOnly && Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-9) {
    return `too_many_decimals:${factKey}`;
  }
  if (entry.minValue !== null && value < entry.minValue) {
    return `value_out_of_range:${factKey}:${value}`;
  }
  if (entry.maxValue !== null && value > entry.maxValue) {
    return `value_out_of_range:${factKey}:${value}`;
  }
  return null;
}

// ── Types ──────────────────────────────────────────────────────────────────

export type ValidationErrorCode =
  | "VALIDATION_FAILED"
  | "BATCH_NOT_ALLOWED"
  | "AUTO_PROMOTION_NOT_ALLOWED"
  | "ATTESTATION_REQUIRED"
  | "MONETARY_KEY_NOT_PROMOTABLE"
  | "FACT_KEY_NOT_PROMOTABLE";

export interface NormalizedPromotionRequest {
  case_id: string;
  assumption_id: string;
  idempotency_key: string;
  fact_key: string;
  promotion_basis: PromotionBasis;
  attested: true;
  expected_assumption_status: PromotableStatus;
  expected_value_type: PromotableValueType;
  expected_value: string | number;
  expect_no_current_fact: boolean;
  expected_current_fact_id: string | null;
  scenario_id: string | null;
  expected_scope_hash: string | null;
}

export type ValidationResult =
  | { ok: true; value: NormalizedPromotionRequest }
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

// ── Validation du payload ──────────────────────────────────────────────────

export function validatePromotionPayload(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) return fail("Le corps de la requête doit être un objet JSON");

  // 1. Masse : refus nommé, AVANT toute autre analyse. Une promotion est
  //    unitaire et explicite (arbitrage CTO n°4).
  const batch = BATCH_PAYLOAD_KEYS.filter((k) => k in raw);
  if (batch.length > 0) {
    return {
      ok: false,
      code: "BATCH_NOT_ALLOWED",
      message:
        `La promotion est unitaire : champs de masse refusés (${batch.join(", ")}). ` +
        "Promouvoir une hypothèse à la fois, chacune attestée pour elle-même.",
    };
  }

  if (typeof raw.promotion_basis === "string" &&
      (AUTOMATIC_PROMOTION_BASES as readonly string[]).includes(raw.promotion_basis.toLowerCase())) {
    return {
      ok: false,
      code: "AUTO_PROMOTION_NOT_ALLOWED",
      message: "La promotion automatique, en cascade ou en masse est interdite.",
    };
  }

  // 2. Identité, état, provenance et valeur écrite : jamais fournis par
  //    l'appelant. La confiance (1.0) et la provenance (manual_input) du fait
  //    sont fixées côté serveur.
  const forbidden = FORBIDDEN_PAYLOAD_KEYS.filter((k) => k in raw);
  if (forbidden.length > 0) {
    return fail(
      `Champs interdits dans le payload : ${forbidden.join(", ")}. ` +
        "L'identité, l'état, la provenance du fait et la valeur écrite sont fixés côté serveur.",
    );
  }

  // 3. Attestation explicite : une promotion n'est jamais implicite.
  if (raw.attested !== true) {
    return {
      ok: false,
      code: "ATTESTATION_REQUIRED",
      message:
        "La promotion exige une attestation explicite de l'opérateur (attested doit valoir true).",
    };
  }

  // 4. Dossier et hypothèse cible.
  if (typeof raw.case_id !== "string" || !UUID_RE.test(raw.case_id)) {
    return fail("case_id doit être un UUID");
  }
  if (typeof raw.assumption_id !== "string" || !UUID_RE.test(raw.assumption_id)) {
    return fail("assumption_id doit être un UUID");
  }

  // 5. Clé d'idempotence (fournie par l'appelant, l'empreinte ne l'est jamais).
  if (typeof raw.idempotency_key !== "string") return fail("idempotency_key est obligatoire");
  const idempotencyKey = raw.idempotency_key.trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return fail("idempotency_key doit faire 8 à 128 caractères");
  }

  // 6. Base de promotion : obligatoire et fermée.
  if (typeof raw.promotion_basis !== "string" ||
      !(PROMOTION_BASES as readonly string[]).includes(raw.promotion_basis)) {
    return fail(
      `promotion_basis est obligatoire. Autorisées : ${PROMOTION_BASES.join(", ")}`,
    );
  }
  const promotionBasis = raw.promotion_basis as PromotionBasis;

  // 7. Clé cible : allowlist FERMÉE, code dédié pour que le refus soit lisible.
  if (typeof raw.fact_key !== "string") return fail("fact_key est obligatoire");
  if (isMonetaryFactKey(raw.fact_key)) {
    return {
      ok: false,
      code: "MONETARY_KEY_NOT_PROMOTABLE",
      message: `La clé « ${raw.fact_key} » est monétaire ou tarifaire et ne peut pas être promue.`,
    };
  }
  const entry = findPromotableFactKey(raw.fact_key);
  if (!entry) {
    return {
      ok: false,
      code: "FACT_KEY_NOT_PROMOTABLE",
      message:
        `La clé « ${raw.fact_key} » n'est pas promouvable. Les clés monétaires et tarifaires ` +
        "sont exclues, ainsi que les classifications à workflow dédié (HS, PAD). " +
        `Autorisées : ${PROMOTABLE_FACT_KEYS.map((e) => e.factKey).join(", ")}`,
    };
  }

  // 8. Statut attendu : écho de ce que l'opérateur a vu.
  if (typeof raw.expected_assumption_status !== "string" ||
      !(PROMOTABLE_STATUSES as readonly string[]).includes(raw.expected_assumption_status)) {
    return fail(
      `expected_assumption_status est obligatoire. Autorisés : ${PROMOTABLE_STATUSES.join(", ")}`,
    );
  }

  // 9. Valeur attendue : ÉCHO, jamais une source d'écriture. La RPC compare cet
  //    écho au ledger et écrit la valeur DU LEDGER.
  if (typeof raw.expected_value_type !== "string" ||
      !(PROMOTABLE_VALUE_TYPES as readonly string[]).includes(raw.expected_value_type)) {
    return fail(
      `expected_value_type est obligatoire. Autorisés : ${PROMOTABLE_VALUE_TYPES.join(", ")}`,
    );
  }
  if (!("expected_value" in raw)) return fail("expected_value est obligatoire");
  const violation = promotionViolation(raw.fact_key, raw.expected_value_type, raw.expected_value);
  if (violation !== null) {
    return fail(`Valeur non promouvable pour ${raw.fact_key} (${violation})`);
  }

  // 10. Fait courant remplacé : l'opérateur atteste EXACTEMENT soit un fait
  //     précis, soit son absence. Une omission ne peut pas se lire comme
  //     « je n'ai rien vu ».
  const expectNone = raw.expect_no_current_fact;
  if (typeof expectNone !== "boolean") {
    return fail("expect_no_current_fact doit être un booléen");
  }
  let expectedCurrentFactId: string | null = null;
  if (expectNone) {
    if (raw.expected_current_fact_id !== undefined && raw.expected_current_fact_id !== null) {
      return fail(
        "expect_no_current_fact=true exclut expected_current_fact_id : déclarer l'un OU l'autre",
      );
    }
  } else {
    if (typeof raw.expected_current_fact_id !== "string" ||
        !UUID_RE.test(raw.expected_current_fact_id)) {
      return fail(
        "expected_current_fact_id (UUID) est obligatoire quand expect_no_current_fact=false",
      );
    }
    expectedCurrentFactId = raw.expected_current_fact_id;
  }

  // 11. Contexte de scénario : optionnel, mais indissociable de son empreinte.
  //     La RPC l'EXIGE dès que l'hypothèse est liée à un scénario vivant.
  let scenarioId: string | null = null;
  let expectedScopeHash: string | null = null;
  const hasScenario = raw.scenario_id !== undefined && raw.scenario_id !== null;
  const hasHash = raw.expected_scope_hash !== undefined && raw.expected_scope_hash !== null;
  if (hasScenario !== hasHash) {
    return fail("scenario_id et expected_scope_hash vont ensemble ou pas du tout");
  }
  if (hasScenario) {
    if (typeof raw.scenario_id !== "string" || !UUID_RE.test(raw.scenario_id)) {
      return fail("scenario_id doit être un UUID");
    }
    if (typeof raw.expected_scope_hash !== "string" || !SHA256_RE.test(raw.expected_scope_hash)) {
      return fail("expected_scope_hash doit être un SHA-256 hexadécimal minuscule");
    }
    scenarioId = raw.scenario_id;
    expectedScopeHash = raw.expected_scope_hash;
  }

  return {
    ok: true,
    value: {
      case_id: raw.case_id,
      assumption_id: raw.assumption_id,
      idempotency_key: idempotencyKey,
      fact_key: raw.fact_key,
      promotion_basis: promotionBasis,
      attested: true,
      expected_assumption_status: raw.expected_assumption_status as PromotableStatus,
      expected_value_type: raw.expected_value_type as PromotableValueType,
      // `promotionViolation` a déjà garanti le type exact.
      expected_value: raw.expected_value as string | number,
      expect_no_current_fact: expectNone,
      expected_current_fact_id: expectedCurrentFactId,
      scenario_id: scenarioId,
      expected_scope_hash: expectedScopeHash,
    },
  };
}

// ── Empreinte de requête ───────────────────────────────────────────────────

/**
 * Sérialisation canonique : clés triées récursivement, `undefined` normalisé.
 *
 * Volontairement PAS `_shared/canonical-hash.ts` : son `normalizeValue` reparse
 * toute chaîne qui ressemble à du JSON, donc deux valeurs textuelles distinctes
 * produiraient la même empreinte — un rejeu serait accepté à la place d'un
 * IDEMPOTENCY_CONFLICT. Ici, une chaîne reste une chaîne.
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
 * → IDEMPOTENCY_CONFLICT.
 */
export function buildFingerprintInput(
  request: NormalizedPromotionRequest,
): Record<string, unknown> {
  return {
    assumption_id: request.assumption_id,
    attested: request.attested,
    case_id: request.case_id,
    expect_no_current_fact: request.expect_no_current_fact,
    expected_assumption_status: request.expected_assumption_status,
    expected_current_fact_id: request.expected_current_fact_id,
    expected_scope_hash: request.expected_scope_hash,
    expected_value: request.expected_value,
    expected_value_type: request.expected_value_type,
    fact_key: request.fact_key,
    promotion_basis: request.promotion_basis,
    scenario_id: request.scenario_id,
  };
}

/** SHA-256 hexadécimal minuscule — format exigé par le CHECK du registre. */
export async function computeRequestFingerprint(
  request: NormalizedPromotionRequest,
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
 * payload : c'est ce qui rend l'auteur de la promotion non forgeable.
 *
 * Aucun `p_confidence`, aucun `p_source_type`, aucune valeur d'écriture : la RPC
 * les fixe (1.0 / manual_input) et lit la valeur du ledger.
 */
export function buildRpcArgs(
  request: NormalizedPromotionRequest,
  actorUserId: string,
  fingerprint: string,
): Record<string, unknown> {
  return {
    p_case_id: request.case_id,
    p_assumption_id: request.assumption_id,
    p_actor_user_id: actorUserId,
    p_idempotency_key: request.idempotency_key,
    p_request_fingerprint: fingerprint,
    p_fact_key: request.fact_key,
    p_promotion_basis: request.promotion_basis,
    p_attested: true,
    p_expected_assumption_status: request.expected_assumption_status,
    p_expected_value_type: request.expected_value_type,
    p_expected_value: request.expected_value,
    p_expect_no_current_fact: request.expect_no_current_fact,
    p_expected_current_fact_id: request.expected_current_fact_id,
    p_scenario_id: request.scenario_id,
    p_expected_scope_hash: request.expected_scope_hash,
  };
}

/**
 * Traduction message PostgreSQL → code d'erreur runtime du projet.
 * La RPC préfixe ses exceptions par un code stable ; on ne devine jamais.
 *
 * Les conflits d'état périmé (valeur, fait courant, scénario) sont des
 * CONFLICT_INVALID_STATE : l'appelant doit recharger, pas réessayer à
 * l'identique.
 */
export function mapRpcErrorCode(
  message: string,
): "VALIDATION_FAILED" | "FORBIDDEN_OWNER" | "CONFLICT_INVALID_STATE" | "UPSTREAM_DB_ERROR" {
  if (message.includes("BATCH_NOT_ALLOWED")) return "VALIDATION_FAILED";
  if (message.includes("AUTO_PROMOTION_NOT_ALLOWED")) return "VALIDATION_FAILED";
  if (message.includes("ATTESTATION_REQUIRED")) return "VALIDATION_FAILED";
  if (message.includes("MONETARY_KEY_NOT_PROMOTABLE")) return "VALIDATION_FAILED";
  if (message.includes("ASSUMPTION_HAS_NO_FACT_KEY")) return "VALIDATION_FAILED";
  if (message.includes("FACT_KEY_NOT_PROMOTABLE")) return "VALIDATION_FAILED";
  if (message.includes("PROMOTION_REJECTED")) return "VALIDATION_FAILED";
  if (message.includes("VALIDATION_FAILED")) return "VALIDATION_FAILED";
  if (message.includes("NOT_FOUND")) return "VALIDATION_FAILED";
  if (message.includes("FORBIDDEN_CROSS_CASE")) return "FORBIDDEN_OWNER";
  if (message.includes("FORBIDDEN_IDENTITY")) return "FORBIDDEN_OWNER";
  if (message.includes("IDEMPOTENCY_CONFLICT")) return "CONFLICT_INVALID_STATE";
  if (message.includes("CONFLICT_STALE_ASSUMPTION")) return "CONFLICT_INVALID_STATE";
  if (message.includes("CONFLICT_STALE_VALUE")) return "CONFLICT_INVALID_STATE";
  if (message.includes("CONFLICT_STALE_FACT")) return "CONFLICT_INVALID_STATE";
  if (message.includes("CONFLICT_STALE_SCENARIO")) return "CONFLICT_INVALID_STATE";
  if (message.includes("SCENARIO_CONTEXT_REQUIRED")) return "CONFLICT_INVALID_STATE";
  if (message.includes("SCENARIO_CONTEXT_AMBIGUOUS")) return "CONFLICT_INVALID_STATE";
  if (message.includes("CONFLICT_INVALID_STATE")) return "CONFLICT_INVALID_STATE";
  return "UPSTREAM_DB_ERROR";
}
