// ============================================================================
// Phase 9.3 — commit-decision (SEUL POINT D'ÉCRITURE PHASE 9)
// 
// ⚠️ CTO RULE: ÉCRITURES AUTORISÉES UNIQUEMENT ICI
// ✅ INSERT decision_proposals
// ✅ INSERT operator_decisions  
// ✅ UPDATE operator_decisions (supersession)
// ✅ INSERT case_timeline_events
// ✅ UPDATE quote_cases.status (→ DECISIONS_COMPLETE uniquement)
// 
// ❌ JAMAIS quote_facts
// ❌ JAMAIS status → READY_TO_PRICE
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

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
  remaining_decisions: number;
  all_complete: boolean;
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

    // Service client for DB writes (bypasses RLS for supersession)
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

    // CTO RULE: Status must be in allowed list (NO automatic transition)
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
    // 4. INSERT SNAPSHOT IA (decision_proposals) — IMMUTABLE
    // -------------------------------------------------------------------------
    const proposalBatchId = crypto.randomUUID();
    
    const { data: proposal, error: proposalError } = await serviceClient
      .from('decision_proposals')
      .insert({
        case_id,
        decision_type,
        proposal_batch_id: proposalBatchId,
        options_json: proposal_json,
        generated_at: proposal_json.generation_timestamp || new Date().toISOString(),
        generated_by: proposal_json.generation_model || 'ai',
        committed_at: new Date().toISOString(),
        committed_by: userId
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
    // 5. SUPERSESSION (if existing decision for this decision_type)
    // -------------------------------------------------------------------------
    const { data: existingDecision } = await serviceClient
      .from('operator_decisions')
      .select('id')
      .eq('case_id', case_id)
      .eq('decision_type', decision_type)
      .eq('is_final', true)
      .single();

    // -------------------------------------------------------------------------
    // 6. INSERT DÉCISION HUMAINE (operator_decisions)
    // -------------------------------------------------------------------------
    const { data: newDecision, error: decisionError } = await serviceClient
      .from('operator_decisions')
      .insert({
        case_id,
        proposal_id: proposalId,
        decision_type,
        selected_key,
        override_value: override_value || null,
        override_reason: override_reason || null,
        decided_by: userId,
        decided_at: new Date().toISOString(),
        is_final: true,
        superseded_by: null
      })
      .select('id')
      .single();

    if (decisionError || !newDecision) {
      console.error('[commit-decision] Failed to insert decision:', decisionError);
      return new Response(
        JSON.stringify({ error: "Failed to save operator decision" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const decisionId = newDecision.id;

    // Update old decision with supersession (non-blocking if fails)
    if (existingDecision) {
      const { error: supersessionError } = await serviceClient
        .from('operator_decisions')
        .update({ 
          is_final: false, 
          superseded_by: decisionId 
        })
        .eq('id', existingDecision.id);

      if (supersessionError) {
        console.warn('[commit-decision] Supersession update failed (non-blocking):', supersessionError);
        // Continue anyway - the new decision is valid
      }
    }

    // -------------------------------------------------------------------------
    // 7. INSERT TIMELINE EVENT (audit)
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
          decision_id: decisionId
        },
        new_value: selected_key,
        previous_value: existingDecision ? 'superseded' : null
      });

    // -------------------------------------------------------------------------
    // 8. VÉRIFICATION COMPLÉTUDE (5/5)
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
    // 9. RETURN RESPONSE
    // -------------------------------------------------------------------------
    const response: CommitDecisionResponse = {
      decision_id: decisionId,
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
