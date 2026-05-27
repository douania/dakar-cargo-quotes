/**
 * Micro-regression test for carrier port-charge double-counting guard.
 *
 * The helper is intentionally mirrored from quotation-engine/index.ts instead
 * of imported, because importing the Edge Function would trigger Deno.serve
 * side effects. This test locks the CTO doctrine for ambiguous carrier labels;
 * it does not test runtime wiring/exportability.
 *
 * Run:
 *   deno test supabase/functions/_tests/ambiguous_carrier_port_charge.test.ts
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

  if (ambiguousPortLabels.some((label) => name.includes(label))) {
    return true;
  }

  return code === "COLL" && ambiguousPortLabels.some((label) => labelText.includes(label));
}

Deno.test("ambiguous carrier port charge: blocks exact dangerous codes", () => {
  const blockedCodes = [
    "TXI",
    "XPV_20",
    "XPV_40",
    "PSX_20",
    "PSX_40",
    "PCD",
    "PORT_TAX",
    "PORT_DUES",
    "PORT_CHARGES",
  ];

  for (const chargeCode of blockedCodes) {
    assertEquals(
      isAmbiguousCarrierPortCharge({
        charge_code: chargeCode,
        charge_name: "Carrier service",
        notes: "No port wording",
      }),
      true,
      `${chargeCode} should be blocked`,
    );
  }
});

Deno.test("ambiguous carrier port charge: blocks clear port/tax labels in charge_name", () => {
  const blockedNames = [
    "Port Tax",
    "Port Dues",
    "Port Charges",
    "Tax Import",
    "Taxe de port",
    "Droits de passage",
    "Taxe portuaire",
    "Taxes portuaires",
    "Redevance portuaire",
    "Redevances portuaires",
  ];

  for (const chargeName of blockedNames) {
    assertEquals(
      isAmbiguousCarrierPortCharge({
        charge_code: "OTHER",
        charge_name: chargeName,
        notes: "",
      }),
      true,
      `${chargeName} should be blocked`,
    );
  }
});

Deno.test("ambiguous carrier port charge: blocks COLL only with port/tax wording", () => {
  const collPortIndicators = [
    { charge_name: "Collection Fees", notes: "Commission sur fret et taxes port" },
    { charge_name: "Collection Fees", notes: "Includes port tax" },
    { charge_name: "Collection Fees", notes: "Includes port charges" },
    { charge_name: "Collection Fees", notes: "Includes port dues" },
    { charge_name: "Collection Fees", notes: "Inclut taxe portuaire" },
    { charge_name: "Collection Fees", notes: "Inclut droits de passage" },
    { charge_name: "Collection Fees", notes: "Inclut redevance portuaire" },
    { charge_name: "Port charges collection", notes: "Carrier collection fee" },
  ];

  for (const charge of collPortIndicators) {
    assertEquals(
      isAmbiguousCarrierPortCharge({
        charge_code: "COLL",
        ...charge,
      }),
      true,
      `COLL should be blocked for ${JSON.stringify(charge)}`,
    );
  }

  assertEquals(
    isAmbiguousCarrierPortCharge({
      charge_code: "COLL",
      charge_name: "Collection Fees",
      notes: "Commission 3.5% du fret maritime",
    }),
    false,
    "pure freight COLL should not be blocked",
  );
});

Deno.test("ambiguous carrier port charge: leaves non-ambiguous carrier charges unchanged", () => {
  const allowedCodes = [
    "DOF",
    "MNF",
    "TBL",
    "CMF",
    "TSS_IMP",
    "DG_HANDLING",
  ];

  for (const chargeCode of allowedCodes) {
    assertEquals(
      isAmbiguousCarrierPortCharge({
        charge_code: chargeCode,
        charge_name: "Carrier service",
        notes: "No port tax wording",
      }),
      false,
      `${chargeCode} should not be blocked`,
    );
  }
});

Deno.test("ambiguous carrier port charge: normalizes accents and repeated spaces", () => {
  assertEquals(
    isAmbiguousCarrierPortCharge({
      charge_code: "OTHER",
      charge_name: "  Redevance    portuaire  ",
      notes: "",
    }),
    true,
  );

  assertEquals(
    isAmbiguousCarrierPortCharge({
      charge_code: "OTHER",
      charge_name: "Taxe   de    port",
      notes: "",
    }),
    true,
  );
});
