/**
 * PAD scope blocker — pure extraction from `run-pricing/index.ts` (roadmap PACK P0-B).
 *
 * Holds ONLY the PAD decision: the service keys that put a scope in PAD range, the
 * operator-facing message, the two fact readers it needs and `resolvePadScopeBlocker`
 * itself. Package/override resolution stays in `index.ts` — both call sites already
 * compute `effectiveServiceKeys` there, so it is a REQUIRED input here rather than a
 * fallback recomputed from the facts.
 *
 * The behaviour is the behaviour of the previously inlined helper, unchanged: this
 * module exists to make the `PAD_CATEGORY_REQUIRED` branch directly testable, not to
 * revisit the doctrine. See `run-pricing/pad-scope-blocker_test.ts` for the contract
 * it pins.
 */

/** Shape of the fact rows `run-pricing` reads (a subset of `case_facts`). */
export type PadScopeFact = {
  fact_key: string;
  value_json?: any;
  value_number?: any;
  value_text?: any;
};

/** A scope containing any of these services cannot be priced without a PAD category. */
export const PAD_SCOPE_SERVICE_KEYS = new Set([
  'PORT_DAKAR_HANDLING',
  'PAD_DROIT_PASSAGE',
]);

export const PAD_CATEGORY_REQUIRED_MESSAGE =
  "Catégorie PAD / droit de passage requise pour chiffrer le service portuaire inclus dans le devis.";

export type PadScopeBlocker = {
  pricing_blockers: ['PAD_CATEGORY_REQUIRED'];
  message: string;
  scope_debug: { servicePackage: string; incoterm: string; effectiveServiceKeys: string[] };
};

export function readFactValue(
  facts: PadScopeFact[],
  factKey: string,
): any {
  const fact = (facts || []).find((f: any) => f?.fact_key === factKey);
  return fact?.value_json ?? fact?.value_number ?? fact?.value_text ?? null;
}

export function hasNonEmptyFactValue(
  facts: PadScopeFact[],
  factKey: string,
): boolean {
  const value = readFactValue(facts, factKey);
  return typeof value === 'string' && value.trim() !== '';
}

export function resolvePadScopeBlocker(params: {
  facts: PadScopeFact[];
  servicePackage: string;
  effectiveServiceKeys: string[];
  incoterm: string;
}): null | PadScopeBlocker {
  const servicePackage = String(params.servicePackage || '').trim().toUpperCase();
  const incoterm = String(params.incoterm || '').trim().toUpperCase();
  const effectiveServiceKeys = (params.effectiveServiceKeys ?? [])
    .map((key) => String(key || '').trim().toUpperCase())
    .filter(Boolean);

  const padRequiredByScope = effectiveServiceKeys.some((key) => PAD_SCOPE_SERVICE_KEYS.has(key));
  if (!padRequiredByScope) return null;

  const hasPadCategory =
    hasNonEmptyFactValue(params.facts || [], 'cargo.pad_category') ||
    hasNonEmptyFactValue(params.facts || [], 'pricing.pad_category');
  const padRate = Number(readFactValue(params.facts || [], 'cargo.pad_rate_fcfa_per_ton'));
  const hasOfficialPadRate = Number.isFinite(padRate) && padRate > 0;

  if (hasPadCategory && hasOfficialPadRate) return null;

  return {
    pricing_blockers: ['PAD_CATEGORY_REQUIRED'],
    message: PAD_CATEGORY_REQUIRED_MESSAGE,
    scope_debug: { servicePackage, incoterm, effectiveServiceKeys },
  };
}
