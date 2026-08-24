/**
 * PAD scope blocker — pure extraction from `run-pricing/index.ts` (roadmap PACK P0-B).
 *
 * Holds ONLY the PAD decision: the service keys that put a scope in PAD range, the
 * operator-facing message, the two fact readers it needs and `resolvePadScopeBlocker`
 * itself. Package/override resolution stays in `index.ts` — both call sites already
 * compute `effectiveServiceKeys` there, so it is a REQUIRED input here rather than a
 * fallback recomputed from the facts.
 *
 * The DOCTRINE is the doctrine of the previously inlined helper, unchanged: this module
 * exists to make the `PAD_CATEGORY_REQUIRED` branch directly testable, not to revisit it.
 * The only correction since the extraction is in the fact readers below — they now read
 * the BUSINESS value of a fact instead of the MAP-6/7B/8B propagation metadata that also
 * lives in `value_json` (P0-E runtime). Nothing was relaxed: a category alone, a rate
 * alone, a null/zero/negative/non-numeric rate or an empty category still block. See
 * `run-pricing/pad-scope-blocker_test.ts` for the contract it pins.
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

function findFact(facts: PadScopeFact[], factKey: string): PadScopeFact | undefined {
  return (facts || []).find((f: any) => f?.fact_key === factKey);
}

/**
 * A scalar column holds a business value; a JSON object/array never does on the PAD keys —
 * see `readFactValue`. Booleans are included for completeness, the PAD keys never use them.
 */
function isBusinessScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/**
 * Business value of a fact, scalar columns first.
 *
 * The historical precedence `value_json ?? value_number ?? value_text` is kept BETWEEN
 * scalars, with one correction proven by the P0-E runtime: the MAP-6 / MAP-7B / MAP-8B
 * propagation RPCs call `supersede_fact` with the business value in `value_text` /
 * `value_number` and RESERVE `value_json` for propagation metadata:
 *
 *   cargo.pad_category          value_text  'T02'
 *                               value_json  { origin: 'MAP-6', candidate_id, …,
 *                                             propagation_idempotency_key, scheme }
 *   cargo.pad_rate_fcfa_per_ton value_number 9678 / value_text '9678'
 *                               value_json  { origin: 'MAP-8B', tariff_source: { … },
 *                                             idempotency_key, previous_amount }
 *
 * Reading that object as the value made the guard block a dossier whose category AND
 * official rate were both materialised. A JSON object/array is therefore skipped when a
 * scalar column is present. Facts whose value really IS JSON (no scalar column beside it,
 * e.g. `service.overrides`) still get their `value_json` back unchanged, and the metadata
 * object is never mined for a business value — `tariff_source.amount` stays invisible here,
 * so a rate whose scalar columns are empty/zero/negative keeps failing closed.
 */
export function readFactValue(
  facts: PadScopeFact[],
  factKey: string,
): any {
  const fact = findFact(facts, factKey);
  if (!fact) return null;
  const businessValue = [fact.value_json, fact.value_number, fact.value_text].find(isBusinessScalar);
  if (businessValue !== undefined) return businessValue;
  return fact.value_json ?? fact.value_number ?? fact.value_text ?? null;
}

/**
 * Textual business value: first non-empty string among the value columns.
 *
 * `value_number` is deliberately excluded — a numeric PAD category is not a category — and
 * a `value_json` metadata object is skipped in favour of `value_text`, which is where the
 * propagation writes the validated `^[TPC][0-9]{2}$` code.
 */
function readTextFactValue(
  facts: PadScopeFact[],
  factKey: string,
): string | null {
  const fact = findFact(facts, factKey);
  if (!fact) return null;
  for (const raw of [fact.value_json, fact.value_text]) {
    if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  }
  return null;
}

export function hasNonEmptyFactValue(
  facts: PadScopeFact[],
  factKey: string,
): boolean {
  return readTextFactValue(facts, factKey) !== null;
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
  // Numeric/textual business value only: a JSON object (propagation metadata) or a boolean
  // is not a tariff, and must not be coerced into one.
  const padRateValue = readFactValue(params.facts || [], 'cargo.pad_rate_fcfa_per_ton');
  const padRate = typeof padRateValue === 'number' || typeof padRateValue === 'string'
    ? Number(padRateValue)
    : Number.NaN;
  const hasOfficialPadRate = Number.isFinite(padRate) && padRate > 0;

  if (hasPadCategory && hasOfficialPadRate) return null;

  return {
    pricing_blockers: ['PAD_CATEGORY_REQUIRED'],
    message: PAD_CATEGORY_REQUIRED_MESSAGE,
    scope_debug: { servicePackage, incoterm, effectiveServiceKeys },
  };
}
