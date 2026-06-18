/**
 * MULTI-CARGO-LINES-ARCHITECTURE-1 — Phase 2-Q (patch shared)
 * Contrat de validation cargo canonique PARTAGÉ (pur, sans I/O).
 *
 * Extrait sans modification de comportement depuis write-cargo-canonical
 * (Phase 2-M) afin de supprimer toute dépendance d'import inter-Edge-Functions
 * (incompatible avec le bundling Lovable Edge).
 *
 * Source unique de vérité de la validation stricte du payload cargo :
 *   - write-cargo-canonical : valide AVANT écriture RPC.
 *   - canonicalize-cargo-from-case : valide AVANT dry_run/commit.
 *
 * PORTÉE : code purement déclaratif/fonctionnel, aucune I/O, aucun accès DB,
 * aucune dépendance runtime Supabase. Testable hors réseau.
 */

// ── Limites & whitelists de validation ─────────────────────────────────────
export const MAX_CARGO_LINES = 200;
export const MAX_EQUIPMENT_PER_LINE = 200;
export const MAX_UNALLOCATED_EQUIPMENT = 200;
export const MAX_SOURCE_EXCERPT_LEN = 2000; // au-delà : validation failed (champ documentaire)
export const MAX_DESCRIPTION_LEN = 4000;
export const MAX_HS_CODE_LEN = 64;
export const MAX_EQUIPMENT_TYPE_LEN = 200;

// Statut d'entrée d'une ligne courante : 'superseded' interdit (cf. RPC).
export const LINE_STATUS_WHITELIST = new Set(["to_confirm", "confirmed"]);
// Équipement : 'superseded' autorisé (cf. RPC upsert_cargo_equipment).
export const EQUIPMENT_STATUS_WHITELIST = new Set([
  "to_confirm",
  "confirmed",
  "superseded",
]);
export const CURRENCY_WHITELIST = new Set(["XOF", "FCFA", "CFA", "EUR", "USD"]);

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Types normalisés (sortie de validatePayload) ───────────────────────────
export interface NormalizedEquipment {
  equipment_type: string;
  quantity: number;
  status: string;
  source_excerpt: string | null;
}

export interface NormalizedCargoLine {
  line_index: number;
  status: string;
  description: string | null;
  hs_code: string | null;
  value_number: number | null;
  value_currency: string | null;
  weight_kg: number | null;
  volume_cbm: number | null;
  pieces_count: number | null;
  supersedes_cargo_line_id: string | null;
  equipment: NormalizedEquipment[];
}

export interface NormalizedSource {
  source_email_id: string | null;
  source_quote_request_line_id: string | null;
  source_excerpt: string | null;
}

export interface NormalizedPayload {
  case_id: string;
  source: NormalizedSource;
  cargo_lines: NormalizedCargoLine[];
  unallocated_equipment: NormalizedEquipment[];
}

export type ValidationResult =
  | { ok: true; value: NormalizedPayload }
  | { ok: false; message: string };

// ── Helpers de validation purs ─────────────────────────────────────────────
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** uuid|null ; rejette tout type/format invalide. */
export function coerceUuidOrNull(
  v: unknown,
  field: string,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string" || !UUID_RE.test(v)) {
    return { ok: false, message: `${field} doit être un UUID valide ou null` };
  }
  return { ok: true, value: v };
}

/**
 * string|null ; rejette les types non-string et les dépassements de longueur.
 * onOverflow = "reject" → validation failed si v.length > maxLen (aucune
 * troncature silencieuse). "truncate" → tronque à maxLen.
 */
export function coerceStringOrNull(
  v: unknown,
  field: string,
  maxLen: number,
  onOverflow: "reject" | "truncate" = "truncate",
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") {
    return { ok: false, message: `${field} doit être une chaîne ou null` };
  }
  if (v.length > maxLen) {
    if (onOverflow === "reject") {
      return { ok: false, message: `${field} dépasse la longueur maximale (${maxLen})` };
    }
    return { ok: true, value: v.slice(0, maxLen) };
  }
  return { ok: true, value: v };
}

/** number|null fini & >= 0 ; rejette NaN, négatif, type invalide. */
export function coerceNonNegativeNumberOrNull(
  v: unknown,
  field: string,
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    return {
      ok: false,
      message: `${field} doit être un nombre >= 0 ou null`,
    };
  }
  return { ok: true, value: v };
}

export function validateEquipment(
  raw: unknown,
  ctx: string,
): { ok: true; value: NormalizedEquipment } | { ok: false; message: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, message: `${ctx} doit être un objet` };
  }

  const typeRaw = raw.equipment_type;
  if (typeof typeRaw !== "string" || typeRaw.trim().length === 0) {
    return { ok: false, message: `${ctx}.equipment_type est obligatoire et non vide` };
  }
  const equipment_type = typeRaw.trim().slice(0, MAX_EQUIPMENT_TYPE_LEN);

  const qty = raw.quantity;
  if (typeof qty !== "number" || !Number.isInteger(qty) || qty <= 0) {
    return { ok: false, message: `${ctx}.quantity doit être un entier > 0` };
  }

  const status = raw.status ?? "to_confirm";
  if (typeof status !== "string" || !EQUIPMENT_STATUS_WHITELIST.has(status)) {
    return {
      ok: false,
      message: `${ctx}.status invalide (attendu: to_confirm|confirmed|superseded)`,
    };
  }

  const excerpt = coerceStringOrNull(
    raw.source_excerpt,
    `${ctx}.source_excerpt`,
    MAX_SOURCE_EXCERPT_LEN,
    "reject",
  );
  if (!excerpt.ok) return excerpt;

  return {
    ok: true,
    value: {
      equipment_type,
      quantity: qty,
      status,
      source_excerpt: excerpt.value,
    },
  };
}

/**
 * Validation stricte & normalisation du payload.
 * Pur (aucune I/O) → testable hors réseau.
 */
export function validatePayload(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, message: "Payload doit être un objet JSON" };
  }

  // case_id obligatoire
  if (typeof raw.case_id !== "string" || !UUID_RE.test(raw.case_id)) {
    return { ok: false, message: "case_id est obligatoire et doit être un UUID" };
  }
  const case_id = raw.case_id;

  // source (optionnelle)
  let source: NormalizedSource = {
    source_email_id: null,
    source_quote_request_line_id: null,
    source_excerpt: null,
  };
  if (raw.source !== undefined && raw.source !== null) {
    if (!isPlainObject(raw.source)) {
      return { ok: false, message: "source doit être un objet ou null" };
    }
    const sEmail = coerceUuidOrNull(raw.source.source_email_id, "source.source_email_id");
    if (!sEmail.ok) return sEmail;
    const sQrl = coerceUuidOrNull(
      raw.source.source_quote_request_line_id,
      "source.source_quote_request_line_id",
    );
    if (!sQrl.ok) return sQrl;
    const sExcerpt = coerceStringOrNull(
      raw.source.source_excerpt,
      "source.source_excerpt",
      MAX_SOURCE_EXCERPT_LEN,
      "reject",
    );
    if (!sExcerpt.ok) return sExcerpt;
    source = {
      source_email_id: sEmail.value,
      source_quote_request_line_id: sQrl.value,
      source_excerpt: sExcerpt.value,
    };
  }

  // cargo_lines (tableau, peut être vide)
  if (!Array.isArray(raw.cargo_lines)) {
    return { ok: false, message: "cargo_lines doit être un tableau" };
  }
  if (raw.cargo_lines.length > MAX_CARGO_LINES) {
    return { ok: false, message: `cargo_lines dépasse la limite (${MAX_CARGO_LINES})` };
  }

  const cargo_lines: NormalizedCargoLine[] = [];
  for (let i = 0; i < raw.cargo_lines.length; i++) {
    const lineRaw = raw.cargo_lines[i];
    const ctx = `cargo_lines[${i}]`;
    if (!isPlainObject(lineRaw)) {
      return { ok: false, message: `${ctx} doit être un objet` };
    }

    const li = lineRaw.line_index;
    if (typeof li !== "number" || !Number.isInteger(li) || li < 1) {
      return { ok: false, message: `${ctx}.line_index doit être un entier >= 1` };
    }

    const status = lineRaw.status ?? "to_confirm";
    if (typeof status !== "string" || !LINE_STATUS_WHITELIST.has(status)) {
      return {
        ok: false,
        message: `${ctx}.status invalide (attendu: to_confirm|confirmed)`,
      };
    }

    const description = coerceStringOrNull(lineRaw.description, `${ctx}.description`, MAX_DESCRIPTION_LEN);
    if (!description.ok) return description;
    const hs_code = coerceStringOrNull(lineRaw.hs_code, `${ctx}.hs_code`, MAX_HS_CODE_LEN);
    if (!hs_code.ok) return hs_code;

    const value_number = coerceNonNegativeNumberOrNull(lineRaw.value_number, `${ctx}.value_number`);
    if (!value_number.ok) return value_number;

    let value_currency: string | null = null;
    if (lineRaw.value_currency !== undefined && lineRaw.value_currency !== null) {
      if (typeof lineRaw.value_currency !== "string" || !CURRENCY_WHITELIST.has(lineRaw.value_currency)) {
        return {
          ok: false,
          message: `${ctx}.value_currency invalide (attendu: XOF|FCFA|CFA|EUR|USD)`,
        };
      }
      value_currency = lineRaw.value_currency;
    }

    const weight_kg = coerceNonNegativeNumberOrNull(lineRaw.weight_kg, `${ctx}.weight_kg`);
    if (!weight_kg.ok) return weight_kg;
    const volume_cbm = coerceNonNegativeNumberOrNull(lineRaw.volume_cbm, `${ctx}.volume_cbm`);
    if (!volume_cbm.ok) return volume_cbm;
    const pieces_count = coerceNonNegativeNumberOrNull(lineRaw.pieces_count, `${ctx}.pieces_count`);
    if (!pieces_count.ok) return pieces_count;

    const supersedes = coerceUuidOrNull(lineRaw.supersedes_cargo_line_id, `${ctx}.supersedes_cargo_line_id`);
    if (!supersedes.ok) return supersedes;

    // equipment attaché (optionnel)
    const equipment: NormalizedEquipment[] = [];
    if (lineRaw.equipment !== undefined && lineRaw.equipment !== null) {
      if (!Array.isArray(lineRaw.equipment)) {
        return { ok: false, message: `${ctx}.equipment doit être un tableau` };
      }
      if (lineRaw.equipment.length > MAX_EQUIPMENT_PER_LINE) {
        return { ok: false, message: `${ctx}.equipment dépasse la limite (${MAX_EQUIPMENT_PER_LINE})` };
      }
      for (let j = 0; j < lineRaw.equipment.length; j++) {
        const eq = validateEquipment(lineRaw.equipment[j], `${ctx}.equipment[${j}]`);
        if (!eq.ok) return eq;
        equipment.push(eq.value);
      }
    }

    cargo_lines.push({
      line_index: li,
      status,
      description: description.value,
      hs_code: hs_code.value,
      value_number: value_number.value,
      value_currency,
      weight_kg: weight_kg.value,
      volume_cbm: volume_cbm.value,
      pieces_count: pieces_count.value,
      supersedes_cargo_line_id: supersedes.value,
      equipment,
    });
  }

  // unallocated_equipment (optionnel)
  const unallocated_equipment: NormalizedEquipment[] = [];
  if (raw.unallocated_equipment !== undefined && raw.unallocated_equipment !== null) {
    if (!Array.isArray(raw.unallocated_equipment)) {
      return { ok: false, message: "unallocated_equipment doit être un tableau" };
    }
    if (raw.unallocated_equipment.length > MAX_UNALLOCATED_EQUIPMENT) {
      return { ok: false, message: `unallocated_equipment dépasse la limite (${MAX_UNALLOCATED_EQUIPMENT})` };
    }
    for (let i = 0; i < raw.unallocated_equipment.length; i++) {
      const eq = validateEquipment(raw.unallocated_equipment[i], `unallocated_equipment[${i}]`);
      if (!eq.ok) return eq;
      unallocated_equipment.push(eq.value);
    }
  }

  // Anti no-op : refuser un payload sans aucune écriture à effectuer.
  if (cargo_lines.length === 0 && unallocated_equipment.length === 0) {
    return {
      ok: false,
      message: "Aucune écriture demandée : cargo_lines et unallocated_equipment sont vides",
    };
  }

  return {
    ok: true,
    value: { case_id, source, cargo_lines, unallocated_equipment },
  };
}
