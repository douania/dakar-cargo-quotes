import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { storageStayInformation, demurrageStayInformation, readStayInformation, stayInformationText } from "./stay-information.ts";
import type { StayGroup } from "./container-stay-estimate.ts";
const group: StayGroup = { unit_ref: "synthetic", equipment_code: "40HQ", quantity: 3, ownership: "COC", provider: "DPW", storage_p1_code: "412", storage_days: null, demurrage_days: 8 };
const tiers = [{ day_from: 11, day_to: 20, rate_per_day: "38050", currency: "XOF", evidence_level: "official", source_document: "Synthetic A" },
  { day_from: 21, day_to: null, rate_per_day: "45920", currency: "XOF", evidence_level: "official", source_document: "Synthetic B" }];
Deno.test("stay information: complete storage periods and cargo example independent of selected duration", () => {
  const before = JSON.stringify(group);
  const info = storageStayInformation(group, 30000, true, "Durée magasinage absente.");
  assertEquals(info.free_days, 10);
  assertEquals(info.tiers.map(t => [t.from, t.to, t.rate]), [[11, 25, 197], [26, 40, 294], [41, null, 394]]);
  assertEquals(info.example?.amount, 11820);
  assertEquals(info.example?.days, 12);
  assert(stayInformationText(info).includes("Non ajouté au total"));
  assert(stayInformationText(info).includes("P2/P3 historiques"));
  assertEquals(JSON.stringify(group), before);
});
Deno.test("stay information: unqualified franchise never gets day 11 or an example", () => {
  const info = storageStayInformation(group, 30000, false, "IMO non qualifié");
  assertEquals(info.free_days, null); assertEquals(info.example, null);
  assertEquals(info.tiers.map(t => [t.from, t.to, t.relative]), [[1, 15, true], [16, 30, true], [31, null, true]]);
  assert(stayInformationText(info).includes("après franchise"));
  assertEquals(storageStayInformation(null, 30000, false, "Pas d’hypothèse").tiers, []);
  for (const code of ["420", "421", "999"]) assertEquals(storageStayInformation({ ...group, storage_p1_code: code }, 30000, true, "").tiers, []);
  for (const kg of [NaN, 0, -1, 1e13]) assertEquals(storageStayInformation(group, kg, true, "").example, null);
});
Deno.test("stay information: observed elsewhere is not proof for DPW", () => {
  const info = storageStayInformation({ ...group, storage_p1_code: "419" }, 1000, true, "");
  assert(info.reservations.some(r => r.includes("autre opérateur")));
});
Deno.test("stay information: armateur rates stay in native currency and show full schedule", () => {
  const before = JSON.stringify(tiers);
  const info = demurrageStayInformation(tiers, 10, 3, true, "Durée à confirmer");
  assertEquals(info.example?.amount, 228300);
  assertEquals(info.tiers.map(t => [t.from, t.to]), [[11, 20], [21, null]]);
  const eur = demurrageStayInformation(tiers.map(t => ({ ...t, currency: "EUR", rate_per_day: "27.5" })), 10, 3, true, "");
  assertEquals(eur.example?.currency, "EUR"); assertEquals(eur.example?.amount, 165);
  const decimal = demurrageStayInformation(tiers.map(t => ({ ...t, currency: "EUR", rate_per_day: "10.25" })), 10, 1, true, "");
  assertEquals(decimal.example?.amount, 20.5);
  assert(eur.reservations.some(r => r.includes("aucune conversion")));
  assertEquals(JSON.stringify(tiers), before);
});
Deno.test("stay information: no example for unqualified scope; no invalid/ambiguous/unproven tiers", () => {
  const unqualified = demurrageStayInformation(tiers, 10, 3, false, "Validité expirée");
  assertEquals(unqualified.example, null); assert(unqualified.franchise_note.includes("non confirmée"));
  for (const invalid of [[], [tiers[0]], [tiers[0], { ...tiers[1], day_from: 19 }], [tiers[0], { ...tiers[1], currency: "EUR" }], tiers.map(t => ({ ...t, evidence_level: "observed" })), tiers.map(t => ({ ...t, source_document: "" }))]) {
    const info = demurrageStayInformation(invalid, 10, 3, true, "");
    assertEquals(info.tiers, []); assertEquals(info.example, null); assertEquals(info.free_days, null);
  }
});
Deno.test("stay information: rejects malformed persisted metadata for display", () => {
  const info = storageStayInformation(group, 1000, true, "");
  assertEquals(readStayInformation(info), info);
  for (const bad of [null, [], {}, { ...info, example: undefined }, { ...info, sources: [1] }, { ...info, tiers: [null] }]) assertEquals(readStayInformation(bad), null);
});
