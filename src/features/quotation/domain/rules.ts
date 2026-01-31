/**
 * Quotation Domain Rules — Phase 4F.2
 * 
 * Calculs purs sans effet de bord.
 * Agrégation métriques cargo + subtotal services.
 */

import type {
  CargoLineDomain,
  Money,
  QuotationInput,
  QuotationTotals,
  QuoteIssue,
  ServiceLineDomain,
} from './types';
import {
  applyRounding,
  asMoney,
  asQuantity,
  asVolumeM3,
  asWeightKg,
} from './guards';

function sumCargoMetrics(
  cargoLines: ReadonlyArray<CargoLineDomain>,
  issues: QuoteIssue[]
) {
  let total_weight_kg = 0;
  let total_volume_m3 = 0;
  let total_quantity = 0;

  cargoLines.forEach((l, i) => {
    const q = asQuantity(l.quantity, `cargoLines[${i}].quantity`, issues) ?? 0;
    const w = asWeightKg(l.weight_kg, `cargoLines[${i}].weight_kg`, issues) ?? 0;
    const v = asVolumeM3(l.volume_m3, `cargoLines[${i}].volume_m3`, issues) ?? 0;

    total_quantity += q;
    total_weight_kg += w;
    total_volume_m3 += v;
  });

  return { total_quantity, total_weight_kg, total_volume_m3 };
}

function sumServiceSubtotal(
  serviceLines: ReadonlyArray<ServiceLineDomain>,
  issues: QuoteIssue[]
): Money {
  let subtotal = 0;

  serviceLines.forEach((l, i) => {
    const q = asQuantity(l.quantity, `serviceLines[${i}].quantity`, issues) ?? 0;
    const p = asMoney(l.unit_price, `serviceLines[${i}].unit_price`, issues) ?? 0;
    subtotal += q * p;
  });

  return subtotal;
}

export function computeTotals(
  input: QuotationInput,
  issues: QuoteIssue[]
): QuotationTotals {
  const rounding = input.context?.rounding ?? 'none';
  const tax_rate = input.context?.tax_rate ?? 0;

  const cargo = sumCargoMetrics(input.cargoLines, issues);
  const subtotal_services = sumServiceSubtotal(input.serviceLines, issues);

  let total_ht = subtotal_services;
  let total_tax = total_ht * (tax_rate > 0 ? tax_rate : 0);
  let total_ttc = total_ht + total_tax;

  total_ht = applyRounding(total_ht, rounding, issues, 'totals.total_ht');
  total_tax = applyRounding(total_tax, rounding, issues, 'totals.total_tax');
  total_ttc = applyRounding(total_ttc, rounding, issues, 'totals.total_ttc');

  return {
    subtotal_services,
    subtotal_cargo_metrics: cargo,
    total_ht,
    total_tax,
    total_ttc,
  };
}
