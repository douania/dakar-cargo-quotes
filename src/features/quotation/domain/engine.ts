/**
 * Quotation Engine — Phase 4F.3
 * 
 * Orchestrateur pur : collecte input → calcule totals → retourne snapshot.
 * Sérialisable, prêt pour API/PDF.
 */

import type { QuotationEngineResult, QuotationInput, QuoteIssue } from './types';
import { computeTotals } from './rules';

export function runQuotationEngine(input: QuotationInput): QuotationEngineResult {
  const issues: QuoteIssue[] = [];

  const totals = computeTotals(input, issues);

  return {
    input,
    snapshot: {
      totals,
      issues,
    },
  };
}
