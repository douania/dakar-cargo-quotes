import type { SodatraFeeSuggestion, SuggestedFee } from '@/hooks/useSodatraFees';

export const OPTIONAL_ZONE_REPLY_CONTRACT = 'optional_factor_v1';

/** Only the two explicit compatibility refusals override the existing SDK error. */
export async function generationErrorMessage(error: unknown): Promise<string> {
  const fallback = error instanceof Error ? error.message : 'Erreur de génération';
  const context = (error as { context?: unknown } | null)?.context;
  if (!(context instanceof Response)) return fallback;
  try {
    const body = await context.clone().json();
    if (['ZONE_CONFIRMATION_REQUIRED', 'ZONE_ENGINE_CONTRACT_NOT_READY'].includes(body?.error?.code) && typeof body.error.message === 'string') return body.error.message;
  } catch { /* Preserve the original error if the response cannot be read. */ }
  return fallback;
}

export interface ServerGenerationPricing { fees: SodatraFeeSuggestion }

/** Fresh server results must not be replaced by a local Dakar calculation. */
export function readServerGenerationPricing(payload: Record<string, unknown>): ServerGenerationPricing {
  const source = payload.sodatra_fees as Record<string, unknown> | null;
  if (!source || !Array.isArray(source.fees) || typeof source.total_suggested !== 'number' || !Number.isFinite(source.total_suggested) ||
      !source.fees.every(fee => fee && typeof fee === 'object' && typeof fee.suggested_amount === 'number' && Number.isFinite(fee.suggested_amount))) {
    throw new Error('Honoraires serveur incomplets ; aucun calcul local de remplacement n’a été appliqué.');
  }
  const metadata = payload.quotation_metadata as { zone_resolution?: { status?: string; source?: string }; zone?: { multiplier?: unknown } | null } | null;
  const factor = source.complexity_factor;
  const known = metadata?.zone_resolution?.status === 'matched' &&
    ['delivery_zones', 'static_fallback'].includes(metadata.zone_resolution.source ?? '') &&
    typeof factor === 'number' && Number.isFinite(factor) && factor > 0 && factor === metadata.zone?.multiplier;
  const reasons = Array.isArray(source.complexity_reasons) ? source.complexity_reasons.filter((value): value is string => typeof value === 'string') : [];
  return { fees: {
    fees: source.fees as SuggestedFee[], total_suggested: source.total_suggested,
    complexity_factor: known ? factor : undefined,
    complexity_reasons: known ? [...reasons] : [...reasons, 'Facteur de zone à confirmer ; aucun facteur local de remplacement.'],
    transport_mode: typeof source.transport_mode === 'string' ? source.transport_mode : 'unknown',
    can_calculate_commission: source.can_calculate_commission === true,
    ...(typeof source.commission_note === 'string' ? { commission_note: source.commission_note } : {}),
  } };
}

export function selectGenerationFees(server: ServerGenerationPricing | undefined, historicalOrLocal: SodatraFeeSuggestion | null): SodatraFeeSuggestion | null {
  return server ? server.fees : historicalOrLocal;
}
