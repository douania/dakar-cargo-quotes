// ============================================================================
// Phase 13 — commit-decision (SEUL POINT D'ÉCRITURE DÉCISIONS)
// 
// ⚠️ CTO RULES:
// ✅ INSERT decision_proposals (sans committed_at initialement)
// ✅ Appel RPC commit_decision_atomic (transactionnel)
// ✅ UPDATE decision_proposals.committed_at après succès RPC
// ✅ INSERT case_timeline_events
// ✅ UPDATE quote_cases.status (→ DECISIONS_COMPLETE uniquement)
// 
// ❌ JAMAIS quote_facts
// ❌ JAMAIS status → READY_TO_PRICE
// 
// CORRECTIONS CTO PHASE 14 INTÉGRÉES:
// - B1: Tous les retours convertis en respondOk/respondError
// - B2: logRuntimeEvent avant chaque return
// - B3: Imports inutilisés retirés (structuredLog, getStatusFromErrorCode)
// - B4: Variable `type` corrigée en `decision_type`
// - B5: Double déclaration userId corrigée
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { computeCanonicalHash } from "../_shared/canonical-hash.ts";
import { 
  getCorrelationId, 
  respondOk, 
  respondError, 
  logRuntimeEvent,
  type ErrorCode 
} from "../_shared/runtime.ts";

// ============================================================================
// TYPES
// ============================================================================

interface CommitDecisionRequest {
  case_id: string;
  decision_type: 'regime' | 'routing' | 'services' | 'incoterm' | 'container';
  proposal_json: {
    options: unknown[];
    source_fact_ids: string[];
    generation_model?: string;
    generation_timestamp?: string;
  };
  selected_key: string;
  override_value?: string;
  override_reason?: string;
}

interface CommitDecisionResponse {
  decision_id: string;
  decision_version?: number;
  remaining_decisions: number;
  all_complete: boolean;
  idempotent?: boolean;
}

interface RpcResult {
  decision_id?: string;
  decision_version?: number;
  idempotent?: boolean;
  superseded_id?: string | null;
  status: 'created' | 'existing' | 'rejected';
  error?: string;
  blocking_count?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ALL_DECISION_TYPES = ['regime', 'routing', 'services', 'incoterm', 'container'] as const;
const ALLOWED_STATUSES = ['DECISIONS_PENDING', 'DECISIONS_COMPLETE'] as const;

// ============================================================================
// HANDLER
// ============================================================================

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Phase 14: Correlation + timing
  const correlationId = getCorrelationId(req);
  const startTime = Date.now();
  
  // CTO FIX B5: userId déclaré une seule fois, assigné après auth
  let userId: string | undefined;
  
  // Service client créé tôt pour logging (utilisé partout)
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // -------------------------------------------------------------------------
    // 1. JWT VALIDATION (via Supabase client with user token)
    // -------------------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'commit-decision',
        op: 'auth',
        status: 'fatal_error',
        errorCode: 'AUTH_MISSING_JWT',
        httpStatus: 401,
        durationMs: Date.now() - startTime,
      });
      return respondError({
        code: 'AUTH_MISSING_JWT',
        message: 'Authorization header required',
        correlationId,
      });
    }

    // User client for auth validation
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !user) {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'commit-decision',
        op: 'auth',
        status: 'fatal_error',
        errorCode: 'AUTH_INVALID_JWT',
        httpStatus: 401,
        durationMs: Date.now() - startTime,
      });
      return respondError({
        code: 'AUTH_INVALID_JWT',
        message: 'Invalid or expired token',
        correlationId,
      });
    }

    // CTO FIX B5: Assignation unique après validation
    userId = user.id;

    // -------------------------------------------------------------------------
    // 2. INPUT VALIDATION
    // -------------------------------------------------------------------------
    const body: CommitDecisionRequest = await req.json();
    const { case_id, decision_type, proposal_json, selected_key, override_value, override_reason } = body;

    // Required fields
    if (!case_id || typeof case_id !== 'string') {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'commit-decision',
        op: 'validate',
        userId,
        status: 'fatal_error',
        errorCode: 'VALIDATION_FAILED',
        httpStatus: 400,
        durationMs: Date.now() - startTime,
        meta: { field: 'case_id' },
      });
      return respondError({
        code: 'VALIDATION_FAILED',
        message: 'case_id is required',
        correlationId,
      });
    }

    if (!decision_type || !ALL_DECISION_TYPES.includes(decision_type)) {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'commit-decision',
        op: 'validate',
        userId,
        status: 'fatal_error',
        errorCode: 'VALIDATION_FAILED',
        httpStatus: 400,
        durationMs: Date.now() - startTime,
        meta: { field: 'decision_type', value: decision_type },
      });
      return respondError({
        code: 'VALIDATION_FAILED',
        message: `Invalid decision_type. Allowed: ${ALL_DECISION_TYPES.join(', ')}`,
        correlationId,
      });
    }

    if (!proposal_json || !Array.isArray(proposal_json.options)) {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'commit-decision',
        op: 'validate',
        userId,
        status: 'fatal_error',
        errorCode: 'VALIDATION_FAILED',
        httpStatus: 400,
        durationMs: Date.now() - startTime,
        meta: { field: 'proposal_json' },
      });
      return respondError({
        code: 'VALIDATION_FAILED',
        message: 'proposal_json with options array is required',
        correlationId,
      });
    }

    if (!selected_key || typeof selected_key !== 'string') {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'commit-decision',
        op: 'validate',
        userId,
        status: 'fatal_error',
        errorCode: 'VALIDATION_FAILED',
        httpStatus: 400,
        durationMs: Date.now() - startTime,
        meta: { field: 'selected_key' },
      });
      return respondError({
        code: 'VALIDATION_FAILED',
        message: 'selected_key is required',
        correlationId,
      });
    }

    // CTO RULE: Override requires reason
    if (override_value !== undefined && override_value !== null && override_value !== '') {
      if (!override_reason || override_reason.trim() === '') {
        await logRuntimeEvent(serviceClient, {
          correlationId,
          functionName: 'commit-decision',
          op: 'validate',
          userId,
          status: 'fatal_error',
          errorCode: 'VALIDATION_FAILED',
          httpStatus: 400,
          durationMs: Date.now() - startTime,
          meta: { field: 'override_reason' },
        });
        return respondError({
          code: 'VALIDATION_FAILED',
          message: 'override_reason is required when override_value is set',
          correlationId,
        });
      }
    }

    // -------------------------------------------------------------------------
    // 3. OWNERSHIP & STATUS CHECK
    // -------------------------------------------------------------------------
    const { data: quoteCase, error: caseError } = await serviceClient
      .from('quote_cases')
      .select('id, created_by, status')
      .eq('id', case_id)
      .single();

    if (caseError || !quoteCase) {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'commit-decision',
        op: 'ownership',
        userId,
        status: 'fatal_error',
        errorCode: 'VALIDATION_FAILED',
        httpStatus: 404,
        durationMs: Date.now() - startTime,
        meta: { case_id },
      });
      return respondError({
        code: 'VALIDATION_FAILED',
        message: 'Case not found',
        correlationId,
      });
    }

    // Mono-tenant app: all authenticated users can access all cases
    // Ownership check removed — JWT auth is sufficient

    // CTO RULE: Status must be in allowed list
    if (!ALLOWED_STATUSES.includes(quoteCase.status as typeof ALLOWED_STATUSES[number])) {
      console.warn(`[commit-decision] Refused: status=${quoteCase.status}, case=${case_id}`);
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'commit-decision',
        op: 'status_check',
        userId,
        status: 'fatal_error',
        errorCode: 'CONFLICT_INVALID_STATE',
        httpStatus: 409,
        durationMs: Date.now() - startTime,
        meta: { case_id, current_status: quoteCase.status },
      });
      return respondError({
        code: 'CONFLICT_INVALID_STATE',
        message: `Case status does not allow decision commit. Current: ${quoteCase.status}`,
        correlationId,
        meta: { allowed_statuses: ALLOWED_STATUSES },
      });
    }

    // -------------------------------------------------------------------------
    // 4. RÉCUPÉRER FACTS/GAPS POUR HASH FORENSIC (avec normalisation)
    // -------------------------------------------------------------------------
    const { data: currentFacts } = await serviceClient
      .from('quote_facts')
      .select('fact_key, value_text, value_number, value_json, value_date')
      .eq('case_id', case_id)
      .eq('is_current', true)
      .order('fact_key');

    const { data: currentGaps } = await serviceClient
      .from('quote_gaps')
      .select('gap_key, status, is_blocking')
      .eq('case_id', case_id)
      .order('gap_key');

    const factsHash = await computeCanonicalHash(currentFacts || []);
    const gapsHash = await computeCanonicalHash(currentGaps || []);

    // -------------------------------------------------------------------------
    // 5. CALCULER IDEMPOTENCY KEY AVANT INSERT (payload stable - CTO FIX)
    // Clé basée sur: case_id, decision_type, selected_key, override_reason, options_hash
    // -------------------------------------------------------------------------
    const optionsHash = await computeCanonicalHash(proposal_json?.options ?? []);
    const idempotencyKey = await computeCanonicalHash({
      case_id,
      decision_type,
      selected_key,
      override_reason: override_reason ?? null,
      options_hash: optionsHash
    });

    // -------------------------------------------------------------------------
    // 6. VÉRIFIER IDEMPOTENCE AVANT INSERT PROPOSAL (évite proposals orphelines)
    // -------------------------------------------------------------------------
    const { data: existingDecision } = await serviceClient
      .from('operator_decisions')
      .select('id, decision_version')
      .eq('case_id', case_id)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existingDecision) {
      // Retour idempotent SANS créer de proposal orpheline
      console.log(`[commit-decision] Idempotent early return for decision_id=${existingDecision.id}`);
      
      const { data: finalDecisions } = await serviceClient
        .from('operator_decisions')
        .select('decision_type')
        .eq('case_id', case_id)
        .eq('is_final', true);

      const completedTypes = new Set(finalDecisions?.map(d => d.decision_type) || []);
      const remainingDecisions = ALL_DECISION_TYPES.filter(t => !completedTypes.has(t)).length;

      const idempotentResponse: CommitDecisionResponse = {
        decision_id: existingDecision.id,
        decision_version: existingDecision.decision_version,
        idempotent: true,
        remaining_decisions: remainingDecisions,
        all_complete: remainingDecisions === 0
      };

      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'commit-decision',
        op: 'idempotent_early_return',
        userId,
        status: 'ok',
        httpStatus: 200,
        durationMs: Date.now() - startTime,
        meta: { decision_id: existingDecision.id, idempotent: true },
      });

      return respondOk(idempotentResponse, correlationId);
    }

    // -------------------------------------------------------------------------
    // 7. INSERT PROPOSAL SANS committed_at (seulement si décision nouvelle)
    // -------------------------------------------------------------------------
    const proposalBatchId = crypto.randomUUID();
    const now = new Date().toISOString();
    
    const { data: proposal, error: proposalError } = await serviceClient
      .from('decision_proposals')
      .insert({
        case_id,
        decision_type,
        proposal_batch_id: proposalBatchId,
        options_json: proposal_json,
        generated_at: now,
        generated_by: 'ai',
        facts_hash: factsHash,
        gaps_hash: gapsHash
      })
      .select('id')
      .single();

    if (proposalError || !proposal) {
      console.error('[commit-decision] Failed to insert proposal:', proposalError);
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'commit-decision',
        op: 'insert_proposal',
        userId,
        status: 'fatal_error',
        errorCode: 'UPSTREAM_DB_ERROR',
        httpStatus: 500,
        durationMs: Date.now() - startTime,
        meta: { error: proposalError?.message },
      });
      return respondError({
        code: 'UPSTREAM_DB_ERROR',
        message: 'Failed to save decision proposal',
        correlationId,
      });
    }

    const proposalId = proposal.id;

    // -------------------------------------------------------------------------
    // 8. APPELER RPC TRANSACTIONNELLE (avec clé stable)
    // -------------------------------------------------------------------------
    const { data: rpcResult, error: rpcError } = await serviceClient
      .rpc('commit_decision_atomic', {
        p_case_id: case_id,
        p_decision_type: decision_type,
        p_idempotency_key: idempotencyKey,
        p_proposal_id: proposalId,
        p_selected_key: selected_key,
        p_override_value: override_value || null,
        p_override_reason: override_reason || null,
        p_facts_hash: factsHash,
        p_gaps_hash: gapsHash,
        p_user_id: userId
      });

    if (rpcError) {
      console.error('[commit-decision] RPC error:', rpcError);
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'commit-decision',
        op: 'rpc_commit',
        userId,
        status: 'fatal_error',
        errorCode: 'UPSTREAM_DB_ERROR',
        httpStatus: 500,
        durationMs: Date.now() - startTime,
        meta: { error: rpcError.message },
      });
      return respondError({
        code: 'UPSTREAM_DB_ERROR',
        message: 'Transaction failed',
        correlationId,
        meta: { details: rpcError.message },
      });
    }

    const result = rpcResult as RpcResult;

    // -------------------------------------------------------------------------
    // 9. GÉRER LES RETOURS RPC
    // -------------------------------------------------------------------------
    
    // Cas: Gaps bloquants ouverts (REJECTED)
    if (result.status === 'rejected') {
      console.warn(`[commit-decision] Rejected: ${result.blocking_count} blocking gaps open`);
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'commit-decision',
        op: 'gaps_check',
        userId,
        status: 'fatal_error',
        errorCode: 'CONFLICT_INVALID_STATE',
        httpStatus: 409,
        durationMs: Date.now() - startTime,
        meta: { blocking_count: result.blocking_count },
      });
      // NE PAS marquer proposal comme committed (Garde-fou #2)
      return respondError({
        code: 'CONFLICT_INVALID_STATE',
        message: 'Gaps bloquants ouverts',
        correlationId,
        meta: { blocking_count: result.blocking_count, require_override: true },
      });
    }

    // Cas: Idempotent (decision existante via RPC)
    if (result.idempotent) {
      console.log(`[commit-decision] Idempotent return for decision_id=${result.decision_id}`);
      
      // Compter les décisions pour la réponse
      const { data: finalDecisions } = await serviceClient
        .from('operator_decisions')
        .select('decision_type')
        .eq('case_id', case_id)
        .eq('is_final', true);

      const completedTypes = new Set(finalDecisions?.map(d => d.decision_type) || []);
      const remainingDecisions = ALL_DECISION_TYPES.filter(t => !completedTypes.has(t)).length;

      const rpcIdempotentResponse: CommitDecisionResponse = {
        decision_id: result.decision_id!,
        idempotent: true,
        remaining_decisions: remainingDecisions,
        all_complete: remainingDecisions === 0
      };

      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'commit-decision',
        op: 'rpc_idempotent',
        userId,
        status: 'ok',
        httpStatus: 200,
        durationMs: Date.now() - startTime,
        meta: { decision_id: result.decision_id, idempotent: true },
      });

      return respondOk(rpcIdempotentResponse, correlationId);
    }

    // Cas: Succès (CREATED) - marquer proposal comme committed (Garde-fou #2)
    const { error: updateProposalError } = await serviceClient
      .from('decision_proposals')
      .update({ 
        committed_at: now, 
        committed_by: userId 
      })
      .eq('id', proposalId);

    if (updateProposalError) {
      console.warn('[commit-decision] Failed to update proposal committed_at (non-blocking):', updateProposalError);
    }

    const decisionId = result.decision_id!;

    // -------------------------------------------------------------------------
    // 10. INSERT TIMELINE EVENT (audit)
    // -------------------------------------------------------------------------
    const wasOverride = !!(override_value && override_value.trim() !== '');
    
    await serviceClient
      .from('case_timeline_events')
      .insert({
        case_id,
        event_type: 'decision_committed',
        actor_type: 'human',
        actor_user_id: userId,
        event_data: {
          decision_type,
          selected_key,
          was_override: wasOverride,
          proposal_id: proposalId,
          decision_id: decisionId,
          decision_version: result.decision_version,
          facts_hash: factsHash,
          gaps_hash: gapsHash,
          superseded_id: result.superseded_id
        },
        new_value: selected_key,
        previous_value: result.superseded_id ? 'superseded' : null
      });

    // -------------------------------------------------------------------------
    // 11. VÉRIFICATION COMPLÉTUDE (5/5)
    // -------------------------------------------------------------------------
    const { data: finalDecisions } = await serviceClient
      .from('operator_decisions')
      .select('decision_type')
      .eq('case_id', case_id)
      .eq('is_final', true);

    const completedTypes = new Set(finalDecisions?.map(d => d.decision_type) || []);
    const remainingDecisions = ALL_DECISION_TYPES.filter(t => !completedTypes.has(t)).length;
    const allComplete = remainingDecisions === 0;

    // If all 5 decisions are complete, update status
    if (allComplete && quoteCase.status !== 'DECISIONS_COMPLETE') {
      const { error: statusError } = await serviceClient
        .from('quote_cases')
        .update({ status: 'DECISIONS_COMPLETE' })
        .eq('id', case_id);

      if (!statusError) {
        // Log completion event
        await serviceClient
          .from('case_timeline_events')
          .insert({
            case_id,
            event_type: 'all_decisions_complete',
            actor_type: 'system',
            actor_user_id: userId,
            event_data: {
              completed_types: Array.from(completedTypes),
              total_decisions: finalDecisions?.length || 0
            },
            new_value: 'DECISIONS_COMPLETE',
            previous_value: quoteCase.status
          });
      }
    }

    // -------------------------------------------------------------------------
    // 12. RETURN RESPONSE
    // -------------------------------------------------------------------------
    const response: CommitDecisionResponse = {
      decision_id: decisionId,
      decision_version: result.decision_version,
      remaining_decisions: remainingDecisions,
      all_complete: allComplete
    };

    // Phase 14: Log runtime event (CTO FIX B4: decision_type, not type)
    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: 'commit-decision',
      op: 'commit',
      userId,
      status: 'ok',
      httpStatus: 200,
      durationMs: Date.now() - startTime,
      meta: { decision_type, decision_id: decisionId },
    });

    return respondOk(response, correlationId);

  } catch (error) {
    console.error('[commit-decision] Unexpected error:', error);
    
    // Phase 14: Log error event
    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: 'commit-decision',
      op: 'commit',
      userId,
      status: 'fatal_error',
      errorCode: 'UNKNOWN',
      httpStatus: 500,
      durationMs: Date.now() - startTime,
      meta: { error: String(error) },
    });

    return respondError({
      code: 'UNKNOWN',
      message: 'Internal server error',
      correlationId,
    });
  }
});
