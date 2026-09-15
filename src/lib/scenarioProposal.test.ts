import { describe, it, expect } from "vitest";
import { proposalToDraft, type ScenarioProposal } from "./scenarioProposal";
import { buildScopeSnapshot } from "./quoteScenarios";
import { proposeGroups } from "../../supabase/functions/recommend-pad-category/scenario-domain";

export function proposalFixture(): ScenarioProposal {
  const result = proposeGroups("client@example.invalid", [{ id: "22222222-2222-4222-8222-222222222222", from_address: "client@example.invalid",
    body_text: "1.8 cabinets: 55t/unit, 20HQ SOC, UN3536\n2.2 transformers: 18t/unit, 20HQ SOC\n3.4 x 40HQ COC (spare parts): 10-15t/container" }]);
  return { ...result, source_fingerprint: "a".repeat(64), pad_candidates: [] };
}
describe("automatic scenario proposals", () => {
  it("produces a valid immutable v2 draft without monetary fields or promotion", async () => {
    // Runtime contract test across runtimes; the Edge module is typechecked by Deno,
    // not under the browser's different strictNullChecks configuration.
    const edgeModule = "../../supabase/functions/manage-quote-scenario/domain.ts";
    const { validateScopeSnapshot } = await import(/* @vite-ignore */ edgeModule);
    const p = proposalFixture(); const before = JSON.stringify(p);
    const draft = proposalToDraft(p); const built = buildScopeSnapshot(draft);
    expect(built.ok).toBe(true); expect(validateScopeSnapshot(built.snapshot).ok).toBe(true);
    expect(draft.cargoUnits.map(g => g.quantity)).toEqual(["8", "2", "4"]);
    expect(draft.cargoUnits.map(g => g.dangerousGoods)).toEqual([true, null, null]);
    expect(draft.cargoUnits[2].grossWeightKg).toBe("15000");
    expect(draft.cargoUnits[2].scenarioBasis).toContain("poids haut");
    expect(draft.cargoUnits[2].scenarioBasis).toContain("Qté conteneurs source");
    expect(draft.cargoUnits[2].scenarioBasis).not.toContain("1 unité/conteneur");
    expect(draft.cargoUnits[0].scenarioBasis).toContain("1 unité/conteneur");
    expect(draft.cargoUnits.every(g => g.scenarioBasis!.length <= 200)).toBe(true);
    expect(draft.cargoUnits[0].scenarioBasis).toContain(p.source_fingerprint);
    expect(draft.status).toBe("draft"); expect(draft.links).toEqual([]);
    expect(JSON.stringify(built.snapshot)).not.toMatch(/pad_category|pad_rate|amount|price/);
    expect(JSON.stringify(p)).toBe(before);
  });
  it("refuses review-only or corrupted proposals", () => {
    expect(() => proposalToDraft({ ...proposalFixture(), status: "needs_review" })).toThrow();
    expect(() => proposalToDraft({ ...proposalFixture(), source_fingerprint: "bad" })).toThrow();
    expect(() => proposalToDraft({ ...proposalFixture(), groups: [] })).toThrow();
  });
});
