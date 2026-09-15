import { describe, it, expect } from "vitest";
import { buildScopeSnapshot, emptyScenarioDraft, emptyScenarioDraftV2, upgradeScenarioDraft, draftFromScenario, compareScenarioScopes } from "./quoteScenarios";
import { resolveScenarioCargo } from "../../supabase/functions/_shared/scenario-cargo";

describe("scenario cargo v2", () => {
  it("malformed v2 groups retain unknown danger and v2 fields when revising", () => {
    for (const raw of [null, false, 17, "invalid", []]) {
      const snapshot = { ...buildScopeSnapshot(emptyScenarioDraftV2()).snapshot, cargo_units: [raw] };
      const before = JSON.stringify(snapshot);
      const draft = draftFromScenario({ title: "Synthetic", status: "draft", blocked_reason: null, scope_snapshot: snapshot });
      expect(draft.cargoUnits[0]).toMatchObject({ dangerousGoods: null, ownership: "unknown", weightBasis: "unknown", scenarioBasis: "" });
      expect(JSON.stringify(snapshot)).toBe(before);
    }
  });
  it("new v2 form preserves unknown danger and round-trips without inventing evidence", () => {
    const draft = emptyScenarioDraftV2();
    const built = buildScopeSnapshot(draft);
    expect(built.ok).toBe(true);
    const units = built.snapshot.cargo_units as Record<string, unknown>[];
    expect(units[0].dangerous_goods).toBe(null);
    expect(units[0].ownership).toBe(null);
    const restored = draftFromScenario({ title: "Synthetic", status: "draft", blocked_reason: null, scope_snapshot: built.snapshot });
    expect(buildScopeSnapshot(restored).snapshot).toEqual(built.snapshot);
  });
  it("v1 stays byte-for-byte v1 on revision; upgrade is explicit and does not confirm false", () => {
    const old = emptyScenarioDraft();
    const snapshot = buildScopeSnapshot(old).snapshot;
    const bytes = JSON.stringify(snapshot);
    const restored = draftFromScenario({ title: "Old", status: "draft", blocked_reason: null, scope_snapshot: snapshot });
    expect(JSON.stringify(buildScopeSnapshot(restored).snapshot)).toBe(bytes);
    const next = upgradeScenarioDraft(restored);
    expect(next.cargoUnits[0].dangerousGoods).toBe(null);
    expect(JSON.stringify(snapshot)).toBe(bytes);
    expect(restored.cargoUnits[0].dangerousGoods).toBe(false);
  });
  it("structured form supplies normalized generic groups, weight and UN-derived class", () => {
    const draft = emptyScenarioDraftV2();
    Object.assign(draft.cargoUnits[0], { equipmentKnown: true, equipmentCode: "20hq", quantity: "4", ownership: "SOC", dangerousGoods: true,
      unNumber: "UN1203", scenarioBasis: "Operator simulation, per unit container allocation to confirm", grossWeightKg: "19000", weightBasis: "per_unit" });
    const snapshot = buildScopeSnapshot(draft).snapshot;
    const plan = resolveScenarioCargo({ schema_version: 2, cargo_units: snapshot.cargo_units as Record<string, unknown>[] });
    expect(plan.blockers).toEqual([]);
    expect(plan.cargoWeight).toBe(76);
    expect(plan.rows[0].imoClass).toBe("3");
    expect(plan.rows[0].classification.status).toBe("DERIVED");
  });
  it("rejects non-DG paired with UN without silently clearing either field", () => {
    const draft = emptyScenarioDraftV2();
    Object.assign(draft.cargoUnits[0], { dangerousGoods: false, unNumber: "UN1203" });
    expect(buildScopeSnapshot(draft).ok).toBe(false);
    expect(draft.cargoUnits[0].unNumber).toBe("UN1203");
  });
  it("comparison exposes changed scenario basis, ownership, weight base and classification", () => {
    const draft = emptyScenarioDraftV2();
    const before = buildScopeSnapshot(draft).snapshot;
    Object.assign(draft.cargoUnits[0], { ownership: "SOC", scenarioBasis: "New assumption", weightBasis: "per_unit", dangerousGoods: true, unNumber: "UN1203" });
    const diff = JSON.stringify(compareScenarioScopes(before, buildScopeSnapshot(draft).snapshot));
    for (const key of ["ownership", "scenario_basis", "weight_basis", "un_number"]) expect(diff).toContain(key);
  });
});
