/** Explicit human PAD decisions, separate from scenario hypotheses and client facts.
 * Shared by the writer, confirmed pricing and gap reconciliation. Never falls back
 * to a global category for a missing/stale group. No DB or AI dependency.
 */
import { isApplicableScenarioPadTariff } from "./scenario-pad-tariff.ts";
import { normalizeDthcContainerType } from "./dpw-dthc-tariff.ts";
import { validWeightBasis, type WeightBasisDecision } from "./quotation-weight-basis.ts";

export type PadGroup = {
  unit_ref: string;
  equipment_code: string;
  quantity: number;
  ownership: "SOC" | "COC";
  description: string;
  total_weight_kg: number | null;
  declared_per_container_kg?: number;
  proposed_category?: string | null;
  proposed_basis?: string;
};
export type PadGroupContext = {
  case_id: string;
  scenario_id: string;
  scope_hash: string;
  context_hash: string;
  groups: PadGroup[];
};
export type PadGroupDecision = WeightBasisDecision & {
  id: string;
  case_id: string;
  scenario_id: string;
  scope_hash: string;
  unit_ref: string;
  context_hash: string;
  action: "confirm" | "revoke";
  category: string | null;
  total_weight_kg: number | null;
  source_reference: string;
  weight_source_reference: string;
  decided_by: string;
  created_at: string;
};
export type PadGroupIssue = { unit_ref: string; code: string };
export type ConfirmedPadLine = WeightBasisDecision & {
  weight_container_count?: number;
  weight_per_container_kg?: number;
  unit_ref: string;
  category: string;
  quantity: number;
  unit_price: number;
  amount: number;
  tariff_id: string;
  tariff_source: string;
  decision_id: string;
  context_hash: string;
};
const categoryPattern = /^(T0[1-9]|T1[0-4]|P0[1-5])$/;
const hashPattern = /^[a-f0-9]{64}$/;
const positiveWeight = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1e12;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** A scenario's grouping is not automatically the confirmed dossier's allocation. */
export function padGroupAllocationIssue(groups: PadGroup[], facts: readonly Record<string, unknown>[]): string | null {
  const equipment = (v: unknown) => normalizeDthcContainerType(v).replace(/^(20|40)HQ$/, "$1HC");
  const containerFacts = facts.filter(f => f.key === "cargo.containers");
  if (containerFacts.length !== 1) return "PAD_GROUP_ALLOCATION_REQUIRED";
  let raw = containerFacts[0].json ?? containerFacts[0].text;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return "PAD_GROUP_ALLOCATION_REQUIRED"; } }
  if (!Array.isArray(raw) || raw.length !== groups.length) return "PAD_GROUP_ALLOCATION_REQUIRED";
  const used = new Set<number>();
  for (const g of groups) {
    const matches = raw.map((c, i) => ({ c, i })).filter(({ c }) => c &&
      equipment(c.type) === equipment(g.equipment_code) &&
      c.quantity === g.quantity && String(c.coc_soc ?? c.cocSoc ?? "").toUpperCase() === g.ownership);
    if (matches.length !== 1 || used.has(matches[0].i)) return "PAD_GROUP_ALLOCATION_REQUIRED";
    used.add(matches[0].i);
  }
  const weights = facts.filter(f => f.key === "cargo.weight_kg");
  if (weights.length > 1) return "PAD_GROUP_WEIGHT_CONFLICT";
  if (weights.length) {
    const f = weights[0]; const value = f.number ?? f.text ?? f.json;
    const weight = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
    if (!positiveWeight(weight) || groups.some(g => !positiveWeight(g.total_weight_kg)) ||
      Math.abs(groups.reduce((sum, g) => sum + g.total_weight_kg!, 0) - weight) > 0.001) return "PAD_GROUP_WEIGHT_CONFLICT";
  }
  return null;
}

/** No implicit weight allocation, no copying total dossier weight to each group. */
export function padGroupsFromSnapshot(snapshot: Record<string, unknown>): PadGroup[] {
  if (snapshot.schema_version !== 3 || snapshot.transport_mode !== "MARITIME" ||
    snapshot.movement_direction !== "IMPORT" || !Array.isArray(snapshot.cargo_units) ||
    !snapshot.cargo_units.length) throw new Error("PAD_GROUP_SCOPE_UNSUPPORTED");
  const refs = new Set<string>();
  return snapshot.cargo_units.map((raw: unknown) => {
    const u = raw as Record<string, unknown>;
    if (!u || u.unit_kind !== "CONTAINER" || !text(u.unit_ref) || refs.has(u.unit_ref) ||
      !text(u.equipment_code) || !Number.isSafeInteger(u.quantity) || Number(u.quantity) <= 0 ||
      !["SOC", "COC"].includes(String(u.ownership)) || !text(u.scenario_basis)) {
      throw new Error("PAD_GROUP_SCOPE_INVALID");
    }
    refs.add(u.unit_ref);
    const weight = positiveWeight(u.gross_weight_kg)
      ? u.weight_basis === "per_unit" ? u.gross_weight_kg * Number(u.quantity)
      : u.weight_basis === "total" ? u.gross_weight_kg : null : null;
    const choice = Array.isArray(snapshot.pad_choices)
      ? snapshot.pad_choices.find((c: Record<string, unknown>) => c.unit_ref === u.unit_ref) : null;
    return { unit_ref: u.unit_ref, equipment_code: String(u.equipment_code), quantity: Number(u.quantity),
      ownership: u.ownership as "SOC" | "COC", description: u.scenario_basis,
      proposed_category: choice && categoryPattern.test(String(choice.category)) ? String(choice.category) : null,
      proposed_basis: typeof choice?.basis === "string" ? choice.basis : "",
      total_weight_kg: positiveWeight(weight) ? weight : null,
      ...(u.weight_basis === "per_unit" && positiveWeight(u.gross_weight_kg) ? { declared_per_container_kg: u.gross_weight_kg } : {}) };
  });
}

/** Consumers receive latest heads, not arbitrary historical decisions. Duplicates fail closed. */
export function resolveConfirmedPadGroups(
  context: PadGroupContext,
  heads: readonly PadGroupDecision[],
  tariffs: readonly Record<string, unknown>[],
  today: string,
): { ready: boolean; issues: PadGroupIssue[]; lines: ConfirmedPadLine[]; total: number | null } {
  const issues: PadGroupIssue[] = [];
  const lines: ConfirmedPadLine[] = [];
  if (!text(context.case_id) || !text(context.scenario_id) || !hashPattern.test(context.context_hash) || !hashPattern.test(context.scope_hash) ||
    !context.groups.length || new Set(context.groups.map(g => g.unit_ref)).size !== context.groups.length) {
    return { ready: false, issues: [{ unit_ref: "", code: "PAD_GROUP_CONTEXT_INVALID" }], lines: [], total: null };
  }
  for (const g of context.groups) {
    const candidates = heads.filter(d => d.unit_ref === g.unit_ref);
    if (candidates.length !== 1) {
      issues.push({ unit_ref: g.unit_ref, code: candidates.length ? "PAD_DECISION_AMBIGUOUS" : "PAD_CONFIRMATION_REQUIRED" });
      continue;
    }
    const d = candidates[0];
    let code: string | null = null;
    if (d.action !== "confirm") code = "PAD_CONFIRMATION_REVOKED";
    else if (d.case_id !== context.case_id || d.scenario_id !== context.scenario_id ||
      d.scope_hash !== context.scope_hash || d.context_hash !== context.context_hash) code = "PAD_CONFIRMATION_STALE";
    else if (!text(d.id) || !text(d.decided_by) || !text(d.created_at) ||
      !text(d.source_reference) || !text(d.weight_source_reference) || !categoryPattern.test(d.category ?? "")) code = "PAD_CONFIRMATION_INVALID";
    else if (!validWeightBasis(d)) code = "PAD_WEIGHT_BASIS_INVALID";
    else if (!positiveWeight(g.total_weight_kg) || d.total_weight_kg !== g.total_weight_kg) code = "PAD_WEIGHT_CONFIRMATION_REQUIRED";
    if (code) { issues.push({ unit_ref: g.unit_ref, code }); continue; }
    const rates = tariffs.filter(t => isApplicableScenarioPadTariff(t, d.category, today));
    if (rates.length !== 1) {
      issues.push({ unit_ref: g.unit_ref, code: rates.length ? "PAD_TARIFF_AMBIGUOUS" : "PAD_TARIFF_REQUIRED" });
      continue;
    }
    const rate = rates[0];
    const quantity = g.total_weight_kg! / 1000;
    const amount = Math.round(quantity * Number(rate.amount));
    if (!Number.isSafeInteger(amount) || amount < 0) {
      issues.push({ unit_ref: g.unit_ref, code: "PAD_AMOUNT_INVALID" }); continue;
    }
    lines.push({ unit_ref: g.unit_ref, category: d.category!, quantity, unit_price: Number(rate.amount), amount,
      tariff_id: String(rate.id), tariff_source: String(rate.source_document), decision_id: d.id,
      context_hash: context.context_hash,
      ...(d.weight_basis === "provisional" ? { weight_basis: d.weight_basis, weight_reservation: d.weight_reservation,
        ...(g.declared_per_container_kg ? { weight_container_count: g.quantity, weight_per_container_kg: g.declared_per_container_kg } : {}) } : {}) });
  }
  if (heads.some(d => !context.groups.some(g => g.unit_ref === d.unit_ref))) {
    issues.push({ unit_ref: "", code: "PAD_DECISION_OUTSIDE_SCOPE" });
  }
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  if (!Number.isSafeInteger(total)) issues.push({ unit_ref: "", code: "PAD_TOTAL_INVALID" });
  // No partial confirmed quote. Estimation remains in the separate scenario path.
  return { ready: !issues.length, issues, lines: issues.length ? [] : lines, total: issues.length ? null : total };
}
