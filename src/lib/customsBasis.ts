export { validateCustomsDecision, type CustomsDecision, type CustomsBasisSnapshot } from '../../supabase/functions/_shared/customs-basis';
export type { CustomsSourceProposal, CustomsSourceGroup } from '../../supabase/functions/_shared/customs-source-proposals';
/** Private to the caller; do not stringify opaque SDK errors or credentials. */
export async function customsResponse(result: {data: unknown;error: {message?: string;context?: unknown}|null}) {
  if(result.error){let message='Opération indisponible. Votre saisie est conservée.';
    if(result.error.context instanceof Response){const body=await result.error.context.json().catch(()=>null);if(typeof body?.error?.message==='string')message=body.error.message;}
    throw new Error(message);
  }
  const value=result.data as Record<string,unknown>;
  if(!value || value.success===false || value.status==='blocked' || value.error || (Array.isArray(value.pricing_blockers)&&value.pricing_blockers.length))throw new Error('Opération refusée : relisez les bases et les réserves du dossier.');
  return value;
}
