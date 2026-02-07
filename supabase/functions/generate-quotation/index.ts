/**
 * Edge Function: generate-quotation
 * Phase 6D.1 — Transition draft → generated avec snapshot figé
 * 
 * Conformité Phase 6C: Tous les changements de statut métier passent par Edge Function.
 * Phase 14: Runtime observability integration
 * CTO CORRECTIONS: All returns use respondOk/respondError + logRuntimeEvent
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { 
  getCorrelationId, 
  respondOk, 
  respondError, 
  logRuntimeEvent,
} from "../_shared/runtime.ts";
import { requireUser } from "../_shared/auth.ts";

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

  // Service client créé tôt pour logging
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Phase S0: Unified auth guard
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    userId = user.id;

    // 2. Parse body
    const { quotation_id, snapshot } = await req.json();

    // 3. Validation stricte
    if (!quotation_id || typeof quotation_id !== 'string') {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'generate-quotation',
        op: 'validate',
        userId,
        status: 'fatal_error',
        errorCode: 'VALIDATION_FAILED',
        httpStatus: 400,
        durationMs: Date.now() - startTime,
        meta: { field: 'quotation_id' },
      });
      return respondError({
        code: 'VALIDATION_FAILED',
        message: 'quotation_id requis (UUID existant)',
        correlationId,
      });
    }

    if (!snapshot || !snapshot.meta || !snapshot.client) {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'generate-quotation',
        op: 'validate',
        userId,
        status: 'fatal_error',
        errorCode: 'VALIDATION_FAILED',
        httpStatus: 400,
        durationMs: Date.now() - startTime,
        meta: { field: 'snapshot' },
      });
      return respondError({
        code: 'VALIDATION_FAILED',
        message: 'Snapshot invalide',
        correlationId,
      });
    }

    // Validate snapshot meta matches quotation_id
    if (snapshot.meta.quotation_id !== quotation_id) {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'generate-quotation',
        op: 'validate',
        userId,
        status: 'fatal_error',
        errorCode: 'VALIDATION_FAILED',
        httpStatus: 400,
        durationMs: Date.now() - startTime,
        meta: { expected: quotation_id, received: snapshot.meta.quotation_id },
      });
      return respondError({
        code: 'VALIDATION_FAILED',
        message: 'Snapshot quotation_id mismatch',
        correlationId,
      });
    }

    // 5. Vérifier ownership + statut actuel
    const { data: existingDraft, error: fetchError } = await serviceClient
      .from('quotation_history')
      .select('id, status, created_by, version')
      .eq('id', quotation_id)
      .single();

    if (fetchError || !existingDraft) {
      console.error('Fetch error:', fetchError);
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'generate-quotation',
        op: 'load_quotation',
        userId,
        status: 'fatal_error',
        errorCode: 'VALIDATION_FAILED',
        httpStatus: 404,
        durationMs: Date.now() - startTime,
        meta: { quotation_id },
      });
      return respondError({
        code: 'VALIDATION_FAILED',
        message: 'Devis introuvable',
        correlationId,
      });
    }

    // 6. Contrôle ownership strict
    if (existingDraft.created_by !== userId) {
      console.error('Ownership check failed:', { created_by: existingDraft.created_by, userId });
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'generate-quotation',
        op: 'ownership',
        userId,
        status: 'fatal_error',
        errorCode: 'FORBIDDEN_OWNER',
        httpStatus: 403,
        durationMs: Date.now() - startTime,
        meta: { quotation_id, owner: existingDraft.created_by },
      });
      return respondError({
        code: 'FORBIDDEN_OWNER',
        message: 'Non autorisé',
        correlationId,
      });
    }

    // 7. Vérifier transition valide (seul draft → generated autorisé)
    if (existingDraft.status !== 'draft') {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'generate-quotation',
        op: 'status_check',
        userId,
        status: 'fatal_error',
        errorCode: 'CONFLICT_INVALID_STATE',
        httpStatus: 409,
        durationMs: Date.now() - startTime,
        meta: { quotation_id, current_status: existingDraft.status },
      });
      return respondError({
        code: 'CONFLICT_INVALID_STATE',
        message: 'Ce devis a déjà été généré',
        correlationId,
        meta: { current_status: existingDraft.status },
      });
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
    
    // Phase 14: Log error (serviceClient déjà créé en haut)
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
    });
  }
});
