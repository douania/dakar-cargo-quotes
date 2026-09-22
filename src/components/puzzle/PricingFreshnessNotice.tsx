/** Compares saved execution dates only; never asserts tariff expiry. */
export function PricingFreshnessNotice({ pricingAt, estimateAt }: { pricingAt?: string | null; estimateAt?: string | null }) {
  const pricing = Date.parse(pricingAt ?? "");
  const estimate = Date.parse(estimateAt ?? "");
  if (!Number.isFinite(pricing) || !Number.isFinite(estimate) || pricing >= estimate) return null;
  return <p role="note" className="text-xs text-amber-700 dark:text-amber-300">
    Ce pricing enregistré le {new Date(pricing).toLocaleString("fr-FR")} est antérieur à l’estimation du scénario du {new Date(estimate).toLocaleString("fr-FR")} et n’a pas été actualisé par son calcul — périmètres, hypothèses et montants sont distincts ; cela ne prouve pas que les barèmes sont périmés.
  </p>;
}
