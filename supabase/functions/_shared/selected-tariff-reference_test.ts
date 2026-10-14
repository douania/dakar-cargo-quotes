import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { partialServiceSource, selectedTariffReference, tariffReferenceNotice } from "./selected-tariff-reference.ts";
import { resolveSnapshotQualification } from "../generate-quotation-version/qqm-resolver.ts";
import { classifyClientLine, quotationRoute } from "./client-quote-projection.ts";

Deno.test("selected reference freezes the exact row and excludes unrelated fields", () => {
  const rule = { id: "synthetic-selected", label: "Forfait provisoire", amount: 123, method: "FIXED", currency: "XOF", source_reference: "SYNTHETIC evidence", unrelated: "never captured" };
  const ref = selectedTariffReference("fee_rules", rule, "2026-01-01T00:00:00Z");
  rule.id = "later-rule"; rule.amount = 999;
  assertEquals(ref.id, "synthetic-selected"); assertEquals(ref.snapshot.amount, 123);
  assertEquals(ref.snapshot.unrelated, undefined); assertEquals(ref.validation_status, "provisional");
  const source = partialServiceSource({ source: "fee_rule", confidence: .95, tariff_reference: ref }, "fee_rule");
  assertEquals(source.reference, "fee_rules/synthetic-selected"); assertEquals(source.tariff_reference, ref);
});
for (const label of ["PROVISIONAL", "Forfait provisoire", "Provision provisoire"]) Deno.test(`explicit provisional wording stays non-firm: ${label}`, () => {
  const ref = selectedTariffReference("fee_rules", { id: "fixture", label, amount: 123, is_active: true, confidence: 1 }, "2026-01-01T00:00:00Z");
  const line = { amount: 123, source: { tariff_reference: ref } };
  assertEquals(classifyClientLine(line, {}).status, "estimated");
  assertEquals(resolveSnapshotQualification({ level: "firm" }, [line]).level, "provisional");
  assertEquals(resolveSnapshotQualification({ level: "partial" }, [line]).level, "partial");
});
Deno.test("active rule without contractual evidence stays unverified, including confidence 1", () => {
  const ref = selectedTariffReference("pricing_service_catalogue", { id: "fixture", active: true, confidence: 1 }, "2026-01-01T00:00:00Z");
  assertEquals(ref.validation_status, "unverified");
  assertEquals(tariffReferenceNotice({ tariff_reference: ref }), "Tarif non validé, compris dans le total, non ferme");
});
Deno.test("missing selected identity is refused, and old source objects keep their old classification", () => {
  assertThrows(() => selectedTariffReference("fee_rules", { amount: 123 }, "2026-01-01T00:00:00Z"), Error, "SELECTED_TARIFF_REFERENCE_MISSING");
  assertEquals(classifyClientLine({ amount: 123, source: { type: "fee_rule", reference: "P5" } }, {}).status, "unqualified");
  assertEquals(resolveSnapshotQualification({ level: "firm" }, [{ amount: 123, source: { type: "fee_rule" } }]).level, "firm");
});
Deno.test("route uses recorded stops only and removes adjacent duplicate names", () => {
  assertEquals(quotationRoute({ origin: "Karachi", destination: "Dakar" }), ["Karachi", "Dakar"]);
  assertEquals(quotationRoute({ origin: " Dakar ", destination: "DAKAR" }), ["Dakar"]);
  assertEquals(quotationRoute({ origin: "Karachi" }), ["Karachi"]);
});
