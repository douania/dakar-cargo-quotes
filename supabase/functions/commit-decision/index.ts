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
// CORRECTIONS CTO INTÉGRÉES:
// 1. Idempotency key basée sur proposal_id (stable)
// 2. Gaps gating transactionnel via RPC
// 3. Hash canonique avec normalisation value_json
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { computeCanonicalHash } from "../_shared/canonical-hash.ts";

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

  try {
    // -------------------------------------------------------------------------
    // 1. JWT VALIDATION (via Supabase client with user token)
    // -------------------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization header required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User client for auth validation
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = user.id;

    // Service client for DB writes (bypasses RLS for RPC call)
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // -------------------------------------------------------------------------
    // 2. INPUT VALIDATION
    // -------------------------------------------------------------------------
    const body: CommitDecisionRequest = await req.json();
    const { case_id, decision_type, proposal_json, selected_key, override_value, override_reason } = body;

    // Required fields
    if (!case_id || typeof case_id !== 'string') {
      return new Response(
        JSON.stringify({ error: "case_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!decision_type || !ALL_DECISION_TYPES.includes(decision_type)) {
      return new Response(
        JSON.stringify({ 
          error: "Invalid decision_type", 
          allowed: ALL_DECISION_TYPES 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!proposal_json || !Array.isArray(proposal_json.options)) {
      return new Response(
        JSON.stringify({ error: "proposal_json with options array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!selected_key || typeof selected_key !== 'string') {
      return new Response(
        JSON.stringify({ error: "selected_key is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // CTO RULE: Override requires reason
    if (override_value !== undefined && override_value !== null && override_value !== '') {
      if (!override_reason || override_reason.trim() === '') {
        return new Response(
          JSON.stringify({ error: "override_reason is required when override_value is set" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
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
      return new Response(
        JSON.stringify({ error: "Case not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Ownership check
    if (quoteCase.created_by !== userId) {
      console.warn(`[commit-decision] Ownership denied: user=${userId}, owner=${quoteCase.created_by}, case=${case_id}`);
      return new Response(
        JSON.stringify({ error: "Access denied: not the case owner" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // CTO RULE: Status must be in allowed list
    if (!ALLOWED_STATUSES.includes(quoteCase.status as typeof ALLOWED_STATUSES[number])) {
      console.warn(`[commit-decision] Refused: status=${quoteCase.status}, case=${case_id}`);
      return new Response(
        JSON.stringify({ 
          error: "Case status does not allow decision commit",
          current_status: quoteCase.status,
          allowed_statuses: ALLOWED_STATUSES
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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

      return new Response(
        JSON.stringify({
          decision_id: existingDecision.id,
          decision_version: existingDecision.decision_version,
          idempotent: true,
          remaining_decisions: remainingDecisions,
          all_complete: remainingDecisions === 0
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
      return new Response(
        JSON.stringify({ error: "Failed to save decision proposal" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
      return new Response(
        JSON.stringify({ error: "Transaction failed", details: rpcError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = rpcResult as RpcResult;

    // -------------------------------------------------------------------------
    // 8. GÉRER LES RETOURS RPC
    // -------------------------------------------------------------------------
    
    // Cas: Gaps bloquants ouverts (REJECTED)
    if (result.status === 'rejected') {
      console.warn(`[commit-decision] Rejected: ${result.blocking_count} blocking gaps open`);
      // NE PAS marquer proposal comme committed (Garde-fou #2)
      return new Response(
        JSON.stringify({
          error: "Gaps bloquants ouverts",
          blocking_count: result.blocking_count,
          require_override: true
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cas: Idempotent (decision existante)
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

      return new Response(
        JSON.stringify({
          decision_id: result.decision_id,
          idempotent: true,
          remaining_decisions: remainingDecisions,
          all_complete: remainingDecisions === 0
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
    // 9. INSERT TIMELINE EVENT (audit)
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
    // 10. VÉRIFICATION COMPLÉTUDE (5/5)
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
    // 11. RETURN RESPONSE
    // -------------------------------------------------------------------------
    const response: CommitDecisionResponse = {
      decision_id: decisionId,
      decision_version: result.decision_version,
      remaining_decisions: remainingDecisions,
      all_complete: allComplete
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('[commit-decision] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
