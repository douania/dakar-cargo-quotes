import { assertEquals, assertNotStrictEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  hasNonEmptyFactValue,
  PAD_CATEGORY_REQUIRED_MESSAGE,
  PAD_SCOPE_SERVICE_KEYS,
  type PadScopeBlocker,
  type PadScopeFact,
  readFactValue,
  readOfficialPadRate,
  readPadCategory,
  readPadPricingInputs,
  resolvePadScopeBlocker,
} from "../_shared/pad-scope-blocker.ts";

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

// ── MAP-7B / MAP-8B propagated facts (P0-E runtime shapes) ──────────────────
//
// `supersede_fact` writes the business value in value_text / value_number and RESERVES
// value_json for propagation metadata. Reading value_json first returned that object, so
// a dossier with a materialised category AND official rate was still blocked.

/** cargo.pad_category as written by the MAP-6/MAP-7B propagation RPC. */
const CATEGORY_PROPAGATED = fact("cargo.pad_category", {
  value_text: "T02",
  value_json: {
    origin: "MAP-6",
    propagated_from: "commodity_classification_candidates",
    candidate_id: "6f6d1a1c-1f0b-4f4a-9c9a-2a2b3c4d5e6f",
    propagation_idempotency_key: "pad-cat-6f6d1a1c",
    operator_validated: true,
    scheme: null,
  },
});

/** cargo.pad_rate_fcfa_per_ton as derived by MAP-8B from the category above. */
function propagatedRate(amount: unknown, valueText?: string): PadScopeFact {
  return fact("cargo.pad_rate_fcfa_per_ton", {
    value_number: amount,
    value_text: valueText,
    value_json: {
      origin: "MAP-8B",
      derived_from_candidate_id: "6f6d1a1c-1f0b-4f4a-9c9a-2a2b3c4d5e6f",
      derived_from_fact_key: "cargo.pad_category",
      pad_category: "T02",
      tariff_source: {
        table: "port_tariffs",
        provider: "PAD",
        category: "DROIT_PASSAGE",
        operation_type: "IMPORT",
        cargo_type: "CONTENEUR",
        classification: "T02",
        unit: "tonne",
        amount: 9678,
      },
      idempotency_key: "pad-rate-6f6d1a1c",
    },
  });
}

const RATE_PROPAGATED = propagatedRate(9678, "9678");

Deno.test("propagated category + propagated official rate -> no blocker", () => {
  assertEquals(resolve([CATEGORY_PROPAGATED, RATE_PROPAGATED]), null);
});

Deno.test("propagated pricing.pad_category is read the same way", () => {
  const categoryPricing = fact("pricing.pad_category", {
    value_text: "T02",
    value_json: { origin: "MAP-6", operator_validated: true },
  });
  assertEquals(resolve([categoryPricing, RATE_PROPAGATED]), null);
});

Deno.test("propagated rate carried by value_text only is still read", () => {
  assertEquals(resolve([CATEGORY_PROPAGATED, propagatedRate(null, "9678")]), null);
});

Deno.test("fail-closed is preserved on propagated facts", () => {
  // Category alone (T02 propagated, no rate fact at all).
  assertEquals(resolve([CATEGORY_PROPAGATED]), expectedBlocker(PAD_KEYS));
  // Rate alone: the metadata names the category, that is not a category fact.
  assertEquals(resolve([RATE_PROPAGATED]), expectedBlocker(PAD_KEYS));
  // Unusable rates: `tariff_source.amount` in the metadata must NEVER rescue them.
  const unusable = [
    propagatedRate(0, "0"),
    propagatedRate(-9678, "-9678"),
    propagatedRate(null, "TO_CONFIRM"),
    propagatedRate(null, ""),
    propagatedRate(null, undefined), // metadata only, no scalar column
  ];
  for (const rate of unusable) {
    assertEquals(
      resolve([CATEGORY_PROPAGATED, rate]),
      expectedBlocker(PAD_KEYS),
      `propagated rate ${JSON.stringify(rate.value_number ?? rate.value_text ?? null)} must stay blocking`,
    );
  }
  // Blank category with propagation metadata: the `pad_category` field of the rate
  // metadata is not a substitute for the category fact.
  assertEquals(
    resolve([
      fact("cargo.pad_category", { value_text: "   ", value_json: { origin: "MAP-6" } }),
      RATE_PROPAGATED,
    ]),
    expectedBlocker(PAD_KEYS),
  );
});

// ── Fact readers: business value vs. genuinely JSON facts ───────────────────

Deno.test("readFactValue returns the business value, not the propagation metadata", () => {
  assertEquals(readFactValue([CATEGORY_PROPAGATED], "cargo.pad_category"), "T02");
  assertEquals(readFactValue([RATE_PROPAGATED], "cargo.pad_rate_fcfa_per_ton"), 9678);
  assertEquals(readFactValue([], "cargo.pad_category"), null);
  assertEquals(readFactValue([fact("cargo.pad_category")], "cargo.pad_category"), null);
});

Deno.test("readFactValue keeps genuinely JSON facts and the scalar precedence", () => {
  // No scalar column: the JSON value itself is still returned as-is.
  const overrides = { add: ["PORT_DAKAR_HANDLING"], remove: [] };
  assertEquals(
    readFactValue([fact("service.overrides", { value_json: overrides })], "service.overrides"),
    overrides,
  );
  assertEquals(
    readFactValue([fact("cargo.containers", { value_json: [{ type: "20DV", quantity: 1 }] })], "cargo.containers"),
    [{ type: "20DV", quantity: 1 }],
  );
  // Between scalars, the historical order value_json > value_number > value_text stands.
  assertEquals(
    readFactValue([fact("k", { value_json: "A", value_number: 2, value_text: "B" })], "k"),
    "A",
  );
  assertEquals(readFactValue([fact("k", { value_number: 2, value_text: "B" })], "k"), 2);
});

Deno.test("hasNonEmptyFactValue reads the textual business value only", () => {
  assertEquals(hasNonEmptyFactValue([CATEGORY_PROPAGATED], "cargo.pad_category"), true);
  assertEquals(hasNonEmptyFactValue([fact("k", { value_json: "T02" })], "k"), true);
  // A metadata object alone is not a category; a number is not a category either.
  assertEquals(hasNonEmptyFactValue([fact("k", { value_json: { origin: "MAP-6" } })], "k"), false);
  assertEquals(hasNonEmptyFactValue([fact("k", { value_number: 2, value_json: { a: 1 } })], "k"), false);
  assertEquals(hasNonEmptyFactValue([fact("k", { value_text: "  " })], "k"), false);
  assertEquals(hasNonEmptyFactValue([], "k"), false);
});

// ── PAD pricing inputs (buildPricingInputs) ─────────────────────────────────
//
// `run-pricing/buildPricingInputs` used the generic `value_json ?? value_number ??
// value_text` for EVERY fact, PAD keys included. On the P0-E runtime shapes that returned
// the MAP-7B / MAP-8B metadata object: padCategory became "[object Object]" and
// padRateFcfaPerTon NaN, so the enrichment guard
// `inputs.padCategory && inputs.padRateFcfaPerTon != null && inputs.padRateFcfaPerTon > 0`
// never fired and the run completed "success" without its PAD_DROIT_PASSAGE line.
// `readPadPricingInputs` is what that switch now delegates to.

/** The generic reader `buildPricingInputs` still applies to every NON-PAD fact. */
function genericValue(row: PadScopeFact): unknown {
  return row.value_json ?? row.value_number ?? row.value_text;
}

/** Facts whose value legitimately IS JSON — they must keep going through the generic read. */
const CONTAINERS = fact("cargo.containers", { value_json: [{ type: "40HC", quantity: 1 }] });
const OVERRIDES = fact("service.overrides", { value_json: { add: ["PAD_DROIT_PASSAGE"], remove: [] } });
const WEIGHT = fact("cargo.weight_kg", { value_number: 10000 });

Deno.test("MAP-7B/MAP-8B runtime shapes produce the T02 / 9678 pricing inputs", () => {
  assertEquals(readPadPricingInputs([CATEGORY_PROPAGATED, RATE_PROPAGATED]), {
    padCategory: "T02",
    padRateFcfaPerTon: 9678,
  });
  // Individually, on the exact rows the propagation writes.
  assertEquals(readPadCategory([CATEGORY_PROPAGATED]), "T02");
  assertEquals(readOfficialPadRate([RATE_PROPAGATED]), 9678);
  // value_text-only rate (value_number never materialised) is read the same way.
  assertEquals(readOfficialPadRate([propagatedRate(null, "9678")]), 9678);
  assertEquals(readPadCategory([fact("pricing.pad_category", {
    value_text: "T02",
    value_json: { origin: "MAP-6", operator_validated: true },
  })]), "T02");
});

Deno.test("the PAD line the fix restores: 10 t x 9678 = 96 780 FCFA", () => {
  const facts = [CATEGORY_PROPAGATED, RATE_PROPAGATED, WEIGHT, CONTAINERS, OVERRIDES];
  const inputs = readPadPricingInputs(facts);
  const weightTonnes = Number(genericValue(WEIGHT)) / 1000; // buildPricingInputs: kg → tonnes

  // The enrichment guard in run-pricing/index.ts, mirrored.
  const enriches = !!inputs.padCategory &&
    inputs.padRateFcfaPerTon != null &&
    inputs.padRateFcfaPerTon > 0 &&
    weightTonnes > 0;

  assertEquals(enriches, true);
  assertEquals(Math.round(inputs.padRateFcfaPerTon! * weightTonnes), 96780);
  assertEquals(`Droit de passage PAD ${inputs.padCategory}`, "Droit de passage PAD T02");

  // Regression witness: what the generic reader used to yield on the same two rows.
  assertEquals(String(genericValue(CATEGORY_PROPAGATED)), "[object Object]");
  assertEquals(Number.isNaN(Number(genericValue(RATE_PROPAGATED))), true);
});

Deno.test("non-PAD JSON facts are untouched by the PAD read", () => {
  const facts = [CATEGORY_PROPAGATED, RATE_PROPAGATED, CONTAINERS, OVERRIDES, WEIGHT];
  // Only the two PAD keys are claimed; nothing else leaks into the PAD inputs.
  assertEquals(Object.keys(readPadPricingInputs(facts)), ["padCategory", "padRateFcfaPerTon"]);
  // And the JSON facts still read as JSON, PAD facts present or not.
  assertEquals(readFactValue(facts, "cargo.containers"), [{ type: "40HC", quantity: 1 }]);
  assertEquals(readFactValue(facts, "service.overrides"), { add: ["PAD_DROIT_PASSAGE"], remove: [] });
  assertEquals(genericValue(CONTAINERS), [{ type: "40HC", quantity: 1 }]);
  assertEquals(genericValue(OVERRIDES), { add: ["PAD_DROIT_PASSAGE"], remove: [] });
  assertEquals(readPadPricingInputs([CONTAINERS, OVERRIDES, WEIGHT]), {});
});

Deno.test("fail-closed: unusable PAD values leave the pricing keys UNSET", () => {
  // Metadata object only, no scalar column beside it — on both keys.
  assertEquals(
    readPadPricingInputs([
      fact("cargo.pad_category", { value_json: { origin: "MAP-6", operator_validated: true } }),
      propagatedRate(null, undefined),
    ]),
    {},
  );
  // Rate values that must never become a tariff (incl. the metadata's tariff_source.amount).
  for (const rate of [
    propagatedRate(0, "0"),
    propagatedRate(-9678, "-9678"),
    propagatedRate(null, "TO_CONFIRM"),
    propagatedRate(null, ""),
    propagatedRate(Infinity, undefined),
    fact("cargo.pad_rate_fcfa_per_ton", {}),
  ]) {
    assertEquals(
      readPadPricingInputs([CATEGORY_PROPAGATED, rate]),
      { padCategory: "T02" },
      `rate ${JSON.stringify(rate.value_number ?? rate.value_text ?? null)} must stay unset`,
    );
  }
  // Blank / non-textual categories: unset, never "null" / "undefined" / "2" strings.
  for (const value of [{ value_text: "" }, { value_text: "   " }, { value_number: 2 }, {}]) {
    assertEquals(
      readPadPricingInputs([fact("cargo.pad_category", value), RATE_PROPAGATED]),
      { padRateFcfaPerTon: 9678 },
      `category ${JSON.stringify(value)} must stay unset`,
    );
  }
});

Deno.test("pricing inputs and the scope guard agree on every fixture", () => {
  const cases: Array<PadScopeFact[]> = [
    [CATEGORY_PROPAGATED, RATE_PROPAGATED],
    [CATEGORY_CARGO, RATE_POSITIVE],
    [CATEGORY_PRICING, RATE_POSITIVE],
    [CATEGORY_PROPAGATED],
    [RATE_PROPAGATED],
    [CATEGORY_PROPAGATED, propagatedRate(0, "0")],
    [fact("cargo.pad_category", { value_text: "  " }), RATE_PROPAGATED],
    [],
  ];
  for (const facts of cases) {
    const inputs = readPadPricingInputs(facts);
    const priceable = inputs.padCategory != null && inputs.padRateFcfaPerTon != null;
    assertEquals(
      resolve(facts) === null,
      priceable,
      `guard and pricing inputs disagree on ${JSON.stringify(facts.map((f) => f.fact_key))}`,
    );
  }
});

Deno.test("category precedence is cargo then pricing, and the value is trimmed", () => {
  assertEquals(
    readPadCategory([
      fact("cargo.pad_category", { value_text: " T02 " }),
      fact("pricing.pad_category", { value_text: "P05" }),
    ]),
    "T02",
  );
  // Blank cargo category falls through to the pricing gap key.
  assertEquals(
    readPadCategory([
      fact("cargo.pad_category", { value_text: "  ", value_json: { origin: "MAP-6" } }),
      fact("pricing.pad_category", { value_text: "P05" }),
    ]),
    "P05",
  );
  assertEquals(readPadCategory([]), null);
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
