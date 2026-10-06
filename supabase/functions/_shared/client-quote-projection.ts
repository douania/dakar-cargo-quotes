/**
 * Client presentation of a saved quotation version (screen, PDF, e-mail). Pure projection:
 * reads only the immutable snapshot, never changes amounts, totals, reservations or
 * qualification. The snapshot lines decide each status; codes only choose the wording.
 * Unknown codes or insufficient history keep their recorded text instead of a guessed class.
 */
import { isToConfirmLine } from "./quotation-line-status.ts";
import { quotationWeightNotices } from "./quotation-weight-basis.ts";
import { readOperatorBasis } from "./operator-quotation-basis.ts";

type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const str = (v: unknown): string => typeof v === "string" ? v.trim() : "";
const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const fr = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(n).replace(/[\u202F\u00A0]/g, " ");

export type ClientLineStatus =
  | "firm" | "estimated" | "to_confirm" | "franchise"
  | "not_applicable" | "client_charge" | "excluded" | "zero_unexplained" | "unqualified";

export interface ClientQuoteLine {
  /** Index in the displayed lines (snapshot.lines, or lots[].lines when the flat list is empty). */
  index: number;
  status: ClientLineStatus;
  /** Short client wording for the status column; empty when history gives no status. */
  label: string;
  /** Replaces the amount cell for a line whose amount is not a price (to confirm, 0 with meaning). */
  amountText: string | null;
}

export interface ClientQuoteProjection {
  lines: ClientQuoteLine[];
  bases: string[];
  conditions: string[];
  general: string[];
  /** Sub-total and SODATRA VAT read from the snapshot, so the table and the total reconcile. */
  totalNote: string | null;
  /** True when at least one item kept its recorded wording (unknown code or line type). */
  hasRecordedFallback: boolean;
}

const UNPRICED = new Set(["NO_MATCH", "MISSING_QUANTITY"]);
const FRANCHISE_REFERENCES = new Set(["SCENARIO_DPW_STORAGE_FRANCHISE_V1"]);
const STAY_CATEGORIES = /^(magasinage|surestaries)$/i;

function sourceOf(line: unknown): Row {
  const source = row(line).source;
  return typeof source === "string" ? { type: source } : row(source);
}
function sourceType(line: unknown): string {
  return str(sourceOf(line).type).split("+")[0].split(":")[0].toUpperCase();
}
function lotLabel(ref: unknown): string | null {
  const value = str(ref);
  if (!value) return null;
  const lot = /^lot[- ]?(\w+)$/i.exec(value);
  return lot ? `lot ${lot[1]}` : value;
}
function lotsText(refs: Iterable<string>): string {
  const values = [...new Set(refs)];
  if (!values.length) return "";
  const lots = values.filter(v => /^lot /.test(v)).map(v => v.slice(4));
  const others = values.filter(v => !/^lot /.test(v));
  const parts = [lots.length ? `${lots.length > 1 ? "lots" : "lot"} ${lots.join(", ")}` : "", ...others].filter(Boolean);
  return parts.join(", ");
}
function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Explanation recorded with a line, without its leading rule code ("EMPTY_RETURN: …"). */
function recordedExplanation(l: Row, r: Row): string {
  return str(r.explanation ?? l.explanation).replace(/^[A-Z][A-Z0-9_]+\s*:\s*/, "").trim();
}

/** Status of one priced line, read from its own source and amount only. */
export function classifyClientLine(line: unknown, raw: unknown, index = 0): ClientQuoteLine {
  const l = row(line);
  const r = row(raw);
  const source = sourceOf(line);
  const type = sourceType(line);
  const reference = str(source.reference);
  const amount = num(l.amount);
  const category = str(l.category ?? r.category);
  const stay = row(r.stay_information ?? l.stay_information);
  const legacyDays = /franchise[^:]*:\s*(\d+)\s*jours/i.exec(str(l.description))?.[1];
  const freeDays = num(stay.free_days) ?? (legacyDays ? Number(legacyDays) : null);

  if (isToConfirmLine(line) || UNPRICED.has(type)) {
    return { index, status: "to_confirm", label: "À confirmer", amountText: "À confirmer" };
  }
  if (type === "EXCLUDED_BY_RULE") {
    if (reference === "SCENARIO_SOC_NO_CARRIER_RETURN") {
      return { index, status: "not_applicable", label: "Sans objet : conteneurs SOC, pas de restitution à l’armateur", amountText: "Non facturé" };
    }
    if (reference === "EMPTY_RETURN_IMPORT_SN_CLIENT_OBLIGATION") {
      return { index, status: "client_charge", label: "À la charge du client, non facturé par SODATRA", amountText: "Non facturé" };
    }
    return { index, status: "excluded", label: "Exclu de l’estimation", amountText: "Exclu" };
  }
  const isStay = STAY_CATEGORIES.test(category) || /^(warehouse_franchise|demurrage_estimate)/.test(str(r.id ?? l.id));
  if (amount === 0 && isStay && (FRANCHISE_REFERENCES.has(reference) || freeDays !== null || /franchise/i.test(str(l.description)))) {
    return {
      index, status: "franchise",
      label: freeDays !== null
        ? `Compris sous franchise de ${freeDays} jours, au-delà facturé`
        : "Compris sous franchise conditionnelle, au-delà facturé",
      amountText: "0 (franchise)",
    };
  }
  // Older business rules record the meaning of a zero in the raw line explanation, not as a code.
  if (amount === 0 && /^EMPTY_RETURN/i.test(category) && /obligation contractuelle (?:du )?client/i.test(recordedExplanation(l, r))) {
    return { index, status: "client_charge", label: "À la charge du client, non facturé par SODATRA", amountText: "Non facturé" };
  }
  if (amount === 0) {
    return { index, status: "zero_unexplained", label: "Montant nul : signification à vérifier", amountText: null };
  }
  // Qualification recorded by the scenario engine (run-scenario-pricing computeScenarioTotals):
  // assumptions, firm eligibility and source together. Without it, nothing is claimed.
  const provenance = row(r.scenario_provenance);
  if (provenance.firm_eligible === true) return { index, status: "firm", label: "", amountText: null };
  if (provenance.firm_eligible === false || source.firm_eligible === false) {
    return {
      index, status: "estimated",
      label: provenance.assumption_dependent === true
        ? "Estimé sous hypothèse, compris dans le total, non ferme"
        : "Estimé, compris dans le total, non ferme",
      amountText: null,
    };
  }
  return { index, status: "unqualified", label: "", amountText: null };
}

const REASON_TEXT: Record<string, string> = {
  SCENARIO_DAP_SERVICES_ONLY: "Droits et taxes et calcul CAF non compris : périmètre DAP.",
  SCENARIO_TERMINAL_ANCILLARIES_TO_CONFIRM: "Frais annexes de terminal : montant et applicabilité à confirmer, non compris dans le total.",
  SCENARIO_PAD_PENDING: "Catégorie portuaire PAD à confirmer.",
  PAD_CATEGORY_UNRESOLVED: "Catégorie portuaire PAD à confirmer.",
  MISSING_CARGO_VALUE: "Valeur de la marchandise à fournir.",
  MISSING_HS_CODE: "Code douanier (SH) à confirmer.",
  PARTNER_COST_PENDING: "Coût partenaire en attente de confirmation.",
  SCENARIO_OWNERSHIP_SCOPE: "Frais de séjour et de repositionnement liés à la propriété des conteneurs : non présumés gratuits, à confirmer hors mention au tableau.",
  SCENARIO_OWNERSHIP_NOT_PRICED: "Frais liés à la propriété des conteneurs non ajustés : à confirmer.",
  SCENARIO_CARGO_ASSUMPTIONS: "Répartition et poids par lot retenus sous hypothèse opérateur, révisables selon les documents définitifs.",
  SCENARIO_CARGO_GROUP_ASSUMPTION: "Répartition et poids par lot retenus sous hypothèse opérateur, révisables selon les documents définitifs.",
  SCENARIO_WEIGHT_UNKNOWN: "Poids à confirmer : la cotation repose sur le poids retenu ci-dessus.",
  PROVISIONAL_WEIGHT_BASIS: "Poids non définitif : montants révisables selon les documents définitifs.",
};
/** Covered by the line statuses of the table, or by the general conditions. */
const COVERED_BY_LINES = new Set([
  "SCENARIO_THC_BASE_ESTIMATE", "SCENARIO_TRANSPORT_KM_ESTIMATE", "SCENARIO_CONTAINER_STAY_ESTIMATE",
  "SCENARIO_EMPTY_RETURN_SCOPE", "RATE_PENDING_CONFIRMATION", "SCENARIO_DG_UNKNOWN", "SCENARIO_IMO_INCOMPLETE",
]);
const GENERAL_CODES: Record<string, string> = {
  SCENARIO_CONTAINER_THC_OPERATOR_INDEPENDENT: "Manutention des conteneurs selon le barème homologué, sans déduction liée à l’opérateur ou au mode de manutention.",
  OPERATOR_QUOTATION_BASIS: "Cotation établie sur des bases opérateur explicites et révisables.",
  SCENARIO_ESTIMATE_ONLY: "Estimation non ferme.",
  SCENARIO_ASSUMPTIONS_APPLIED: "Cotation établie sur les hypothèses indiquées dans les bases.",
};
const OPEN_POINT_TEXT: Record<string, string> = {
  commodity_classification_unknown: "classification de la marchandise",
  packaging_unknown: "emballage",
  customs_regime_unknown: "régime douanier",
  port_to_propose: "lieu",
  port_alternatives_open: "choix du lieu",
  terminal_operation_mode_unknown: "mode de manutention au terminal",
  equipment_unknown: "équipement",
  temperature_setpoint_missing: "température de consigne",
  classification_conflict: "classification de la marchandise",
  attachment_required: "pièce justificative",
  chargeable_basis_unconfirmed: "base taxable",
  booking_pre_booking: "pré-réservation",
  destination_split_unknown: "répartition entre destinations",
};

/** Operator wording for the client: hashes and record identifiers removed, kept short. */
function operatorWording(value: unknown, limit = 140): string {
  const text = str(value)
    .replace(/SHA-?256\s*:?\s*[a-f0-9]{64};?\s*/gi, "")
    .replace(/e-?mail\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "e-mail source")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "référence")
    .replace(/\bper_unit\b/g, "par unité")
    .replace(/\b([Ll])ot lot-(\w+)/g, "$1ot $2")
    .replace(/\blot-(\w+)/g, "lot $1")
    .replace(/(?:;\s*){2,}/g, "; ")
    .replace(/\s+([,.])/g, "$1")
    .replace(/^[\s;,]+|[\s;,]+$/g, "")
    .trim();
  return text.length <= limit ? text : `${text.slice(0, limit).replace(/\s+\S*$/, "")} …`;
}

// Cargo-unit basis for the client: source traceability (e-mail, hash, record) and the generic
// "to verify" marker are operator-only; known shorthand is translated, anything else kept as written.
const BASIS_PROVENANCE = /^(?:e-?mail(?: source)?|référence|source|hypothèses? à vérifier)$/i;
const BASIS_SHORTHAND: Record<string, string> = {
  "poids haut": "poids retenu en hypothèse haute",
  "qté conteneurs source": "nombre de conteneurs selon la demande",
};
function cargoBasisWording(value: unknown, limit = 120): string {
  const text = operatorWording(value, 1000).replace(/\.$/, "").split(/\s*;\s*/)
    .filter(segment => segment && !BASIS_PROVENANCE.test(segment))
    .map(segment => BASIS_SHORTHAND[segment.toLowerCase()] ?? segment)
    .join(" ; ");
  return text.length <= limit ? text : `${text.slice(0, limit).replace(/\s+\S*$/, "")} …`;
}
/** Place references of open points in French, so "origin" and "origine" are one entry. */
function placeRef(ref: string): string {
  return ref === "origin" ? "origine" : ref;
}

const STAY_DAY_LABELS: Record<string, string> = {
  storage_days: "magasinage", demurrage_days: "surestaries", detention_days: "détention", free_days: "franchise",
};

/** Assumed value in a few words: primitives, retained distance and retained stay durations per lot. */
function assumptionValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return fr(value);
  if (typeof value === "string") return operatorWording(value, 80);
  if (typeof value === "boolean") return value ? "oui" : "non";
  const v = row(value);
  const parts: string[] = [];
  const km = num(v.distance_km);
  if (km !== null) parts.push(`distance ${fr(km)} km`);
  for (const group of list(v.groups).map(row)) {
    const days = Object.entries(STAY_DAY_LABELS).flatMap(([key, label]) => {
      if (!(key in group)) return [];
      const n = num(group[key]);
      return [n !== null ? `${label} ${fr(n)} jours` : `${label} à confirmer`];
    });
    if (days.length) parts.push(`${lotLabel(group.unit_ref) ?? "lot"} : ${days.join(", ")}`);
  }
  return parts.join(" ; ");
}

// Stay notes mix client conditions and operator guidance: only exclusions, counting rules and
// items still to confirm reach the client; instructions to the operator stay in the operator detail.
const OPERATOR_INSTRUCTION = /^(Choisir|Renseigner|Relier|Sélectionner|Saisir|Compléter)\b/i;
const CLIENT_CONDITION = /exclu|non (?:présumée?s? )?inclus|non compris|décompte|à confirmer|à renseigner|à reconfirmer|non ajouté/i;
function conditionSentences(texts: string[], max = 5): string[] {
  return [...new Set(texts.flatMap(text => str(text).split(/(?<=[.!?])\s+/)).map(s => s.trim())
    .filter(s => s && !OPERATOR_INSTRUCTION.test(s) && CLIENT_CONDITION.test(s))
    .map(s => operatorWording(s, 170)))].slice(0, max);
}

/** Franchise, overage tiers and recorded exclusions of one stay line (storage or demurrage). */
function stayCondition(line: unknown, raw: unknown): { label: string; body: string } | null {
  const info = row(row(raw).stay_information ?? row(line).stay_information);
  if (info.schema_version !== 1) return null;
  const free = num(info.free_days);
  const sentences = conditionSentences([str(info.franchise_note), ...list(info.reservations).map(str),
    ...list(row(info.carrier_comparison).reservations).map(str)]);
  const parts: string[] = [];
  if (free !== null) parts.push(`franchise ${free} jours`);
  else if (!sentences.some(s => /^franchise/i.test(s))) parts.push("franchise à confirmer");
  const tiers = list(info.tiers).map(row).slice(0, 3).flatMap(t => {
    const from = num(t.from), to = num(t.to), rate = num(t.rate);
    if (from === null || rate === null) return [];
    return [`${to === null ? `dès le jour ${from}` : `jours ${from} à ${to}`} : ${fr(rate)} ${str(t.currency)}/${str(t.unit)}${t.relative === true ? " après franchise" : ""}`];
  });
  if (tiers.length) parts.push(`au-delà : ${tiers.join(", ")}`);
  const references = list(row(info.carrier_comparison).references).map(row);
  if (references.length) {
    parts.push(`armateur à confirmer ; barèmes de référence consultés : ${references.map(r =>
      `${str(r.carrier)}${num(r.free_days) !== null ? ` (franchise ${num(r.free_days)} jours)` : ""}`).join(", ")}, comparaison indicative non ajoutée au total`);
  }
  // The carrier summary above already says "armateur à confirmer".
  parts.push(...sentences.filter(s => !(references.length && /^(Indicatif|Franchise applicable)/i.test(s))).map(s => s.replace(/\.$/, "")));
  const label = cleanLabel(str(row(line).description) || str(row(raw).description)) || "Séjour";
  return { label, body: [...new Set(parts)].join(" ; ") };
}

/** "Magasinage — lot 1", "Magasinage — lot 2" → "Magasinage — lots 1, 2". */
function mergeLabels(labels: string[]): string {
  const unique = [...new Set(labels)];
  const parsed = unique.map(l => /^(.*?)\s—\s(lot [\w ]+)$/.exec(l));
  if (unique.length > 1 && parsed.every(Boolean) && new Set(parsed.map(m => m![1])).size === 1) {
    return `${parsed[0]![1]} — ${lotsText(parsed.map(m => m![2]))}`;
  }
  return unique.join(" ; ");
}

function lineKey(line: unknown): string {
  const l = row(line);
  const s = sourceOf(line);
  // Package lines keep their wording in `label` on the raw side and in `description` once displayed.
  return JSON.stringify([cleanLabel(str(l.description) || str(l.label)), str(s.type).toUpperCase(), str(s.reference), str(s.unit_ref)]);
}

/**
 * Associates each displayed line (snapshot.lines, or lots[].lines of a multi-lot snapshot) with its
 * saved raw line by content, in order — never by object identity, which JSON storage does not keep.
 * An unmatched line gets no raw data, so no qualification is claimed for it.
 */
export function createRawLineLookup(snapshotValue: unknown): (line: unknown) => unknown {
  const rawLines = list(row(snapshotValue).raw_lines);
  // Documented contract: snapshot.lines and raw_lines share their order. A line of that list is
  // read at its position; lots[].lines (distinct objects) are matched by content.
  const flatLines = list(row(snapshotValue).lines);
  const aligned = flatLines.length > 0 && flatLines.length === rawLines.length;
  const buckets = new Map<string, number[]>();
  rawLines.forEach((raw, i) => { const k = lineKey(raw); buckets.set(k, [...(buckets.get(k) ?? []), i]); });
  const used = new Map<string, number>();
  return (line) => {
    const position = aligned ? flatLines.indexOf(line) : -1;
    if (position >= 0) return rawLines[position];
    const k = lineKey(line);
    const candidates = buckets.get(k) ?? [];
    const n = used.get(k) ?? 0;
    used.set(k, n + 1);
    // Once its candidates are used, a line borrows no qualification from another displayed line.
    return n < candidates.length ? rawLines[candidates[n]] : {};
  };
}

function displayedLines(snapshot: Row): unknown[] {
  const lines = list(snapshot.lines);
  return lines.length ? lines : list(snapshot.lots).flatMap(lot => list(row(lot).lines));
}

function unitBasis(cargo: Row): string | null {
  const ref = lotLabel(cargo.unit_ref);
  const quantity = num(cargo.quantity);
  const equipment = str(cargo.equipment_code ?? cargo.unit_kind).toUpperCase();
  const ownership = str(cargo.ownership).toUpperCase();
  const weight = num(cargo.gross_weight_kg);
  const weightText = weight === null ? "poids non précisé"
    : cargo.weight_basis === "per_unit" ? `${fr(weight)} kg par conteneur`
    : cargo.weight_basis === "total" ? `${fr(weight)} kg au total`
    : `${fr(weight)} kg (base de poids non précisée)`;
  const un = str(cargo.un_number);
  const imo = str(cargo.imo_class);
  const danger = cargo.dangerous_goods === true
    ? `dangereux${un || imo ? ` (${[un ? `UN${un.replace(/^UN/i, "")}` : "", imo ? `classe ${imo}` : ""].filter(Boolean).join(", ")})` : ""}`
    : cargo.dangerous_goods === false ? "non dangereux selon la base retenue" : "statut dangereux non confirmé";
  const parts = [quantity !== null && equipment ? `${fr(quantity)} × ${equipment}` : equipment || null,
    ownership ? (ownership === "SOC" || ownership === "COC" ? ownership : `propriété ${ownership}`) : null, weightText, danger];
  const operator = cargoBasisWording(cargo.scenario_basis);
  if (operator) parts.push(`base opérateur : ${operator}`);
  return ref ? `${capitalize(ref)} : ${parts.filter(Boolean).join(", ")}` : null;
}

/**
 * Equipment per lot of an older multi-lot version, read from the container type recorded on its
 * own priced lines (no quantity is inferred). Empty when a lot has no recorded type.
 */
function legacyLotEquipment(snapshot: Row, rawLines: unknown[]): string[] {
  const lots = list(snapshot.lots).map(row);
  if (lots.length < 2) return [];
  const out: string[] = [];
  for (const lot of lots) {
    const index = num(lot.lot_index);
    const types = new Set(rawLines.map(row)
      .filter(r => num(r.lot_index) === index)
      .map(r => str(r.containerType ?? r.container_type).toUpperCase())
      .filter(Boolean));
    if (index === null || types.size === 0) return [];
    out.push(`${str(lot.label) || `Lot ${index}`} : conteneur ${[...types].join(", ")}`);
  }
  return out;
}

function legacyBases(inputs: Row, lotEquipment: string[] = []): string[] {
  const out: string[] = [];
  const route = [str(inputs.origin), str(inputs.destination)].filter(Boolean).join(" → ");
  if (route || str(inputs.incoterm)) out.push(`Trajet : ${route || "non précisé"}${str(inputs.incoterm) ? ` (${str(inputs.incoterm)})` : ""}`);
  const containers = list(inputs.containers).map(row).map(c => [
    num(c.quantity) !== null ? `${fr(num(c.quantity)!)} ×` : "", str(c.type).toUpperCase(), str(c.coc_soc).toUpperCase(),
    lotLabel(c.unit_ref) ? `(${lotLabel(c.unit_ref)})` : "",
  ].filter(Boolean).join(" ")).filter(Boolean);
  // Older multi-lot versions keep a single container in their inputs: the lots' own lines prevail.
  if (lotEquipment.length) out.push(...lotEquipment);
  else if (containers.length) out.push(`Conteneurs : ${containers.join(" ; ")}`);
  // Historical snapshots store weight without a unit: never invent one.
  const scope = lotEquipment.length ? " au dossier, non réparti par lot" : "";
  const weight = num(inputs.cargoWeight);
  if (weight !== null) out.push(`Poids retenu${scope} : ${fr(weight)} t`);
  else if (num(inputs.cargo_weight) !== null) out.push(`Poids enregistré${scope} : ${fr(num(inputs.cargo_weight)!)} (unité non précisée)`);
  return out;
}

export function projectClientQuote(snapshotValue: unknown): ClientQuoteProjection {
  const snapshot = row(snapshotValue);
  const lines = displayedLines(snapshot);
  const rawLines = list(snapshot.raw_lines);
  const basis = readOperatorBasis(snapshot.operator_basis);
  const lookup = createRawLineLookup(snapshot);
  const rawFor = lines.map(line => lookup(line));
  const projected = lines.map((line, i) => classifyClientLine(line, rawFor[i], i));
  let hasRecordedFallback = projected.some(l => l.status === "zero_unexplained");

  // --- Bases de cotation ---
  const bases: string[] = [];
  if (basis) {
    const scope = row(basis.scope);
    const origin = str(row(scope.origin).location_code);
    const destination = str(row(scope.destination).location_code);
    if (origin || destination) bases.push(`Trajet : ${origin || "non précisé"} → ${destination || "non précisé"}`);
    for (const unit of list(scope.cargo_units)) {
      const text = unitBasis(row(unit));
      if (text) bases.push(text);
    }
    const assumptions = list(basis.assumptions).map(row);
    for (const a of assumptions) {
      const statement = operatorWording(a.statement, 100);
      const value = assumptionValue(a.assumed_value);
      if (statement || value) bases.push(`Hypothèse : ${[statement, value].filter(Boolean).join(" — ")}`);
    }
    for (const o of list(basis.overlay).map(row).filter(o => o.basis === "assumption")) {
      if (assumptions.some(a => a.assumed_fact_key === o.fact_key && JSON.stringify(a.assumed_value) === JSON.stringify(o.value))) continue;
      const value = assumptionValue(o.value);
      if (value) bases.push(`Paramètre retenu sous hypothèse : ${o.fact_key === "routing.local_transport_estimate" ? "transport routier" : str(o.fact_key)} — ${value}`);
    }
  } else {
    bases.push(...legacyBases(row(snapshot.inputs), legacyLotEquipment(snapshot, rawLines)));
  }
  const distances = new Map<string, string[]>();
  for (const line of lines) {
    const source = sourceOf(line);
    const km = num(source.distance_km);
    if (km === null) continue;
    const key = fr(km);
    distances.set(key, [...(distances.get(key) ?? []), lotLabel(source.unit_ref) ?? ""].filter(Boolean));
  }
  for (const [km, lots] of distances) bases.push(`Distance routière retenue : ${km} km${lots.length ? ` (${lotsText(lots)})` : ""}`);
  bases.push(...quotationWeightNotices(rawLines));

  // --- Conditions particulières ---
  const conditions: string[] = [];
  const pending = projected.filter(l => l.status === "to_confirm")
    .map(l => str(row(lines[l.index]).description) || str(row(rawFor[l.index]).description)).filter(Boolean);
  if (pending.length) {
    conditions.push(`Postes à confirmer, non compris dans le total (montant et applicabilité à confirmer) : ${[...new Set(pending.map(cleanLabel))].join(" ; ")}.`);
  }
  const stays = new Map<string, string[]>();
  lines.forEach((line, i) => {
    const stay = stayCondition(line, rawFor[i]);
    if (stay) stays.set(stay.body, [...(stays.get(stay.body) ?? []), stay.label]);
  });
  for (const [body, labels] of stays) conditions.push(`${mergeLabels(labels)} : ${body}.`);

  // Feasibility and carrier acceptance carried by the transport lines themselves.
  const vehicleLots = new Set<string>();
  const dangerLots = new Set<string>();
  const transportTerms: string[] = [];
  lines.forEach((line, i) => {
    const source = sourceOf(line);
    const qualification = row(source.qualification);
    const ref = lotLabel(source.unit_ref ?? qualification.unit_ref);
    if (qualification.standard_estimate_only === true || qualification.ordinary_transport === false) vehicleLots.add(ref ?? "transport");
    if (str(source.danger_reservation) || source.danger_status === "unknown") dangerLots.add(ref ?? "transport");
    if (num(source.distance_km) !== null) {
      // Supplier VAT and the exclusions recorded with the transport estimate stay visible.
      if ((num(source.supplier_vat_per_container) ?? 0) > 0) transportTerms.push("montant transport TTC, TVA fournisseur incluse");
      transportTerms.push(...conditionSentences([str(row(rawFor[i]).notes) || str(row(line).notes)], 3).map(t => t.replace(/\.$/, "")));
    }
  });
  if (vehicleLots.size) {
    conditions.push(`${capitalize(lotsText(vehicleLots))} : faisabilité, véhicule et éventuelles autorisations à vérifier auprès du transporteur${
      transportTerms.length ? ` ; ${[...new Set(transportTerms)].join(" ; ")}` : ""}.`);
  } else if (transportTerms.length) {
    conditions.push(`Transport : ${[...new Set(transportTerms)].join(" ; ")}.`);
  }
  if (dangerLots.size) conditions.push(`${capitalize(lotsText(dangerLots))} : statut dangereux non confirmé ; transport estimé sur base ordinaire ; supplément IMO éventuel, montant et applicabilité à confirmer.`);

  // A covered reservation is dropped only when a line of the same scope already tells the client the
  // same thing (its status, franchise or exclusion); otherwise its cleaned text is kept with its scope.
  const lineLot = (l: unknown): string | null => {
    const fromSource = lotLabel(sourceOf(l).unit_ref);
    if (fromSource) return fromSource;
    const fromLabel = /\blot[- ]?(\w+)/i.exec(cleanLabel(str(row(l).description)))?.[1];
    return fromLabel ? `lot ${fromLabel}` : null;
  };
  const restitutionPresent = (code: string, ref: string | null): boolean => {
    const text = (l: unknown, i: number) => `${str(row(l).description)} ${str(row(l).service_code)} ${str(row(l).category ?? row(rawFor[i]).category)}`;
    const has = (match: (l: unknown, i: number) => boolean, statuses: ClientLineStatus[]) =>
      lines.some((l, i) => (!ref || lineLot(l) === ref) && match(l, i) && statuses.includes(projected[i].status));
    switch (code) {
      case "SCENARIO_THC_BASE_ESTIMATE":
        return has((l, i) => /\bTHC\b|DTHC/i.test(text(l, i)) && /hors supplément IMO/i.test(text(l, i)), ["estimated"]);
      case "SCENARIO_TRANSPORT_KM_ESTIMATE": return has(l => num(sourceOf(l).distance_km) !== null, ["estimated"]);
      case "SCENARIO_CONTAINER_STAY_ESTIMATE":
        return has((l, i) => STAY_CATEGORIES.test(str(row(l).category ?? row(rawFor[i]).category)) && stayCondition(l, rawFor[i]) !== null,
          ["to_confirm", "franchise", "estimated"]);
      case "SCENARIO_EMPTY_RETURN_SCOPE":
        return has((l, i) => /retour vide|empty.return/i.test(text(l, i)), ["not_applicable", "client_charge", "excluded"]);
      case "RATE_PENDING_CONFIRMATION": return projected.some(l => l.status === "to_confirm");
      default: return true; // danger/IMO: restituted by the dedicated condition below
    }
  };
  const codes = new Map<string, Set<string>>();
  const openPoints = new Map<string, Set<string>>();
  const recorded: string[] = [];
  const reasonItems = [
    ...list(row(row(snapshot.meta).quoteQualification).reasons),
    ...(basis ? [...list(basis.reservations), ...list(basis.open_points)] : []),
  ];
  for (const item of reasonItems) {
    if (typeof item === "string") { recorded.push(item); continue; }
    const r = row(item);
    const code = str(r.code);
    const ref = lotLabel(r.unit_ref ?? r.ref ?? (str(r.open_point_key).split(":")[1] || null));
    if (code === "OPEN_POINT" || (!code && str(r.reason))) {
      const reason = str(r.reason);
      if (OPEN_POINT_TEXT[reason]) {
        const set = openPoints.get(OPEN_POINT_TEXT[reason]) ?? new Set<string>();
        if (ref) set.add(placeRef(ref));
        openPoints.set(OPEN_POINT_TEXT[reason], set);
      } else recorded.push(str(r.message) || reason || "Point ouvert à examiner");
      continue;
    }
    if (OPEN_POINT_TEXT[code]) {
      const set = openPoints.get(OPEN_POINT_TEXT[code]) ?? new Set<string>();
      if (ref) set.add(placeRef(ref));
      openPoints.set(OPEN_POINT_TEXT[code], set);
      continue;
    }
    if (COVERED_BY_LINES.has(code) && !restitutionPresent(code, ref)) {
      const message = operatorWording(str(r.message) || str(r.statement), 240) || code;
      recorded.push(ref && !message.toLowerCase().startsWith(ref.toLowerCase()) ? `${capitalize(ref)} : ${message}` : message);
      continue;
    }
    if (REASON_TEXT[code] || GENERAL_CODES[code] || COVERED_BY_LINES.has(code)) {
      const set = codes.get(code) ?? new Set<string>();
      if (ref) set.add(ref);
      codes.set(code, set);
      continue;
    }
    const message = operatorWording(str(r.message) || str(r.statement), 240) || code || "Réserve à examiner";
    recorded.push(ref && !message.toLowerCase().startsWith(ref.toLowerCase()) ? `${capitalize(ref)} : ${message}` : message);
  }
  const seen = new Set<string>();
  for (const [code, refs] of codes) {
    const text = REASON_TEXT[code];
    if (!text || seen.has(text)) continue;
    seen.add(text);
    conditions.push(refs.size && !/lot/i.test(text) ? `${capitalize(lotsText(refs))} : ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text);
  }
  const dgRefs = new Set([...(codes.get("SCENARIO_DG_UNKNOWN") ?? []), ...(codes.get("SCENARIO_IMO_INCOMPLETE") ?? [])]);
  if ((codes.has("SCENARIO_DG_UNKNOWN") || codes.has("SCENARIO_IMO_INCOMPLETE")) && !dangerLots.size) {
    conditions.push(`${capitalize(lotsText(dgRefs)) || "Marchandise"} : statut dangereux ou données IMO non confirmés ; supplément IMO éventuel, montant et applicabilité à confirmer.`);
  }
  if (openPoints.size) {
    conditions.push(`À confirmer avant offre ferme : ${[...openPoints.entries()].map(([label, refs]) => refs.size ? `${label} (${lotsText(refs)})` : label).join(", ")}.`);
  }
  if (recorded.length) {
    hasRecordedFallback = true;
    conditions.push(...[...new Set(recorded)].map(text => text.trim()).filter(Boolean));
  }
  for (const l of projected.filter(l => l.status === "zero_unexplained")) {
    const r = row(rawFor[l.index]);
    // A bare rule reference ("P5") means nothing to a client: only recorded wording is shown.
    const reference = str(sourceOf(lines[l.index]).reference);
    const original = str(r.notes) || recordedExplanation(row(lines[l.index]), r) || (/\s/.test(reference) ? reference : "");
    const label = str(row(lines[l.index]).description) || str(r.description);
    if (l.status === "zero_unexplained" && label) conditions.push(`${cleanLabel(label)} : ${original || "montant nul, signification non enregistrée"}`);
  }

  // --- Conditions générales ---
  const general: string[] = [];
  if (projected.some(l => l.status === "estimated")) general.push("Les montants « Estimé » sont compris dans le total mais ne sont pas fermes.");
  if (projected.some(l => l.status === "to_confirm")) general.push("Un poste non chiffré n’est pas gratuit.");
  if (projected.some(l => l.status === "franchise")) general.push("Une franchise de séjour est conditionnelle : au-delà, le séjour est facturable selon les conditions applicables.");
  for (const [code] of codes) if (GENERAL_CODES[code]) general.push(GENERAL_CODES[code]);
  if (basis || bases.some(b => /non définitif|révisable/i.test(b))) general.push("Bases révisables selon les documents définitifs ; toute correction donne lieu à une révision du devis.");

  const totals = row(snapshot.totals);
  const vat = num(totals.honoraires_tva);
  const subtotal = num(totals.subtotal_before_sodatra_vat);
  const currency = str(totals.currency) || "XOF";
  const totalNote = vat !== null && vat > 0 && subtotal !== null
    ? `Sous-total avant TVA SODATRA : ${fr(subtotal)} ${currency} ; TVA SODATRA sur honoraires : ${fr(vat)} ${currency}.`
    : null;

  return {
    totalNote,
    lines: projected,
    bases: [...new Set(bases)],
    conditions: [...new Set(conditions)],
    general: [...new Set(general)],
    hasRecordedFallback,
  };
}

/** Line labels repeat their own status ("— à confirmer"); the status column already says it. */
function cleanLabel(label: string): string {
  return label
    .replace(/\b([Ll])ot lot-(\w+)/g, "$1ot $2")
    .replace(/\blot-(\w+)/g, "lot $1")
    .replace(/(\s—\s*à confirmer)+$/i, "")
    .replace(/\s—\s*exclu de l’estimation$/i, "")
    .trim();
}
export { cleanLabel as clientLineLabel };
