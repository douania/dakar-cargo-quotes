import { computeCanonicalHash } from "../_shared/canonical-hash.ts";
import { resolveImoFromUn } from "../_shared/imo-un-resolution.ts";
import { CONTAINER_PROFILES } from "../_shared/dpw-dthc-tariff.ts";

export type Row = Record<string, unknown>;
export interface ProposedGroup {
  unit_ref: string; source_email_id: string; excerpt: string; quantity: number;
  equipment: string; ownership: "SOC" | "COC" | "unknown";
  quantity_basis: "explicit_containers" | "one_unit_per_container";
  weight_kg: number | null; weight_basis: "per_unit" | "unknown";
  dangerous: boolean | null; un_number: string | null; imo_class: string | null;
  imo_source: ReturnType<typeof resolveImoFromUn>["source"];
  assumptions: string[];
}
export interface PadCandidate {
  unit_ref: string; category: string; justification: string; matching_aliases: string[];
  rate: number | null; tariff_source: Row | null;
  qualification: "PROPOSAL_ONLY";
}
export interface ScenarioProposal {
  source_fingerprint: string; status: "proposed" | "needs_review";
  groups: ProposedGroup[]; reasons: string[]; pad_candidates: PadCandidate[];
}

const HISTORY = /^\s*(?:>|(?:From|De|Sent|Envoy[ée]|Subject|Objet)\s*:|On .+ wrote:|Le .+ [ée]crit\s*:|[-_]{5,}|Best regards|Cordialement)/im;
const normalize = (s: unknown) => typeof s === "string" ? s.trim().toLowerCase() : "";
const activeBody = (body: string) => { const cut = body.search(HISTORY); return cut < 0 ? body : body.slice(0, cut); };

export async function proposalFingerprint(client: unknown, emails: Row[]) {
  return computeCanonicalHash({ client, emails: [...emails].sort((a, b) => String(a.id).localeCompare(String(b.id))) });
}

/** Proposed allocations, not canonical facts. No UN marker is needed to recognize ordinary cargo. */
export function proposeGroups(client: unknown, emails: Row[]): Pick<ScenarioProposal, "status" | "groups" | "reasons"> {
  const reasons = new Set<string>();
  const groups: ProposedGroup[] = [];
  const sources = new Set<string>();
  if (!normalize(client)) return { status: "needs_review", groups, reasons: ["CLIENT_SOURCE_UNVERIFIED"] };
  for (const email of emails) {
    if (normalize(email.from_address) !== normalize(client)) continue;
    if (typeof email.body_text !== "string" || email.body_text.length > 100000 ||
      /\uFFFD|content-transfer-encoding:|boundary=|<html|\[(?:truncated|tronqu[ée])/i.test(email.body_text)) {
      reasons.add("SOURCE_BODY_UNAVAILABLE"); continue;
    }
    const body = activeBody(email.body_text);
    if (/\b(?:revised|instead|replace[ds]?|correction|cancel(?:led)?|annul[ée]|remplac[ée]|corrig[ée])\b/i.test(body)) reasons.add("SOURCE_REVISION_REVIEW");
    const numbered = body.split(/\r?\n/).filter(line => /^\s*\d{1,2}[.)]/.test(line));
    const ordinals: number[] = [];
    for (const line of numbered) {
      const row = line.match(/^\s*(\d{1,2})[.)]\s*(\d+)\s+(?:[x×]\s*)?(.+)$/i);
      const equipment = [...line.matchAll(/\b(?:20|40|45)(?:HQ|HC|GP|DV|DC|ST|FL|FR|OT|RF|RE)\b/gi)].map(m => m[0].toUpperCase());
      if (!row || equipment.length !== 1 || !CONTAINER_PROFILES[equipment[0]] || Number(row[2]) < 1 || Number(row[2]) > 100000 || line.length > 1000) {
        reasons.add("CARGO_ROW_UNSUPPORTED"); continue;
      }
      if (/[?]|\b(?:if|whether|maybe|possibly|except|sauf|excluding|example|exemple)\b/i.test(line)) reasons.add("CONDITIONAL_CARGO_ROW");
      ordinals.push(Number(row[1])); sources.add(String(email.id));
      const ownerships = [...line.matchAll(/\b(SOC|COC)\b/gi)].map(m => m[0].toUpperCase());
      if (new Set(ownerships).size > 1) reasons.add("OWNERSHIP_CONFLICT");
      // Uppercase spaced markers or compact lowercase codes; never the French article "un 20HQ".
      const uns = [...line.matchAll(/\b(?:UN|ONU)\s*[-:]?\s*(\d+[A-Za-z]*)|\b(?:un|onu)(\d+[A-Za-z]*)/g)].map(m => `UN${m[1] ?? m[2]}`);
      if (/\b(?:un|onu)\s+[-:]?\s*\d{4}\b/.test(line)) reasons.add("IMO_ROW_REVIEW");
      const classMarkers = [...line.matchAll(/\b(?:IMDG|IMO)?\s*(?:class|classe)\s*[:=]?\s*([\d.]+[A-Za-z]*)/gi)];
      const declaredClass = classMarkers[0]?.[1];
      const resolution = resolveImoFromUn(uns[0], declaredClass);
      if (uns.length > 1 || classMarkers.length > 1 || ["CONFLICT", "INVALID", "UNKNOWN_UN", "NEEDS_DIVISION"].includes(resolution.status)) reasons.add("IMO_ROW_REVIEW");
      const noDg = /[,;:]\s*(?:non[- ]dangerous|non dangereux|not dangerous)\s*\.?\s*$/i.test(line);
      if (!noDg && /\b(?:not|no|without|sans|non)\b/i.test(line)) reasons.add("CONDITIONAL_CARGO_ROW");
      if (noDg && (uns.length || declaredClass)) reasons.add("IMO_ROW_REVIEW");
      const bound = uns.length === 1 && ["DERIVED", "CONFIRMED"].includes(resolution.status) && !noDg;
      const explicitContainers = new RegExp(`^\\s*${row[1]}[.)]\\s*${row[2]}\\s*[x×]?\\s*${equipment[0]}\\b`, "i").test(line);
      const assumptions = [explicitContainers ? "Quantité de conteneurs reprise de la ligne source." : "Hypothèse à vérifier : une unité de marchandise par conteneur."];
      // A range is not an exact weight: propose the upper bound and expose it.
      const weights = [...line.matchAll(/(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?\s*(t|tonnes?|tons?|kg)\s*\/\s*(?:unit|container|conteneur|unité)\b/gi)];
      let weight: number | null = null;
      if (weights.length === 1) {
        const m = weights[0]; const lo = Number(m[1].replace(",", ".")); const hi = Number((m[2] ?? m[1]).replace(",", "."));
        const kg = hi * (m[3].toLowerCase() === "kg" ? 1 : 1000);
        if (hi >= lo && Number.isSafeInteger(kg) && kg > 0) weight = kg;
        if (m[2] && weight !== null) assumptions.push(`Hypothèse de poids haute de la fourchette ${m[1]}–${m[2]} ${m[3]} par unité ; poids exact non confirmé.`);
      }
      if (weight === null) assumptions.push("Poids par conteneur non déterminé ; aucun poids global réparti automatiquement.");
      if (!bound && !noDg && resolution.status !== "DECLARED") assumptions.push("Danger inconnu : absence de numéro ONU ne signifie pas non dangereux.");
      if (resolution.status === "DECLARED") assumptions.push("Classe ou division déclarée dans la ligne source, non déduite automatiquement.");
      groups.push({ unit_ref: `lot-${row[1]}`, source_email_id: String(email.id), excerpt: line.trim(), quantity: Number(row[2]),
        quantity_basis: explicitContainers ? "explicit_containers" : "one_unit_per_container",
        equipment: equipment[0], ownership: ownerships[0] === "SOC" ? "SOC" : ownerships[0] === "COC" ? "COC" : "unknown",
        weight_kg: weight, weight_basis: weight === null ? "unknown" : "per_unit", dangerous: bound || resolution.status === "DECLARED" ? true : noDg ? false : null,
        un_number: uns[0] ?? null, imo_class: bound ? resolution.imdgClass : declaredClass ?? null,
        imo_source: bound ? resolution.source : null, assumptions });
    }
    if (ordinals.some((n, i) => n !== i + 1)) reasons.add("INCOMPLETE_CARGO_LIST");
    const outsideRows = body.split(/\r?\n/).filter(line => !numbered.includes(line)).join("\n");
    if (/\b(?:UN|ONU)\s*[-:]?\s*\d|\b(?:un|onu)\d|\b(?:un|onu)\s+[-:]?\s*\d{4}\b/.test(outsideRows) ||
      /\b(?:(?:IMO|IMDG)\b|(?:class|classe)\s*[:=]?\s*\d)/i.test(outsideRows)) reasons.add("UN_OUTSIDE_GROUP");
  }
  if (sources.size > 1) reasons.add("MULTIPLE_CARGO_SOURCES");
  if (!groups.length || groups.length > 12) reasons.add("CARGO_LIST_REQUIRED");
  return { status: reasons.size ? "needs_review" : "proposed", groups: reasons.size ? [] : groups, reasons: [...reasons] };
}

/** AI chooses candidates, never their amounts or provenance. Duplicated/expired rates are not selected. */
export function validatePadCandidates(raw: unknown, groups: ProposedGroup[], aliases: Row[], tariffs: Row[], today: string): PadCandidate[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>(); const counts = new Map<string, number>();
  const out: PadCandidate[] = [];
  for (const r of raw.slice(0, 36)) {
    if (!r || typeof r !== "object") continue;
    const c = r as Row;
    if (!groups.some(g => g.unit_ref === c.unit_ref) || typeof c.category !== "string" || !/^(?:T(?:0[1-9]|1[0-4])|P0[1-5])$/.test(c.category) ||
      typeof c.justification !== "string" || !c.justification.trim() || c.justification.length > 1000) continue;
    const key = `${c.unit_ref}:${c.category}`;
    if (seen.has(key) || (counts.get(String(c.unit_ref)) ?? 0) >= 3) continue;
    const matched = Array.isArray(c.matching_aliases) ? c.matching_aliases.filter(a => typeof a === "string" && aliases.some(
      known => known.is_validated === true && known.pad_category === c.category && normalize(known.normalized_term) === normalize(a))) as string[] : [];
    if (!matched.length) continue;
    const rates = tariffs.filter(t => t.classification === c.category && t.provider === "PAD" && t.category === "DROIT_PASSAGE" &&
      t.operation_type === "IMPORT" && t.cargo_type === "CONTENEUR" && t.is_active === true &&
      ["official", "validated_internal"].includes(String(t.evidence_level)) && typeof t.source_document === "string" && t.source_document.trim() &&
      ["tonne", "tonnes", "t", "ton"].includes(normalize(t.unit)) && typeof t.amount === "number" && Number.isFinite(t.amount) && t.amount > 0 &&
      typeof t.effective_date === "string" && t.effective_date.slice(0, 10) <= today && (!t.expiry_date || String(t.expiry_date).slice(0, 10) >= today));
    const rate = rates.length === 1 ? rates[0] : null;
    out.push({ unit_ref: String(c.unit_ref), category: c.category, justification: c.justification, matching_aliases: [...new Set(matched)].slice(0, 5),
      rate: rate ? Number(rate.amount) : null, tariff_source: rate ? { id: rate.id, source_document: rate.source_document,
        evidence_level: rate.evidence_level, effective_date: rate.effective_date, expiry_date: rate.expiry_date, unit: rate.unit } : null,
      qualification: "PROPOSAL_ONLY" });
    seen.add(key); counts.set(String(c.unit_ref), (counts.get(String(c.unit_ref)) ?? 0) + 1);
  }
  return out;
}
