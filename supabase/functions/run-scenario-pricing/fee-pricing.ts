import { buildFeeCaseContextFromFacts } from "../_shared/fee-case-facts.ts";
import { resolveFeeLine, type FeeLineRow, type FeeRuleRow } from "../_shared/fee-rules.ts";
import type { PricingFactRow, ScenarioTariffLine } from "./domain.ts";
import type { ScenarioCargoContext } from "../_shared/scenario-cargo.ts";
/** Reuse H2's pure resolver once per case, never once per cargo group. */
export function priceScenarioFees(args: {
  facts: PricingFactRow[]; cargo: ScenarioCargoContext; containers: { type: string; quantity: number }[];
  weightKg: number | null; requested: string[]; lines: FeeLineRow[]; rules: FeeRuleRow[]; today: string;
}): ScenarioTariffLine[] {
  const context = buildFeeCaseContextFromFacts({ factsMap: new Map(args.facts.map(f => [f.fact_key, {
    value_text: typeof f.value_text === "string" ? f.value_text : null,
    value_number: typeof f.value_number === "number" ? f.value_number : null,
    value_json: f.value_json,
  }])),
    requestType: "SEA_FCL_IMPORT", asOfDate: args.today,
    override: { scope: "IMPORT", containers: args.containers, weight_kg: args.weightKg, caf_value: null, imo_facts: [] } });
  const dangers = args.cargo.cargo_units.map(u => u.dangerous_goods);
  context.dangerousGoods = dangers.every(d => d === false) ? false : dangers.every(d => d === true) ? true : null;
  return [...new Set(args.requested)].filter(key => ["AGENCY", "CUSTOMS_DAKAR"].includes(key)).map(key => {
    const matching = args.lines.filter(l => l.code === key && l.is_active === true);
    const resolution = matching.length === 1 ? resolveFeeLine(matching[0], args.rules, context) : null;
    const currencySupported = args.rules.find(r => r.id === resolution?.ruleId)?.currency === "XOF";
    const priced = resolution?.status === "RESOLVED" && resolution.amount !== null && currencySupported;
    const foreignCurrency = resolution?.status === "RESOLVED" && !currencySupported;
    const skipped = resolution?.status === "SKIPPED";
    return { id: `scenario-fee-${key.toLowerCase()}`, bloc: "honoraires", category: key, canonical: { service_key: key },
      description: resolution?.label ?? key, amount: priced ? resolution.amount : skipped ? 0 : null,
      currency: "XOF", isEditable: false,
      notes: foreignCurrency ? "Devise de la règle d’honoraires différente de XOF ou inconnue ; aucune conversion inventée." : resolution ? `${resolution.message}${resolution.detail ? ` — ${resolution.detail}` : ""}` : "Ligne d’honoraires active unique non disponible ; aucun forfait inventé.",
      source: { type: priced ? "validated_internal" : skipped ? "EXCLUDED_BY_RULE" : "TO_CONFIRM",
        reference: priced ? `fee_rules:${resolution.ruleId}` : foreignCurrency ? "FEE_CURRENCY_UNSUPPORTED" : resolution?.reason ?? (skipped ? "Non facturé selon le paramétrage de la ligne" : "FEE_LINE_UNAVAILABLE"),
        fee_line_id: resolution?.lineId ?? null, rule_id: resolution?.ruleId ?? null,
        vat_applicable: resolution?.vatApplicable ?? false, confidence: priced || skipped ? 0.95 : 0 } };
  });
}
