/**
 * Edge Function: generate-quotation
 * Phase 6D.1 — Transition draft → generated avec snapshot figé
 * 
 * Conformité Phase 6C: Tous les changements de statut métier passent par Edge Function.
 * Phase 14: Runtime observability integration
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { 
  getCorrelationId, 
  respondOk, 
  respondError, 
  logRuntimeEvent,
} from "../_shared/runtime.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Phase 14: Correlation + timing
  const correlationId = getCorrelationId(req);
  const startTime = Date.now();
  let userId: string | undefined;

  try {
    // 1. Validation JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return respondError({
        code: 'AUTH_MISSING_JWT',
        message: 'Missing authorization header',
        correlationId,
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Client with user's token for auth validation
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } }
    });
    
    // Validate JWT using getUser (méthode standard Supabase)
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    
    if (authError || !user) {
      console.error('Auth error:', authError);
      return respondError({
        code: 'AUTH_INVALID_JWT',
        message: 'Invalid or expired token',
        correlationId,
      });
    }

    userId = user.id;

    // 2. Parse body
    const { quotation_id, snapshot } = await req.json();

    // 3. Validation stricte
    if (!quotation_id || typeof quotation_id !== 'string') {
      return new Response(
        JSON.stringify({ error: 'quotation_id requis (UUID existant)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!snapshot || !snapshot.meta || !snapshot.client) {
      return new Response(
        JSON.stringify({ error: 'Snapshot invalide' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate snapshot meta matches quotation_id
    if (snapshot.meta.quotation_id !== quotation_id) {
      return new Response(
        JSON.stringify({ error: 'Snapshot quotation_id mismatch' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Service client (bypass RLS pour vérification + update)
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // 5. Vérifier ownership + statut actuel
    const { data: existingDraft, error: fetchError } = await serviceClient
      .from('quotation_history')
      .select('id, status, created_by, version')
      .eq('id', quotation_id)
      .single();

    if (fetchError || !existingDraft) {
      console.error('Fetch error:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Devis introuvable' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 6. Contrôle ownership strict
    if (existingDraft.created_by !== userId) {
      console.error('Ownership check failed:', { created_by: existingDraft.created_by, userId });
      return new Response(
        JSON.stringify({ error: 'Non autorisé' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. Vérifier transition valide (seul draft → generated autorisé)
    if (existingDraft.status !== 'draft') {
      return new Response(
        JSON.stringify({ 
          error: 'Ce devis a déjà été généré', 
          current_status: existingDraft.status 
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 8. UPDATE avec snapshot figé
    const generatedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await serviceClient
      .from('quotation_history')
      .update({
        status: 'generated',
        generated_at: generatedAt,
        generated_snapshot: snapshot,
        updated_at: generatedAt,
      })
      .eq('id', quotation_id)
      .select('id, version, status, generated_at')
      .single();

    if (updateError) {
      console.error('Update error:', updateError);
      throw updateError;
    }

    console.log('Quotation generated successfully:', { quotation_id, version: updated.version });

    // Phase 14: Log runtime event
    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: 'generate-quotation',
      op: 'generate',
      userId,
      status: 'ok',
      httpStatus: 200,
      durationMs: Date.now() - startTime,
      meta: { quotation_id, version: updated.version },
    });

    return respondOk({ success: true, quotation: updated }, correlationId);

  } catch (error) {
    console.error('generate-quotation error:', error);
    
    // Phase 14: Log error
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: 'generate-quotation',
      op: 'generate',
      userId,
      status: 'fatal_error',
      errorCode: 'UNKNOWN',
      httpStatus: 500,
      durationMs: Date.now() - startTime,
      meta: { error: String(error) },
    });

    return respondError({
      code: 'UNKNOWN',
      message: 'Échec génération',
      correlationId,
      meta: { details: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
});
