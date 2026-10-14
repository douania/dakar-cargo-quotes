import { readServiceScopeEvent } from './request-service-evidence.ts';
export const PARTIAL_CUSTOMS_GAP_KEYS = new Set(['cargo.hs_code', 'cargo.value', 'customs.regime_code']);
/** Every requested line must be returned once, even when reserved or skipped. */
export function assertPartialServiceResponse(data: unknown, ids: string[]): void {
  const lines = (data as { data?: { priced_lines?: unknown } })?.data?.priced_lines;
  if (!Array.isArray(lines) || lines.length !== ids.length || ids.some(id => lines.filter(l => l?.id === id).length !== 1)
    || lines.some(l => !l || typeof l.source !== 'string' || !(l.rate === null || (typeof l.rate === 'number' && Number.isFinite(l.rate))))) {
    throw new Error('Partial destination service response incomplete or invalid');
  }
}
export type PartialQuoteFact = { fact_key: string; value_number?: number | null; value_json?: unknown; source_type?: string | null; is_validated?: boolean };

/** Explicit provisional request only; no implicit scope/lot-count fallback. */
export function partialDestinationDdpEligible(input: { allowProvisional: boolean; packageKey: string; requestType: string; lotCount: number | null; scopeEvent: { actor_type?: string; event_data?: unknown } | null; serviceKeys: string[] }): boolean {
  if (!input.allowProvisional || input.packageKey !== 'AIR_IMPORT_DDP' || !['AIR_IMPORT', 'AIR_IMPORT_DDP'].includes(input.requestType)
    || input.lotCount === null || input.lotCount >= 2 || input.lotCount < 0 || !Number.isSafeInteger(input.lotCount)
    || input.serviceKeys.includes('AIR_FREIGHT') || !input.serviceKeys.includes('CUSTOMS_DAKAR')) return false;
  const scope = readServiceScopeEvent(input.scopeEvent?.event_data);
  if (!scope || scope.freight_scope !== false || scope.customs_scope === false) return false;
  const evidence = scope.request_evidence as { mode?: unknown } | undefined;
  return input.scopeEvent?.actor_type === 'operator' || evidence?.mode === 'destination';
}

/** No volumetric formula or gross-weight substitution. Existing operator choice wins. */
export function partialChargeableWeight(facts: PartialQuoteFact[]): { kg: number | null; reason: string | null } {
  const fact = facts.find(f => f.fact_key === 'cargo.chargeable_weight_kg');
  const number = fact?.value_number;
  if (typeof number !== 'number' || !Number.isFinite(number) || number <= 0) return { kg: null, reason: 'MISSING_CHARGEABLE_WEIGHT' };
  const dimensions = facts.find(f => f.fact_key === 'cargo.dimensions_evidence')?.value_json;
  const conflict = dimensions && typeof dimensions === 'object' && (dimensions as Record<string, unknown>).conflict === true;
  const protectedChoice = fact?.is_validated === true || ['operator', 'operator_correction', 'manual_input'].includes(fact?.source_type ?? '');
  if (conflict && !protectedChoice) return { kg: null, reason: 'DIMENSIONS_CONFLICT_CHARGEABLE_UNCONFIRMED' };
  return { kg: number, reason: null };
}

/** A KG unit/service name never establishes which weight a tariff requires. */
export function partialKgQuantity(rule: { requires_fact_key?: string | null }, facts: PartialQuoteFact[]): { kg: number | null; factKey: string | null; reason: string | null } {
  const key = rule.requires_fact_key?.trim() ?? '';
  if (key === 'cargo.chargeable_weight_kg') return { ...partialChargeableWeight(facts), factKey: key };
  if (!['cargo.weight_kg', 'cargo.weight_net_kg'].includes(key)) return { kg: null, factKey: null, reason: 'KG_TARIFF_BASIS_UNSPECIFIED' };
  const value = facts.find(f => f.fact_key === key)?.value_number;
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? { kg: value, factKey: key, reason: null }
    : { kg: null, factKey: key, reason: 'MISSING_REQUIRED_TARIFF_WEIGHT' };
}
