import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validWeightBasis, weightBasisNotice, quotationWeightNotices } from "./quotation-weight-basis.ts";
import { resolveSnapshotQualification } from "../generate-quotation-version/qqm-resolver.ts";
const decision = { weight_basis: "provisional" as const, weight_reservation: "15 tonnes par conteneur ; révision après documents définitifs." };
const lines = [{ quantity: 45, source: { ...decision, unit_ref: "spares" } }];
Deno.test("legacy exact basis stays exact; provisional requires a meaningful reserve", () => {
  assertEquals(validWeightBasis({}), true);
  assertEquals(validWeightBasis(decision), true);
  assertEquals(validWeightBasis({ weight_basis: "provisional" }), false);
  assertEquals(validWeightBasis({ weight_basis: "confirmed", weight_reservation: "uncertain" }), false);
  assertEquals(validWeightBasis({ ...decision, weight_reservation: "x".repeat(2001) }), false);
  assertEquals(weightBasisNotice("a", 1000, {}), null);
});
Deno.test("snapshot reserve is derived from immutable lines, not a mutable decision", () => {
  const copy = structuredClone(lines);
  assertEquals(quotationWeightNotices(copy), ["Groupe spares : base de cotation 45 tonnes, poids non définitif. " + decision.weight_reservation]);
  assertEquals(copy, lines);
  assertThrows(() => quotationWeightNotices([{ quantity: 45, source: { weight_basis: "provisional", unit_ref: "a" } }]));
});
Deno.test("provisional weight cannot become firm in quotation; partial scope remains partial", () => {
  for (const incoming of [undefined, { level: "firm", reasons: [] }, { level: "provisional", reasons: [] }]) {
    const q = resolveSnapshotQualification(incoming, lines);
    assertEquals(q.level, "provisional"); assertEquals(q.reasons[0].code, "PROVISIONAL_WEIGHT_BASIS");
  }
  assertEquals(resolveSnapshotQualification({ level: "partial", reasons: [] }, lines).level, "partial");
});
Deno.test("unit basis is explicit and checked, never reconstructed from a group total", () => {
  const unit = { ...decision, weight_container_count: 3, weight_per_container_kg: 15000 };
  assertEquals(weightBasisNotice("spares", 45000, unit)?.includes("3 conteneurs × 15 tonnes/conteneur = 45 tonnes"), true);
  assertThrows(() => weightBasisNotice("spares", 44000, unit));
  assertEquals(weightBasisNotice("spares", 45000, decision)?.includes("conteneurs ×"), false);
});
