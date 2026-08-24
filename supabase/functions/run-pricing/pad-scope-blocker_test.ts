import { assertEquals, assertNotStrictEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  PAD_CATEGORY_REQUIRED_MESSAGE,
  PAD_SCOPE_SERVICE_KEYS,
  type PadScopeBlocker,
  type PadScopeFact,
  resolvePadScopeBlocker,
} from "./pad-scope-blocker.ts";

/**
 * PACK P0-B — direct proof of the PAD_CATEGORY_REQUIRED guard.
 *
 * These tests pin the CURRENT behaviour of `resolvePadScopeBlocker`, including the
 * fact that a scope in PAD range with a category but WITHOUT a strictly positive
 * `cargo.pad_rate_fcfa_per_ton` is still reported under the `PAD_CATEGORY_REQUIRED`
 * code. That naming is deliberate and out of scope here; see the P0-B report.
 */

// ── Fixtures ────────────────────────────────────────────────────────────────

/** A package whose services put the scope in PAD range. */
const PAD_KEYS = ["PORT_DAKAR_HANDLING", "CUSTOMS_DAKAR", "TRUCKING"];
/** A package with no port-of-Dakar service at all. */
const NON_PAD_KEYS = ["CUSTOMS_DAKAR", "TRUCKING", "AGENCY"];

function fact(fact_key: string, value: Partial<PadScopeFact> = {}): PadScopeFact {
  return { fact_key, ...value };
}

const CATEGORY_CARGO = fact("cargo.pad_category", { value_text: "CATEGORIE_2" });
const CATEGORY_PRICING = fact("pricing.pad_category", { value_text: "CATEGORIE_2" });
const RATE_POSITIVE = fact("cargo.pad_rate_fcfa_per_ton", { value_number: 1250 });

/** Convenience wrapper so each test only states what it actually varies. */
function resolve(
  facts: PadScopeFact[],
  effectiveServiceKeys: string[] = PAD_KEYS,
  servicePackage = "IMPORT_FCL_DAP",
  incoterm = "CIF",
): PadScopeBlocker | null {
  return resolvePadScopeBlocker({ facts, servicePackage, effectiveServiceKeys, incoterm });
}

/** The exact object the two run-pricing call sites receive when the guard fires. */
function expectedBlocker(
  effectiveServiceKeys: string[],
  servicePackage = "IMPORT_FCL_DAP",
  incoterm = "CIF",
): PadScopeBlocker {
  return {
    pricing_blockers: ["PAD_CATEGORY_REQUIRED"],
    message:
      "Catégorie PAD / droit de passage requise pour chiffrer le service portuaire inclus dans le devis.",
    scope_debug: { servicePackage, incoterm, effectiveServiceKeys },
  };
}

// ── Scope: when the guard applies at all ────────────────────────────────────

Deno.test("out of PAD scope with no facts at all -> no blocker", () => {
  assertEquals(resolve([], NON_PAD_KEYS), null);
});

Deno.test("out of PAD scope stays clear even without category nor rate", () => {
  assertEquals(resolve([fact("cargo.weight_total_kg", { value_number: 24000 })], NON_PAD_KEYS), null);
});

Deno.test("an empty effective service key list is never in PAD scope", () => {
  assertEquals(resolve([], []), null);
});

Deno.test("both PAD service keys put the scope in range", () => {
  for (const key of PAD_SCOPE_SERVICE_KEYS) {
    assertEquals(
      resolve([], [key]),
      expectedBlocker([key]),
      `${key} must trigger the PAD guard`,
    );
  }
  assertEquals([...PAD_SCOPE_SERVICE_KEYS], ["PORT_DAKAR_HANDLING", "PAD_DROIT_PASSAGE"]);
});

// ── Happy paths: category + official rate ───────────────────────────────────

Deno.test("in PAD scope with cargo.pad_category and a positive rate -> no blocker", () => {
  assertEquals(resolve([CATEGORY_CARGO, RATE_POSITIVE]), null);
});

Deno.test("in PAD scope with pricing.pad_category and a positive rate -> no blocker", () => {
  assertEquals(resolve([CATEGORY_PRICING, RATE_POSITIVE]), null);
});

Deno.test("either category fact alone unlocks the scope (cargo OR pricing)", () => {
  assertEquals(resolve([CATEGORY_CARGO, CATEGORY_PRICING, RATE_POSITIVE]), null);
  // pricing.pad_category is the gap key build-case-puzzle protects; it must suffice
  // on its own even when cargo.pad_category is present but empty.
  assertEquals(
    resolve([fact("cargo.pad_category", { value_text: "   " }), CATEGORY_PRICING, RATE_POSITIVE]),
    null,
  );
});

Deno.test("the rate is read from value_json / value_number / value_text alike", () => {
  assertEquals(resolve([CATEGORY_CARGO, fact("cargo.pad_rate_fcfa_per_ton", { value_json: 900 })]), null);
  assertEquals(resolve([CATEGORY_CARGO, fact("cargo.pad_rate_fcfa_per_ton", { value_text: "900" })]), null);
  assertEquals(resolve([CATEGORY_CARGO, fact("cargo.pad_rate_fcfa_per_ton", { value_number: 0.5 })]), null);
});

// ── Missing category ────────────────────────────────────────────────────────

Deno.test("in PAD scope with no category fact at all -> PAD_CATEGORY_REQUIRED", () => {
  assertEquals(resolve([RATE_POSITIVE]), expectedBlocker(PAD_KEYS));
});

Deno.test("empty / blank / non-string category values do not count as a category", () => {
  const blankValues: Array<Partial<PadScopeFact>> = [
    { value_text: "" },
    { value_text: "   " },
    { value_text: "\t\n" },
    { value_json: "" },
    { value_json: null },
    { value_number: 2 }, // numeric category is not a category
    {}, // fact row present, every value column empty
  ];
  for (const value of blankValues) {
    assertEquals(
      resolve([fact("cargo.pad_category", value), fact("pricing.pad_category", value), RATE_POSITIVE]),
      expectedBlocker(PAD_KEYS),
      `category value ${JSON.stringify(value)} must not unlock the scope`,
    );
  }
});

// ── Missing / invalid rate (current doctrine: same PAD_CATEGORY_REQUIRED code) ──

Deno.test("a category without a usable rate still returns PAD_CATEGORY_REQUIRED", () => {
  const unusableRates: Array<PadScopeFact[]> = [
    [], // rate fact absent entirely
    [fact("cargo.pad_rate_fcfa_per_ton", {})], // present, all value columns empty -> null -> 0
    [fact("cargo.pad_rate_fcfa_per_ton", { value_number: 0 })],
    [fact("cargo.pad_rate_fcfa_per_ton", { value_number: -1250 })],
    [fact("cargo.pad_rate_fcfa_per_ton", { value_text: "TO_CONFIRM" })], // NaN
    [fact("cargo.pad_rate_fcfa_per_ton", { value_text: "" })], // Number("") === 0
    [fact("cargo.pad_rate_fcfa_per_ton", { value_json: { amount: 1250 } })], // NaN
    [fact("cargo.pad_rate_fcfa_per_ton", { value_number: Infinity })], // not finite
  ];
  for (const rateFacts of unusableRates) {
    assertEquals(
      resolve([CATEGORY_CARGO, ...rateFacts]),
      expectedBlocker(PAD_KEYS),
      `rate ${JSON.stringify(rateFacts)} must not be treated as an official PAD rate`,
    );
  }
});

// ── Normalisation ───────────────────────────────────────────────────────────

Deno.test("service keys are trimmed, upper-cased and emptied entries dropped", () => {
  const blocker = resolve(
    [],
    ["  port_dakar_handling ", "", "  ", "customs_dakar"],
    "import_fcl_dap",
    " cif ",
  );
  assertEquals(blocker, expectedBlocker(["PORT_DAKAR_HANDLING", "CUSTOMS_DAKAR"], "IMPORT_FCL_DAP", "CIF"));
});

Deno.test("servicePackage and incoterm are normalised in scope_debug, including empty input", () => {
  assertEquals(
    resolve([], [" pad_droit_passage "], "  ", ""),
    expectedBlocker(["PAD_DROIT_PASSAGE"], "", ""),
  );
});

Deno.test("normalisation does not mutate the caller's inputs", () => {
  const keys = ["  port_dakar_handling ", "customs_dakar"];
  const facts: PadScopeFact[] = [fact("cargo.pad_category", { value_text: " " })];
  const keysSnapshot = [...keys];
  const factsSnapshot = structuredClone(facts);

  const blocker = resolve(facts, keys);

  assertEquals(blocker?.pricing_blockers, ["PAD_CATEGORY_REQUIRED"]);
  assertEquals(keys, keysSnapshot);
  assertEquals(facts, factsSnapshot);
  assertNotStrictEquals(blocker?.scope_debug.effectiveServiceKeys, keys);
});

// ── Multi-lot independence ──────────────────────────────────────────────────

Deno.test("multi-lot: a blocked lot does not contaminate a clean lot", () => {
  const blockedLotFacts: PadScopeFact[] = [RATE_POSITIVE]; // no category
  const cleanLotFacts: PadScopeFact[] = [CATEGORY_CARGO, RATE_POSITIVE];

  const lots = [
    { id: "LOT-A", facts: blockedLotFacts, keys: PAD_KEYS, pkg: "IMPORT_FCL_DAP", incoterm: "CIF" },
    { id: "LOT-B", facts: cleanLotFacts, keys: PAD_KEYS, pkg: "IMPORT_FCL_DAP", incoterm: "CIF" },
    { id: "LOT-C", facts: [], keys: NON_PAD_KEYS, pkg: "IMPORT_LCL_FOB", incoterm: "FOB" },
  ];

  const results = lots.map((lot) => ({
    id: lot.id,
    blocker: resolvePadScopeBlocker({
      facts: lot.facts,
      servicePackage: lot.pkg,
      effectiveServiceKeys: lot.keys,
      incoterm: lot.incoterm,
    }),
  }));

  assertEquals(results[0].blocker, expectedBlocker(PAD_KEYS));
  assertEquals(results[1].blocker, null);
  assertEquals(results[2].blocker, null);
  assertEquals(results.filter((r) => r.blocker !== null).map((r) => r.id), ["LOT-A"]);
});

Deno.test("multi-lot: same shared facts, different scopes -> only the PAD lot blocks", () => {
  const sharedFacts: PadScopeFact[] = [fact("cargo.weight_total_kg", { value_number: 24000 })];
  assertEquals(
    resolve(sharedFacts, PAD_KEYS, "IMPORT_FCL_DAP", "CIF"),
    expectedBlocker(PAD_KEYS),
  );
  assertEquals(resolve(sharedFacts, NON_PAD_KEYS, "IMPORT_FCL_DAP", "CIF"), null);
  // Re-checking the blocked lot after the clean one must be unchanged.
  assertEquals(
    resolve(sharedFacts, PAD_KEYS, "IMPORT_FCL_DAP", "CIF"),
    expectedBlocker(PAD_KEYS),
  );
});

// ── Idempotence & exact contract ────────────────────────────────────────────

Deno.test("re-running the guard on the same input yields the same output", () => {
  const facts: PadScopeFact[] = [CATEGORY_PRICING]; // category present, rate missing
  const runs = [resolve(facts), resolve(facts), resolve(facts)];
  assertEquals(runs[0], expectedBlocker(PAD_KEYS));
  assertEquals(runs[1], runs[0]);
  assertEquals(runs[2], runs[0]);
  // Fresh object each call: a caller mutating one result cannot poison the next lot.
  assertNotStrictEquals(runs[0], runs[1]);

  const clean: PadScopeFact[] = [CATEGORY_PRICING, RATE_POSITIVE];
  assertEquals(resolve(clean), null);
  assertEquals(resolve(clean), null);
});

Deno.test("exact blocker contract: pricing_blockers, message, scope_debug", () => {
  const blocker = resolve([], PAD_KEYS, "IMPORT_FCL_DDP", "DDP");

  assertEquals(blocker, {
    pricing_blockers: ["PAD_CATEGORY_REQUIRED"],
    message:
      "Catégorie PAD / droit de passage requise pour chiffrer le service portuaire inclus dans le devis.",
    scope_debug: {
      servicePackage: "IMPORT_FCL_DDP",
      incoterm: "DDP",
      effectiveServiceKeys: ["PORT_DAKAR_HANDLING", "CUSTOMS_DAKAR", "TRUCKING"],
    },
  });

  // The single code index.ts pushes into lotBlockers, and the exported message constant.
  assertEquals(blocker?.pricing_blockers.length, 1);
  assertEquals(blocker?.pricing_blockers[0], "PAD_CATEGORY_REQUIRED");
  assertEquals(blocker?.message, PAD_CATEGORY_REQUIRED_MESSAGE);
  assertEquals(Object.keys(blocker ?? {}), ["pricing_blockers", "message", "scope_debug"]);
  assertEquals(Object.keys(blocker?.scope_debug ?? {}), [
    "servicePackage",
    "incoterm",
    "effectiveServiceKeys",
  ]);
});
