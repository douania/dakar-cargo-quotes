/**
 * Pure regression test for carrier port-charge double-counting guard.
 *
 * The helper is mirrored from quotation-engine/index.ts instead of imported,
 * because importing the Edge Function would trigger Deno.serve side effects.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

function normalizeCarrierPortChargeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function containsTokenAwarePhrase(text: string, phrase: string): boolean {
  const phraseTokens = phrase.match(/[A-Z0-9]+/g);

  if (!phraseTokens?.length) {
    return false;
  }

  const escapedTokens = phraseTokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(^|[^A-Z0-9])${escapedTokens.join("[^A-Z0-9]+")}(?=$|[^A-Z0-9])`);

  return pattern.test(text);
}

function isAmbiguousCarrierPortCharge(charge: any): boolean {
  const code = normalizeCarrierPortChargeText(charge?.charge_code);
  const name = normalizeCarrierPortChargeText(charge?.charge_name);
  const notes = normalizeCarrierPortChargeText(charge?.notes);
  const labelText = `${name} ${notes}`;

  if ([
    "TXI",
    "XPV_20",
    "XPV_40",
    "PSX_20",
    "PSX_40",
    "PCD",
    "PORT_TAX",
    "PORT_DUES",
    "PORT_CHARGES",
  ].includes(code)) {
    return true;
  }

  const ambiguousPortLabels = [
    "PORT TAX",
    "PORT DUES",
    "PORT CHARGES",
    "TAX IMPORT",
    "TAXE PORT",
    "TAXES PORT",
    "TAXE DE PORT",
    "DROIT PASSAGE",
    "DROITS DE PASSAGE",
    "TAXE PORTUAIRE",
    "TAXES PORTUAIRES",
    "REDEVANCE PORTUAIRE",
    "REDEVANCES PORTUAIRES",
    "PAD_DROIT_PASSAGE",
  ];

  if (ambiguousPortLabels.some((label) => containsTokenAwarePhrase(name, label))) {
    return true;
  }

  return code === "COLL" && ambiguousPortLabels.some((label) => containsTokenAwarePhrase(labelText, label));
}

Deno.test("carrier port charge guard: token-aware matching", () => {
  const cases = [
    {
      label: "TXI",
      charge: { charge_code: "TXI", charge_name: "Carrier service", notes: "" },
      expected: true,
    },
    {
      label: "XPV_20",
      charge: { charge_code: "XPV_20", charge_name: "Carrier service", notes: "" },
      expected: true,
    },
    {
      label: "PSX_40",
      charge: { charge_code: "PSX_40", charge_name: "Carrier service", notes: "" },
      expected: true,
    },
    {
      label: "PCD",
      charge: { charge_code: "PCD", charge_name: "Carrier service", notes: "" },
      expected: true,
    },
    {
      label: "PORT CHARGES DESTINATION",
      charge: { charge_code: "OTHER", charge_name: "PORT CHARGES DESTINATION", notes: "" },
      expected: true,
    },
    {
      label: "TAXE DE PORT (T12)_IMPORT",
      charge: { charge_code: "OTHER", charge_name: "TAXE DE PORT (T12)_IMPORT", notes: "" },
      expected: true,
    },
    {
      label: "IMPORT CHARGES",
      charge: { charge_code: "OTHER", charge_name: "IMPORT CHARGES", notes: "" },
      expected: false,
    },
    {
      label: "TRANSPORT CHARGES",
      charge: { charge_code: "OTHER", charge_name: "TRANSPORT CHARGES", notes: "" },
      expected: false,
    },
    {
      label: "DEMURRAGE IMPORT CHARGES FOR EQUIPMENT",
      charge: { charge_code: "OTHER", charge_name: "DEMURRAGE IMPORT CHARGES FOR EQUIPMENT", notes: "" },
      expected: false,
    },
    {
      label: "ISPS Fee",
      charge: { charge_code: "ISPS", charge_name: "ISPS Fee", notes: "" },
      expected: false,
    },
    {
      label: "Collection Fees with taxes port notes",
      charge: { charge_code: "COLL", charge_name: "Collection Fees", notes: "commission sur fret et taxes port" },
      expected: true,
    },
  ];

  for (const testCase of cases) {
    assertEquals(
      isAmbiguousCarrierPortCharge(testCase.charge),
      testCase.expected,
      `${testCase.label} should be ${testCase.expected}`,
    );
  }
});
