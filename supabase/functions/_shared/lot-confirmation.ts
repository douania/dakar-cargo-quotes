/** MULTI-LOT-TERMINAL-1 — explicit per-lot operator decisions (GO CTO 2026-09-25).
 * Pure: no DB, no AI. Shared by the Edge reader/writer, the PAD store and run-pricing.
 *
 * - A lot is a `unit_ref` of the selected scenario. It is attached to a request line only
 *   by an explicit, sourced decision naming the line's business fingerprint: never by
 *   position, never automatically, and never when several lines are indiscernible.
 * - Every decision is pinned to the global context hash: any change of the dossier,
 *   including a re-analysis that recreates identical lines, makes all decisions stale.
 *   Old values stay readable; nothing is re-applied without a new confirmation.
 * - A decision that depends on a binding (terminal mode, PAD confirmation) is stale as
 *   soon as that binding is replaced, even by an identical one.
 * - The dossier-level terminal fact never satisfies a per-lot requirement.
 */
import { normalizeTerminalOperationMode, TERMINAL_OPERATION_MODE_FACT_KEY, type TerminalOperationMode } from "./terminal-operation-mode.ts";
import { normalizeDthcContainerType } from "./dpw-dthc-tariff.ts";
import type { ConfirmedPadLine, PadGroup, PadGroupDecision } from "./pad-group-confirmation.ts";

export type LotDecisionKind = "line_binding" | "terminal_mode";
export type LotDecision = {
  id: string;
  case_id: string;
  scenario_id: string;
  scope_hash: string;
  context_hash: string;
  unit_ref: string;
  decision_kind: LotDecisionKind;
  action: "confirm" | "revoke";
  line_fingerprint: string | null;
  terminal_mode: string | null;
  source_reference: string;
  decided_by: string;
  created_at: string;
  decision_version: number;
};
export type LotLine = {
  id: string;
  line_index: number;
  line_label: string;
  request_type_hint: string | null;
  extracted_facts: unknown;
  fingerprint: string;
};
export type LotScenario = {
  id: string;
  scope_hash: string;
  status: string;
  superseded_by_scenario_id: string | null;
  scope_snapshot: Record<string, unknown>;
};
export type LotContext = {
  case_id: string;
  case_status: string;
  context_hash: string;
  request_count: number;
  scenario: LotScenario | null;
  lines: LotLine[];
  heads: LotDecision[];
  pad_heads: unknown[];
  weight_head_id: string | null;
};
export type LotIssue = { unit_ref: string; line_id: string; kind: LotDecisionKind | ""; code: string };
export type LotBinding = { unit_ref: string; line: LotLine; decision: LotDecision };
export type LotTerminal = { unit_ref: string; mode: TerminalOperationMode; decision: LotDecision };
export type LotUnit = { unit_ref: string; unit_kind: string; equipment_code: string | null; quantity: number | null; scenario_basis: string };
export type LotResolution = { units: LotUnit[]; bindings: LotBinding[]; terminals: LotTerminal[]; issues: LotIssue[] };

/** Dossier statuses in which no decision can be recorded (same list as the SQL writers). */
export const LOT_LOCKED_STATUSES = ["SENT", "ACCEPTED", "REJECTED", "ARCHIVED", "PRICING_RUNNING"];

const hashPattern = /^[a-f0-9]{64}$/;
const unitPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DEAD_SCENARIO_STATUSES = new Set(["blocked", "superseded", "promoted_to_final"]);

function invalid(): never { throw new Error("LOT_CONTEXT_INVALID"); }

/** Strict reading of `read_lot_confirmation_context`; a malformed snapshot is never guessed. */
export function parseLotContext(raw: unknown, caseId: string): LotContext {
  if (!isObject(raw) || raw.case_id !== caseId || typeof raw.context_hash !== "string" || !hashPattern.test(raw.context_hash) ||
    !Number.isSafeInteger(raw.request_count) || !Array.isArray(raw.lines) || !Array.isArray(raw.heads)) invalid();
  const lines = raw.lines.map((l): LotLine => {
    if (!isObject(l) || !text(l.id) || !Number.isSafeInteger(l.line_index) || typeof l.fingerprint !== "string" ||
      !hashPattern.test(l.fingerprint)) invalid();
    return { id: l.id, line_index: l.line_index as number, line_label: typeof l.line_label === "string" ? l.line_label : "",
      request_type_hint: typeof l.request_type_hint === "string" ? l.request_type_hint : null,
      extracted_facts: l.extracted_facts, fingerprint: l.fingerprint };
  });
  if (new Set(lines.map(l => l.id)).size !== lines.length) invalid();
  const heads = raw.heads.map((h): LotDecision => {
    if (!isObject(h) || !text(h.id) || !text(h.unit_ref) || !["line_binding", "terminal_mode"].includes(String(h.decision_kind)) ||
      !["confirm", "revoke"].includes(String(h.action))) invalid();
    return h as unknown as LotDecision;
  });
  let scenario: LotScenario | null = null;
  if (raw.scenario !== null && raw.scenario !== undefined) {
    const s = raw.scenario;
    if (!isObject(s) || !text(s.id) || !text(s.scope_hash) || !isObject(s.scope_snapshot)) invalid();
    scenario = { id: s.id, scope_hash: s.scope_hash, status: String(s.status ?? ""),
      superseded_by_scenario_id: typeof s.superseded_by_scenario_id === "string" ? s.superseded_by_scenario_id : null,
      scope_snapshot: s.scope_snapshot };
  }
  return { case_id: caseId, case_status: String(raw.case_status ?? ""), context_hash: raw.context_hash,
    request_count: raw.request_count as number, scenario, lines, heads,
    pad_heads: Array.isArray(raw.pad_heads) ? raw.pad_heads : [],
    weight_head_id: typeof raw.weight_head_id === "string" && uuidPattern.test(raw.weight_head_id) ? raw.weight_head_id : null };
}

function scenarioUnits(scenario: LotScenario): LotUnit[] | null {
  const snapshot = scenario.scope_snapshot;
  if (![2, 3].includes(Number(snapshot.schema_version)) || !Array.isArray(snapshot.cargo_units) || !snapshot.cargo_units.length) return null;
  const units: LotUnit[] = [];
  for (const raw of snapshot.cargo_units) {
    if (!isObject(raw) || typeof raw.unit_ref !== "string" || !unitPattern.test(raw.unit_ref) ||
      units.some(u => u.unit_ref === raw.unit_ref)) return null;
    units.push({ unit_ref: raw.unit_ref, unit_kind: String(raw.unit_kind ?? ""),
      equipment_code: typeof raw.equipment_code === "string" ? raw.equipment_code : null,
      quantity: Number.isSafeInteger(raw.quantity) ? raw.quantity as number : null,
      scenario_basis: typeof raw.scenario_basis === "string" ? raw.scenario_basis : "" });
  }
  return units;
}

const validDecision = (d: LotDecision) => text(d.decided_by) && text(d.created_at) && Number.isFinite(Date.parse(d.created_at)) &&
  typeof d.source_reference === "string" && d.source_reference.trim().length >= 3;

/** Latest decision per lot and kind → valid bindings, valid terminal modes and precise issues. */
export function resolveLotConfirmations(ctx: LotContext): LotResolution {
  const issues: LotIssue[] = [];
  const add = (unit_ref: string, line_id: string, kind: LotIssue["kind"], code: string) => issues.push({ unit_ref, line_id, kind, code });
  const sc = ctx.scenario;
  const units = sc ? scenarioUnits(sc) : null;
  if (ctx.request_count < 2 || ctx.lines.length !== ctx.request_count) add("", "", "", "LOT_SCOPE_UNSUPPORTED");
  else if (!sc) add("", "", "", "LOT_SCENARIO_REQUIRED");
  else if (sc.superseded_by_scenario_id || DEAD_SCENARIO_STATUSES.has(sc.status) || !units) add("", "", "", "LOT_SCOPE_UNSUPPORTED");
  if (issues.length || !sc || !units) return { units: units ?? [], bindings: [], terminals: [], issues };

  const byFingerprint = new Map<string, LotLine[]>();
  for (const line of ctx.lines) byFingerprint.set(line.fingerprint, [...(byFingerprint.get(line.fingerprint) ?? []), line]);
  for (const line of ctx.lines) {
    if ((byFingerprint.get(line.fingerprint)?.length ?? 0) > 1) add("", line.id, "line_binding", "LOT_LINE_AMBIGUOUS");
  }
  const head = (unit: string, kind: LotDecisionKind): LotDecision | null | "ambiguous" => {
    const found = ctx.heads.filter(d => d.unit_ref === unit && d.decision_kind === kind);
    return found.length > 1 ? "ambiguous" : found[0] ?? null;
  };
  const fresh = (d: LotDecision) => d.case_id === ctx.case_id && d.context_hash === ctx.context_hash &&
    d.scenario_id === sc.id && d.scope_hash === sc.scope_hash;

  const candidates: LotBinding[] = [];
  for (const unit of units) {
    const d = head(unit.unit_ref, "line_binding");
    const code = d === "ambiguous" ? "LOT_DECISION_AMBIGUOUS" : !d ? "LOT_BINDING_REQUIRED"
      : d.action !== "confirm" ? "LOT_CONFIRMATION_REVOKED"
      : !validDecision(d) || typeof d.line_fingerprint !== "string" || !hashPattern.test(d.line_fingerprint) ? "LOT_CONFIRMATION_INVALID"
      : !fresh(d) ? "LOT_CONFIRMATION_STALE" : null;
    if (code) { add(unit.unit_ref, "", "line_binding", code); continue; }
    const binding = d as LotDecision;
    const matches = byFingerprint.get(binding.line_fingerprint!) ?? [];
    if (matches.length !== 1) { add(unit.unit_ref, "", "line_binding", matches.length ? "LOT_LINE_AMBIGUOUS" : "LOT_LINE_CHANGED"); continue; }
    candidates.push({ unit_ref: unit.unit_ref, line: matches[0], decision: binding });
  }
  const claims = new Map<string, number>();
  for (const c of candidates) claims.set(c.line.id, (claims.get(c.line.id) ?? 0) + 1);
  const bindings = candidates.filter(c => claims.get(c.line.id) === 1);
  for (const c of candidates) if (claims.get(c.line.id) !== 1) add(c.unit_ref, c.line.id, "line_binding", "LOT_LINE_ALREADY_BOUND");
  for (const line of ctx.lines) {
    if (!bindings.some(b => b.line.id === line.id)) add("", line.id, "line_binding", "LOT_LINE_UNBOUND");
  }

  const terminals: LotTerminal[] = [];
  for (const b of bindings) {
    const d = head(b.unit_ref, "terminal_mode");
    if (!d) continue;
    const mode = d !== "ambiguous" ? normalizeTerminalOperationMode(d.terminal_mode) : null;
    const code = d === "ambiguous" ? "LOT_DECISION_AMBIGUOUS"
      : d.action !== "confirm" ? "LOT_CONFIRMATION_REVOKED"
      : !validDecision(d) || !mode ? "LOT_CONFIRMATION_INVALID"
      : !fresh(d) ? "LOT_CONFIRMATION_STALE"
      : !(Date.parse(d.created_at) > Date.parse(b.decision.created_at)) ? "LOT_BINDING_CHANGED" : null;
    if (code) { add(b.unit_ref, b.line.id, "terminal_mode", code); continue; }
    terminals.push({ unit_ref: b.unit_ref, mode: mode!, decision: d as LotDecision });
  }
  return { units, bindings, terminals, issues };
}

export const lotBindingForLine = (res: LotResolution, lineId: string) => res.bindings.find(b => b.line.id === lineId) ?? null;
export const lotBindingForUnit = (res: LotResolution, unitRef: string) => res.bindings.find(b => b.unit_ref === unitRef) ?? null;
export const lotTerminalForUnit = (res: LotResolution, unitRef: string) => res.terminals.find(t => t.unit_ref === unitRef) ?? null;

/** Lot-declared facts as seen by the per-lot terminal guard. The confirmed decision replaces
 * whatever the line carries; without a decision the line's own facts are used unchanged. */
export function withConfirmedLotTerminalMode(
  lotExtractedFacts: ReadonlyArray<{ key?: string; value?: unknown }>,
  mode: TerminalOperationMode | null,
): Array<{ key?: string; value?: unknown }> {
  const facts = Array.isArray(lotExtractedFacts) ? [...lotExtractedFacts] : [];
  if (!mode) return facts;
  return [...facts.filter(f => f?.key !== TERMINAL_OPERATION_MODE_FACT_KEY), { key: TERMINAL_OPERATION_MODE_FACT_KEY, value: mode }];
}

/** What a request line gets from the registry, and why it is blocked when it is. */
export function evaluateLotRequirements(params: {
  resolution: LotResolution;
  lineId: string;
  terminalRequired: boolean;
  padGroupsRequired: boolean;
  padReady: boolean;
  padLines: readonly ConfirmedPadLine[];
}): { unit_ref: string | null; terminalMode: TerminalOperationMode | null; padLine: ConfirmedPadLine | null; diagnostics: string[] } {
  const { resolution, lineId } = params;
  const binding = lotBindingForLine(resolution, lineId);
  const diagnostics: string[] = [];
  const needed = params.terminalRequired || params.padGroupsRequired;
  if (needed && !binding) {
    diagnostics.push(...resolution.issues.filter(i => !i.unit_ref && !i.line_id).map(i => i.code));
    diagnostics.push(...resolution.issues.filter(i => i.line_id === lineId && i.kind === "line_binding").map(i => i.code));
    if (!diagnostics.length) diagnostics.push("LOT_LINE_UNBOUND");
  }
  const terminal = binding ? lotTerminalForUnit(resolution, binding.unit_ref) : null;
  if (params.terminalRequired && binding && !terminal) {
    const terminalIssues = resolution.issues.filter(i => i.unit_ref === binding.unit_ref && i.kind === "terminal_mode").map(i => i.code);
    diagnostics.push(...(terminalIssues.length ? terminalIssues : ["LOT_TERMINAL_CONFIRMATION_REQUIRED"]));
  }
  const padLine = binding && params.padReady ? params.padLines.find(l => l.unit_ref === binding.unit_ref) ?? null : null;
  return { unit_ref: binding?.unit_ref ?? null, terminalMode: terminal?.mode ?? null, padLine, diagnostics: [...new Set(diagnostics)] };
}

function lineFacts(line: LotLine): Array<{ key: string; value: unknown }> {
  return Array.isArray(line.extracted_facts)
    ? line.extracted_facts.filter(isObject).filter(f => typeof f.key === "string").map(f => ({ key: f.key as string, value: f.value }))
    : [];
}
const equipment = (v: unknown) => normalizeDthcContainerType(v).replace(/^(20|40)HQ$/, "$1HC");

/** Per-lot counterpart of the dossier-level PAD allocation check: in a multi-lot dossier the
 * global facts describe only one lot, so a group is compared with the facts of the line it is
 * bound to. Equipment and quantity must match exactly; an ownership stated by the line must
 * match; a weight stated by the line must equal the group weight. Nothing is inferred. */
export function lotPadAllocationIssue(group: PadGroup, line: LotLine): string | null {
  const facts = lineFacts(line);
  const containers = facts.filter(f => f.key === "cargo.containers");
  if (containers.length !== 1) return "LOT_PAD_ALLOCATION_MISMATCH";
  let raw = containers[0].value;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return "LOT_PAD_ALLOCATION_MISMATCH"; } }
  if (!Array.isArray(raw) || raw.length !== 1 || !isObject(raw[0])) return "LOT_PAD_ALLOCATION_MISMATCH";
  const c = raw[0];
  const ownership = String(c.coc_soc ?? c.cocSoc ?? "").trim().toUpperCase();
  if (equipment(c.type) === "" || equipment(c.type) !== equipment(group.equipment_code) || Number(c.quantity) !== group.quantity ||
    (ownership !== "" && ownership !== group.ownership)) return "LOT_PAD_ALLOCATION_MISMATCH";
  const weights = facts.filter(f => f.key === "cargo.weight_kg");
  if (weights.length > 1) return "LOT_PAD_WEIGHT_MISMATCH";
  if (weights.length) {
    const w = typeof weights[0].value === "number" || typeof weights[0].value === "string" ? Number(weights[0].value) : NaN;
    if (!Number.isFinite(w) || w <= 0 || group.total_weight_kg === null || Math.abs(w - group.total_weight_kg) > 0.001) return "LOT_PAD_WEIGHT_MISMATCH";
  }
  return null;
}

/** PAD readiness conditions added for a multi-lot dossier: every group bound to exactly one
 * current line, its PAD decision recorded after that binding, and its allocation matching the
 * line. Replaces the blanket PAD_REQUEST_MULTI_LOT_UNSUPPORTED refusal. */
export function padLotIssues(params: {
  contextHash: string;
  groups: readonly PadGroup[];
  heads: readonly PadGroupDecision[];
  lots: LotContext;
  resolution: LotResolution;
}): { unit_ref: string; code: string }[] {
  if (params.lots.context_hash !== params.contextHash) return [{ unit_ref: "", code: "LOT_CONTEXT_CHANGED" }];
  const issues = params.resolution.issues.filter(i => !i.unit_ref && !i.line_id).map(i => ({ unit_ref: "", code: i.code }));
  for (const g of params.groups) {
    const binding = lotBindingForUnit(params.resolution, g.unit_ref);
    if (!binding) {
      const code = params.resolution.issues.find(i => i.unit_ref === g.unit_ref && i.kind === "line_binding")?.code ?? "LOT_BINDING_REQUIRED";
      issues.push({ unit_ref: g.unit_ref, code });
      continue;
    }
    const head = params.heads.find(h => h.unit_ref === g.unit_ref);
    if (head?.action === "confirm" && !(Date.parse(head.created_at) > Date.parse(binding.decision.created_at))) {
      issues.push({ unit_ref: g.unit_ref, code: "LOT_BINDING_CHANGED" });
    }
    const allocation = lotPadAllocationIssue(g, binding.line);
    if (allocation) issues.push({ unit_ref: g.unit_ref, code: allocation });
  }
  return issues;
}

/** D5, before pricing: each confirmed PAD line must belong to exactly one lot of this run,
 * and that lot must be in the PAD scope. Returns blockers per lot index. */
export function lotPadScopeIssues(
  padLines: readonly ConfirmedPadLine[],
  lots: ReadonlyArray<{ lot_index: number; unit_ref: string | null; padInScope: boolean }>,
): Map<number, string[]> {
  const blocked = new Map<number, string[]>();
  const push = (lot: number) => blocked.set(lot, [...new Set([...(blocked.get(lot) ?? []), "LOT_PAD_SCOPE_MISMATCH"])]);
  for (const line of padLines) {
    const owners = lots.filter(l => l.unit_ref === line.unit_ref);
    if (owners.length !== 1) { for (const l of lots) push(l.lot_index); continue; }
    if (!owners[0].padInScope) push(owners[0].lot_index);
  }
  return blocked;
}

type EmittedLine = { category?: unknown; amount?: unknown; lot_index?: unknown; source?: { decision_id?: unknown; unit_ref?: unknown; tariff_id?: unknown } | null };

/** D5, after pricing: exactly one PAD line per valid decision across all lots, in the lot bound
 * to its group, with the decided tariff and amount; no other PAD line (engine, global facts). */
export function lotPadEmissionValid(
  expected: readonly ConfirmedPadLine[],
  emitted: readonly EmittedLine[],
  lotUnits: ReadonlyMap<number, string>,
): boolean {
  // A zero-amount placeholder without decision (engine "to confirm" line on a lot outside the
  // PAD scope) is not a charge; any other PAD line counts.
  const pad = emitted.filter(l => l?.category === "PAD_DROIT_PASSAGE" && (l.source?.decision_id != null || Number(l.amount) !== 0));
  if (pad.length !== expected.length) return false;
  return expected.every(e => pad.filter(l => l.source?.decision_id === e.decision_id && l.source?.unit_ref === e.unit_ref &&
    l.source?.tariff_id === e.tariff_id && Number(l.amount) === e.amount &&
    lotUnits.get(Number(l.lot_index)) === e.unit_ref).length === 1);
}
