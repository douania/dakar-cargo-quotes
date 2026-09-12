/** IMO-GOODS: conservative recognition and read-only group pricing projection.
 * A numbered cargo row is a goods group, NEVER a separate quote request.
 * Deliberately conservative grammar: other layouts remain reviewable evidence.
 */
import { resolveImoFromUn, type ImoUnResolution } from "./imo-un-resolution.ts";
import { IMDG_UN_REFERENCE } from "./imo-un-reference.ts";
import { canonicalStringify, computeCanonicalHash } from "./canonical-hash.ts";
import { normalizeDangerousGoodsFactValue } from "./dangerous-goods.ts";
import { normalizeDpwDthcFamily } from "./dpw-dthc-tariff.ts";

export const IMO_GOODS_GAP = "cargo.imo_goods_scope_confirmation";
export const IMO_GOODS_EVENT = "imo_goods_recognition";
export interface ImoGoodsSource {
  id: string;
  body: string;
  /** Exact client sender match, not merely the same domain. */
  trustedClient: boolean;
  complete?: boolean;
}
export interface ImoGoodsGroup {
  sourceEmailId: string;
  ordinal: number;
  excerpt: string;
  declaredQuantity: number;
  quantityKind: "goods" | "containers";
  equipmentType: string;
  unNumbers: string[];
  evidence: "direct_client" | "quoted_or_unverified";
  binding: "BOUND" | "REVIEW" | "UNSPECIFIED";
  classification: ImoUnResolution | null;
  /** Only an explicit, unconditional client declaration can establish false. */
  dangerous?: boolean | null;
  ownership?: string | null;
}
export interface ImoGoodsAssessment {
  version: 1;
  status: "BOUND" | "REVIEW";
  groups: ImoGoodsGroup[];
  reasons: string[];
  /** Recognition alone never authorizes pricing; resolveImoGoodsPricing must pass. */
  pricingBlocked: true;
  sourceFingerprint?: string;
}

const UN_RE = /\b(?:UN|ONU)\s*[-:]?\s*(\d{4})\b/gi;
const HAS_UN_MARKER = /\b(?:UN|ONU)\s*[-:]?\s*\d/i;
const EQUIPMENT_RE = /\b(?:20|40|45)(?:HQ|HC|GP|DV|ST|FL|FR|OT|RF|RE)\b/i;
// Signatures delimit active content too. This also handles forwarded messages
// whose Chinese headers were mojibake-decoded by the legacy mail ingestion.
const HISTORY_RE = /^\s*(?:>|(?:From|De|Sent|Envoy[ée]|Subject|Sujet|Objet)\s*:|On .+ wrote:|Le .+ [ée]crit\s*:|发件人|寄件者|åä»¶äºº|[-_]{5,}|Best regards|Thanks\s*(?:&|and)\s*regards|Cordialement)/im;
const REVISION_RE = /\b(?:cancel(?:led)?|revised|instead|replace[ds]?|correction|annul[ée]|remplac[ée]|corrig[ée])\b/i;

function unNumbers(text: string): string[] {
  return [...new Set([...text.matchAll(UN_RE)].map(m => `UN${m[1]}`))];
}

/** No inference from the product name, weight, proximity or an AI confidence. */
export function recognizeImoGoods(sources: readonly ImoGoodsSource[]): ImoGoodsAssessment | null {
  if (!sources.some(s => HAS_UN_MARKER.test(s.body))) return null;
  const groups: ImoGoodsGroup[] = [];
  const reasons = new Set<string>();
  const activeCargoSources = new Set<string>();
  for (const source of sources) {
    const rawNumbers = [...source.body.matchAll(/\b(?:UN|ONU)\s*[-:]?\s*(\d+[A-Za-z]*)/gi)];
    if (rawNumbers.some(m => !/^\d{4}$/.test(m[1]))) reasons.add("INVALID_OR_UNSUPPORTED_UN");
    const cut = source.body.search(HISTORY_RE);
    const active = cut < 0 ? source.body : source.body.slice(0, cut);
    if (source.complete === false && HAS_UN_MARKER.test(source.body)) reasons.add("TRUNCATED_SOURCE");
    if (REVISION_RE.test(active)) reasons.add("POSSIBLE_CARGO_REVISION");
    let offset = 0;
    const boundNumbers: string[] = [];
    for (const line of source.body.split(/\r?\n/)) {
      const lineStart = offset;
      offset += line.length + (source.body.slice(offset + line.length, offset + line.length + 2) === "\r\n" ? 2 : 1);
      // Examples: '1.8 units: ... 20HQ SOC, UN3536', '2) 2 x 40HQ COC (...)'.
      const row = line.match(/^\s*(\d{1,2})[.)]\s*(\d+)\s+(?:[x×]\s*)?(.+)$/i);
      const equipment = row?.[3].match(EQUIPMENT_RE)?.[0].toUpperCase();
      if (!row || !equipment || !Number.isSafeInteger(Number(row[2])) || Number(row[2]) < 1) {
        if ((cut < 0 || lineStart < cut) && unNumbers(line).length) reasons.add("UN_WITHOUT_PROVEN_GROUP");
        continue;
      }
      const direct = source.trustedClient && source.complete !== false && (cut < 0 || lineStart < cut);
      if (direct) activeCargoSources.add(source.id);
      const numbers = unNumbers(line);
      const declaredClass = line.match(/\b(?:IMDG\s*class|IMO\s*class|class|classe)\s*[:=]?\s*([1-9](?:\.[1-6])?[A-Z]?)\b/i)?.[1];
      const isConditional = /\b(?:if|whether|example|e\.g|possibly|maybe|not|no|sans|non|si|exemple|and|et|except|sauf|excluding|previously|historical)\b|[?;+]|\b(?:lot|group|groupe|item|ligne)\s*\d/i.test(line);
      const classification = direct && numbers.length === 1 && !isConditional
        ? resolveImoFromUn(numbers[0], declaredClass) : null;
      const bindable = classification && ["DERIVED", "CONFIRMED"].includes(classification.status);
      // Narrow, anchored declaration: never infer NO from the absence of an ONU.
      const explicitNo = direct && numbers.length === 0 && !declaredClass &&
        /[,;:]\s*(?:non[- ]dangerous|non dangereu(?:x|ses)|not dangerous)\s*[.]?\s*$/i.test(line) &&
        !/\b(?:if|si|maybe|possibly|except|sauf|and|et|not non|hazmat|IMDG|IMO|DG)\b|[?+]/i.test(line);
      if (new Set(line.match(/\b(?:20|40|45)(?:HQ|HC|GP|DV|ST|FL|FR|OT|RF|RE)\b/gi)?.map(v => v.toUpperCase())).size !== 1 ||
        new Set(line.match(/\b(?:SOC|COC)\b/gi)?.map(v => v.toUpperCase())).size > 1) reasons.add("AMBIGUOUS_EQUIPMENT_ROW");
      groups.push({
        sourceEmailId: source.id, ordinal: Number(row[1]), excerpt: line.trim(),
        declaredQuantity: Number(row[2]),
        quantityKind: new RegExp(`^\\s*${row[1]}[.)]\\s*${row[2]}\\s*[x×]\\s*${equipment}\\b`, "i").test(line)
          ? "containers" : "goods",
        equipmentType: equipment, unNumbers: numbers,
        evidence: direct ? "direct_client" : "quoted_or_unverified",
        binding: numbers.length === 0 ? "UNSPECIFIED" : bindable ? "BOUND" : "REVIEW",
        classification,
        dangerous: bindable ? true : explicitNo ? false : null,
        ownership: line.match(/\b(SOC|COC)\b/i)?.[1].toUpperCase() ?? null,
      });
      if (bindable) boundNumbers.push(...numbers);
      if (numbers.length && !bindable) reasons.add(direct ? "AMBIGUOUS_OR_UNRESOLVED_ROW" : "QUOTED_OR_UNVERIFIED_SOURCE");
    }
    if (unNumbers(active).some(n => !boundNumbers.includes(n))) reasons.add("UN_WITHOUT_PROVEN_GROUP");
  }
  // Never infer that a later partial list replaces/augments an earlier one.
  if (activeCargoSources.size > 1) reasons.add("MULTIPLE_ACTIVE_CARGO_LISTS");
  const directGroups = groups.filter(g => g.evidence === "direct_client");
  const ordinals = directGroups.map(g => g.ordinal);
  if (new Set(ordinals).size !== ordinals.length) reasons.add("DUPLICATE_GROUP_ORDINAL");
  if (ordinals.some((ordinal, index) => ordinal !== index + 1)) reasons.add("INCOMPLETE_OR_REORDERED_LIST");
  if (!directGroups.some(g => g.binding === "BOUND")) reasons.add("NO_DIRECT_BINDING");
  // An exact quoted copy of a directly sourced row adds no uncertainty. Other
  // quoted cargo remains reviewable, never silently merged into the active list.
  const quoted = groups.filter(g => g.evidence !== "direct_client");
  if (quoted.length && quoted.every(q => directGroups.some(g => g.excerpt === q.excerpt))) {
    reasons.delete("QUOTED_OR_UNVERIFIED_SOURCE");
  } else if (quoted.length) reasons.add("QUOTED_OR_UNVERIFIED_SOURCE");
  if (reasons.size) {
    for (const group of groups) {
      if (group.binding === "BOUND") group.binding = "REVIEW";
    }
  }
  return { version: 1, status: reasons.size ? "REVIEW" : "BOUND", groups,
    reasons: [...reasons].sort(), pricingBlocked: true };
}

export function imoGoodsQuestion(assessment: ImoGoodsAssessment): string {
  const rows = assessment.groups.slice(0, 20).map(g =>
    `Groupe ${g.ordinal} (${g.declaredQuantity} ${g.quantityKind === "goods" ? "unités de marchandise" : "conteneurs"}, ${g.equipmentType}) : ${g.dangerous === false ? "non dangereux déclaré explicitement" : g.unNumbers.join(", ") || "ONU non précisé (ne signifie pas non dangereux)"}; ${g.binding === "BOUND" ? `rattachement direct, classe dérivée ${g.classification?.imdgClass}` : "à vérifier"}; e-mail ${g.sourceEmailId}; extrait « ${g.excerpt} ».`);
  return `Contrôle du périmètre IMO. ${rows.join(" ")} ${assessment.reasons.join(", ")}. Le calcul par groupe nécessite une source client actuelle, un statut dangereux explicite et une correspondance prouvée avec les conteneurs pour chaque groupe. Les unités de marchandise ne valent pas un nombre de conteneurs. Ne pas transformer les groupes en demandes de devis distinctes.`;
}

export interface ImoGoodsStore {
  readLast(): Promise<ImoGoodsAssessment | null>;
  ensureBlockingGap(question: string): Promise<void>;
  appendEvidence(assessment: ImoGoodsAssessment): Promise<void>;
}

/** Deterministic UUID for concurrent replays of the same evidence transition.
 * Including the previous event ID permits A→B→A without losing the last state.
 */
export async function imoGoodsEvidenceId(caseId: string, previousEventId: string | null, assessment: ImoGoodsAssessment) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(
    canonicalStringify({ namespace: IMO_GOODS_EVENT, caseId, previousEventId, assessment }),
  )));
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes.slice(0, 16)].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Gap first; no supersede_fact, quote_request_lines or tariff write. */
export async function syncImoGoodsRecognition(store: ImoGoodsStore, sources: readonly ImoGoodsSource[], sourceFingerprint?: string) {
  const previous = await store.readLast();
  let assessment = recognizeImoGoods(sources);
  if (!assessment && previous) {
    assessment = { ...previous, status: "REVIEW", reasons: ["SOURCE_NO_LONGER_AVAILABLE"],
      groups: previous.groups.map(g => ({ ...g, binding: g.unNumbers.length ? "REVIEW" : "UNSPECIFIED" })) };
  }
  if (!assessment) return null;
  if (sourceFingerprint) assessment.sourceFingerprint = sourceFingerprint;
  await store.ensureBlockingGap(imoGoodsQuestion(assessment));
  if (canonicalStringify(previous) !== canonicalStringify(assessment)) await store.appendEvidence(assessment);
  return assessment;
}

/** Raw source snapshot: changes to sender, thread identity or any mail invalidate the evidence. */
export function imoGoodsSourceFingerprint(clientEmail: unknown, emails: readonly Record<string, unknown>[]) {
  return computeCanonicalHash({ clientEmail: clientEmail ?? null, emails: emails.map(e => ({
    id: e.id, from_address: e.from_address, body_text: e.body_text,
    subject: e.subject, sent_at: e.sent_at,
  })).sort((a, b) => String(a.id).localeCompare(String(b.id))) });
}

export interface ImoGoodsContainer { type: string; quantity: number; coc_soc?: string; cocSoc?: string }
export interface ImoGoodsPricingRow {
  containerIndex: number; type: string; quantity: number; ownership: string;
  sourceEmailId: string; ordinal: number; excerpt: string;
  dangerous: boolean; unNumber: string | null; imoClass: string | null;
}
export interface ImoGoodsPricingPlan {
  status: "READY" | "BLOCKED"; reasons: string[]; rows: ImoGoodsPricingRow[];
  sourceFingerprint: string; mixed: boolean;
  reference: typeof IMDG_UN_REFERENCE;
}
type PricingFact = { fact_key: string; value_text?: unknown; value_json?: unknown };

/** Exact bijection only. No allocation from weights, goods counts or list order. */
export function resolveImoGoodsPricing(
  assessment: ImoGoodsAssessment, facts: readonly PricingFact[], fingerprint: string,
): ImoGoodsPricingPlan {
  const reasons = new Set<string>();
  const rows: ImoGoodsPricingRow[] = [];
  for (const key of ["cargo.containers", "cargo.dangerous_goods", "cargo.un_number", "cargo.imo_class", "pricing.dthc_family"]) {
    if (facts.filter(f => f.fact_key === key).length > 1) reasons.add("DUPLICATE_CURRENT_IMO_FACT");
  }
  const get = (key: string) => facts.find(f => f.fact_key === key);
  let raw = get("cargo.containers")?.value_json ?? get("cargo.containers")?.value_text;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = null; } }
  const containers = Array.isArray(raw) ? raw as ImoGoodsContainer[] : [];
  if (!assessment.sourceFingerprint || assessment.sourceFingerprint !== fingerprint) reasons.add("SOURCE_CHANGED_REANALYZE");
  if (assessment.version !== 1 || assessment.status !== "BOUND" || assessment.reasons?.length) reasons.add("SOURCE_REVIEW_REQUIRED");
  const groups = (assessment.groups ?? []).filter(g => g.evidence === "direct_client");
  if (!containers.length || groups.length !== containers.length) reasons.add("CONTAINER_ALLOCATION_REQUIRED");
  const used = new Set<number>();
  for (const group of groups) {
    if (group.quantityKind !== "containers" || !group.ownership) reasons.add("CONTAINER_ALLOCATION_REQUIRED");
    const candidates = containers.map((c, i) => ({ c, i })).filter(({ c }) =>
      c && String(c.type).toUpperCase() === group.equipmentType && c.quantity === group.declaredQuantity &&
      String(c.coc_soc ?? c.cocSoc ?? "").toUpperCase() === group.ownership);
    if (candidates.length !== 1 || used.has(candidates[0]?.i)) { reasons.add("CONTAINER_ALLOCATION_REQUIRED"); continue; }
    const { c, i } = candidates[0];
    used.add(i);
    const classification = group.unNumbers.length === 1 ? resolveImoFromUn(group.unNumbers[0], group.classification?.imdgClass) : null;
    const positive = group.binding === "BOUND" && classification && ["DERIVED", "CONFIRMED"].includes(classification.status);
    const negative = group.dangerous === false && !group.unNumbers.length && group.binding === "UNSPECIFIED";
    if (!positive && !negative) { reasons.add(`GROUP_${group.ordinal}_CLASSIFICATION_REQUIRED`); continue; }
    rows.push({ containerIndex: i, type: c.type, quantity: c.quantity, ownership: group.ownership!,
      sourceEmailId: group.sourceEmailId, ordinal: group.ordinal, excerpt: group.excerpt,
      dangerous: !!positive, unNumber: positive ? classification!.unNumber : null,
      imoClass: positive ? classification!.imdgClass : null });
  }
  const dg = normalizeDangerousGoodsFactValue(get("cargo.dangerous_goods")?.value_text);
  if (dg === "NO" && rows.some(r => r.dangerous)) reasons.add("GLOBAL_DG_CONFLICT");
  if (dg === "YES" && rows.length && rows.every(r => !r.dangerous)) reasons.add("GLOBAL_DG_CONFLICT");
  const declaredUn = get("cargo.un_number")?.value_text;
  const declaredClass = get("cargo.imo_class")?.value_text;
  if (declaredUn || declaredClass) {
    const global = resolveImoFromUn(declaredUn, declaredClass);
    if (["INVALID", "CONFLICT", "NEEDS_DIVISION", "UNKNOWN_UN"].includes(global.status) ||
      (global.unNumber && !rows.some(r => r.unNumber === global.unNumber)) ||
      (global.imdgClass && rows.filter(r => r.dangerous).some(r => r.imoClass !== global.imdgClass))) reasons.add("GLOBAL_IMO_CONFLICT");
  }
  const family = normalizeDpwDthcFamily(get("pricing.dthc_family")?.value_text);
  if ((family && family !== "DANGEROUS" && rows.some(r => r.dangerous)) ||
      (family === "DANGEROUS" && rows.some(r => !r.dangerous))) reasons.add("GLOBAL_DTHC_FAMILY_CONFLICT");
  return { status: reasons.size ? "BLOCKED" : "READY", reasons: [...reasons].sort(), rows,
    sourceFingerprint: assessment.sourceFingerprint ?? "", mixed: rows.some(r => r.dangerous) && rows.some(r => !r.dangerous),
    reference: IMDG_UN_REFERENCE };
}

/** Validate the engine boundary independently; a partial plan must never fall back globally. */
export function assertImoGoodsPlan(plan: ImoGoodsPricingPlan, containers: readonly ImoGoodsContainer[]) {
  if (plan.status !== "READY" || plan.reasons.length || !plan.sourceFingerprint ||
    canonicalStringify(plan.reference) !== canonicalStringify(IMDG_UN_REFERENCE) ||
    !containers.length || plan.rows.length !== containers.length || new Set(plan.rows.map(r => r.containerIndex)).size !== containers.length) {
    throw new Error("IMO_GOODS_PLAN_INVALID");
  }
  for (const row of plan.rows) {
    const c = containers[row.containerIndex];
    if (!c || c.type !== row.type || c.quantity !== row.quantity || !Number.isSafeInteger(c.quantity) || c.quantity <= 0 ||
      String(c.coc_soc ?? c.cocSoc ?? "").toUpperCase() !== row.ownership || !row.sourceEmailId || !row.excerpt ||
      typeof row.dangerous !== "boolean" ||
      (row.dangerous ? resolveImoFromUn(row.unNumber, row.imoClass).status !== "CONFIRMED" : !!row.unNumber || !!row.imoClass)) {
      throw new Error("IMO_GOODS_PLAN_INVALID");
    }
  }
  if (plan.mixed !== (plan.rows.some(r => r.dangerous) && plan.rows.some(r => !r.dangerous))) throw new Error("IMO_GOODS_PLAN_INVALID");
}

/** Dossier fee conditions: mixed scope is unknown, never global YES. No fee split. */
export function imoGoodsFeeFacts(plan: ImoGoodsPricingPlan) {
  return plan.mixed ? [] : [{ fact_key: "cargo.dangerous_goods", value_text: plan.rows.every(r => r.dangerous) ? "YES" : "NO" }];
}

/** Covers run-pricing's additional ALL-operation carrier templates as well. */
export function imoGoodsCarrierNeedsConfirmation(plan: ImoGoodsPricingPlan | undefined, charge: { charge_code?: unknown; charge_name?: unknown }) {
  return !!plan && !plan.rows.every(r => r.dangerous) &&
    /(^|[^A-Z0-9])(DG|DANGEROUS|HAZMAT|IMO|IMDG)(?=$|[^A-Z0-9])/.test(`${charge.charge_code ?? ""} ${charge.charge_name ?? ""}`.toUpperCase());
}
