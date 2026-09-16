import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { scenarioEmptyReturnLines } from "./ownership-pricing.ts";
import { computeScenarioTotals, inferCoveredServices } from "./domain.ts";
const cargo = { schema_version: 2 as const, cargo_units: [
  { unit_ref: "alpha", ownership: "SOC", scenario_basis: "Operator SOC assumption" },
  { unit_ref: "beta", ownership: "COC", scenario_basis: "Operator COC assumption" },
] };
Deno.test("empty return: per-group ownership, no unknown-country Senegal default or invented price", () => {
  const before = JSON.stringify(cargo);
  for (const facts of [[], [{ id: "country", fact_key: "routing.destination_country", value_text: "ML" }]]) {
    const lines = scenarioEmptyReturnLines(cargo, facts, "IMPORT");
    assertEquals(lines.map(l => l.amount), [0, null]);
    assertEquals((lines[0].source as Record<string, unknown>).type, "EXCLUDED_BY_RULE");
    assertEquals((lines[1].source as Record<string, unknown>).type, "TO_CONFIRM");
    assert(String(lines[0].notes).includes("repositionnement"));
    assert(inferCoveredServices(lines).has("EMPTY_RETURN"));
    assertEquals(computeScenarioTotals(lines, new Set(["scenario.cargo_units"])).indicative_total_ht, 0);
  }
  assertEquals(JSON.stringify(cargo), before);
});
Deno.test("empty return: existing SN client-obligation rule is explicit exclusion, not free transport", () => {
  const fact = { id: "country", fact_key: "routing.destination_country", value_text: "SN" };
  const lines = scenarioEmptyReturnLines(cargo, [fact], "IMPORT");
  assertEquals(lines[1].amount, 0);
  assertEquals((lines[1].source as Record<string, unknown>).reference, "EMPTY_RETURN_IMPORT_SN_CLIENT_OBLIGATION");
  assert(String(lines[1].notes).includes("responsabilité contractuelle à vérifier"));
  assertEquals(scenarioEmptyReturnLines(cargo, [fact, { ...fact, value_text: "ML" }], "IMPORT")[1].amount, null);
  for (const movement of ["TRANSIT", "EXPORT", "", "UNKNOWN"]) {
    assertEquals(scenarioEmptyReturnLines(cargo, [fact], movement)[1].amount, null);
  }
});
