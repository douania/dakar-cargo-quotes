import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveCommercialTotalPresentation } from "./commercial-total-presentation.ts";

Deno.test("detailed totals keep supplier-TTC debours outside the SODATRA VAT label", () => {
  const result = resolveCommercialTotalPresentation({
    total_ht: 432600,
    total_ttc: 450600,
    subtotal_before_sodatra_vat: 432600,
    honoraires_tva: 18000,
    total_payable: 450600,
    currency: "XOF",
  });

  assertEquals(result, {
    isDetailed: true,
    subtotalBeforeSodatraVat: 432600,
    honorairesVat: 18000,
    totalPayable: 450600,
    currency: "XOF",
  });
});

Deno.test("legacy snapshots retain their historical total fields", () => {
  const result = resolveCommercialTotalPresentation({
    total_ht: 250000,
    total_ttc: 295000,
    currency: "FCFA",
  });

  assertEquals(result, {
    isDetailed: false,
    subtotalBeforeSodatraVat: 250000,
    honorairesVat: null,
    totalPayable: 295000,
    currency: "FCFA",
  });
});
