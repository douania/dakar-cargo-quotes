/**
 * Pure regression tests for Phase 3-C: Carrier Billing Charges Enrichment.
 *
 * Functions are mirrored inline from run-pricing/index.ts instead of imported
 * to avoid Deno.serve side effects. Keep in sync with run-pricing helpers.
 *
 * Run:
 *   deno test --allow-env supabase/functions/_tests/carrier_charges_enrichment.test.ts
 */

// ─── Mirrored helpers ────────────────────────────────────────────────────────

const VALID_CARRIER_COMMISSION_EVIDENCE_LEVELS = new Set(['official', 'validated_internal']);

function normalizePricingText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeCarrierCode(value: unknown): string {
  const normalized = normalizePricingText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized === 'CMACGM' ? 'CMA_CGM' : normalized;
}

function isAmbiguousCarrierPortChargeBasic(charge: any): boolean {
  const norm = (v: unknown): string => normalizePricingText(v).toUpperCase();
  const carrier = norm(charge?.carrier);
  const code = norm(charge?.charge_code);
  const name = norm(charge?.charge_name);
  const notes = norm(charge?.notes);
  const evidenceLevel = norm(charge?.evidence_level);
  const calcMethod = norm(charge?.calculation_method);
  const defaultAmt = Number(charge?.default_amount);
  const labelText = `${name} ${notes}`;

  if (
    carrier === 'HAPAG_LLOYD' &&
    code === 'TXI' &&
    ['OFFICIAL', 'VALIDATED_INTERNAL'].includes(evidenceLevel) &&
    calcMethod === 'PER_BL' &&
    defaultAmt === 25000
  ) {
    return false;
  }

  if ([
    'TXI', 'XPV_20', 'XPV_40', 'PSX_20', 'PSX_40',
    'PCD', 'PORT_TAX', 'PORT_DUES', 'PORT_CHARGES',
  ].includes(code)) {
    return true;
  }

  const ambiguousLabels = [
    'PORT TAX', 'PORT DUES', 'PORT CHARGES', 'TAX IMPORT',
    'TAXE PORT', 'TAXES PORT', 'TAXE DE PORT',
    'DROIT PASSAGE', 'DROITS DE PASSAGE',
    'TAXE PORTUAIRE', 'TAXES PORTUAIRES',
    'REDEVANCE PORTUAIRE', 'REDEVANCES PORTUAIRES',
    'PAD_DROIT_PASSAGE',
  ];

  const containsPortLabel = (text: string, phrase: string): boolean => {
    const tokens = phrase.match(/[A-Z0-9]+/g);
    if (!tokens?.length) return false;
    const escaped = tokens.map((tok) => tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`(^|[^A-Z0-9])${escaped.join('[^A-Z0-9]+')}(?=$|[^A-Z0-9])`).test(text);
  };

  if (ambiguousLabels.some((label) => containsPortLabel(name, label))) {
    return true;
  }

  return code === 'COLL' && ambiguousLabels.some((label) => containsPortLabel(labelText, label));
}

interface CarrierTemplate {
  carrier: string;
  charge_code: string;
  charge_name?: string;
  calculation_method: string;
  default_amount: number | null;
  currency?: string;
  evidence_level: string;
  is_active?: boolean;
  is_variable?: boolean;
  base_reference?: string | null;
  source_documents?: string[];
  notes?: string;
}

interface Container {
  type: string;
  quantity: number;
}

interface FreightInputs {
  containers?: Container[];
  freightCost?: number;
}

interface EnrichmentLine {
  category: string;
  label: string;
  description: string;
  amount: number;
  currency: string;
  source: {
    type: string;
    reference: string;
    confidence: number;
    table: string;
  };
  isEditable: boolean;
}

function buildCarrierEnrichmentLine(
  t: CarrierTemplate,
  existingCategoryKeys: Set<string>,
  existingEngineIds: Set<string>,
  inputs: FreightInputs,
): EnrichmentLine | null {
  const chargeCode = String(t.charge_code || '').trim().toUpperCase();
  const car = normalizeCarrierCode(t.carrier);
  const method = String(t.calculation_method || '').trim().toUpperCase();
  const evl = String(t.evidence_level || '').trim().toLowerCase();
  const isOfficialEvl = VALID_CARRIER_COMMISSION_EVIDENCE_LEVELS.has(evl);
  const isVar = t.is_variable === true;
  const amtRaw = t.default_amount;
  const amt = Number(amtRaw ?? NaN);
  const amtMissing = amtRaw === null || amtRaw === undefined || !Number.isFinite(amt) || amt <= 0;
  const cur = String(t.currency || 'XOF').trim().toUpperCase();
  const isXof = cur === 'XOF' || cur === 'FCFA';
  const categoryKey = `${car}_${chargeCode}`;

  // SKIP 1 — CMA_CGM/COMM handled by Phase 3 PAD commission
  if (car === 'CMA_CGM' && chargeCode === 'COMM') return null;

  // SKIP 2 — already in engine lines
  const engineIdPrefix = `carrier_${chargeCode.toLowerCase()}_`;
  if ([...existingEngineIds].some((id) => id.startsWith(engineIdPrefix))) return null;

  // SKIP 3 — category already enriched
  if (existingCategoryKeys.has(categoryKey)) return null;

  // SKIP 4 — ambiguous port charge
  if (isAmbiguousCarrierPortChargeBasic(t)) return null;

  let lineAmt = 0;
  let srcType: string;
  let toConfirmReason: string | null = null;

  const enrichContainers = inputs.containers || [];
  const getTeu = () => enrichContainers.reduce((s, c) =>
    s + (String(c.type || '').includes('40') ? 2 : 1) * c.quantity, 0);
  const getCnt = () => enrichContainers.reduce((s, c) => s + c.quantity, 0);

  if (isVar) {
    srcType = 'TO_CONFIRM';
    toConfirmReason = 'is_variable=true';
  } else if (amtMissing) {
    srcType = 'TO_CONFIRM';
    toConfirmReason = 'default_amount null ou invalide';
  } else if (!isOfficialEvl) {
    srcType = 'TO_CONFIRM';
    toConfirmReason = `evidence_level="${evl}" (hors official/validated_internal)`;
  } else if (!isXof) {
    srcType = 'TO_CONFIRM';
    toConfirmReason = `currency="${cur}" — conversion non disponible dans run-pricing`;
  } else {
    switch (method) {
      case 'PER_BL':
        lineAmt = Math.round(amt);
        srcType = 'OFFICIAL';
        break;
      case 'PER_TEU': {
        const teu = getTeu();
        if (teu > 0) { lineAmt = Math.round(amt * teu); srcType = 'OFFICIAL'; }
        else { srcType = 'TO_CONFIRM'; toConfirmReason = 'PER_TEU — aucun conteneur (TEU=0)'; }
        break;
      }
      case 'PER_CNT':
      case 'PER_CONTAINER': {
        const cnt = getCnt();
        if (cnt > 0) { lineAmt = Math.round(amt * cnt); srcType = 'OFFICIAL'; }
        else { srcType = 'TO_CONFIRM'; toConfirmReason = 'PER_CNT/PER_CONTAINER — aucun conteneur (CNT=0)'; }
        break;
      }
      case 'PERCENTAGE':
        srcType = 'TO_CONFIRM';
        toConfirmReason = `PERCENTAGE — V1 conservateur : aucun calcul ferme (base_reference="${t.base_reference || 'non défini'}")`;
        break;
      case 'PER_TONNE':
        srcType = 'TO_CONFIRM';
        toConfirmReason = 'PER_TONNE — montant variable ou non contractualisé';
        break;
      default:
        srcType = 'TO_CONFIRM';
        toConfirmReason = `méthode de calcul non gérée: ${method}`;
    }
  }

  const lineLabel = String(t.charge_name || chargeCode);
  const lineDesc = srcType === 'TO_CONFIRM'
    ? `${lineLabel} — À confirmer : ${toConfirmReason}`
    : `${lineLabel} (${car})`;

  return {
    category: categoryKey,
    label: lineLabel,
    description: lineDesc,
    amount: lineAmt,
    currency: isXof ? 'XOF' : cur,
    source: {
      type: srcType,
      reference: (t.source_documents?.[0] ?? t.base_reference ?? t.notes ?? 'carrier_billing_templates'),
      confidence: srcType === 'TO_CONFIRM' ? 0 : 0.9,
      table: 'carrier_billing_templates',
    },
    isEditable: srcType === 'TO_CONFIRM',
  };
}

function computeEnrichmentAmountWithCarrierCharges(lines: Array<{ amount: number; source: { type: string }; canonical?: { origin_layer: string } }>): number {
  return lines
    .filter((l) => {
      const layer = l.canonical?.origin_layer;
      if (
        layer !== 'enrichment_pad' &&
        layer !== 'enrichment_terminal_storage' &&
        layer !== 'enrichment_carrier_commission' &&
        layer !== 'enrichment_carrier_charges'
      ) return false;
      const srcType = String(l.source?.type || '').trim().split('+')[0].split(':')[0].toUpperCase();
      if (srcType === 'TO_CONFIRM') return false;
      return (Number(l.amount) || 0) > 0;
    })
    .reduce((s, l) => s + (Number(l.amount) || 0), 0);
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const containers20 = [{ type: '20GP', quantity: 2 }];
const containers40 = [{ type: '40HC', quantity: 1 }];
const noContainers: Container[] = [];

// ─── Tests ───────────────────────────────────────────────────────────────────

function assertEquals(actual: unknown, expected: unknown, msg?: string): void {
  if (actual !== expected) {
    throw new Error(msg ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

Deno.test('CMA_CGM/COMM is skipped — never double-counted', () => {
  const t: CarrierTemplate = {
    carrier: 'CMA_CGM', charge_code: 'COMM', charge_name: 'Commission sur débours',
    calculation_method: 'PERCENTAGE', default_amount: 2.8,
    currency: 'XOF', evidence_level: 'validated_internal',
  };
  const result = buildCarrierEnrichmentLine(t, new Set(), new Set(), { containers: containers20 });
  assertEquals(result, null, 'CMA_CGM/COMM must be skipped (handled by Phase 3 PAD)');
});

Deno.test('CMA_CGM/CMF USD → TO_CONFIRM, no firm amount', () => {
  const t: CarrierTemplate = {
    carrier: 'CMA_CGM', charge_code: 'CMF', charge_name: 'Container Management Fee',
    calculation_method: 'PER_TEU', default_amount: 10,
    currency: 'USD', evidence_level: 'validated_internal',
  };
  const result = buildCarrierEnrichmentLine(t, new Set(), new Set(), { containers: containers20 });
  assert(result !== null, 'CMA_CGM/CMF should produce a TO_CONFIRM line');
  assertEquals(result.source.type, 'TO_CONFIRM');
  assertEquals(result.amount, 0);
  assert(result.description.includes('USD'), 'Description must mention USD');
  assertEquals(result.isEditable, true);
});

Deno.test('CMA_CGM/CMDF PER_BL 600 XOF → firm line 600 XOF', () => {
  const t: CarrierTemplate = {
    carrier: 'CMA_CGM', charge_code: 'CMDF', charge_name: 'BL Fee',
    calculation_method: 'PER_BL', default_amount: 600,
    currency: 'XOF', evidence_level: 'validated_internal',
  };
  const result = buildCarrierEnrichmentLine(t, new Set(), new Set(), { containers: containers20 });
  assert(result !== null, 'CMA_CGM/CMDF must produce a firm line');
  assertEquals(result.source.type, 'OFFICIAL');
  assertEquals(result.amount, 600);
  assertEquals(result.currency, 'XOF');
  assertEquals(result.isEditable, false);
});

Deno.test('PER_CONTAINER is alias for PER_CNT — firm if XOF + official/validated_internal', () => {
  const t: CarrierTemplate = {
    carrier: 'ONE', charge_code: 'CMF', charge_name: 'Container Management Fee',
    calculation_method: 'PER_CONTAINER', default_amount: 5000,
    currency: 'XOF', evidence_level: 'validated_internal',
  };
  const result = buildCarrierEnrichmentLine(t, new Set(), new Set(), { containers: containers20 });
  assert(result !== null, 'ONE/CMF PER_CONTAINER must produce a line');
  assertEquals(result.source.type, 'OFFICIAL');
  assertEquals(result.amount, 10000);  // 5000 × 2 containers
  assertEquals(result.currency, 'XOF');
  assertEquals(result.isEditable, false);
});

Deno.test('PER_CONTAINER to_confirm evidence → TO_CONFIRM (no firm even if calc possible)', () => {
  const t: CarrierTemplate = {
    carrier: 'ONE', charge_code: 'CMF', charge_name: 'Container Management Fee',
    calculation_method: 'PER_CONTAINER', default_amount: 5000,
    currency: 'XOF', evidence_level: 'to_confirm',
  };
  const result = buildCarrierEnrichmentLine(t, new Set(), new Set(), { containers: containers20 });
  assert(result !== null, 'Should produce TO_CONFIRM line');
  assertEquals(result.source.type, 'TO_CONFIRM');
  assertEquals(result.amount, 0);
  assertEquals(result.isEditable, true);
});

Deno.test('HAPAG_LLOYD/COLL PERCENTAGE without base_reference → TO_CONFIRM', () => {
  const t: CarrierTemplate = {
    carrier: 'HAPAG_LLOYD', charge_code: 'COLL', charge_name: 'Collection Fee',
    calculation_method: 'PERCENTAGE', default_amount: 3.5,
    currency: 'XOF', evidence_level: 'official',
    base_reference: null,
    notes: 'Commission sur fret',
  };
  const result = buildCarrierEnrichmentLine(t, new Set(), new Set(), { containers: containers20 });
  assert(result !== null, 'Should produce a TO_CONFIRM line');
  assertEquals(result.source.type, 'TO_CONFIRM');
  assertEquals(result.amount, 0);
  assert(result.description.includes('base_reference'), 'Description must mention missing base_reference');
});

Deno.test('HAPAG_LLOYD/COLL PERCENTAGE with base_reference=sea_freight and freight available → TO_CONFIRM (V1 conservateur)', () => {
  const t: CarrierTemplate = {
    carrier: 'HAPAG_LLOYD', charge_code: 'COLL', charge_name: 'Collection Fee',
    calculation_method: 'PERCENTAGE', default_amount: 3.5,
    currency: 'XOF', evidence_level: 'official',
    base_reference: 'sea_freight',
    notes: 'Commission sur fret',
  };
  const result = buildCarrierEnrichmentLine(t, new Set(), new Set(), {
    containers: containers20,
    freightCost: 1000000,
  });
  assert(result !== null, 'Should produce a TO_CONFIRM line');
  assertEquals(result.source.type, 'TO_CONFIRM');
  assertEquals(result.amount, 0);
  assert(result.description.includes('V1 conservateur'), 'Description must mention V1 conservateur');
  assertEquals(result.isEditable, true);
});

Deno.test('MAERSK/FAI is_variable=true PER_TONNE → TO_CONFIRM', () => {
  const t: CarrierTemplate = {
    carrier: 'MAERSK', charge_code: 'FAI', charge_name: 'Fuel Adjustment Index',
    calculation_method: 'PER_TONNE', default_amount: null,
    currency: 'XOF', evidence_level: 'observed', is_variable: true,
  };
  const result = buildCarrierEnrichmentLine(t, new Set(), new Set(), { containers: containers20 });
  assert(result !== null, 'Should produce TO_CONFIRM line');
  assertEquals(result.source.type, 'TO_CONFIRM');
  assertEquals(result.amount, 0);
  assert(result.description.includes('is_variable'), 'Description must mention is_variable');
});

Deno.test('MSC/THO default_amount=null → TO_CONFIRM', () => {
  const t: CarrierTemplate = {
    carrier: 'MSC', charge_code: 'THO', charge_name: 'Terminal Handling',
    calculation_method: 'PER_TONNE', default_amount: null,
    currency: 'XOF', evidence_level: 'observed',
  };
  const result = buildCarrierEnrichmentLine(t, new Set(), new Set(), { containers: containers20 });
  assert(result !== null, 'Should produce TO_CONFIRM line');
  assertEquals(result.source.type, 'TO_CONFIRM');
  assertEquals(result.amount, 0);
});

Deno.test('observed evidence → TO_CONFIRM regardless of method/amount', () => {
  const t: CarrierTemplate = {
    carrier: 'GRIMALDI', charge_code: 'COMM', charge_name: 'Commission',
    calculation_method: 'PERCENTAGE', default_amount: 2.5,
    currency: 'XOF', evidence_level: 'observed',
  };
  const result = buildCarrierEnrichmentLine(t, new Set(), new Set(), {
    containers: containers20, freightCost: 500000,
  });
  assert(result !== null, 'Should produce TO_CONFIRM line');
  assertEquals(result.source.type, 'TO_CONFIRM');
  assertEquals(result.amount, 0);
});

Deno.test('historical_only evidence → TO_CONFIRM', () => {
  for (const evl of ['historical_only', 'to_confirm']) {
    const t: CarrierTemplate = {
      carrier: 'GRIMALDI', charge_code: 'SVC', charge_name: 'Service Charge',
      calculation_method: 'PER_BL', default_amount: 300,
      currency: 'XOF', evidence_level: evl,
    };
    const result = buildCarrierEnrichmentLine(t, new Set(), new Set(), { containers: containers20 });
    assert(result !== null, `Should produce TO_CONFIRM for evidence ${evl}`);
    assertEquals(result.source.type, 'TO_CONFIRM', `evidence=${evl} must be TO_CONFIRM`);
  }
});

Deno.test('PER_TEU with 40HC container → 2 TEU × amount', () => {
  const t: CarrierTemplate = {
    carrier: 'CMA_CGM', charge_code: 'ISPS', charge_name: 'ISPS Fee',
    calculation_method: 'PER_TEU', default_amount: 1000,
    currency: 'XOF', evidence_level: 'validated_internal',
  };
  const result = buildCarrierEnrichmentLine(t, new Set(), new Set(), { containers: containers40 });
  assert(result !== null, 'PER_TEU 40HC should produce a firm line');
  assertEquals(result.source.type, 'OFFICIAL');
  assertEquals(result.amount, 2000);  // 1 × 40HC = 2 TEU × 1000
});

Deno.test('already in engine lines → skipped (dedup SKIP 2)', () => {
  const t: CarrierTemplate = {
    carrier: 'CMA_CGM', charge_code: 'CMDF', charge_name: 'BL Fee',
    calculation_method: 'PER_BL', default_amount: 600,
    currency: 'XOF', evidence_level: 'validated_internal',
  };
  // Simulate engine produced carrier_cmdf_0
  const engineIds = new Set(['carrier_cmdf_0']);
  const result = buildCarrierEnrichmentLine(t, new Set(), engineIds, { containers: containers20 });
  assertEquals(result, null, 'Should be skipped — already in engine lines');
});

Deno.test('firm carrier charge line counted in enrichmentAmount', () => {
  const firmLine = {
    category: 'CMA_CGM_CMDF',
    amount: 600,
    source: { type: 'OFFICIAL' },
    canonical: { origin_layer: 'enrichment_carrier_charges' },
  };
  const toConfirmLine = {
    category: 'CMA_CGM_CMF',
    amount: 0,
    source: { type: 'TO_CONFIRM' },
    canonical: { origin_layer: 'enrichment_carrier_charges' },
  };
  const total = computeEnrichmentAmountWithCarrierCharges([firmLine, toConfirmLine]);
  assertEquals(total, 600, 'Only firm line should count — TO_CONFIRM excluded');
});

Deno.test('TO_CONFIRM carrier charge NOT counted in enrichmentAmount', () => {
  const toConfirmLine = {
    category: 'CMA_CGM_CMF',
    amount: 0,
    source: { type: 'TO_CONFIRM' },
    canonical: { origin_layer: 'enrichment_carrier_charges' },
  };
  const total = computeEnrichmentAmountWithCarrierCharges([toConfirmLine]);
  assertEquals(total, 0, 'TO_CONFIRM line must not affect enrichmentAmount');
});

Deno.test('ambiguous port charge (TXI) → skipped by isAmbiguousCarrierPortChargeBasic', () => {
  const t: CarrierTemplate = {
    carrier: 'OTHER_CARRIER', charge_code: 'TXI', charge_name: 'Tax Import',
    calculation_method: 'PER_BL', default_amount: 25000,
    currency: 'XOF', evidence_level: 'validated_internal',
  };
  const result = buildCarrierEnrichmentLine(t, new Set(), new Set(), { containers: containers20 });
  assertEquals(result, null, 'TXI (non-HAPAG exception) must be skipped as ambiguous port charge');
});

Deno.test('HAPAG_LLOYD/TXI validated PER_BL 25000 → not blocked (ambiguity exception)', () => {
  assertEquals(
    isAmbiguousCarrierPortChargeBasic({
      carrier: 'HAPAG_LLOYD', charge_code: 'TXI', charge_name: 'Tax Import',
      evidence_level: 'validated_internal', calculation_method: 'PER_BL', default_amount: 25000,
    }),
    false,
    'HAPAG_LLOYD/TXI validated PER_BL 25000 should pass ambiguity guard',
  );
});

Deno.test('COLL without port wording → not ambiguous (pure freight commission)', () => {
  assertEquals(
    isAmbiguousCarrierPortChargeBasic({
      charge_code: 'COLL', charge_name: 'Collection Fee',
      notes: 'Commission 3.5% sur fret maritime',
    }),
    false,
    'Pure freight COLL should not be blocked',
  );
});
