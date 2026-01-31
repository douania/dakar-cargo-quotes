/**
 * Quotation Engine Tests — Phase 4F.4
 */

import { describe, it, expect } from 'vitest';
import { runQuotationEngine } from './engine';

describe('Quotation Engine', () => {
  it('should compute service subtotal and totals with tax', () => {
    const res = runQuotationEngine({
      cargoLines: [],
      serviceLines: [
        { id: 's1', quantity: 2, unit_price: 1000 },
        { id: 's2', quantity: 1, unit_price: 5000 },
      ],
      context: { tax_rate: 0.18, rounding: 'none', currency: 'XOF' },
    });

    expect(res.snapshot.totals.subtotal_services).toBe(7000);
    expect(res.snapshot.totals.total_ht).toBe(7000);
    expect(res.snapshot.totals.total_tax).toBe(1260);
    expect(res.snapshot.totals.total_ttc).toBe(8260);
  });

  it('should aggregate cargo metrics', () => {
    const res = runQuotationEngine({
      cargoLines: [
        { id: 'c1', quantity: 2, weight_kg: 1000, volume_m3: 5 },
        { id: 'c2', quantity: 3, weight_kg: 500, volume_m3: 2.5 },
      ],
      serviceLines: [],
      context: { rounding: 'none' },
    });

    expect(res.snapshot.totals.subtotal_cargo_metrics.total_quantity).toBe(5);
    expect(res.snapshot.totals.subtotal_cargo_metrics.total_weight_kg).toBe(1500);
    expect(res.snapshot.totals.subtotal_cargo_metrics.total_volume_m3).toBe(7.5);
  });

  it('should coerce negative values and record issues', () => {
    const res = runQuotationEngine({
      cargoLines: [{ id: 'c1', quantity: -1, weight_kg: -5, volume_m3: 1 }],
      serviceLines: [{ id: 's1', quantity: -2, unit_price: 1000 }],
      context: { tax_rate: 0, rounding: 'none' },
    });

    expect(res.snapshot.totals.subtotal_services).toBe(0);
    expect(res.snapshot.totals.subtotal_cargo_metrics.total_quantity).toBe(0);
    expect(res.snapshot.totals.subtotal_cargo_metrics.total_weight_kg).toBe(0);
    expect(res.snapshot.issues.length).toBeGreaterThan(0);
    expect(res.snapshot.issues.some(i => i.code === 'NEGATIVE_VALUES_COERCED')).toBe(true);
  });

  it('should apply integer rounding when configured', () => {
    const res = runQuotationEngine({
      cargoLines: [],
      serviceLines: [{ id: 's1', quantity: 1, unit_price: 999.6 }],
      context: { tax_rate: 0.18, rounding: 'integer' },
    });

    expect(res.snapshot.totals.total_ht).toBe(1000);
    expect(res.snapshot.totals.total_tax).toBe(180);
    expect(res.snapshot.totals.total_ttc).toBe(1180);
    expect(res.snapshot.issues.some(i => i.code === 'ROUNDING_APPLIED')).toBe(true);
  });
});
