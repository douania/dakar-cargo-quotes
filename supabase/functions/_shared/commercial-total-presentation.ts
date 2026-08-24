export interface CommercialTotalPresentation {
  isDetailed: boolean;
  subtotalBeforeSodatraVat: number;
  honorairesVat: number | null;
  totalPayable: number;
  currency: string;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function resolveCommercialTotalPresentation(
  totals: Record<string, unknown> | null | undefined,
): CommercialTotalPresentation {
  const safeTotals = totals || {};
  const detailedSubtotal = finiteNumber(safeTotals.subtotal_before_sodatra_vat);
  const detailedPayable = finiteNumber(safeTotals.total_payable);
  const legacySubtotal = finiteNumber(safeTotals.total_ht) ?? 0;
  const legacyPayable = finiteNumber(safeTotals.total_ttc) ?? legacySubtotal;
  const isDetailed = detailedSubtotal !== null && detailedPayable !== null;

  return {
    isDetailed,
    subtotalBeforeSodatraVat: isDetailed ? detailedSubtotal : legacySubtotal,
    honorairesVat: isDetailed
      ? finiteNumber(safeTotals.honoraires_tva) ?? 0
      : null,
    totalPayable: isDetailed ? detailedPayable : legacyPayable,
    currency:
      typeof safeTotals.currency === "string" && safeTotals.currency.trim()
        ? safeTotals.currency
        : "XOF",
  };
}
