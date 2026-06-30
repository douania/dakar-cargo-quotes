/**
 * CARRIER_FEES_RUNTIME_SAFETY-2 — Patch A runtime safety for carrier billing charges.
 *
 * Pure regression test, no live DB. The helpers are mirrored from
 * quotation-engine/index.ts (not imported) because importing the Edge Function
 * would trigger Deno.serve side effects.
 *
 * Patch A scope only: this proves that carrier charges whose method, currency or
 * applicability are not safe never produce a firm auto-counted amount, and that
 * TO_CONFIRM / amount:null lines are excluded from the `operationnel` total.
 * It does NOT exercise any PAD/commission engine, EUR conversion, or weight pricing.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// ---------------------------------------------------------------------------
// Mirrored helpers (verbatim from supabase/functions/quotation-engine/index.ts)
// ---------------------------------------------------------------------------

function normalizeCarrierPortChargeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
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
  const carrier = normalizeCarrierPortChargeText(charge?.carrier);
  const code = normalizeCarrierPortChargeText(charge?.charge_code);
  const name = normalizeCarrierPortChargeText(charge?.charge_name);
  const notes = normalizeCarrierPortChargeText(charge?.notes);
  const evidenceLevel = normalizeCarrierPortChargeText(charge?.evidence_level);
  const calculationMethod = normalizeCarrierPortChargeText(charge?.calculation_method);
  const defaultAmount = Number(charge?.default_amount);
  const labelText = `${name} ${notes}`;

  if (
    carrier === "HAPAG_LLOYD" &&
    code === "TXI" &&
    ["OFFICIAL", "VALIDATED_INTERNAL"].includes(evidenceLevel) &&
    calculationMethod === "PER_BL" &&
    defaultAmount === 25000
  ) {
    return false;
  }

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

function evaluateCarrierChargeSafety(
  charge: any,
  metrics: { totalCnt: number; cnt20: number; cnt40: number; totalEVP: number; isIMO: boolean; isHazmat: boolean },
): { status: "FIRM"; amount: number } | { status: "TO_CONFIRM"; note: string } {
  const method = normalizeCarrierPortChargeText(charge?.calculation_method);
  const currencyRaw = charge?.currency;
  const currency = normalizeCarrierPortChargeText(currencyRaw);
  const evidence = normalizeCarrierPortChargeText(charge?.evidence_level);
  const code = normalizeCarrierPortChargeText(charge?.charge_code);
  const name = normalizeCarrierPortChargeText(charge?.charge_name);
  const defaultAmount = Number(charge?.default_amount);
  const isVariable = charge?.is_variable === true;
  const codeLabel = charge?.charge_code ?? "UNKNOWN";

  const toConfirm = (
    note: string,
  ): { status: "TO_CONFIRM"; note: string } => ({ status: "TO_CONFIRM", note });

  // Rule 5 — DG/IMO handling applicability (firm only when dossier is declared DG/IMO).
  const dgTokenPattern = /(^|[^A-Z0-9])(DG|DANGEROUS|HAZMAT|IMO|IMDG)(?=$|[^A-Z0-9])/;
  const looksDG = dgTokenPattern.test(code) || dgTokenPattern.test(name);
  if (looksDG && metrics.isIMO !== true && metrics.isHazmat !== true) {
    return toConfirm(
      `Carrier charge DG/IMO non confirmé: applicabilité dangerous/IMO à confirmer (dossier non déclaré DG/IMO). charge_code=${codeLabel}`,
    );
  }

  // Rule 1 — Foreign currency (Patch A: EUR & USD both TO_CONFIRM, no conversion here).
  if (!["XOF", "FCFA", "CFA"].includes(currency)) {
    return toConfirm(
      `Carrier charge devise étrangère (${currencyRaw ?? "inconnue"}): conversion/validation requise avant montant ferme. charge_code=${codeLabel}`,
    );
  }

  // Rule 3 — PERCENTAGE never becomes a flat amount.
  if (method === "PERCENTAGE") {
    return toConfirm(
      `Carrier charge PERCENTAGE: base de calcul requise, ne peut pas devenir un montant forfaitaire. charge_code=${codeLabel}`,
    );
  }

  // Rule 4 — PER_TONNE not contracted in V1 (no dossier weight used in Patch A).
  if (method === "PER_TONNE") {
    return toConfirm(
      `Carrier charge PER_TONNE non contractualisée en V1: montant à confirmer. charge_code=${codeLabel}`,
    );
  }

  // Shared firm-amount safety guards.
  if (!["OFFICIAL", "VALIDATED_INTERNAL"].includes(evidence)) {
    return toConfirm(
      `Carrier charge preuve insuffisante (official/validated_internal requis): montant à confirmer. charge_code=${codeLabel}`,
    );
  }
  if (isVariable) {
    return toConfirm(
      `Carrier charge marquée variable: montant à confirmer. charge_code=${codeLabel}`,
    );
  }
  if (!(defaultAmount > 0)) {
    return toConfirm(
      `Carrier charge montant par défaut absent ou nul: montant à confirmer. charge_code=${codeLabel}`,
    );
  }

  // Rule 2 — PER_CONTAINER treated as alias of PER_CNT.
  if (method === "PER_CNT" || method === "PER_CONTAINER") {
    if (code.includes("_20") || code.includes("20")) {
      return { status: "FIRM", amount: defaultAmount * metrics.cnt20 };
    }
    if (code.includes("_40") || code.includes("40")) {
      return { status: "FIRM", amount: defaultAmount * metrics.cnt40 };
    }
    return { status: "FIRM", amount: defaultAmount * metrics.totalCnt };
  }
  if (method === "PER_TEU") {
    return { status: "FIRM", amount: defaultAmount * metrics.totalEVP };
  }
  if (method === "PER_BL") {
    return { status: "FIRM", amount: defaultAmount };
  }

  // Unknown / unsafe method — no longer auto-counted as a flat amount.
  return toConfirm(
    `Carrier charge méthode non reconnue (${charge?.calculation_method ?? "inconnue"}): montant à confirmer. charge_code=${codeLabel}`,
  );
}

// ---------------------------------------------------------------------------
// Test-side simulation of the carrier charges block (mirrors index.ts §4)
// ---------------------------------------------------------------------------

interface SimulatedLine {
  id: string;
  bloc: string;
  category: string;
  description: string;
  amount: number | null;
  currency: string;
  source: { type: string; reference: string; confidence: number };
  notes?: string;
  isEditable: boolean;
}

function evpMultiplier(type: string): number {
  const normalized = type.toUpperCase().replace(/['\s-]/g, "");
  if (normalized.includes("45")) return 2.25;
  if (normalized.includes("40")) return 2;
  if (normalized.includes("20")) return 1;
  return 1;
}

function buildMetrics(
  containers: Array<{ type: string; quantity: number }>,
  opts: { isIMO?: boolean; isHazmat?: boolean } = {},
) {
  return {
    totalCnt: containers.reduce((s, c) => s + c.quantity, 0),
    cnt20: containers.filter((c) => !c.type.includes("40")).reduce((s, c) => s + c.quantity, 0),
    cnt40: containers.filter((c) => c.type.includes("40")).reduce((s, c) => s + c.quantity, 0),
    totalEVP: containers.reduce((s, c) => s + evpMultiplier(c.type) * c.quantity, 0),
    isIMO: opts.isIMO === true,
    isHazmat: opts.isHazmat === true,
  };
}

/** Mirrors the per-charge branch of quotation-engine §4 CARRIER CHARGES. */
function simulateCarrierLine(
  charge: any,
  metrics: ReturnType<typeof buildMetrics>,
  index: number,
): SimulatedLine | null {
  if (isAmbiguousCarrierPortCharge(charge)) {
    const blockMessage = "Carrier charge blocked (ambiguous port label)";
    return {
      id: `carrier_${String(charge.charge_code || "unknown").toLowerCase()}_blocked_${index}`,
      bloc: "operationnel",
      category: "Compagnie Maritime",
      description: charge.charge_name || charge.charge_code || "Carrier charge to confirm",
      amount: null,
      currency: charge.currency || "XOF",
      source: { type: "TO_CONFIRM", reference: blockMessage, confidence: 0 },
      notes: blockMessage,
      isEditable: true,
    };
  }

  const safety = evaluateCarrierChargeSafety(charge, metrics);

  if (safety.status === "TO_CONFIRM") {
    return {
      id: `carrier_${String(charge.charge_code || "unknown").toLowerCase()}_to_confirm_${index}`,
      bloc: "operationnel",
      category: "Compagnie Maritime",
      description: charge.charge_name || charge.charge_code || "Carrier charge to confirm",
      amount: null,
      currency: charge.currency || "XOF",
      source: { type: "TO_CONFIRM", reference: safety.note, confidence: 0 },
      notes: safety.note,
      isEditable: true,
    };
  }

  if (safety.amount > 0) {
    return {
      id: `carrier_${charge.charge_code.toLowerCase()}_${index}`,
      bloc: "operationnel",
      category: "Compagnie Maritime",
      description: charge.charge_name,
      amount: safety.amount,
      currency: charge.currency || "XOF",
      source: {
        type: "OFFICIAL",
        reference: `${charge.carrier} - ${charge.notes || "Carrier Billing Template"}`,
        confidence: 0.9,
      },
      isEditable: false,
    };
  }

  return null;
}

/** Mirrors the `operationnel` total filter in quotation-engine (excludes amount=null/0). */
function computeOperationnelTotal(lines: SimulatedLine[]): number {
  return lines
    .filter((l) => l.bloc === "operationnel" && l.amount)
    .reduce((s, l) => s + (l.amount || 0), 0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("1. ONE/CMF PER_CONTAINER XOF -> firm 230000 for 2 containers", () => {
  const charge = {
    carrier: "ONE",
    charge_code: "CMF",
    charge_name: "Carrier Management Fee",
    calculation_method: "PER_CONTAINER",
    default_amount: 115000,
    currency: "XOF",
    evidence_level: "validated_internal",
  };
  const metrics = buildMetrics([{ type: "20GP", quantity: 2 }]);
  const line = simulateCarrierLine(charge, metrics, 0);

  assertEquals(line?.amount, 230000);
  assertEquals(line?.source.type, "OFFICIAL");
  assertEquals(line?.isEditable, false);
  assertEquals(computeOperationnelTotal(line ? [line] : []), 230000);
});

Deno.test("2. ONE/DG_HANDLING on non-DG dossier -> TO_CONFIRM, amount null, not counted", () => {
  const charge = {
    carrier: "ONE",
    charge_code: "DG_HANDLING",
    charge_name: "DG Handling",
    calculation_method: "PER_CONTAINER",
    default_amount: 5000,
    currency: "XOF",
    evidence_level: "validated_internal",
  };
  // Dossier not DG: isIMO !== true and isHazmat !== true.
  const metrics = buildMetrics([{ type: "20GP", quantity: 2 }], { isIMO: false, isHazmat: false });
  const line = simulateCarrierLine(charge, metrics, 0);

  assertEquals(line?.amount, null);
  assertEquals(line?.source.type, "TO_CONFIRM");
  assertEquals(line?.isEditable, true);
  assertEquals(computeOperationnelTotal(line ? [line] : []), 0);
});

Deno.test("2b. DG_HANDLING on declared DG dossier stays firm (applicability satisfied)", () => {
  const charge = {
    carrier: "ONE",
    charge_code: "DG_HANDLING",
    charge_name: "DG Handling",
    calculation_method: "PER_CONTAINER",
    default_amount: 5000,
    currency: "XOF",
    evidence_level: "validated_internal",
  };
  const metrics = buildMetrics([{ type: "20GP", quantity: 2 }], { isIMO: true });
  const line = simulateCarrierLine(charge, metrics, 0);

  assertEquals(line?.amount, 10000);
  assertEquals(line?.source.type, "OFFICIAL");
});

Deno.test("3. CMA_CGM/LOC_TERM PER_TEU EUR -> TO_CONFIRM, amount null, not counted", () => {
  const charge = {
    carrier: "CMA_CGM",
    charge_code: "LOC_TERM",
    charge_name: "Local Terminal Handling",
    calculation_method: "PER_TEU",
    default_amount: 23,
    currency: "EUR",
    evidence_level: "validated_internal",
  };
  const metrics = buildMetrics([{ type: "40HC", quantity: 1 }]);
  const line = simulateCarrierLine(charge, metrics, 0);

  assertEquals(line?.amount, null);
  assertEquals(line?.source.type, "TO_CONFIRM");
  assertEquals(line?.isEditable, true);
  assertEquals(computeOperationnelTotal(line ? [line] : []), 0);
});

Deno.test("3b. USD treated like EUR in Patch A -> TO_CONFIRM, amount null", () => {
  const charge = {
    carrier: "MAERSK",
    charge_code: "SOME_USD_FEE",
    charge_name: "Some carrier fee",
    calculation_method: "PER_CNT",
    default_amount: 40,
    currency: "USD",
    evidence_level: "official",
  };
  const metrics = buildMetrics([{ type: "20GP", quantity: 1 }]);
  const line = simulateCarrierLine(charge, metrics, 0);

  assertEquals(line?.amount, null);
  assertEquals(line?.source.type, "TO_CONFIRM");
});

Deno.test("4. HAPAG_LLOYD/COLL PERCENTAGE -> TO_CONFIRM, amount null, not counted", () => {
  const charge = {
    carrier: "HAPAG_LLOYD",
    charge_code: "COLL",
    charge_name: "Commission",
    calculation_method: "PERCENTAGE",
    default_amount: 3.5,
    currency: "XOF",
    evidence_level: "official",
  };
  const metrics = buildMetrics([{ type: "20GP", quantity: 1 }]);
  const line = simulateCarrierLine(charge, metrics, 0);

  assertEquals(line?.amount, null);
  assertEquals(line?.source.type, "TO_CONFIRM");
  assertEquals(line?.isEditable, true);
  assertEquals(computeOperationnelTotal(line ? [line] : []), 0);
});

Deno.test("5. Generic PER_TONNE (any carrier/code) -> TO_CONFIRM, amount null, not counted", () => {
  for (const charge of [
    {
      carrier: "ACME_LINE",
      charge_code: "WEIGHT_FEE",
      charge_name: "Weight based fee",
      calculation_method: "PER_TONNE",
      default_amount: 1200,
      currency: "XOF",
      evidence_level: "validated_internal",
    },
    {
      carrier: "GENERIC",
      charge_code: "TONNAGE_X",
      charge_name: "Tonnage handling",
      calculation_method: "PER_TONNE",
      default_amount: null,
      currency: "XOF",
      evidence_level: "validated_internal",
    },
  ]) {
    const metrics = buildMetrics([{ type: "20GP", quantity: 3 }]);
    const line = simulateCarrierLine(charge, metrics, 0);

    assertEquals(line?.amount, null, `${charge.charge_code} must not produce a firm amount`);
    assertEquals(line?.source.type, "TO_CONFIRM");
    assertEquals(computeOperationnelTotal(line ? [line] : []), 0);
  }
});

Deno.test("6. HAPAG_LLOYD/TXI PER_BL 25000 XOF -> firm 25000, not blocked by ambiguous guard", () => {
  const charge = {
    carrier: "HAPAG_LLOYD",
    charge_code: "TXI",
    charge_name: "Tax Import",
    calculation_method: "PER_BL",
    default_amount: 25000,
    currency: "XOF",
    evidence_level: "validated_internal",
  };
  // Must NOT be flagged ambiguous (validated exception).
  assertEquals(isAmbiguousCarrierPortCharge(charge), false);

  const metrics = buildMetrics([{ type: "20GP", quantity: 1 }]);
  const line = simulateCarrierLine(charge, metrics, 0);

  assertEquals(line?.amount, 25000);
  assertEquals(line?.source.type, "OFFICIAL");
  assertEquals(line?.isEditable, false);
  assertEquals(computeOperationnelTotal(line ? [line] : []), 25000);
});

Deno.test("7. MANDATORY total test: amount:null lines are excluded from operationnel total", () => {
  const metrics = buildMetrics([{ type: "20GP", quantity: 1 }]);

  const firmCharge = {
    carrier: "ONE",
    charge_code: "CMF",
    charge_name: "Carrier Management Fee",
    calculation_method: "PER_CONTAINER",
    default_amount: 115000,
    currency: "XOF",
    evidence_level: "validated_internal",
  };
  const eurCharge = {
    carrier: "CMA_CGM",
    charge_code: "LOC_TERM",
    charge_name: "Local Terminal Handling",
    calculation_method: "PER_TEU",
    default_amount: 23,
    currency: "EUR",
    evidence_level: "validated_internal",
  };
  const percentageCharge = {
    carrier: "HAPAG_LLOYD",
    charge_code: "COLL",
    charge_name: "Commission",
    calculation_method: "PERCENTAGE",
    default_amount: 3.5,
    currency: "XOF",
    evidence_level: "official",
  };

  const lines = [firmCharge, eurCharge, percentageCharge]
    .map((charge, i) => simulateCarrierLine(charge, metrics, i))
    .filter((l): l is SimulatedLine => l !== null);

  // One firm line + two TO_CONFIRM null lines.
  assertEquals(lines.length, 3);
  assertEquals(lines.filter((l) => l.amount === null).length, 2);

  // The total must include only the firm XOF line.
  assertEquals(computeOperationnelTotal(lines), 115000);
});
