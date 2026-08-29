/** Tests purs P1-A4 — aucun réseau, DB ou Deno.serve. */
import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildEngineRequest,
  applyScenarioExplicitServiceRemovals,
  buildFingerprintInput,
  buildMissingServiceReserveLines,
  buildPricingInputs,
  buildScenarioOverlay,
  computeRequestFingerprint,
  computeScenarioTotals,
  deriveQualification,
  inferCoveredServices,
  mapRpcErrorCode,
  validateScenarioPricingRequest,
  type PricingAssumptionRow,
  type PricingFactRow,
} from "../run-scenario-pricing/domain.ts";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const SCENARIO_ID = "22222222-2222-4222-8222-222222222222";
const FACT_ID = "33333333-3333-4333-8333-333333333333";
const ASSUMPTION_ID = "44444444-4444-4444-8444-444444444444";
const HASH = "a".repeat(64);

function request(extra: Record<string, unknown> = {}) {
  return {
    case_id: CASE_ID,
    scenario_id: SCENARIO_ID,
    expected_scope_hash: HASH,
    idempotency_key: "scenario-pricing-0001",
    ...extra,
  };
}

function fact(
  key: string,
  value: Partial<PricingFactRow>,
  id = FACT_ID,
): PricingFactRow {
  return { id, fact_key: key, ...value };
}

function assumption(
  key: string | null,
  value: unknown,
  type = "number",
  id = ASSUMPTION_ID,
): PricingAssumptionRow {
  return {
    id,
    status: "active",
    assumed_fact_key: key,
    assumed_value_type: type,
    assumed_value: value,
  };
}

Deno.test("P1-A4 payload: contrat fermé et borné", () => {
  const ok = validateScenarioPricingRequest(request());
  assert(ok.ok);
  assertEquals(ok.value.idempotency_key, "scenario-pricing-0001");
  assert(!validateScenarioPricingRequest(request({ rogue: true })).ok);
  assert(!validateScenarioPricingRequest(request({ expected_scope_hash: "x" })).ok);
  assert(!validateScenarioPricingRequest(request({ idempotency_key: "court" })).ok);
});

Deno.test("P1-A4 overlay: la valeur vient du ledger et ne modifie pas le fait", () => {
  const original = fact("cargo.value", { value_number: 1000 });
  const result = buildScenarioOverlay(
    [original],
    [assumption("cargo.value", 2500)],
  );
  assert(result.ok);
  assertEquals(original.value_number, 1000);
  assertEquals(result.facts[0].value_number, 2500);
  assertEquals(result.overlay, [{
    fact_key: "cargo.value",
    basis: "assumption",
    source_id: ASSUMPTION_ID,
    value_type: "number",
    value: 2500,
  }]);
  assert(result.assumptionKeys.has("cargo.value"));
});

Deno.test("P1-A4 overlay: doublon et clé inconnue bloquent fail-closed", () => {
  const duplicate = buildScenarioOverlay([], [
    assumption("cargo.weight_kg", 1000, "number", ASSUMPTION_ID),
    assumption("cargo.weight_kg", 2000, "number", "55555555-5555-4555-8555-555555555555"),
  ]);
  assert(!duplicate.ok);
  assert(duplicate.blockers.includes("AMBIGUOUS_ASSUMPTION_OVERLAY"));

  const unsupported = buildScenarioOverlay([], [assumption("pricing.unknown", 1)]);
  assert(!unsupported.ok);
  assert(unsupported.blockers.includes("SCENARIO_ASSUMPTION_KEY_UNSUPPORTED"));
});

Deno.test("P1-A4 inputs: conversion poids kg→tonnes et JSON défensif", () => {
  const inputs = buildPricingInputs([
    fact("routing.destination_city", { value_text: "Thiès" }, "10000000-0000-4000-8000-000000000001"),
    fact("routing.incoterm", { value_text: "DAP" }, "10000000-0000-4000-8000-000000000002"),
    fact("cargo.weight_kg", { value_number: 12_500 }, "10000000-0000-4000-8000-000000000003"),
    fact("cargo.value", { value_number: 10_000_000 }, "10000000-0000-4000-8000-000000000004"),
    fact("cargo.containers", {
      value_json: [{ type: "40HC", quantity: 2 }],
    }, "10000000-0000-4000-8000-000000000005"),
  ]);
  assertEquals(inputs.cargoWeight, 12.5);
  assertEquals(inputs.containers, [{ type: "40HC", quantity: 2 }]);
  const engine = buildEngineRequest(inputs, "MARITIME");
  assertEquals(engine.transportMode, "maritime");
  assertEquals(engine.finalDestination, "Thiès");
});

Deno.test("P1-A4 totaux: TVA uniquement honoraires, ligne ferme prouvée", () => {
  const totals = computeScenarioTotals([
    {
      bloc: "operationnel",
      category: "Transport",
      description: "Transport local",
      amount: 1000,
      source: { type: "official", confidence: 1 },
    },
    {
      bloc: "honoraires",
      category: "Agence",
      description: "Honoraires",
      amount: 500,
      source: { type: "validated_internal", confidence: 1 },
    },
  ], new Set());
  assertEquals(totals.firm_total_ht, 1500);
  assertEquals(totals.firm_total_ttc, 1590);
  assertEquals(totals.indicative_total_ht, 1500);
  assertEquals(totals.indicative_total_ttc, 1590);
});

Deno.test("P1-A4 totaux: hypothèse douanière exclut le débours mais conserve l'indépendant", () => {
  const totals = computeScenarioTotals([
    {
      bloc: "operationnel",
      category: "Transport",
      description: "Transport",
      amount: 1000,
      source: { type: "official", confidence: 1 },
    },
    {
      bloc: "debours",
      category: "Droits & Taxes",
      description: "Droits douaniers",
      amount: 400,
      source: { type: "official", confidence: 1 },
    },
  ], new Set(["cargo.value"]));
  assertEquals(totals.firm_total_ht, 1000);
  assertEquals(totals.indicative_total_ht, 1400);
  assertEquals(totals.lines[0].scenario_provenance.assumption_dependent, false);
  assertEquals(totals.lines[1].scenario_provenance.assumption_dependent, true);
});

Deno.test("P1-A4 totaux: dépendance globale et TO_CONFIRM ne deviennent jamais fermes", () => {
  const totals = computeScenarioTotals([
    {
      bloc: "operationnel",
      category: "Transport",
      amount: 1000,
      source: { type: "official", confidence: 1 },
    },
    {
      bloc: "debours",
      category: "Réserve",
      amount: null,
      source: { type: "TO_CONFIRM", confidence: 0 },
    },
  ], new Set(["routing.destination_city"]));
  assertEquals(totals.firm_total_ht, 0);
  assertEquals(totals.indicative_total_ht, 1000);
});

Deno.test("P1-A4 couverture: le marqueur PAD devient une réserve financière PAD", () => {
  const covered = inferCoveredServices([
    { category: "Terminal (DPW)", amount: 75000, source: { type: "official" } },
  ]);
  assert(covered.has("DTHC"));
  const missing = buildMissingServiceReserveLines(
    ["PORT_DAKAR_HANDLING", "DTHC", "TRUCKING"],
    covered,
  );
  assertEquals(missing.map((line) => line.category), ["PAD_DROIT_PASSAGE", "TRUCKING"]);
  assert(missing.every((line) => line.amount === null));
  assert(missing.every((line) =>
    (line.source as { type?: unknown }).type === "TO_CONFIRM"
  ));
});

Deno.test("P1-A4 périmètre: un service explicitement retiré ne réapparaît jamais", () => {
  const lines = [
    {
      bloc: "operationnel",
      category: "Transport",
      description: "Livraison locale",
      amount: 1000,
      source: { type: "OFFICIAL", confidence: 1 },
    },
    {
      bloc: "debours",
      category: "Droits & Taxes",
      description: "Débours douaniers obligatoires non mappés",
      amount: 500,
      source: { type: "OFFICIAL", confidence: 1 },
    },
  ];
  const filtered = applyScenarioExplicitServiceRemovals(lines, new Set(["TRUCKING"]));
  assertEquals(filtered.removedLines.map((line) => line.category), ["Transport"]);
  assertEquals(filtered.keptLines.map((line) => line.category), ["Droits & Taxes"]);
});

Deno.test("P1-A4 qualification: jamais firm", () => {
  assertEquals(deriveQualification({ blockers: ["X"], assumptionsCount: 0, reserveCount: 0, openPointsCount: 0 }), "blocked");
  assertEquals(deriveQualification({ blockers: [], assumptionsCount: 1, reserveCount: 1, openPointsCount: 0 }), "partial");
  assertEquals(deriveQualification({ blockers: [], assumptionsCount: 0, reserveCount: 0, openPointsCount: 0 }), "provisional");
});

Deno.test("P1-A4 empreinte: stable par ordre, sensible au contenu", async () => {
  const base = buildFingerprintInput({
    request: request(),
    scopeSnapshot: { b: 2, a: 1 },
    factsSnapshot: [],
    assumptionsSnapshot: [],
    reservations: [],
  });
  const permuted = { ...base, scope_snapshot: { a: 1, b: 2 } };
  const changed = { ...base, scope_snapshot: { a: 1, b: 3 } };
  assertEquals(await computeRequestFingerprint(base), await computeRequestFingerprint(permuted));
  assertNotEquals(await computeRequestFingerprint(base), await computeRequestFingerprint(changed));
});

Deno.test("P1-A4 erreurs RPC: conflits et isolation sont distincts", () => {
  assertEquals(mapRpcErrorCode("IDEMPOTENCY_CONFLICT"), "CONFLICT_INVALID_STATE");
  assertEquals(mapRpcErrorCode("SCENARIO_STATE_CHANGED"), "CONFLICT_INVALID_STATE");
  assertEquals(mapRpcErrorCode("FORBIDDEN_CROSS_CASE"), "FORBIDDEN_OWNER");
  assertEquals(mapRpcErrorCode("database offline"), "UPSTREAM_DB_ERROR");
});
