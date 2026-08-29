import { describe, expect, it } from "vitest";
import {
  formatScenarioPricingAmount,
  latestScenarioPricingRuns,
  readScenarioPricingCodes,
  readScenarioPricingEdgeData,
  readScenarioOutputEdgeData,
  scenarioOutputMutationSignature,
  scenarioOutputsByPricingRun,
  scenarioPricingMutationSignature,
  type ScenarioPricingRunSummary,
} from "./scenarioPricing";

function run(
  scenarioId: string,
  sequence: number,
  status: ScenarioPricingRunSummary["status"] = "success",
): ScenarioPricingRunSummary {
  return {
    id: `${scenarioId}-${sequence}`,
    scenario_id: scenarioId,
    run_seq: sequence,
    status,
    qualification: status === "success" ? "provisional" : "blocked",
    blockers: [],
    reservations: [],
    assumptions_snapshot: [],
    firm_total_ht: status === "success" ? 100 : null,
    firm_total_ttc: status === "success" ? 100 : null,
    indicative_total_ht: status === "success" ? 120 : null,
    indicative_total_ttc: status === "success" ? 120 : null,
    currency: "XOF",
    completed_at: "2026-08-29T20:00:00Z",
  };
}

describe("scenarioPricing P1-A4", () => {
  it("conserve le run de séquence la plus récente par scénario", () => {
    const latest = latestScenarioPricingRuns([
      run("scenario-a", 1, "superseded"),
      run("scenario-b", 1),
      run("scenario-a", 2, "blocked"),
    ]);
    expect(latest.get("scenario-a")?.run_seq).toBe(2);
    expect(latest.get("scenario-a")?.status).toBe("blocked");
    expect(latest.get("scenario-b")?.run_seq).toBe(1);
  });

  it("déduplique les blocages et réserves sans accepter une forme forgée", () => {
    expect(readScenarioPricingCodes([
      { code: "RATE_PENDING_CONFIRMATION" },
      { code: "RATE_PENDING_CONFIRMATION" },
      { rogue: "x" },
      "OPEN_POINT",
    ])).toEqual(["RATE_PENDING_CONFIRMATION", "OPEN_POINT"]);
    expect(readScenarioPricingCodes({ code: "X" })).toEqual([]);
  });

  it("valide l'enveloppe Edge et refuse une réponse incomplète", () => {
    expect(readScenarioPricingEdgeData({
      ok: true,
      data: {
        pricing_run_id: "run-1",
        scenario_id: "scenario-1",
        run_seq: 1,
        status: "blocked",
        qualification: "blocked",
        blockers: [{ code: "SCENARIO_NOT_SELECTED" }],
        idempotent_replay: false,
      },
    })).toMatchObject({ status: "blocked", blockers: ["SCENARIO_NOT_SELECTED"] });
    expect(readScenarioPricingEdgeData({ ok: true, data: { status: "firm" } })).toBeNull();
  });

  it("lie l'idempotence au dossier, scénario et scope_hash", () => {
    expect(scenarioPricingMutationSignature("case", "scenario", "hash"))
      .toBe("case:scenario:hash");
  });

  it("présente le XOF sans décimales et garde l'absence explicite", () => {
    expect(formatScenarioPricingAmount(null)).toBe("—");
    expect(formatScenarioPricingAmount(125000)).toContain("125");
  });

  it("indexe une sortie documentaire par run et lie son idempotence au run", () => {
    const outputs = scenarioOutputsByPricingRun([{
      id: "version-1",
      scenario_pricing_run_id: "run-1",
      snapshot: {},
      created_at: "2026-08-29T23:00:00Z",
    }]);
    expect(outputs.get("run-1")?.id).toBe("version-1");
    expect(scenarioOutputMutationSignature("case", "scenario", "run"))
      .toBe("case:scenario:run:output");
  });

  it("valide la réponse de création d'une sortie non ferme", () => {
    expect(readScenarioOutputEdgeData({
      ok: true,
      data: {
        version_id: "version-1",
        version_number: -1,
        scenario_reference: "SC-ABC-R1-E2",
        qualification: "partial",
        idempotent_replay: false,
      },
    })).toMatchObject({ version_id: "version-1", qualification: "partial" });
    expect(readScenarioOutputEdgeData({
      ok: true,
      data: {
        version_id: "version-1",
        version_number: 1,
        scenario_reference: "SC-ABC-R1-E2",
        qualification: "partial",
      },
    })).toBeNull();
    expect(readScenarioOutputEdgeData({
      ok: true,
      data: { version_id: "version-1", qualification: "firm" },
    })).toBeNull();
  });
});
