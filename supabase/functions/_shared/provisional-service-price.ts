// Missing/invalid service prices remain reserves; explicit finite zero is known.
export function provisionalServicePrice(rate: unknown, source: unknown) {
  const known = typeof rate === "number" && Number.isFinite(rate);
  return {
    amount: known ? rate : null,
    sourceType: known ? (typeof source === "string" && source ? source : "price-service-lines") : "TO_CONFIRM",
  };
}
