/**
 * Phase P1-A1 — Contrat front des hypothèses de scénario.
 *
 * Module PUR : aucun accès Supabase, aucun DOM, aucun état React. Il ne fait que
 * traduire la saisie opérateur vers le payload de l'Edge Function
 * `manage-scenario-assumption` et décrire ce que l'UI a le droit de proposer.
 *
 * IMPORTANT — ce module n'est PAS un contrôle de sécurité. Chaque règle ici a
 * son autorité côté serveur (RPC service_role-only + CHECK/trigger en base) ;
 * ce qui vit ici n'existe que pour éviter un aller-retour réseau perdu et pour
 * afficher un message compréhensible.
 *
 * Hors périmètre P1-A1, volontairement absent : promotion vers quote_facts,
 * suppression, tout calcul de prix ou de total.
 */

export const ASSUMPTION_OPERATIONS = [
  "create",
  "revise",
  "confirm_client",
  "refute",
] as const;
export type AssumptionOperation = (typeof ASSUMPTION_OPERATIONS)[number];

export const ASSUMPTION_VALUE_TYPES = [
  "text",
  "number",
  "boolean",
  "date",
  "json",
] as const;
export type AssumptionValueType = (typeof ASSUMPTION_VALUE_TYPES)[number];

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
export type AssumptionType = (typeof ASSUMPTION_TYPES)[number];

export const ASSUMPTION_SOURCE_TYPES = [
  "operator_guidance",
  "document_analogy",
  "prior_client_info",
  "internal_experience",
  "other",
] as const;
export type AssumptionSourceType = (typeof ASSUMPTION_SOURCE_TYPES)[number];

export const ASSUMPTION_RISK_LEVELS = ["low", "medium", "high"] as const;
export type AssumptionRiskLevel = (typeof ASSUMPTION_RISK_LEVELS)[number];

export const ASSUMPTION_STATUSES = [
  "active",
  "client_confirmed",
  "refuted",
  "superseded",
  "promoted_to_fact",
] as const;
export type AssumptionStatus = (typeof ASSUMPTION_STATUSES)[number];

export const MAX_STATEMENT_LENGTH = 2000;
export const MAX_BASIS_LENGTH = 2000;
export const MAX_TEXT_VALUE_LENGTH = 2000;
export const MAX_JSON_VALUE_CHARS = 8000;

/** Miroir de quote_scenario_assumptions_scope_key_format. */
const SCOPE_KEY_RE = /^[a-z][a-z0-9_]*(:[A-Za-z0-9._-]{1,64})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const ASSUMPTION_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  client_confirmed: "Confirmée client",
  refuted: "Réfutée",
  superseded: "Remplacée",
  promoted_to_fact: "Promue en fact",
};

export const ASSUMPTION_TYPE_LABELS: Record<string, string> = {
  value: "Valeur",
  hs: "Code HS",
  pad: "Catégorie PAD",
  weight: "Poids",
  dimensions: "Dimensions",
  quantity: "Quantité",
  category: "Catégorie",
  partner_cost: "Coût partenaire",
  service_scope: "Périmètre de service",
  other: "Autre",
};

export const ASSUMPTION_SOURCE_LABELS: Record<string, string> = {
  operator_guidance: "Consigne opérateur",
  document_analogy: "Analogie documentaire",
  prior_client_info: "Information client antérieure",
  internal_experience: "Expérience interne",
  other: "Autre",
};

export const ASSUMPTION_VALUE_TYPE_LABELS: Record<AssumptionValueType, string> = {
  text: "Texte",
  number: "Nombre",
  boolean: "Oui / Non",
  date: "Date",
  json: "JSON",
};

/**
 * Actions que l'UI peut proposer pour un statut donné.
 *
 * Seule `active` est mutable : la RPC refuse toute transition depuis un statut
 * terminal. La promotion n'apparaît dans aucun cas — elle est hors P1-A1.
 */
export function allowedActionsForStatus(
  status: string,
): readonly Exclude<AssumptionOperation, "create">[] {
  return status === "active" ? ["revise", "confirm_client", "refute"] : [];
}

export function isMutableStatus(status: string): boolean {
  return allowedActionsForStatus(status).length > 0;
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
 * Le repo compile en `strict: false` : TypeScript n'y réduit pas une union
 * discriminée par un booléen. Chaque branche déclare donc les clés de l'autre
 * en `?: undefined` — le discriminant reste exact pour un lecteur (et pour un
 * consommateur strict), et l'accès reste typé sans `as`.
 */
export type ValueParseResult =
  | { ok: true; value: unknown; message?: undefined }
  | { ok: false; value?: undefined; message: string };

/**
 * Convertit la saisie brute d'un formulaire (toujours une chaîne, sauf pour le
 * booléen) vers la représentation UNIQUE stockée dans `assumed_value`.
 */
export function parseAssumptionValueInput(
  valueType: AssumptionValueType,
  raw: string | boolean,
): ValueParseResult {
  if (valueType === "boolean") {
    if (typeof raw === "boolean") return { ok: true, value: raw };
    const normalized = String(raw).trim().toLowerCase();
    if (normalized === "true") return { ok: true, value: true };
    if (normalized === "false") return { ok: true, value: false };
    return { ok: false, message: "Choisir Oui ou Non." };
  }

  const text = typeof raw === "boolean" ? String(raw) : raw.trim();
  if (text === "") return { ok: false, message: "La valeur de l'hypothèse est obligatoire." };

  switch (valueType) {
    case "text":
      if (text.length > MAX_TEXT_VALUE_LENGTH) {
        return { ok: false, message: `La valeur dépasse ${MAX_TEXT_VALUE_LENGTH} caractères.` };
      }
      return { ok: true, value: text };

    case "number": {
      // `Number()` accepte "" et les espaces : on a déjà écarté la chaîne vide.
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) {
        return { ok: false, message: "La valeur doit être un nombre fini." };
      }
      return { ok: true, value: parsed };
    }

    case "date":
      if (!isRealIsoDate(text)) {
        return { ok: false, message: "La date doit être une date réelle au format AAAA-MM-JJ." };
      }
      return { ok: true, value: text };

    case "json": {
      if (text.length > MAX_JSON_VALUE_CHARS) {
        return { ok: false, message: `Le JSON dépasse ${MAX_JSON_VALUE_CHARS} caractères.` };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, message: "JSON invalide." };
      }
      if (parsed === null || typeof parsed !== "object") {
        return { ok: false, message: "Le JSON doit être un objet ou un tableau." };
      }
      return { ok: true, value: parsed };
    }
  }
}

/** Rendu lisible d'une valeur stockée, sans dump JSON bruyant pour les scalaires. */
export function formatAssumptionValue(
  valueType: string | null,
  value: unknown,
): string {
  if (valueType === null || value === null || value === undefined) return "—";
  switch (valueType) {
    case "boolean":
      return value === true ? "Oui" : "Non";
    case "number":
      return typeof value === "number" ? value.toLocaleString("fr-FR") : String(value);
    case "text":
    case "date":
      return String(value);
    default:
      try {
        return JSON.stringify(value);
      } catch {
        return "—";
      }
  }
}

export function isValidScopeKey(scopeKey: string): boolean {
  const trimmed = scopeKey.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return false;
  if (!SCOPE_KEY_RE.test(trimmed)) return false;
  // Arbitrage CTO n°4 : le périmètre d'un scénario ne portera jamais un
  // identifiant de ligne, seulement un snapshot immuable.
  return !UUID_RE.test(trimmed) && !UUID_RE.test(trimmed.split(":")[1] ?? "");
}

export interface AssumptionDraft {
  statement: string;
  basis: string;
  assumptionType: AssumptionType;
  valueType: AssumptionValueType;
  valueInput: string | boolean;
  scopeKey: string;
  assumedFactKey: string;
  gapKey: string;
  sourceType: AssumptionSourceType;
  riskLevel: AssumptionRiskLevel;
  clientVisible: boolean;
}

/** Même forme que ValueParseResult : voir la note sur `strict: false`. */
export type BuildRequestResult =
  | { ok: true; body: Record<string, unknown>; message?: undefined }
  | { ok: false; body?: undefined; message: string };

/**
 * Construit le corps envoyé à `manage-scenario-assumption`.
 *
 * N'émet JAMAIS d'identité (`created_by`, `resolved_by`), de statut, ni de lien
 * de supersession : l'Edge Function refuse ces champs, et le serveur les fixe
 * lui-même. `idempotency_key` est fourni par l'appelant, l'empreinte est
 * calculée côté serveur.
 */
export function buildAssumptionRequestBody(
  caseId: string,
  operation: AssumptionOperation,
  idempotencyKey: string,
  draft: AssumptionDraft | null,
  assumptionId?: string,
): BuildRequestResult {
  if (!UUID_RE.test(caseId)) return { ok: false, message: "Dossier invalide." };
  if (idempotencyKey.trim().length < 8 || idempotencyKey.trim().length > 128) {
    return { ok: false, message: "Clé d'idempotence invalide." };
  }

  if (operation === "confirm_client" || operation === "refute") {
    if (!assumptionId) return { ok: false, message: "Hypothèse cible manquante." };
    return {
      ok: true,
      body: {
        case_id: caseId,
        operation,
        idempotency_key: idempotencyKey.trim(),
        assumption_id: assumptionId,
      },
    };
  }

  if (!draft) return { ok: false, message: "Contenu de l'hypothèse manquant." };

  const statement = draft.statement.trim();
  if (statement === "") return { ok: false, message: "L'énoncé de l'hypothèse est obligatoire." };
  if (statement.length > MAX_STATEMENT_LENGTH) {
    return { ok: false, message: `L'énoncé dépasse ${MAX_STATEMENT_LENGTH} caractères.` };
  }

  const basis = draft.basis.trim();
  if (basis.length > MAX_BASIS_LENGTH) {
    return { ok: false, message: `La base dépasse ${MAX_BASIS_LENGTH} caractères.` };
  }

  const parsedValue = parseAssumptionValueInput(draft.valueType, draft.valueInput);
  if (!parsedValue.ok) return { ok: false, message: parsedValue.message };

  const body: Record<string, unknown> = {
    case_id: caseId,
    operation,
    idempotency_key: idempotencyKey.trim(),
    statement,
    assumed_value_type: draft.valueType,
    assumed_value: parsedValue.value,
    client_visible: draft.clientVisible,
    risk_level: draft.riskLevel,
    source_type: draft.sourceType,
  };
  if (basis !== "") body.basis = basis;

  if (operation === "revise") {
    // Le périmètre est hérité de l'hypothèse révisée : ne rien envoyer d'autre,
    // l'Edge Function rejette explicitement ces champs sur une révision.
    if (!assumptionId) return { ok: false, message: "Hypothèse cible manquante." };
    body.assumption_id = assumptionId;
    return { ok: true, body };
  }

  const scopeKey = draft.scopeKey.trim() === "" ? "case" : draft.scopeKey.trim();
  if (!isValidScopeKey(scopeKey)) {
    return {
      ok: false,
      message: "Périmètre invalide : utiliser `case`, `lot:2`, `commodity:bus`… sans identifiant technique.",
    };
  }
  body.scope_key = scopeKey;
  body.assumption_type = draft.assumptionType;

  const factKey = draft.assumedFactKey.trim();
  if (factKey !== "") body.assumed_fact_key = factKey;
  const gapKey = draft.gapKey.trim();
  if (gapKey !== "") body.gap_key = gapKey;

  return { ok: true, body };
}
