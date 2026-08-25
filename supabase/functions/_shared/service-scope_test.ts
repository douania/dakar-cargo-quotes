import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  readOverridesFromFacts,
  resolveEffectiveServiceKeys,
  resolveExplicitlyRemovedServiceKeys,
  SERVICE_PACKAGES,
  type ServiceOverrides,
} from "./service-scope.ts";

/**
 * SCOPE-REMOVE — direct tests for `resolveExplicitlyRemovedServiceKeys`.
 *
 * The helper is the single source of the "explicitly removed" set used by
 * run-pricing to drop engine structural lines. Doctrine pinned here:
 * - add wins: a key in BOTH `add` and `remove` is NOT removed (exact complement
 *   of `resolveEffectiveServiceKeys`);
 * - removed ∩ effective = ∅ for EVERY package, so the P5 enrichment (bounded by
 *   the effective scope) can never re-add a dropped service;
 * - malformed shapes resolve to an empty set (strict downstream no-op).
 */

const INCIDENT_OVERRIDES: ServiceOverrides = {
  add: [],
  remove: ["PORT_DAKAR_HANDLING", "TRUCKING", "EMPTY_RETURN", "CUSTOMS_DAKAR"],
};

Deno.test("SCOPE-REMOVE: remove \\ add — plain removal set", () => {
  const removed = resolveExplicitlyRemovedServiceKeys(INCIDENT_OVERRIDES);
  assertEquals(
    [...removed].sort(),
    ["CUSTOMS_DAKAR", "EMPTY_RETURN", "PORT_DAKAR_HANDLING", "TRUCKING"],
  );
});

Deno.test("SCOPE-REMOVE: add wins — a key in both add and remove is not removed", () => {
  const removed = resolveExplicitlyRemovedServiceKeys({
    add: ["TRUCKING"],
    remove: ["TRUCKING", "CUSTOMS_DAKAR"],
  });
  assertEquals([...removed], ["CUSTOMS_DAKAR"]);

  const fullyContradicted = resolveExplicitlyRemovedServiceKeys({
    add: ["TRUCKING"],
    remove: ["TRUCKING"],
  });
  assertEquals(fullyContradicted.size, 0);
});

Deno.test("SCOPE-REMOVE: empty overrides → empty set", () => {
  assertEquals(resolveExplicitlyRemovedServiceKeys({ add: [], remove: [] }).size, 0);
});

Deno.test("SCOPE-REMOVE: malformed shapes are a strict no-op (fail-closed)", () => {
  assertEquals(resolveExplicitlyRemovedServiceKeys(null).size, 0);
  assertEquals(resolveExplicitlyRemovedServiceKeys(undefined).size, 0);
  assertEquals(
    resolveExplicitlyRemovedServiceKeys({ add: "TRUCKING", remove: "CUSTOMS_DAKAR" } as unknown as ServiceOverrides).size,
    0,
  );
  assertEquals(
    resolveExplicitlyRemovedServiceKeys({} as unknown as ServiceOverrides).size,
    0,
  );
  // A SINGLE malformed side poisons the whole resolution: with `add` unreadable
  // the add-wins protection cannot be evaluated, so nothing may be removed.
  assertEquals(
    resolveExplicitlyRemovedServiceKeys(
      { add: "TRUCKING", remove: ["CUSTOMS_DAKAR"] } as unknown as ServiceOverrides,
    ).size,
    0,
  );
  assertEquals(
    resolveExplicitlyRemovedServiceKeys(
      { add: [], remove: "CUSTOMS_DAKAR" } as unknown as ServiceOverrides,
    ).size,
    0,
  );
  // Non-string entries are ignored, string entries survive.
  assertEquals(
    [...resolveExplicitlyRemovedServiceKeys({
      add: [],
      remove: ["TRUCKING", 42, null, ""] as unknown as string[],
    })],
    ["TRUCKING"],
  );
});

Deno.test("SCOPE-REMOVE: removed ∩ effective = ∅ for every package", () => {
  const cases: ServiceOverrides[] = [
    INCIDENT_OVERRIDES,
    { add: ["TRUCKING"], remove: ["TRUCKING", "CUSTOMS_DAKAR"] },
    { add: ["DTHC", "AGENCY"], remove: ["DTHC", "EMPTY_RETURN"] },
  ];
  for (const overrides of cases) {
    const removed = resolveExplicitlyRemovedServiceKeys(overrides);
    for (const packageKey of Object.keys(SERVICE_PACKAGES)) {
      const effective = resolveEffectiveServiceKeys(packageKey, overrides);
      for (const key of effective) {
        assert(
          !removed.has(key),
          `${packageKey}: '${key}' is both effective and removed`,
        );
      }
    }
  }
});

Deno.test("SCOPE-REMOVE: chained with readOverridesFromFacts (incident fact + garbage)", () => {
  const removed = resolveExplicitlyRemovedServiceKeys(readOverridesFromFacts([
    { fact_key: "service.overrides", value_json: INCIDENT_OVERRIDES },
  ]));
  assertEquals(
    [...removed].sort(),
    ["CUSTOMS_DAKAR", "EMPTY_RETURN", "PORT_DAKAR_HANDLING", "TRUCKING"],
  );

  const fromGarbage = resolveExplicitlyRemovedServiceKeys(readOverridesFromFacts([
    { fact_key: "service.overrides", value_text: "{pas du json" },
  ]));
  assertEquals(fromGarbage.size, 0);

  // Unknown keys are sanitized away upstream: they never reach the removal set.
  const fromUnknown = resolveExplicitlyRemovedServiceKeys(readOverridesFromFacts([
    { fact_key: "service.overrides", value_json: { add: [], remove: ["SERVICE_INCONNU", "TRUCKING"] } },
  ]));
  assertEquals([...fromUnknown], ["TRUCKING"]);
});
