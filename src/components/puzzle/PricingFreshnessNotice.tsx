/** Compares saved execution dates only; never asserts tariff expiry. */
export function PricingFreshnessNotice({ pricingAt, estimateAt }: { pricingAt?: string | null; estimateAt?: string | null }) {
  const pricing = Date.parse(pricingAt ?? "");
  const estimate = Date.parse(estimateAt ?? "");
  if (!Number.isFinite(pricing) || !Number.isFinite(estimate) || pricing >= estimate) return null;
  return <p role="note" className="rounded border border-amber-400/50 bg-amber-50/50 p-3 text-sm dark:bg-amber-950/20">
    Ce pricing enregistré le {new Date(pricing).toLocaleString("fr-FR")} est antérieur à l’estimation du scénario du {new Date(estimate).toLocaleString("fr-FR")}.
    Il n’a pas été actualisé par le calcul du scénario : périmètres, hypothèses et montants sont distincts.
    Cela ne prouve pas, à lui seul, que les barèmes sont périmés.
  </p>;
}
