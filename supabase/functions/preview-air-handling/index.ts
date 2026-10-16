import { createClient } from 'jsr:@supabase/supabase-js@2';
import { requireUser } from '../_shared/auth.ts';
import { handleCors } from '../_shared/cors.ts';
import { getCorrelationId, respondError, respondOk } from '../_shared/runtime.ts';
import { resolveAirHandling, type AirProfile, type AirState } from '../_shared/air-handling.ts';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read-only: exactly the resolver used by pricing; no fact/run/version writes. */
export async function handleAirPreview(req: Request): Promise<Response> {
  const cors = handleCors(req); if (cors) return cors;
  const correlationId = getCorrelationId(req);
  const auth = await requireUser(req); if (auth instanceof Response) return auth;
  try {
    if (req.method !== 'POST') throw new Error('POST required');
    const body = await req.json();
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${auth.token}` } }, auth: { persistSession: false },
    });
    let state: AirState;
    let example = false;
    if (typeof body.case_id === 'string' && uuid.test(body.case_id)) {
      const read = await client.rpc('air_handling_read', { p_case_id: body.case_id });
      if (read.error || !read.data) return respondError({ code: 'FORBIDDEN_OWNER', message: 'Dossier inaccessible', correlationId });
      state = read.data as AirState;
    } else {
      if (!uuid.test(body.profile_id ?? '') || typeof body.taxable_kg !== 'number' || !Number.isFinite(body.taxable_kg)
        || body.taxable_kg <= 0 || body.general_cargo_confirmed !== true || typeof body.warehouse_bracket_confirmed !== 'boolean') throw new Error('Example input invalid');
      const read = await client.rpc('air_handling_read', {});
      if (read.error) throw new Error('Profile unavailable');
      const profiles = (read.data as { profiles?: AirProfile[] })?.profiles;
      const profile = profiles?.find(p => p.id === body.profile_id);
      if (!profile) throw new Error('Profile unavailable');
      example = true;
      state = { selection: { id: 'read-only-example', profile_id: profile.id, context_hash: 'example', source_reference: 'Simulation explicite hors dossier',
        warehouse_bracket_confirmed: body.warehouse_bracket_confirmed }, profile, context_hash: 'example', request_type: 'AIR_IMPORT', lot_count: 0,
        facts: [{ fact_key: 'cargo.chargeable_weight_kg', value_number: body.taxable_kg, source_type: 'operator' }] };
    }
    return respondOk({ example, resolution: resolveAirHandling(state, new Date().toISOString().slice(0, 10)) }, correlationId);
  } catch {
    return respondError({ code: 'VALIDATION_FAILED', message: 'Paramètres incomplets ou profil indisponible', correlationId });
  }
}
if (import.meta.main) Deno.serve(handleAirPreview);
