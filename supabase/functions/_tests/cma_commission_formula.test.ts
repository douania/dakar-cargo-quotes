/**
 * Pure regression tests for CMA CGM "Commission sur debours".
 *
 * The helpers are mirrored from run-pricing/index.ts instead of imported,
 * because importing the Edge Function would trigger Deno.serve side effects.
 *
 * Run:
 *   deno test --allow-env supabase/functions/_tests/cma_commission_formula.test.ts
 */

const CMA_CGM_DEBOURS_COMMISSION_RATE = 0.028;
const CMA_CGM_DEBOURS_COMMISSION_PERCENT = 2.8;
const VALID_CARRIER_COMMISSION_EVIDENCE_LEVELS = new Set(["official", "validated_internal"]);

function assertEquals(actual: unknown, expected: unknown, message?: string): void {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizePricingText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeCarrierCode(value: unknown): string {
  const normalized = normalizePricingText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized === "CMACGM" ? "CMA_CGM" : normalized;
}

function isEligibleCmaCgmCommissionTemplate(template: any): boolean {
  return (
    normalizeCarrierCode(template?.carrier) === "CMA_CGM" &&
    String(template?.charge_code || "").trim().toUpperCase() === "COMM" &&
    template?.is_active === true &&
    VALID_CARRIER_COMMISSION_EVIDENCE_LEVELS.has(String(template?.evidence_level || "").trim().toLowerCase()) &&
    String(template?.calculation_method || "").trim().toUpperCase() === "PERCENTAGE" &&
    Number(template?.default_amount) === CMA_CGM_DEBOURS_COMMISSION_PERCENT
  );
}

function buildCmaCgmCommissionLine(params: {
  carrier: string;
  isMaritimeImport: boolean;
  isExportFlow?: boolean;
  isTransitLike?: boolean;
  isMultiLot?: boolean;
  padLine?: any;
  commTemplate?: any;
}): any | null {
  if (params.isMultiLot) return null;
  if (!params.isMaritimeImport || params.isExportFlow || params.isTransitLike) return null;
  if (normalizeCarrierCode(params.carrier) !== "CMA_CGM") return null;
  if (!params.padLine || Number(params.padLine.amount) <= 0) return null;
  if (String(params.padLine?.source?.type || "").trim().toUpperCase() !== "OFFICIAL") return null;
  if (!isEligibleCmaCgmCommissionTemplate(params.commTemplate)) return null;

  return {
    category: "CMA_CGM_COMM",
    label: "Commission sur debours CMA CGM",
    amount: Math.round(Number(params.padLine.amount) * CMA_CGM_DEBOURS_COMMISSION_RATE),
    currency: "FCFA",
    source: { type: "CALCULATED" },
    isEditable: false,
    canonical: { origin_layer: "enrichment_carrier_commission" },
  };
}

function computeEnrichmentAmount(lines: any[]): number {
  return lines
    .filter((l: any) => {
      const layer = l.canonical?.origin_layer;
      if (
        layer !== "enrichment_pad" &&
        layer !== "enrichment_terminal_storage" &&
        layer !== "enrichment_carrier_commission"
      ) return false;
      const sourceType = String(l?.source?.type || "")
        .trim()
        .split("+")[0]
        .split(":")[0]
        .toUpperCase();
      if (sourceType === "TO_CONFIRM") return false;
      return (Number(l.amount) || 0) > 0;
    })
    .reduce((sum: number, l: any) => sum + (Number(l.amount) || 0), 0);
}

const officialPad100000 = {
  category: "PAD_DROIT_PASSAGE",
  amount: 100000,
  currency: "FCFA",
  source: { type: "OFFICIAL" },
  canonical: { origin_layer: "enrichment_pad" },
};

const toConfirmPad = {
  ...officialPad100000,
  amount: 0,
  source: { type: "TO_CONFIRM" },
};

const validCommTemplate = {
  carrier: "CMA_CGM",
  charge_code: "COMM",
  is_active: true,
  evidence_level: "validated_internal",
  calculation_method: "PERCENTAGE",
  default_amount: 2.8,
};

Deno.test("CMA_CGM + official PAD 100000 + validated COMM 2.8 creates 2800 FCFA commission", () => {
  const line = buildCmaCgmCommissionLine({
    carrier: "CMA CGM",
    isMaritimeImport: true,
    padLine: officialPad100000,
    commTemplate: validCommTemplate,
  });

  assert(line, "Expected commission line");
  assertEquals(line.amount, 2800);
  assertEquals(line.currency, "FCFA");
  assertEquals(line.source.type, "CALCULATED");
  assertEquals(line.canonical.origin_layer, "enrichment_carrier_commission");
  assertEquals(line.isEditable, false);
});

Deno.test("CMA_CGM + PAD absent creates no commission", () => {
  const line = buildCmaCgmCommissionLine({
    carrier: "CMA_CGM",
    isMaritimeImport: true,
    commTemplate: validCommTemplate,
  });

  assertEquals(line, null);
});

Deno.test("CMA_CGM + PAD TO_CONFIRM creates no commission", () => {
  const line = buildCmaCgmCommissionLine({
    carrier: "CMA_CGM",
    isMaritimeImport: true,
    padLine: toConfirmPad,
    commTemplate: validCommTemplate,
  });

  assertEquals(line, null);
});

Deno.test("CMA_CGM + COMM to_confirm creates no commission", () => {
  const line = buildCmaCgmCommissionLine({
    carrier: "CMA_CGM",
    isMaritimeImport: true,
    padLine: officialPad100000,
    commTemplate: { ...validCommTemplate, evidence_level: "to_confirm" },
  });

  assertEquals(line, null);
});

Deno.test("CMA_CGM + COMM amount different from 2.8 creates no commission", () => {
  const line = buildCmaCgmCommissionLine({
    carrier: "CMA_CGM",
    isMaritimeImport: true,
    padLine: officialPad100000,
    commTemplate: { ...validCommTemplate, default_amount: 3.5 },
  });

  assertEquals(line, null);
});

Deno.test("HAPAG_LLOYD + PAD + COMM creates no commission", () => {
  const line = buildCmaCgmCommissionLine({
    carrier: "HAPAG_LLOYD",
    isMaritimeImport: true,
    padLine: officialPad100000,
    commTemplate: validCommTemplate,
  });

  assertEquals(line, null);
});

Deno.test("commission is included in enrichmentAmount", () => {
  const commissionLine = buildCmaCgmCommissionLine({
    carrier: "CMA_CGM",
    isMaritimeImport: true,
    padLine: officialPad100000,
    commTemplate: validCommTemplate,
  });

  assert(commissionLine, "Expected commission line");
  assertEquals(computeEnrichmentAmount([officialPad100000, commissionLine]), 102800);
});

Deno.test("PAD is not double counted in enrichmentAmount", () => {
  const commissionLine = buildCmaCgmCommissionLine({
    carrier: "CMA_CGM",
    isMaritimeImport: true,
    padLine: officialPad100000,
    commTemplate: validCommTemplate,
  });

  assert(commissionLine, "Expected commission line");
  const enrichmentAmount = computeEnrichmentAmount([officialPad100000, commissionLine]);
  assertEquals(enrichmentAmount - commissionLine.amount, officialPad100000.amount);
});

Deno.test("multi-lot/global PAD scope skips commission explicitly", () => {
  const line = buildCmaCgmCommissionLine({
    carrier: "CMA_CGM",
    isMaritimeImport: true,
    isMultiLot: true,
    padLine: officialPad100000,
    commTemplate: validCommTemplate,
  });

  assertEquals(line, null);
});

Deno.test("export and transit-like flows create no commission", () => {
  const exportLine = buildCmaCgmCommissionLine({
    carrier: "CMA_CGM",
    isMaritimeImport: true,
    isExportFlow: true,
    padLine: officialPad100000,
    commTemplate: validCommTemplate,
  });
  const transitLine = buildCmaCgmCommissionLine({
    carrier: "CMA_CGM",
    isMaritimeImport: true,
    isTransitLike: true,
    padLine: officialPad100000,
    commTemplate: validCommTemplate,
  });

  assertEquals(exportLine, null);
  assertEquals(transitLine, null);
});
