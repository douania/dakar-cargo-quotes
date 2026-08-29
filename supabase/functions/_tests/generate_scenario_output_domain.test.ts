import { assertEquals } from "jsr:@std/assert";
import {
  mapScenarioOutputRpcError,
  validateScenarioOutputRequest,
} from "../generate-scenario-quotation-version/domain.ts";

const request = {
  case_id: "11111111-1111-4111-8111-111111111111",
  scenario_id: "22222222-2222-4222-8222-222222222222",
  scenario_pricing_run_id: "33333333-3333-4333-8333-333333333333",
  expected_scope_hash: "a".repeat(64),
  idempotency_key: "scenario-output-0001",
};

Deno.test("P1-A5 requête: accepte le contrat fermé nominal", () => {
  const result = validateScenarioOutputRequest(request);
  assertEquals(result.ok, true);
});

Deno.test("P1-A5 requête: refuse champ inconnu, UUID et clé invalides", () => {
  assertEquals(validateScenarioOutputRequest({ ...request, rogue: true }).ok, false);
  assertEquals(validateScenarioOutputRequest({ ...request, scenario_id: "x" }).ok, false);
  assertEquals(validateScenarioOutputRequest({ ...request, idempotency_key: "short" }).ok, false);
});

Deno.test("P1-A5 erreurs RPC: distingue accès, conflit et panne", () => {
  assertEquals(mapScenarioOutputRpcError("FORBIDDEN_CROSS_CASE"), "FORBIDDEN_OWNER");
  assertEquals(mapScenarioOutputRpcError("SCENARIO_STATE_CHANGED"), "CONFLICT_INVALID_STATE");
  assertEquals(mapScenarioOutputRpcError("NOT_FOUND"), "VALIDATION_FAILED");
  assertEquals(mapScenarioOutputRpcError("connection lost"), "UPSTREAM_DB_ERROR");
});
