/**
 * Quotation Domain Guards — Phase 4F.1
 * 
 * Sanitization non-destructive des valeurs numériques.
 * Collecte des issues sans lever d'exceptions.
 */

import type { Money, QuoteIssue, Quantity, VolumeM3, WeightKg } from './types';

export function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function toNonNegativeNumber(
  value: unknown,
  issuePath: string,
  issues: QuoteIssue[]
): number | null {
  if (value === null || value === undefined) return null;
  if (!isFiniteNumber(value)) {
    issues.push({
      code: 'NON_FINITE_NUMBER',
      message: 'Valeur numérique non finie ignorée',
      path: issuePath,
    });
    return null;
  }
  if (value < 0) {
    issues.push({
      code: 'NEGATIVE_VALUES_COERCED',
      message: 'Valeur négative ramenée à 0',
      path: issuePath,
    });
    return 0;
  }
  return value;
}

export function asMoney(
  value: unknown,
  path: string,
  issues: QuoteIssue[]
): Money | null {
  return toNonNegativeNumber(value, path, issues) as Money | null;
}

export function asQuantity(
  value: unknown,
  path: string,
  issues: QuoteIssue[]
): Quantity | null {
  return toNonNegativeNumber(value, path, issues) as Quantity | null;
}

export function asWeightKg(
  value: unknown,
  path: string,
  issues: QuoteIssue[]
): WeightKg | null {
  return toNonNegativeNumber(value, path, issues) as WeightKg | null;
}

export function asVolumeM3(
  value: unknown,
  path: string,
  issues: QuoteIssue[]
): VolumeM3 | null {
  return toNonNegativeNumber(value, path, issues) as VolumeM3 | null;
}

export function applyRounding(
  value: number,
  rounding: 'none' | 'integer' | undefined,
  issues: QuoteIssue[],
  path: string
): number {
  if (rounding === 'integer') {
    const rounded = Math.round(value);
    if (rounded !== value) {
      issues.push({
        code: 'ROUNDING_APPLIED',
        message: 'Arrondi appliqué (integer)',
        path,
      });
    }
    return rounded;
  }
  return value;
}
