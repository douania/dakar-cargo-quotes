import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  PAD_SCOPE_SERVICE_KEYS,
  type PadScopeFact,
  resolvePadScopeBlocker,
} from "../_shared/pad-scope-blocker.ts";
import {
  ALL_KNOWN_SERVICE_KEYS,
  readOverridesFromFacts,
  resolveEffectiveServiceKeys,
  SERVICE_PACKAGES,
} from "../_shared/service-scope.ts";

/**
 * P0-E — the PAD markers must never reach `price-service-lines`.
 *
 * `PORT_DAKAR_HANDLING` (and, defensively, `PAD_DROIT_PASSAGE`) are scope MARKERS, not
 * catalogue services: `price-service-lines` has no PAD tariff for them, so enriching them
 * produced a 0 XOF / `no_match` line counted ON TOP of the official `PAD_DROIT_PASSAGE`
 * line (enriched separately by run-pricing from the `cargo.pad_*` facts) and on top of
 * DTHC, which is the destination terminal handling and a different charge entirely.
 *
 * These tests pin the exclusion AND the fact that it changes nothing else: the
 * `PAD_CATEGORY_REQUIRED` guard still reads the UNFILTERED scope, DTHC is still enriched,
 * and `service.overrides` keep behaving exactly as before.
 */

// The Edge Function is imported for its pure helpers only — no HTTP listener wanted.
Deno.env.set("RUN_PRICING_DISABLE_SERVE", "1");
const {
  excludePadScopeKeysForEnrichment,
  scopeRequiresPadPricing,
  resolvePadBlockersForLot,
  PAD_MULTI_LOT_UNSUPPORTED,
} = await import("./index.ts") as {
  excludePadScopeKeysForEnrichment: (keys: string[]) => string[];
  scopeRequiresPadPricing: (keys: string[]) => boolean;
  resolvePadBlockersForLot: (params: {
    facts: PadScopeFact[];
    servicePackage: string;
    effectiveServiceKeys: string[];
    incoterm: string;
  }) => string[];
  PAD_MULTI_LOT_UNSUPPORTED: string;
};

function fact(fact_key: string, value: Partial<PadScopeFact> = {}): PadScopeFact {
  return { fact_key, ...value };
}

/** The two facts that legitimately clear the PAD guard. */
const PAD_FACTS: PadScopeFact[] = [
  fact("cargo.pad_category", { value_text: "T02" }),
  fact("cargo.pad_rate_fcfa_per_ton", { value_number: 9678 }),
];

const NO_OVERRIDES = { add: [], remove: [] };

// ── The exclusion itself ────────────────────────────────────────────────────

Deno.test("P0-E: every PAD scope marker is stripped from the enrichment list", () => {
  const keys = [...PAD_SCOPE_SERVICE_KEYS];
  assert(keys.length > 0, "PAD_SCOPE_SERVICE_KEYS must not be empty");
  assertEquals(excludePadScopeKeysForEnrichment(keys), []);
});

Deno.test("P0-E: DAP_PROJECT_IMPORT enriches everything except the PAD marker", () => {
  const effective = resolveEffectiveServiceKeys("DAP_PROJECT_IMPORT", NO_OVERRIDES);
  // Unfiltered scope is untouched — it is what the PAD guard reads.
  assertEquals(effective, [
    "PORT_DAKAR_HANDLING",
    "DTHC",
    "TRUCKING",
    "EMPTY_RETURN",
    "CUSTOMS_DAKAR",
  ]);
  assertEquals(excludePadScopeKeysForEnrichment(effective), [
    "DTHC",
    "TRUCKING",
    "EMPTY_RETURN",
    "CUSTOMS_DAKAR",
  ]);
});

Deno.test("P0-E: DTHC is never touched by the exclusion", () => {
  for (const pkg of Object.keys(SERVICE_PACKAGES)) {
    const effective = resolveEffectiveServiceKeys(pkg, NO_OVERRIDES);
    const enriched = excludePadScopeKeysForEnrichment(effective);
    assertEquals(
      enriched.includes("DTHC"),
      effective.includes("DTHC"),
      `${pkg}: DTHC membership changed`,
    );
  }
});

Deno.test("P0-E: no package leaks a PAD marker into the enrichment list", () => {
  for (const pkg of Object.keys(SERVICE_PACKAGES)) {
    const enriched = excludePadScopeKeysForEnrichment(
      resolveEffectiveServiceKeys(pkg, NO_OVERRIDES),
    );
    for (const marker of PAD_SCOPE_SERVICE_KEYS) {
      assertEquals(enriched.includes(marker), false, `${pkg} still enriches ${marker}`);
    }
  }
});

Deno.test("P0-E: relative order of the remaining keys is preserved", () => {
  const input = ["DTHC", "PORT_DAKAR_HANDLING", "TRUCKING", "PAD_DROIT_PASSAGE", "AGENCY"];
  assertEquals(excludePadScopeKeysForEnrichment(input), ["DTHC", "TRUCKING", "AGENCY"]);
});

Deno.test("P0-E: exclusion is idempotent", () => {
  const once = excludePadScopeKeysForEnrichment(
    resolveEffectiveServiceKeys("TRANSIT_REGIONAL_VIA_DAKAR", NO_OVERRIDES),
  );
  assertEquals(excludePadScopeKeysForEnrichment(once), once);
});

Deno.test("P0-E: markers are matched after trim/upper normalisation", () => {
  assertEquals(
    excludePadScopeKeysForEnrichment([" port_dakar_handling ", "dthc", "PAD_DROIT_PASSAGE"]),
    ["dthc"],
  );
});

Deno.test("P0-E: empty and nullish inputs are safe", () => {
  assertEquals(excludePadScopeKeysForEnrichment([]), []);
  assertEquals(excludePadScopeKeysForEnrichment(null as unknown as string[]), []);
  assertEquals(excludePadScopeKeysForEnrichment(undefined as unknown as string[]), []);
});

// ── The PAD guard is NOT bypassed by the exclusion ──────────────────────────

Deno.test("P0-E: filtering the enrichment list does not clear PAD_CATEGORY_REQUIRED", () => {
  for (const pkg of ["DAP_PROJECT_IMPORT", "DDP_PROJECT_IMPORT", "LCL_IMPORT_DAP"]) {
    const effective = resolveEffectiveServiceKeys(pkg, NO_OVERRIDES);
    const blocker = resolvePadScopeBlocker({
      facts: [],
      servicePackage: pkg,
      effectiveServiceKeys: effective,
      incoterm: "CIF",
    });
    assert(blocker, `${pkg}: PAD guard must still block without pad facts`);
    assertEquals(blocker.pricing_blockers, ["PAD_CATEGORY_REQUIRED"]);
    // The audit trail keeps the marker — only the enrichment call drops it.
    assertEquals(blocker.scope_debug.effectiveServiceKeys.includes("PORT_DAKAR_HANDLING"), true);
    assertEquals(excludePadScopeKeysForEnrichment(effective).includes("PORT_DAKAR_HANDLING"), false);
  }
});

Deno.test("P0-E: a filtered scope would NOT block — proof the guard reads the unfiltered list", () => {
  // Guard against a future refactor that passes the enrichment list to the guard.
  const filtered = excludePadScopeKeysForEnrichment(
    resolveEffectiveServiceKeys("DAP_PROJECT_IMPORT", NO_OVERRIDES),
  );
  assertEquals(
    resolvePadScopeBlocker({
      facts: [],
      servicePackage: "DAP_PROJECT_IMPORT",
      effectiveServiceKeys: filtered,
      incoterm: "CIF",
    }),
    null,
  );
});

Deno.test("P0-E: complete PAD facts still clear the guard, enrichment stays PAD-free", () => {
  const effective = resolveEffectiveServiceKeys("DAP_PROJECT_IMPORT", NO_OVERRIDES);
  assertEquals(
    resolvePadScopeBlocker({
      facts: PAD_FACTS,
      servicePackage: "DAP_PROJECT_IMPORT",
      effectiveServiceKeys: effective,
      incoterm: "CIF",
    }),
    null,
  );
  // The official PAD line comes from the `enrichment_pad` block, never from this list.
  assertEquals(excludePadScopeKeysForEnrichment(effective).includes("PORT_DAKAR_HANDLING"), false);
});

// ── Historical `service.overrides` keep working ─────────────────────────────

Deno.test("P0-E: overrides.add(PORT_DAKAR_HANDLING) still arms the guard but is not enriched", () => {
  const overrides = readOverridesFromFacts([
    { fact_key: "service.overrides", value_json: { add: ["PORT_DAKAR_HANDLING"], remove: [] } },
  ]);
  const effective = resolveEffectiveServiceKeys("AIR_IMPORT_DAP", overrides);
  assertEquals(effective.includes("PORT_DAKAR_HANDLING"), true);
  assert(
    resolvePadScopeBlocker({
      facts: [],
      servicePackage: "AIR_IMPORT_DAP",
      effectiveServiceKeys: effective,
      incoterm: "CIF",
    }),
    "override-added PAD marker must still block",
  );
  assertEquals(excludePadScopeKeysForEnrichment(effective), [
    "AIR_HANDLING",
    "CUSTOMS_DAKAR",
    "TRUCKING",
    "AGENCY",
  ]);
});

Deno.test("P0-E: overrides.remove(PORT_DAKAR_HANDLING) behaviour is unchanged", () => {
  const overrides = readOverridesFromFacts([
    { fact_key: "service.overrides", value_json: { add: [], remove: ["PORT_DAKAR_HANDLING"] } },
  ]);
  const effective = resolveEffectiveServiceKeys("DAP_PROJECT_IMPORT", overrides);
  assertEquals(effective.includes("PORT_DAKAR_HANDLING"), false);
  assertEquals(
    resolvePadScopeBlocker({
      facts: [],
      servicePackage: "DAP_PROJECT_IMPORT",
      effectiveServiceKeys: effective,
      incoterm: "CIF",
    }),
    null,
  );
  // Removing the marker changes nothing for the enrichment: it was excluded anyway.
  assertEquals(excludePadScopeKeysForEnrichment(effective), effective);
});

Deno.test("P0-E: PAD_DROIT_PASSAGE is unreachable through service.overrides", () => {
  // It carries no default unit, so `readOverridesFromFacts` sanitises it away. The
  // exclusion above covers it regardless — belt and braces, no doctrine change.
  assertEquals(ALL_KNOWN_SERVICE_KEYS.has("PAD_DROIT_PASSAGE"), false);
  const overrides = readOverridesFromFacts([
    { fact_key: "service.overrides", value_json: { add: ["PAD_DROIT_PASSAGE"], remove: [] } },
  ]);
  assertEquals(overrides.add, []);
});

// ── DDP_PROJECT_IMPORT parity, backend side ─────────────────────────────────

Deno.test("P0-E: DDP_PROJECT_IMPORT resolves the same scope as DAP_PROJECT_IMPORT", () => {
  assertEquals(
    resolveEffectiveServiceKeys("DDP_PROJECT_IMPORT", NO_OVERRIDES),
    resolveEffectiveServiceKeys("DAP_PROJECT_IMPORT", NO_OVERRIDES),
  );
});

Deno.test("P0-E: DDP_PROJECT_IMPORT enriches DTHC and excludes the PAD marker", () => {
  assertEquals(
    excludePadScopeKeysForEnrichment(
      resolveEffectiveServiceKeys("DDP_PROJECT_IMPORT", NO_OVERRIDES),
    ),
    ["DTHC", "TRUCKING", "EMPTY_RETURN", "CUSTOMS_DAKAR"],
  );
});

// ── Multi-lot fail-closed: no PAD-scoped lot may be priced without a PAD line ─
//
// The mono-lot `enrichment_pad` block is the ONLY producer of the official
// `PAD_DROIT_PASSAGE` line, and the multi-lot branch returns long before it. So the mono-lot
// `resolvePadScopeBlocker` alone is fail-OPEN per lot: complete global `cargo.pad_*` facts
// clear it, and no per-lot PAD charge follows. Combined with the enrichment exclusion above —
// which also removes the bogus 0 XOF marker line — a PAD-scoped multi-lot run would have
// completed with ZERO PAD charge: a silent under-charge. `resolvePadBlockersForLot` blocks it.

/** Packages whose resolved scope carries a PAD marker (in PAD range). */
const PAD_SCOPED_PACKAGES = Object.keys(SERVICE_PACKAGES).filter((pkg) =>
  scopeRequiresPadPricing(resolveEffectiveServiceKeys(pkg, NO_OVERRIDES))
);

/** Packages whose resolved scope carries none (out of PAD range). */
const NON_PAD_PACKAGES = Object.keys(SERVICE_PACKAGES).filter((pkg) =>
  !scopeRequiresPadPricing(resolveEffectiveServiceKeys(pkg, NO_OVERRIDES))
);

function lotBlockersFor(pkg: string, facts: PadScopeFact[]): string[] {
  return resolvePadBlockersForLot({
    facts,
    servicePackage: pkg,
    effectiveServiceKeys: resolveEffectiveServiceKeys(pkg, NO_OVERRIDES),
    incoterm: "CIF",
  });
}

Deno.test("P0-E: both sides of the PAD range are represented in SERVICE_PACKAGES", () => {
  // Guards the three cases below against becoming vacuously true.
  assert(PAD_SCOPED_PACKAGES.includes("DAP_PROJECT_IMPORT"), "expected a PAD-scoped package");
  assert(NON_PAD_PACKAGES.includes("AIR_IMPORT_DAP"), "expected a non-PAD package");
});

// Case 1 — in PAD range, facts missing → the historical blocker, unchanged.
Deno.test("P0-E: PAD-scoped lot without pad facts keeps PAD_CATEGORY_REQUIRED", () => {
  for (const pkg of PAD_SCOPED_PACKAGES) {
    assertEquals(lotBlockersFor(pkg, []), ["PAD_CATEGORY_REQUIRED"], pkg);
  }
});

Deno.test("P0-E: partial or unusable pad facts still yield PAD_CATEGORY_REQUIRED", () => {
  const partials: Array<[string, PadScopeFact[]]> = [
    ["category only", [fact("cargo.pad_category", { value_text: "T02" })]],
    ["rate only", [fact("cargo.pad_rate_fcfa_per_ton", { value_number: 9678 })]],
    ["blank category", [
      fact("cargo.pad_category", { value_text: "   " }),
      fact("cargo.pad_rate_fcfa_per_ton", { value_number: 9678 }),
    ]],
    ["zero rate", [
      fact("cargo.pad_category", { value_text: "T02" }),
      fact("cargo.pad_rate_fcfa_per_ton", { value_number: 0 }),
    ]],
    ["negative rate", [
      fact("cargo.pad_category", { value_text: "T02" }),
      fact("cargo.pad_rate_fcfa_per_ton", { value_number: -9678 }),
    ]],
    ["metadata-only rate", [
      fact("cargo.pad_category", { value_text: "T02" }),
      fact("cargo.pad_rate_fcfa_per_ton", {
        value_json: { origin: "MAP-8B", tariff_source: { amount: 9678 } },
      }),
    ]],
  ];
  for (const [label, facts] of partials) {
    assertEquals(
      lotBlockersFor("DAP_PROJECT_IMPORT", facts),
      ["PAD_CATEGORY_REQUIRED"],
      `${label}: must stay blocked`,
    );
  }
});

// Case 2 — in PAD range, facts complete → the new explicit fail-closed blocker.
Deno.test("P0-E: PAD-scoped lot WITH complete pad facts yields PAD_MULTI_LOT_UNSUPPORTED", () => {
  for (const pkg of PAD_SCOPED_PACKAGES) {
    assertEquals(lotBlockersFor(pkg, PAD_FACTS), [PAD_MULTI_LOT_UNSUPPORTED], pkg);
  }
});

Deno.test("P0-E: the multi-lot blocker code is stable", () => {
  // Persisted in pricing_runs.outputs_json.blocked_lots[].blockers — renaming it is a breaking change.
  assertEquals(PAD_MULTI_LOT_UNSUPPORTED, "PAD_MULTI_LOT_UNSUPPORTED");
});

Deno.test("P0-E: a PAD-scoped lot is NEVER cleared, whatever the facts", () => {
  const factSets: PadScopeFact[][] = [
    [],
    PAD_FACTS,
    [fact("cargo.pad_category", { value_text: "T02" })],
    [fact("pricing.pad_category", { value_text: "P05" }), ...PAD_FACTS],
  ];
  for (const pkg of PAD_SCOPED_PACKAGES) {
    for (const facts of factSets) {
      const blockers = lotBlockersFor(pkg, facts);
      assertEquals(blockers.length, 1, `${pkg}: exactly one PAD blocker expected`);
      assert(
        blockers[0] === "PAD_CATEGORY_REQUIRED" || blockers[0] === PAD_MULTI_LOT_UNSUPPORTED,
        `${pkg}: unexpected blocker ${blockers[0]}`,
      );
    }
  }
});

// Case 3 — out of PAD range → strictly unaffected.
Deno.test("P0-E: a lot outside the PAD range is never blocked by the PAD guard", () => {
  for (const pkg of NON_PAD_PACKAGES) {
    assertEquals(lotBlockersFor(pkg, []), [], `${pkg} without pad facts`);
    assertEquals(lotBlockersFor(pkg, PAD_FACTS), [], `${pkg} with pad facts`);
  }
});

Deno.test("P0-E: an unknown/empty package resolves an empty scope and stays unblocked", () => {
  assertEquals(lotBlockersFor("", []), []);
  assertEquals(lotBlockersFor("NOT_A_PACKAGE", PAD_FACTS), []);
});

Deno.test("P0-E: overrides.remove(PORT_DAKAR_HANDLING) takes the lot out of PAD range", () => {
  const overrides = readOverridesFromFacts([
    { fact_key: "service.overrides", value_json: { add: [], remove: ["PORT_DAKAR_HANDLING"] } },
  ]);
  assertEquals(
    resolvePadBlockersForLot({
      facts: PAD_FACTS,
      servicePackage: "DAP_PROJECT_IMPORT",
      effectiveServiceKeys: resolveEffectiveServiceKeys("DAP_PROJECT_IMPORT", overrides),
      incoterm: "CIF",
    }),
    [],
  );
});

Deno.test("P0-E: overrides.add(PORT_DAKAR_HANDLING) puts a non-PAD lot in PAD range", () => {
  const overrides = readOverridesFromFacts([
    { fact_key: "service.overrides", value_json: { add: ["PORT_DAKAR_HANDLING"], remove: [] } },
  ]);
  const effectiveServiceKeys = resolveEffectiveServiceKeys("AIR_IMPORT_DAP", overrides);
  assertEquals(
    resolvePadBlockersForLot({
      facts: [],
      servicePackage: "AIR_IMPORT_DAP",
      effectiveServiceKeys,
      incoterm: "CIF",
    }),
    ["PAD_CATEGORY_REQUIRED"],
  );
  assertEquals(
    resolvePadBlockersForLot({
      facts: PAD_FACTS,
      servicePackage: "AIR_IMPORT_DAP",
      effectiveServiceKeys,
      incoterm: "CIF",
    }),
    [PAD_MULTI_LOT_UNSUPPORTED],
  );
});

// ── Idempotence / non-regression ────────────────────────────────────────────

Deno.test("P0-E: resolvePadBlockersForLot is pure — repeatable and non-mutating", () => {
  const effectiveServiceKeys = resolveEffectiveServiceKeys("DAP_PROJECT_IMPORT", NO_OVERRIDES);
  const keysBefore = [...effectiveServiceKeys];
  const factsBefore = JSON.stringify(PAD_FACTS);
  const params = {
    facts: PAD_FACTS,
    servicePackage: "DAP_PROJECT_IMPORT",
    effectiveServiceKeys,
    incoterm: "CIF",
  };
  const first = resolvePadBlockersForLot(params);
  const second = resolvePadBlockersForLot(params);
  assertEquals(first, second);
  assertEquals(first, [PAD_MULTI_LOT_UNSUPPORTED]);
  // A returned array must not be the guard's own state either.
  first.push("MUTATED");
  assertEquals(resolvePadBlockersForLot(params), [PAD_MULTI_LOT_UNSUPPORTED]);
  assertEquals(effectiveServiceKeys, keysBefore, "input scope was mutated");
  assertEquals(JSON.stringify(PAD_FACTS), factsBefore, "input facts were mutated");
});

Deno.test("P0-E: scopeRequiresPadPricing is the exact complement of the enrichment filter", () => {
  for (const pkg of Object.keys(SERVICE_PACKAGES)) {
    const effective = resolveEffectiveServiceKeys(pkg, NO_OVERRIDES);
    assertEquals(
      scopeRequiresPadPricing(effective),
      excludePadScopeKeysForEnrichment(effective).length !== effective.length,
      `${pkg}: PAD range and enrichment filter disagree`,
    );
  }
  // Same normalisation on both sides, and nullish-safe.
  assertEquals(scopeRequiresPadPricing([" port_dakar_handling "]), true);
  assertEquals(scopeRequiresPadPricing(["DTHC", "TRUCKING"]), false);
  assertEquals(scopeRequiresPadPricing([]), false);
  assertEquals(scopeRequiresPadPricing(null as unknown as string[]), false);
});

Deno.test("P0-E: the mono-lot guard keeps its own verdict — no cross-contamination", () => {
  const effectiveServiceKeys = resolveEffectiveServiceKeys("DAP_PROJECT_IMPORT", NO_OVERRIDES);
  // Mono-lot: complete facts clear the guard, because enrichment_pad then prices the line.
  assertEquals(
    resolvePadScopeBlocker({
      facts: PAD_FACTS,
      servicePackage: "DAP_PROJECT_IMPORT",
      effectiveServiceKeys,
      incoterm: "CIF",
    }),
    null,
  );
  // Multi-lot, same inputs: blocked, because no per-lot equivalent of that block exists.
  assertEquals(
    resolvePadBlockersForLot({
      facts: PAD_FACTS,
      servicePackage: "DAP_PROJECT_IMPORT",
      effectiveServiceKeys,
      incoterm: "CIF",
    }),
    [PAD_MULTI_LOT_UNSUPPORTED],
  );
});
