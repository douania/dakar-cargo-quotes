import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { storageRateEstimate, estimateStorageByTonne } from "./storage-rate-estimate.ts";
Deno.test("storage policy: first tier only x1.111, rounded FCFA; two observed codes not blanket official", () => {
  const expected = { "410": 156, "411": 176, "412": 197, "413": 239, "414": 394, "415": 518, "416": 634, "417": 982, "418": 1551, "419": 1964, "420": 2193, "421": 3953 };
  for (const [code, p1] of Object.entries(expected)) {
    const r = storageRateEstimate(code, "DPW")!;
    assertEquals(r.p1, p1); assertEquals(r.firm_eligible, false);
    assertEquals(r.evidence, ["412", "419"].includes(code) ? "observed_invoice" : "estimated_unproven");
  }
  assertEquals(storageRateEstimate("419", "DPW")!.observed_for_provider, false);
  assertEquals(storageRateEstimate("419", "TOM")!.observed_for_provider, true);
  assertEquals(storageRateEstimate("412", "DPW")!.p2, 294);
  assertEquals(storageRateEstimate("419", "TOM")!.p3, 3708);
  for (const code of ["519", "619", "999", " 412", "412.0"]) assertEquals(storageRateEstimate(code, "DPW"), null);
});
Deno.test("storage policy: inclusive 15/15/open periods, fractional tonnes preserved", () => {
  for (const [days, expected] of [[10, 0], [11, 1970], [25, 29550], [26, 32490], [40, 73650], [41, 77590]])
    assertEquals(estimateStorageByTonne("412", "DPW", 10000, days, 10).amount, expected);
  assertEquals(estimateStorageByTonne("419", "TOM", 10020, 25, 10).amount, Math.round(10.02 * 15 * 1964));
  assert(estimateStorageByTonne("414", "DPW", 10000, 12, 10).reason.includes("à corroborer"));
});
Deno.test("storage policy: unsupported units and invalid weights/days refuse, never zero", () => {
  for (const code of ["420", "421", "999"]) assertEquals(estimateStorageByTonne(code, "DPW", 10000, 12, 10).amount, null);
  for (const kg of [NaN, Infinity, 0, -1, 1e15]) assertEquals(estimateStorageByTonne("412", "DPW", kg, 12, 10).amount, null);
  for (const days of [0, -1, 1.5, 4000]) assertEquals(estimateStorageByTonne("412", "DPW", 10000, days, 10).amount, null);
});
