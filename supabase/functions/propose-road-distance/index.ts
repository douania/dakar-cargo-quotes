import { createClient } from 'jsr:@supabase/supabase-js@2';
import { requireUser } from '../_shared/auth.ts';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { proposeDistance, readOrigin } from './domain.ts';

// No service-role client, writes, pricing, or raw provider/error logging.
const dependencies = { authenticate: requireUser, client: createClient, env: (key: string) => Deno.env.get(key), propose: proposeDistance };
export async function handleRequest(req: Request, deps = dependencies): Promise<Response> {
  const cors = handleCors(req); if (cors) return cors;
  if (req.method !== 'POST') return errorResponse('Méthode non autorisée', 405);
  const auth = await deps.authenticate(req); if (auth instanceof Response) return auth;
  let body;
  try { const raw = await req.text(); if (raw.length > 2048) return errorResponse('Requête trop longue', 400); body = JSON.parse(raw); }
  catch { return errorResponse('Requête invalide', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
    Object.keys(body).some(k => !['case_id', 'destination', 'selected_id'].includes(k)) ||
    typeof body.case_id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.case_id) ||
    typeof body.destination !== 'string' || body.destination.length > 200 ||
    (body.selected_id !== undefined && (typeof body.selected_id !== 'string' || body.selected_id.length > 200))) return errorResponse('Requête invalide', 400);
  const db = deps.client(deps.env('SUPABASE_URL')!, deps.env('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${auth.token}` } }, auth: { persistSession: false },
  });
  const access = await db.from('quote_cases').select('id').eq('id', body.case_id).maybeSingle();
  if (access.error || !access.data) return errorResponse('Dossier inaccessible', 403);
  let destination = body.destination.trim();
  if (!destination) {
    const facts = await db.from('quote_facts').select('value_text').eq('case_id', body.case_id)
      .eq('is_current', true).eq('fact_key', 'routing.destination_city');
    if (facts.error || facts.data?.length !== 1 || !facts.data[0].value_text) return errorResponse('Précisez la destination de livraison.', 422);
    destination = facts.data[0].value_text;
  }
  const origin = readOrigin(deps.env('TOMTOM_DAKAR_ORIGIN'));
  const key = deps.env('TOMTOM_API_KEY');
  if (!origin || !key) return errorResponse('Clé cartographique absente ou configuration du départ invalide. Saisie manuelle disponible.', 503);
  try { return jsonResponse(await deps.propose(destination, body.selected_id, origin, key)); }
  catch (e) { return errorResponse(e instanceof Error ? e.message : 'Distance indisponible', 422); }
}
if (import.meta.main) Deno.serve(req => handleRequest(req));
