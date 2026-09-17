import { padGroupsFromSnapshot, padGroupAllocationIssue, resolveConfirmedPadGroups,
  type PadGroupContext, type PadGroupDecision, type PadGroupIssue, type ConfirmedPadLine } from "./pad-group-confirmation.ts";
import { PAD_REVIEW_FR } from "./pad-gap-review.ts";
import { resolveEffectiveServiceKeys, readOverridesFromFacts, resolveExplicitlyRemovedServiceKeys } from "./service-scope.ts";
import { PAD_SCOPE_SERVICE_KEYS, type PadScopeFact } from "./pad-scope-blocker.ts";

export function padGroupScopeRequired(facts: PadScopeFact[], effectiveServiceKeys: string[]): boolean {
  const removed = resolveExplicitlyRemovedServiceKeys(readOverridesFromFacts(facts));
  return !removed.has("PAD_DROIT_PASSAGE") && !removed.has("PORT_DAKAR_HANDLING") &&
    effectiveServiceKeys.some(k => PAD_SCOPE_SERVICE_KEYS.has(k));
}

// Structural adapter used by Edge and both pricing/gap consumers. No browser input.
type Filter = { eq: (key: string, value: unknown) => Filter;
  limit: (count: number) => PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown; count: number | null }> };
type Client = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  from: (table: string) => { select: (columns: string, options: { count: "exact" }) => Filter } };
type ContextRow = { case_id: string; case_status: string; context_hash: string; request_count: number;
  facts: Record<string, unknown>[]; heads: PadGroupDecision[];
  scenario: { id: string; scope_hash: string; scope_snapshot: Record<string, unknown>; status: string; superseded_by_scenario_id: string | null } | null };
export type PadGroupState = {
  mode: "legacy" | "groups";
  required: boolean;
  read_only: boolean;
  context: PadGroupContext | null;
  heads: PadGroupDecision[];
  all_heads: PadGroupDecision[];
  ready: boolean;
  issues: PadGroupIssue[];
  lines: ConfirmedPadLine[];
  total: number | null;
};
export async function loadPadGroupState(client: unknown, caseId: string): Promise<PadGroupState> {
  // Isolate the deeply generic Supabase builder at this adapter boundary.
  const db = client as Client;
  const response = await db.rpc("read_pad_group_context", { p_case_id: caseId });
  if (response.error || !response.data || typeof response.data !== "object") throw new Error("PAD_GROUP_CONTEXT_UNAVAILABLE");
  const raw = response.data as ContextRow;
  if (raw.case_id !== caseId) throw new Error("PAD_GROUP_CONTEXT_INVALID");
  if (!Array.isArray(raw.heads) || !Array.isArray(raw.facts)) throw new Error("PAD_GROUP_CONTEXT_INVALID");
  const facts = raw.facts.map((f): PadScopeFact => ({ fact_key: String(f.key), value_text: f.text, value_number: f.number, value_json: f.json }));
  const pkg = facts.find(f => f.fact_key === "service.package")?.value_text ?? "";
  const required = padGroupScopeRequired(facts, resolveEffectiveServiceKeys(String(pkg).trim().toUpperCase(), readOverridesFromFacts(facts)));
  const sc = raw.scenario;
  const groupScope = sc?.scope_snapshot?.schema_version === 3;
  const read_only = ["SENT", "ACCEPTED", "REJECTED", "ARCHIVED", "PRICING_RUNNING"].includes(raw.case_status);
  const empty: PadGroupState = { mode: "groups", required, read_only, context: null, heads: [], all_heads: raw.heads, ready: false, issues: [], lines: [], total: null };
  // No old confirmation can disappear silently into the legacy global path.
  if (!groupScope && !raw.heads.length) return { ...empty, mode: "legacy" };
  if (!groupScope || !sc || sc.superseded_by_scenario_id || ["blocked", "superseded", "promoted_to_final"].includes(sc.status)) {
    return { ...empty, issues: [{ unit_ref: "", code: "PAD_GROUP_SELECTION_REQUIRED" }] };
  }
  let groups;
  try { groups = padGroupsFromSnapshot(sc.scope_snapshot); }
  catch { return { ...empty, issues: [{ unit_ref: "", code: "PAD_GROUP_SCOPE_UNSUPPORTED" }] }; }
  const context: PadGroupContext = { case_id: caseId, scenario_id: sc.id, scope_hash: sc.scope_hash, context_hash: raw.context_hash, groups };
  const heads = raw.heads.filter((d: PadGroupDecision) => groups.some(g => g.unit_ref === d.unit_ref));
  const rates = await db.from("port_tariffs")
    .select("id,provider,category,operation_type,cargo_type,classification,amount,unit,source_document,evidence_level,effective_date,expiry_date,is_active", { count: "exact" })
    .eq("provider", "PAD").eq("category", "DROIT_PASSAGE").eq("operation_type", "IMPORT").eq("cargo_type", "CONTENEUR").eq("is_active", true).limit(201);
  if (rates.error || rates.count === null || rates.count > 200 || rates.count !== rates.data?.length) throw new Error("PAD_GROUP_CATALOG_UNAVAILABLE");
  const resolved = resolveConfirmedPadGroups(context, heads, rates.data ?? [], new Date().toISOString().slice(0, 10));
  const allocation = padGroupAllocationIssue(groups, raw.facts);
  const issues = [...resolved.issues];
  if (raw.request_count > 1) issues.push({ unit_ref: "", code: "PAD_REQUEST_MULTI_LOT_UNSUPPORTED" });
  if (allocation) issues.push({ unit_ref: "", code: allocation });
  return { mode: "groups", required, read_only, context, heads, all_heads: raw.heads, ...resolved, issues, ready: !issues.length,
    lines: issues.length ? [] : resolved.lines, total: issues.length ? null : resolved.total };
}

export async function syncPadGroupGap(client: unknown, caseId: string, state: PadGroupState): Promise<void> {
  const db = client as Client;
  if (!state.context) return;
  const result = await db.rpc("sync_pad_group_gap", { p_case_id: caseId, p_context_hash: state.context.context_hash,
    p_heads: state.all_heads, p_ready: !state.required || state.ready, p_question: PAD_REVIEW_FR });
  if (result.error) throw new Error("PAD_GAP_SYNC_FAILED");
}
