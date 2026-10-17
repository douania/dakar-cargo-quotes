/** Snapshot composition only. Matches the existing fee VAT rule in
 * run-pricing/commercial-totals.ts (18%, Math.round), without importing a sibling
 * Edge directory that Lovable does not include in this deployment bundle.
 * The compatibility test compares this narrow projection with that frozen owner. */
export function commercialFeeTotals(subtotalBeforeSodatraVat: number,honorairesHt: number) {
  const honorairesTva=Math.round(honorairesHt*0.18);
  return {honorairesTva,honorairesTtc:honorairesHt+honorairesTva,totalPayable:subtotalBeforeSodatraVat+honorairesTva};
}
