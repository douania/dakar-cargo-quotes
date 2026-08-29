/**
 * Phase P1-A3 — Contrat front de la promotion d'une hypothèse en fait.
 *
 * Module PUR : aucun accès Supabase, aucun DOM, aucun état React. Il ne fait que
 * traduire le geste opérateur vers le payload de l'Edge Function
 * `promote-scenario-assumption` et décrire ce que l'UI a le droit de proposer.
 *
 * IMPORTANT — ce module n'est PAS un contrôle de sécurité. Chaque règle ici a
 * son autorité côté serveur (Edge Function pure + RPC service_role-only +
 * CHECK/trigger en base). Ce qui vit ici n'existe que pour éviter un
 * aller-retour réseau perdu et pour afficher un message compréhensible.
 *
 * Doctrine P1-A3 :
 *   - une promotion n'est JAMAIS automatique : elle exige une clé cible, une
 *     base de promotion d'un vocabulaire fermé et une attestation explicite ;
 *   - UNE hypothèse par geste : ce module n'expose aucune forme de masse
 *     (arbitrage CTO n°4) ;
 *   - aucune clé monétaire ni tarifaire n'est promouvable (arbitrage CTO n°1) ;
 *   - aucune dé-promotion (arbitrage CTO n°6) : rien ici ne la propose ;
 *   - la valeur écrite est lue du ledger côté serveur. Ce que l'UI envoie n'est
 *     qu'un ÉCHO de ce qu'elle a AFFICHÉ : si l'état a bougé entre l'affichage
 *     et le clic, le serveur refuse au lieu de deviner.
 */

/** Miroir de quote_fact_promotions_basis_check et de PROMOTION_BASES (Edge). */
export const PROMOTION_BASES = [
  "client_written_confirmation",
  "document_evidence",
  "partner_confirmation",
  "regulatory_reference",
  "operator_expertise",
] as const;
export type PromotionBasis = (typeof PROMOTION_BASES)[number];

export const PROMOTION_BASIS_LABELS: Record<PromotionBasis, string> = {
  client_written_confirmation: "Confirmation écrite du client",
  document_evidence: "Pièce justificative au dossier",
  partner_confirmation: "Confirmation d'un partenaire",
  regulatory_reference: "Référence réglementaire",
  operator_expertise: "Expertise opérateur assumée",
};

/** Statuts depuis lesquels une promotion est recevable (arbitrage CTO n°2). */
export const PROMOTABLE_STATUSES = ["active", "client_confirmed"] as const;
export type PromotableStatus = (typeof PROMOTABLE_STATUSES)[number];

/** Types de valeur promouvables. `boolean`, `date` et `json` en sont exclus. */
export const PROMOTABLE_VALUE_TYPES = ["text", "number"] as const;
export type PromotableValueType = (typeof PROMOTABLE_VALUE_TYPES)[number];

export interface PromotableFactKey {
  readonly factKey: string;
  readonly label: string;
  readonly valueType: PromotableValueType;
  readonly allowedValues: readonly string[] | null;
  readonly minValue: number | null;
  readonly maxValue: number | null;
  readonly integerOnly: boolean;
}

/**
 * ALLOWLIST FERMÉE — miroir de PROMOTABLE_FACT_KEYS (Edge) et de
 * public.quote_fact_promotion_allowlist() (base).
 *
 * En sont volontairement absentes : toute clé monétaire ou tarifaire
 * (cargo.value, cargo.caf_value, cargo.freight_cost,
 * cargo.pad_rate_fcfa_per_ton, cargo.freight_exchange_rate), toute clé à
 * montants imbriqués (cargo.articles_detail, cargo.containers,
 * service.overrides), les classifications à workflow dédié (cargo.hs_code,
 * cargo.pad_category) et regulatory.exemption_title.
 */
export const PROMOTABLE_FACT_KEYS: readonly PromotableFactKey[] = [
  { factKey: "cargo.weight_kg", label: "Poids brut (kg)", valueType: "number", allowedValues: null, minValue: 0.001, maxValue: 1_000_000_000, integerOnly: false },
  { factKey: "cargo.chargeable_weight_kg", label: "Poids taxable (kg)", valueType: "number", allowedValues: null, minValue: 0.001, maxValue: 1_000_000_000, integerOnly: false },
  { factKey: "cargo.weight_per_container_kg", label: "Poids par conteneur (kg)", valueType: "number", allowedValues: null, minValue: 0.001, maxValue: 1_000_000_000, integerOnly: false },
  { factKey: "cargo.volume_cbm", label: "Volume (m³)", valueType: "number", allowedValues: null, minValue: 0.001, maxValue: 1_000_000, integerOnly: false },
  { factKey: "cargo.pieces_count", label: "Nombre de colis", valueType: "number", allowedValues: null, minValue: 1, maxValue: 100_000, integerOnly: true },
  { factKey: "cargo.container_count", label: "Nombre de conteneurs", valueType: "number", allowedValues: null, minValue: 1, maxValue: 500, integerOnly: true },
  { factKey: "cargo.container_type", label: "Type de conteneur", valueType: "text", allowedValues: ["20DV", "20DC", "20GP", "20ST", "20RF", "20OT", "20FR", "40DV", "40DC", "40GP", "40ST", "40HC", "40HQ", "40RF", "40OT", "40FR", "45HC", "45HQ"], minValue: null, maxValue: null, integerOnly: false },
  { factKey: "cargo.description", label: "Description marchandise", valueType: "text", allowedValues: null, minValue: null, maxValue: null, integerOnly: false },
  { factKey: "routing.transport_mode", label: "Mode de transport", valueType: "text", allowedValues: ["AIR", "MARITIME", "ROUTE", "MULTIMODAL"], minValue: null, maxValue: null, integerOnly: false },
  { factKey: "routing.incoterm", label: "Incoterm", valueType: "text", allowedValues: ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"], minValue: null, maxValue: null, integerOnly: false },
  { factKey: "routing.origin_port", label: "Port d'origine", valueType: "text", allowedValues: null, minValue: null, maxValue: null, integerOnly: false },
  { factKey: "routing.origin_country", label: "Pays d'origine", valueType: "text", allowedValues: null, minValue: null, maxValue: null, integerOnly: false },
  { factKey: "routing.destination_port", label: "Port de destination", valueType: "text", allowedValues: null, minValue: null, maxValue: null, integerOnly: false },
  { factKey: "routing.destination_country", label: "Pays de destination", valueType: "text", allowedValues: null, minValue: null, maxValue: null, integerOnly: false },
  { factKey: "routing.destination_city", label: "Ville de destination", valueType: "text", allowedValues: null, minValue: null, maxValue: null, integerOnly: false },
  { factKey: "routing.terminal_operation_mode", label: "Mode d'opération terminal", valueType: "text", allowedValues: ["LOLO", "RORO", "CONRO"], minValue: null, maxValue: null, integerOnly: false },
  { factKey: "customs.regime_code", label: "Régime douanier", valueType: "text", allowedValues: null, minValue: null, maxValue: null, integerOnly: false },
];

export const MAX_PROMOTED_TEXT_LENGTH = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

export function findPromotableFactKey(factKey: string): PromotableFactKey | null {
  return PROMOTABLE_FACT_KEYS.find((e) => e.factKey === factKey) ?? null;
}

/**
 * Clés que l'UI peut proposer pour une hypothèse donnée.
 *
 * Filtrées par le type de valeur : promouvoir un poids vers une clé textuelle
 * n'a pas de sens et le serveur le refuserait. Si l'hypothèse déclare anticiper
 * un fait promouvable, ce fait est la SEULE cible : la RPC refuse de détourner
 * la cible d'une hypothèse qui a nommé la sienne.
 */
export function promotableKeysFor(
  valueType: string | null,
  assumedFactKey: string | null,
): readonly PromotableFactKey[] {
  if (valueType === null || !(PROMOTABLE_VALUE_TYPES as readonly string[]).includes(valueType)) {
    return [];
  }
  const declared = assumedFactKey === null ? "" : assumedFactKey.trim();
  if (declared === "") return [];
  const entry = findPromotableFactKey(declared);
  return entry !== null && entry.valueType === valueType ? [entry] : [];
}

/**
 * Une hypothèse est promouvable si son statut l'autorise ET qu'au moins une clé
 * cible lui est ouverte. Une hypothèse booléenne, datée ou json, ou dont le fait
 * anticipé est monétaire, n'a aucune cible : l'UI ne propose alors rien.
 */
export function canPromote(
  status: string,
  valueType: string | null,
  assumedFactKey: string | null,
): boolean {
  if (!(PROMOTABLE_STATUSES as readonly string[]).includes(status)) return false;
  return promotableKeysFor(valueType, assumedFactKey).length > 0;
}

/**
 * Explique pourquoi une hypothèse n'est pas promouvable. `null` si elle l'est.
 * L'UI dit pourquoi elle ne propose rien plutôt que de masquer l'action en
 * silence — une action absente sans raison se lit comme un bug.
 */
export function promotionBlockReason(
  status: string,
  valueType: string | null,
  assumedFactKey: string | null,
): string | null {
  if (status === "promoted_to_fact") return "Cette hypothèse est déjà promue en fait.";
  if (!(PROMOTABLE_STATUSES as readonly string[]).includes(status)) {
    return "Seule une hypothèse active ou confirmée côté client peut être promue.";
  }
  if (valueType === null || !(PROMOTABLE_VALUE_TYPES as readonly string[]).includes(valueType)) {
    return "Seules les hypothèses de type Texte ou Nombre sont promouvables.";
  }
  const declared = assumedFactKey === null ? "" : assumedFactKey.trim();
  if (declared === "") {
    return "Cette hypothèse ne nomme aucun fait cible. Révisez-la avant de la promouvoir.";
  }
  if (declared !== "" && findPromotableFactKey(declared) === null) {
    return `Le fait « ${declared} » n'est pas promouvable : les clés monétaires et tarifaires sont exclues, ` +
      "et les classifications HS/PAD passent par leur workflow dédié.";
  }
  if (promotableKeysFor(valueType, assumedFactKey).length === 0) {
    return "Aucune clé de fait promouvable ne correspond au type de cette hypothèse.";
  }
  return null;
}

/** Rendu lisible de la valeur exacte qui sera écrite dans quote_facts. */
export function formatPromotedValue(valueType: string | null, value: unknown): string {
  if (valueType === "number" && typeof value === "number") {
    return value.toLocaleString("fr-FR");
  }
  if (valueType === "text" && typeof value === "string") return value;
  if (value === null || value === undefined) return "—";
  try {
    return JSON.stringify(value);
  } catch {
    return "—";
  }
}

/** Rendu lisible du fait courant qui sera remplacé. */
export function formatCurrentFactValue(fact: CurrentFact | null): string {
  if (fact === null) return "Aucun fait courant : la promotion crée le premier.";
  if (fact.value_number !== null && fact.value_number !== undefined) {
    return fact.value_number.toLocaleString("fr-FR");
  }
  if (fact.value_text !== null && fact.value_text !== undefined && fact.value_text !== "") {
    return fact.value_text;
  }
  return "—";
}

export interface CurrentFact {
  id: string;
  value_text: string | null;
  value_number: number | null;
  source_type: string | null;
}

export interface ScenarioContext {
  scenarioId: string;
  scopeHash: string;
}

export interface PromotionDraft {
  assumptionId: string;
  assumptionStatus: string;
  valueType: string | null;
  /** Valeur telle que LUE de quote_scenario_assumptions et AFFICHÉE. */
  value: unknown;
  assumedFactKey: string | null;
  factKey: string;
  basis: PromotionBasis | null;
  attested: boolean;
  /** Fait courant tel qu'AFFICHÉ ; `null` si l'UI n'en a affiché aucun. */
  currentFact: CurrentFact | null;
  /** Contexte de scénario tel qu'AFFICHÉ ; `null` si aucun scénario vivant. */
  scenario: ScenarioContext | null;
}

/** Même forme que dans scenarioAssumptions.ts : voir la note sur `strict: false`. */
export type BuildPromotionResult =
  | { ok: true; body: Record<string, unknown>; message?: undefined }
  | { ok: false; body?: undefined; message: string };

/**
 * Construit le corps envoyé à `promote-scenario-assumption`.
 *
 * N'émet JAMAIS d'identité (`actor_user_id`), de statut, de provenance
 * (`source_type`), de confiance (`confidence`) ni de valeur d'écriture : l'Edge
 * Function refuse ces champs et le serveur les fixe lui-même. La valeur envoyée
 * est un ÉCHO de l'affichage, comparé au ledger par la RPC.
 */
export function buildPromotionRequestBody(
  caseId: string,
  idempotencyKey: string,
  draft: PromotionDraft,
): BuildPromotionResult {
  if (!UUID_RE.test(caseId)) return { ok: false, message: "Dossier invalide." };
  if (!UUID_RE.test(draft.assumptionId)) return { ok: false, message: "Hypothèse invalide." };
  const key = idempotencyKey.trim();
  if (key.length < 8 || key.length > 128) {
    return { ok: false, message: "Clé d'idempotence invalide." };
  }

  if (!(PROMOTABLE_STATUSES as readonly string[]).includes(draft.assumptionStatus)) {
    return {
      ok: false,
      message: "Seule une hypothèse active ou confirmée côté client peut être promue.",
    };
  }

  if (draft.basis === null || !(PROMOTION_BASES as readonly string[]).includes(draft.basis)) {
    return { ok: false, message: "Choisir la base de la promotion." };
  }

  // Une promotion n'est jamais implicite : sans attestation cochée, rien ne part.
  if (draft.attested !== true) {
    return {
      ok: false,
      message: "Cocher l'attestation : la promotion transforme une hypothèse en fait du dossier.",
    };
  }

  const entry = findPromotableFactKey(draft.factKey);
  if (entry === null) {
    return {
      ok: false,
      message:
        `La clé « ${draft.factKey} » n'est pas promouvable. Les clés monétaires et tarifaires ` +
        "sont exclues, et les classifications HS/PAD passent par leur workflow dédié.",
    };
  }
  if (draft.assumedFactKey === null || draft.assumedFactKey.trim() === "") {
    return { ok: false, message: "L'hypothèse ne nomme aucun fait cible." };
  }
  if (draft.assumedFactKey.trim() !== entry.factKey) {
    return {
      ok: false,
      message: `L'hypothèse anticipe « ${draft.assumedFactKey} », pas « ${entry.factKey} ».`,
    };
  }
  if (draft.valueType !== entry.valueType) {
    return {
      ok: false,
      message: `« ${entry.label} » attend une valeur de type ${
        entry.valueType === "number" ? "Nombre" : "Texte"
      }.`,
    };
  }

  // La valeur est ÉCHOÉE telle qu'affichée : ni reformatée, ni reparsée.
  if (entry.valueType === "number") {
    if (typeof draft.value !== "number" || !Number.isFinite(draft.value)) {
      return { ok: false, message: "La valeur de l'hypothèse n'est pas un nombre exploitable." };
    }
    if (entry.integerOnly && !Number.isInteger(draft.value)) {
      return { ok: false, message: `« ${entry.label} » n'accepte qu'un nombre entier.` };
    }
    if (!entry.integerOnly &&
        Math.abs(draft.value * 1000 - Math.round(draft.value * 1000)) > 1e-9) {
      return { ok: false, message: `« ${entry.label} » accepte au plus 3 décimales.` };
    }
    if (entry.minValue !== null && draft.value < entry.minValue) {
      return { ok: false, message: `« ${entry.label} » n'accepte pas ${draft.value}.` };
    }
    if (entry.maxValue !== null && draft.value > entry.maxValue) {
      return { ok: false, message: `« ${entry.label} » n'accepte pas ${draft.value}.` };
    }
  } else {
    if (typeof draft.value !== "string" || draft.value.trim() === "") {
      return { ok: false, message: "La valeur de l'hypothèse est vide." };
    }
    const trimmed = draft.value.trim();
    const maxLength = entry.factKey === "cargo.description"
      ? 500
      : entry.factKey === "routing.destination_city"
      ? 120
      : MAX_PROMOTED_TEXT_LENGTH;
    if (trimmed.length > maxLength) {
      return {
        ok: false,
        message: `La valeur dépasse ${maxLength} caractères.`,
      };
    }
    if (entry.allowedValues !== null && !entry.allowedValues.includes(trimmed)) {
      return {
        ok: false,
        message: `« ${entry.label} » n'accepte que : ${entry.allowedValues.join(", ")}.`,
      };
    }
    if (["routing.origin_port", "routing.destination_port"].includes(entry.factKey) &&
        !/^[A-Z]{2}[A-Z2-9]{3}$/.test(trimmed)) {
      return { ok: false, message: `« ${entry.label} » exige un code UN/LOCODE canonique.` };
    }
    if (["routing.origin_country", "routing.destination_country"].includes(entry.factKey) &&
        !/^[A-Z]{2}$/.test(trimmed)) {
      return { ok: false, message: `« ${entry.label} » exige un code pays ISO alpha-2.` };
    }
    if (entry.factKey === "customs.regime_code" &&
        !/^[A-Z0-9][A-Z0-9._/-]{0,31}$/.test(trimmed)) {
      return { ok: false, message: "Le code de régime douanier n'est pas canonique." };
    }
  }

  const body: Record<string, unknown> = {
    case_id: caseId,
    assumption_id: draft.assumptionId,
    idempotency_key: key,
    fact_key: entry.factKey,
    promotion_basis: draft.basis,
    attested: true,
    expected_assumption_status: draft.assumptionStatus,
    expected_value_type: entry.valueType,
    // ÉCHO VERBATIM de la valeur affichée, jamais reformatée. La RPC compare cet
    // écho au ledger : le normaliser ici (par exemple en l'élaguant) ferait
    // diverger la comparaison d'une valeur stockée non élaguée, et produirait un
    // CONFLICT_STALE_VALUE que l'opérateur ne pourrait jamais résoudre.
    // L'élagage appartient à l'ÉCRITURE, que la base fait de son côté.
    expected_value: draft.value,
    expect_no_current_fact: draft.currentFact === null,
  };

  // L'opérateur atteste EXACTEMENT ce qu'il remplace : un fait précis, ou son
  // absence. Les deux formes s'excluent côté serveur.
  if (draft.currentFact !== null) {
    if (!UUID_RE.test(draft.currentFact.id)) {
      return { ok: false, message: "Fait courant invalide." };
    }
    body.expected_current_fact_id = draft.currentFact.id;
  }

  // Le périmètre du scénario est figé à sa révision exacte : si le scénario a
  // été révisé depuis l'affichage, le serveur refuse.
  if (draft.scenario !== null) {
    if (!UUID_RE.test(draft.scenario.scenarioId) || !SHA256_RE.test(draft.scenario.scopeHash)) {
      return { ok: false, message: "Contexte de scénario invalide." };
    }
    body.scenario_id = draft.scenario.scenarioId;
    body.expected_scope_hash = draft.scenario.scopeHash;
  }

  return { ok: true, body };
}

/** Identité logique d'une tentative, sans sa clé d'idempotence. */
export function buildPromotionSignature(caseId: string, draft: PromotionDraft): string {
  return JSON.stringify({
    assumptionId: draft.assumptionId,
    assumptionStatus: draft.assumptionStatus,
    assumedFactKey: draft.assumedFactKey,
    attested: draft.attested,
    basis: draft.basis,
    caseId,
    currentFactId: draft.currentFact?.id ?? null,
    factKey: draft.factKey,
    scenarioId: draft.scenario?.scenarioId ?? null,
    scopeHash: draft.scenario?.scopeHash ?? null,
    value: draft.value,
    valueType: draft.valueType,
  });
}
