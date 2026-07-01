// Tests Deno du moteur pur de propositions de frais maritimes (PATCH B1).
//
// Exécution (Vitest ne couvre PAS supabase/functions/** — include = src/** ;
// convention du repo = Deno test, comme _shared/pad/) :
//   deno test supabase/functions/_shared/maritime-fee-proposals/engine.test.ts
//
// Ce test ne modifie AUCUNE configuration globale.

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildMaritimeFeeProposals,
  classifyInvoiceLine,
  type MaritimeFeeProposal,
  type Parametrage,
} from "./engine.ts";

import parametrageJson from "./dcq_pad_parametrage.json" with { type: "json" };

const parametrage = parametrageJson as unknown as Parametrage;

function findPad(proposals: MaritimeFeeProposal[]): MaritimeFeeProposal | undefined {
  return proposals.find((p) => p.category === "taxe_de_port");
}

function findCommission(
  proposals: MaritimeFeeProposal[],
): MaritimeFeeProposal | undefined {
  return proposals.find((p) => p.category === "commission_debours");
}

// 1. JSON v2 parse correctement et contient la version attendue.
Deno.test("1 - JSON v2 parse + version attendue", () => {
  assertEquals(
    parametrage._meta.version,
    "2.0 (corroboration carriers intégrée)",
  );
  assertEquals(parametrage.conversions_devise.EUR_XOF, 655.957);
  assertEquals(parametrage.conversions_devise.USD_XOF, "VARIABLE");
});

// 2. PAD conteneur import T04, tonnage 322.
Deno.test("2 - PAD conteneur import T04 tonnage 322 = 988218", () => {
  const { proposals } = buildMaritimeFeeProposals(
    {
      operation_type: "IMPORT",
      cargo_mode: "CONTENEUR",
      pad_category: "T04",
      tonnage: 322,
    },
    parametrage,
  );
  const pad = findPad(proposals);
  assert(pad, "proposition taxe de port attendue");
  assertStringIncludes(pad!.suggested_formula ?? "", "import_conteneurs");
  assertStringIncludes(pad!.suggested_formula ?? "", "3069");
  assertEquals(pad!.suggested_amount_xof, 988218); // 3069 x 322
  assertEquals(pad!.amount, null);
  assertEquals(pad!.needs_human_confirmation, true);
});

// 3. RoRo / conventionnel import T09 -> import_conventionnel (2715), pas import_conteneurs (4367).
Deno.test("3 - RoRo/conventionnel import T09 utilise import_conventionnel", () => {
  const tonnage = 10;
  const { proposals } = buildMaritimeFeeProposals(
    {
      operation_type: "IMPORT",
      cargo_mode: "RORO",
      pad_category: "T09",
      tonnage,
    },
    parametrage,
  );
  const pad = findPad(proposals);
  assert(pad);
  assertStringIncludes(pad!.suggested_formula ?? "", "import_conventionnel");
  assertEquals(pad!.suggested_amount_xof, 2715 * tonnage); // = 27150
  // Ne doit PAS utiliser la colonne conteneurs (4367).
  assertNotEquals(pad!.suggested_amount_xof, 4367 * tonnage);
});

// 4. Export -> aucune proposition chiffrée.
Deno.test("4 - Export ne produit aucune proposition", () => {
  const { proposals, warnings } = buildMaritimeFeeProposals(
    {
      operation_type: "EXPORT",
      cargo_mode: "CONTENEUR",
      pad_category: "T04",
      tonnage: 322,
    },
    parametrage,
  );
  assertEquals(proposals.length, 0);
  assert(warnings.length > 0, "un warning exploitable est attendu");
});

// 5. Transit -> aucune proposition chiffrée.
Deno.test("5 - Transit ne produit aucune proposition", () => {
  const { proposals, warnings } = buildMaritimeFeeProposals(
    {
      operation_type: "TRANSIT",
      cargo_mode: "CONTENEUR",
      pad_category: "T04",
      tonnage: 322,
    },
    parametrage,
  );
  assertEquals(proposals.length, 0);
  assert(warnings.length > 0);
});

// 6. Catégorie absente -> suggested null + missing pad_category.
Deno.test("6 - Catégorie absente => suggested null + missing pad_category", () => {
  const { proposals } = buildMaritimeFeeProposals(
    { operation_type: "IMPORT", cargo_mode: "CONTENEUR", tonnage: 322 },
    parametrage,
  );
  const pad = findPad(proposals);
  assert(pad);
  assertEquals(pad!.suggested_amount_xof, null);
  assert(pad!.missing_confirmation.includes("pad_category"));
});

// 7. Tonnage absent -> suggested null + missing tonnage.
Deno.test("7 - Tonnage absent => suggested null + missing tonnage", () => {
  const { proposals } = buildMaritimeFeeProposals(
    { operation_type: "IMPORT", cargo_mode: "CONTENEUR", pad_category: "T04" },
    parametrage,
  );
  const pad = findPad(proposals);
  assert(pad);
  assertEquals(pad!.suggested_amount_xof, null);
  assert(pad!.missing_confirmation.includes("tonnage"));
});

// 8. Maersk "Frais Additionnel Import" -> taxe de port PAD.
Deno.test("8 - Maersk 'Frais Additionnel Import' = taxe_de_port", () => {
  const res = classifyInvoiceLine({
    label: "Frais Additionnel Import",
    carrier: "MAERSK",
    operation_type: "IMPORT",
  });
  assertEquals(res.feeType, "taxe_de_port");
});

// 9. MSC "HARBOUR TAX FEE" -> commission, pas PAD.
Deno.test("9 - MSC 'HARBOUR TAX FEE' = commission (pas PAD)", () => {
  const res = classifyInvoiceLine({
    label: "HARBOUR TAX FEE",
    carrier: "MSC",
    operation_type: "IMPORT",
  });
  assertEquals(res.feeType, "commission");
  assertNotEquals(res.feeType, "taxe_de_port");
});

// 10. ONE sans seafreight -> commission non chiffrée + missing seafreight.
Deno.test("10 - ONE sans seafreight => commission non chiffrée + missing seafreight", () => {
  const { proposals } = buildMaritimeFeeProposals(
    {
      operation_type: "IMPORT",
      cargo_mode: "CONTENEUR",
      carrier: "ONE",
      pad_category: "T04",
      tonnage: 322,
      // pas de seafreight
    },
    parametrage,
  );
  const commission = findCommission(proposals);
  assert(commission, "proposition commission ONE attendue");
  assertEquals(commission!.suggested_amount_xof, null);
  assert(commission!.missing_confirmation.includes("seafreight"));
});

// 11. Hapag-Lloyd sans seafreight -> commission non chiffrée + missing seafreight.
Deno.test("11 - Hapag sans seafreight => commission non chiffrée + missing seafreight", () => {
  const { proposals } = buildMaritimeFeeProposals(
    {
      operation_type: "IMPORT",
      cargo_mode: "CONTENEUR",
      carrier: "Hapag-Lloyd",
      pad_category: "T04",
      tonnage: 322,
    },
    parametrage,
  );
  const commission = findCommission(proposals);
  assert(commission, "proposition commission Hapag attendue");
  assertEquals(commission!.suggested_amount_xof, null);
  assert(commission!.missing_confirmation.includes("seafreight"));
});

// 12. Hapag THO en import -> ignoré (hors scope import).
Deno.test("12 - Hapag THO en import => ignoré", () => {
  const res = classifyInvoiceLine({
    label: "Port Dues THO",
    carrier: "Hapag-Lloyd",
    operation_type: "IMPORT",
  });
  assertEquals(res.feeType, "ignored");
});

// 13. Tous les résultats ont amount:null.
Deno.test("13 - Toutes les propositions ont amount:null", () => {
  const scenarios = [
    {
      operation_type: "IMPORT",
      cargo_mode: "CONTENEUR",
      carrier: "CMA CGM",
      pad_category: "T04",
      tonnage: 322,
    },
    {
      operation_type: "IMPORT",
      cargo_mode: "CONTENEUR",
      carrier: "MSC",
      pad_category: "T02",
      tonnage: 6,
    },
    {
      operation_type: "IMPORT",
      cargo_mode: "RORO",
      carrier: "GRIMALDI",
      pad_category: "T09",
      tonnage: 12,
    },
    {
      operation_type: "IMPORT",
      cargo_mode: "CONTENEUR",
      carrier: "Hapag-Lloyd",
      pad_category: "T12",
      tonnage: 5,
      seafreight: { value: 1000, currency: "EUR" },
    },
  ];
  for (const input of scenarios) {
    const { proposals } = buildMaritimeFeeProposals(input, parametrage);
    assert(proposals.length > 0, "propositions attendues en IMPORT");
    for (const p of proposals) {
      assertEquals(p.amount, null);
      assertEquals(p.currency, "XOF");
      assertEquals(p.needs_human_confirmation, true);
    }
  }
});

// ---------------------------------------------------------------------------
// PATCH B1.1 — corrections CTO
// ---------------------------------------------------------------------------

// 14. Tonnage 0 => suggested null + missing tonnage (aucun calcul avec 0).
Deno.test("14 - Tonnage 0 => suggested null + missing tonnage", () => {
  const { proposals } = buildMaritimeFeeProposals(
    {
      operation_type: "IMPORT",
      cargo_mode: "CONTENEUR",
      pad_category: "T04",
      tonnage: 0,
    },
    parametrage,
  );
  const pad = findPad(proposals);
  assert(pad);
  assertEquals(pad!.suggested_amount_xof, null);
  assert(pad!.missing_confirmation.includes("tonnage"));
});

// 15. Tonnage négatif => suggested null + missing tonnage.
Deno.test("15 - Tonnage -10 => suggested null + missing tonnage", () => {
  const { proposals } = buildMaritimeFeeProposals(
    {
      operation_type: "IMPORT",
      cargo_mode: "CONTENEUR",
      pad_category: "T04",
      tonnage: -10,
    },
    parametrage,
  );
  const pad = findPad(proposals);
  assert(pad);
  assertEquals(pad!.suggested_amount_xof, null);
  assert(pad!.missing_confirmation.includes("tonnage"));
});

// 16. "Frais Additionnel Import" chez MSC => PAS taxe_de_port.
Deno.test("16 - MSC 'Frais Additionnel Import' n'est pas taxe_de_port", () => {
  const res = classifyInvoiceLine({
    label: "Frais Additionnel Import",
    carrier: "MSC",
    operation_type: "IMPORT",
  });
  assertNotEquals(res.feeType, "taxe_de_port");
  assertEquals(res.feeType, "unknown");
});

// 17. Hapag seafreight EUR 0 => commission suggested null + missing seafreight.
Deno.test("17 - Hapag seafreight EUR 0 => commission null + missing seafreight", () => {
  const { proposals } = buildMaritimeFeeProposals(
    {
      operation_type: "IMPORT",
      cargo_mode: "CONTENEUR",
      carrier: "Hapag-Lloyd",
      pad_category: "T04",
      tonnage: 322,
      seafreight: { value: 0, currency: "EUR" },
    },
    parametrage,
  );
  const commission = findCommission(proposals);
  assert(commission);
  assertEquals(commission!.suggested_amount_xof, null);
  assert(commission!.missing_confirmation.includes("seafreight"));
});

// 18. Hapag seafreight EUR -100 => commission suggested null + missing seafreight.
Deno.test("18 - Hapag seafreight EUR -100 => commission null + missing seafreight", () => {
  const { proposals } = buildMaritimeFeeProposals(
    {
      operation_type: "IMPORT",
      cargo_mode: "CONTENEUR",
      carrier: "Hapag-Lloyd",
      pad_category: "T04",
      tonnage: 322,
      seafreight: { value: -100, currency: "EUR" },
    },
    parametrage,
  );
  const commission = findCommission(proposals);
  assert(commission);
  assertEquals(commission!.suggested_amount_xof, null);
  assert(commission!.missing_confirmation.includes("seafreight"));
});

// 19. ONE seafreight USD sans usdToXofRate => missing usd_exchange_rate.
Deno.test("19 - ONE seafreight USD sans taux => missing usd_exchange_rate", () => {
  const { proposals } = buildMaritimeFeeProposals(
    {
      operation_type: "IMPORT",
      cargo_mode: "CONTENEUR",
      carrier: "ONE",
      pad_category: "T04",
      tonnage: 322,
      seafreight: { value: 1000, currency: "USD" },
      // pas de usdToXofRate
    },
    parametrage,
  );
  const commission = findCommission(proposals);
  assert(commission);
  assertEquals(commission!.suggested_amount_xof, null);
  assert(commission!.missing_confirmation.includes("usd_exchange_rate"));
});

// 20. ONE seafreight USD avec usdToXofRate explicite => suggested calculé.
Deno.test("20 - ONE seafreight USD avec taux explicite => suggested calculé", () => {
  const { proposals } = buildMaritimeFeeProposals(
    {
      operation_type: "IMPORT",
      cargo_mode: "CONTENEUR",
      carrier: "ONE",
      pad_category: "T04",
      tonnage: 322,
      seafreight: { value: 1000, currency: "USD" },
      usdToXofRate: 600,
    },
    parametrage,
  );
  const commission = findCommission(proposals);
  assert(commission);
  // base = taxe_de_port (3069 x 322 = 988218) + seafreight (1000 x 600 = 600000)
  //      = 1588218 ; commission = round(0.028 x 1588218) = 44470
  assertEquals(commission!.suggested_amount_xof, 44470);
  assert(!commission!.missing_confirmation.includes("usd_exchange_rate"));
  assert(!commission!.missing_confirmation.includes("seafreight"));
  assertEquals(commission!.amount, null);
});
