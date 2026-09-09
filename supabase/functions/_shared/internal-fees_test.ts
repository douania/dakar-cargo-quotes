import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  INTERNAL_FEE_BLOC,
  INTERNAL_FEE_SERVICE_KEYS,
  isInternalFeeServiceKey,
  sumFirmInternalFeePackageLines,
} from "./internal-fees.ts";

Deno.test("HONORAIRES-1: exactly the two CTO keys are internal fees", () => {
  assertEquals([...INTERNAL_FEE_SERVICE_KEYS].sort(), ["AGENCY", "CUSTOMS_DAKAR"]);
  assertEquals(INTERNAL_FEE_BLOC, "honoraires");
  assertEquals(isInternalFeeServiceKey("AGENCY"), true);
  assertEquals(isInternalFeeServiceKey(" customs_dakar "), true);
  for (const key of ["CUSTOMS_EXPORT", "DTHC", "TRUCKING", "", null, undefined, 42]) {
    assertEquals(isInternalFeeServiceKey(key), false, String(key));
  }
});

const pkg = (service_key: string, amount: unknown, type = "rate_card") => ({
  amount,
  source: { type },
  canonical: { origin_layer: "package_enrichment", service_key },
});

Deno.test("HONORAIRES-1: firm package internal fees are summed, nothing else", () => {
  const lines = [
    pkg("AGENCY", 200_000),
    pkg("CUSTOMS_DAKAR", 350_000, "rate_card+modifiers"),
    pkg("EMPTY_RETURN", 0, "business_rule"),
    pkg("TRUCKING", 6_254_000, "local_transport_rate"),
    // Moteur : déjà compté dans totals.honoraires, jamais ici.
    { amount: 75_000, source: { type: "CALCULATED" }, canonical: { origin_layer: "engine_structural", service_key: "CUSTOMS_DAKAR" } },
    // À confirmer, nul, négatif, non numérique : ignorés.
    pkg("AGENCY", 999_999, "TO_CONFIRM"),
    pkg("AGENCY", null),
    pkg("CUSTOMS_DAKAR", -1),
    pkg("CUSTOMS_DAKAR", "abc"),
    { amount: 10, source: { type: "rate_card" }, canonical: null },
  ];
  assertEquals(sumFirmInternalFeePackageLines(lines), 550_000);
  assertEquals(sumFirmInternalFeePackageLines([]), 0);
  assertEquals(sumFirmInternalFeePackageLines(null), 0);
  assertEquals(sumFirmInternalFeePackageLines(undefined), 0);
});
