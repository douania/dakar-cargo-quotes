// ============================================================================
// Phase 10 — ack-pricing-ready (GATE STRICT)
// 
// ROLE: Dernier verrou avant pricing
// - 100% déterministe
// - 0 logique IA
// - 0 calcul métier
// - IDEMPOTENT (correction CTO #1)
// 
// ⚠️ CTO RULE: CE N'EST PAS UN MOTEUR DE CALCUL
// ✅ SELECT operator_decisions (lecture)
// ✅ UPDATE quote_cases.status → ACK_READY_FOR_PRICING
// ✅ INSERT case_timeline_events
// 
// ❌ JAMAIS de calcul de prix
// ❌ JAMAIS d'accès aux tables: pricing_runs, port_tariffs, etc.
// ❌ JAMAIS d'UPDATE/INSERT quote_facts
// ❌ JAMAIS d'appel depuis commit-decision (découplé)
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// ============================================================================
// TYPES
// ============================================================================

interface AckPricingReadyRequest {
  case_id: string;
}

interface DecisionSummary {
  decision_type: string;
  selected_key: string;
  decided_at: string;
  decided_by: string;
}

interface AckPricingReadyResponse {
  status: 'ACK_READY_FOR_PRICING';
  decisions_summary: DecisionSummary[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ALL_DECISION_TYPES = ['regime', 'routing', 'services', 'incoterm', 'container'] as const;

// ============================================================================
// HELPER: Build decisions summary from operator_decisions rows
// ============================================================================

function buildDecisionsSummary(decisions: any[]): DecisionSummary[] {
  return decisions.map(d => ({
    decision_type: d.decision_type,
    selected_key: d.selected_key,
    decided_at: d.decided_at,
    decided_by: d.decided_by
  }));
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ========================================================================
    // 1. VALIDATE JWT & EXTRACT USER
    // ========================================================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // User client for JWT validation
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;

    // Service client for DB operations
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // ========================================================================
    // 2. VALIDATE INPUT
    // ========================================================================
    const body: AckPricingReadyRequest = await req.json();
    const { case_id } = body;

    if (!case_id) {
      return new Response(
        JSON.stringify({ error: 'case_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========================================================================
    // 3. FETCH QUOTE CASE & OWNERSHIP CHECK
    // ========================================================================
    const { data: quoteCase, error: caseError } = await serviceClient
      .from('quote_cases')
      .select('id, status, created_by')
      .eq('id', case_id)
      .single();

    if (caseError || !quoteCase) {
      return new Response(
        JSON.stringify({ error: 'Quote case not found', case_id }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (quoteCase.created_by !== userId) {
      return new Response(
        JSON.stringify({ error: 'Access denied: not the owner of this case' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========================================================================
    // 4. FETCH FINAL DECISIONS
    // ========================================================================
    const { data: finalDecisions, error: decisionsError } = await serviceClient
      .from('operator_decisions')
      .select('decision_type, selected_key, decided_at, decided_by')
      .eq('case_id', case_id)
      .eq('is_final', true);

    if (decisionsError) {
      console.error('Error fetching decisions:', decisionsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch decisions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const decisions = finalDecisions || [];
    const decisionsSummary = buildDecisionsSummary(decisions);

    // ========================================================================
    // 5. IDEMPOTENCE CHECK (CTO Correction #1)
    // Si déjà ACK_READY_FOR_PRICING → return 200 sans update, sans timeline
    // ========================================================================
    if (quoteCase.status === 'ACK_READY_FOR_PRICING') {
      console.log(`[ack-pricing-ready] Case ${case_id} already ACK - idempotent return`);
      
      const response: AckPricingReadyResponse = {
        status: 'ACK_READY_FOR_PRICING',
        decisions_summary: decisionsSummary
      };

      return new Response(
        JSON.stringify(response),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========================================================================
    // 6. STATUS CHECK (must be DECISIONS_COMPLETE)
    // ========================================================================
    if (quoteCase.status !== 'DECISIONS_COMPLETE') {
      return new Response(
        JSON.stringify({
          error: 'Case must be in DECISIONS_COMPLETE status',
          current_status: quoteCase.status,
          required_status: 'DECISIONS_COMPLETE'
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========================================================================
    // 7. DECISIONS INTEGRITY CHECK (CTO Correction #2)
    // Exiger: rows.length === 5 ET distinct_types === 5
    // ========================================================================
    const distinctTypes = new Set(decisions.map(d => d.decision_type));
    
    // Check for exact count (detects duplicates)
    if (decisions.length !== 5) {
      const foundTypes = decisions.map(d => d.decision_type);
      return new Response(
        JSON.stringify({
          error: 'Integrity error: expected exactly 5 final decisions',
          found_count: decisions.length,
          found_types: foundTypes,
          required_count: 5,
          hint: decisions.length > 5 
            ? 'Multiple final decisions detected for same type' 
            : 'Missing final decisions'
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for distinct types (detects missing types)
    if (distinctTypes.size !== 5) {
      const missingTypes = ALL_DECISION_TYPES.filter(t => !distinctTypes.has(t));
      const duplicateTypes = decisions
        .map(d => d.decision_type)
        .filter((t, i, arr) => arr.indexOf(t) !== i);
      
      return new Response(
        JSON.stringify({
          error: 'Integrity error: multiple final decisions for same type',
          distinct_types_count: distinctTypes.size,
          missing_types: missingTypes,
          duplicate_types: [...new Set(duplicateTypes)],
          required_distinct: 5
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Final check: all required types present
    const allTypesPresent = ALL_DECISION_TYPES.every(type => distinctTypes.has(type));
    if (!allTypesPresent) {
      const missingTypes = ALL_DECISION_TYPES.filter(t => !distinctTypes.has(t));
      return new Response(
        JSON.stringify({
          error: 'Not all decision types are finalized',
          found_types: Array.from(distinctTypes),
          missing_types: missingTypes,
          required_types: ALL_DECISION_TYPES
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========================================================================
    // 8. UPDATE STATUS → ACK_READY_FOR_PRICING
    // ========================================================================
    const { error: updateError } = await serviceClient
      .from('quote_cases')
      .update({ status: 'ACK_READY_FOR_PRICING' })
      .eq('id', case_id);

    if (updateError) {
      console.error('Error updating case status:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update case status' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========================================================================
    // 9. TIMELINE EVENT (CTO Correction #3: actor_type = 'human')
    // ========================================================================
    const { error: timelineError } = await serviceClient
      .from('case_timeline_events')
      .insert({
        case_id,
        event_type: 'pricing_unlocked',
        actor_type: 'human',  // CTO Correction #3: action initiée par l'opérateur
        actor_user_id: userId,
        previous_value: 'DECISIONS_COMPLETE',
        new_value: 'ACK_READY_FOR_PRICING',
        event_data: {
          decision_types: Array.from(distinctTypes),
          transition_from: 'DECISIONS_COMPLETE',
          transition_to: 'ACK_READY_FOR_PRICING',
          decisions_count: 5
        }
      });

    if (timelineError) {
      console.error('Error creating timeline event:', timelineError);
      // Non-blocking: log but don't fail the request
    }

    // ========================================================================
    // 10. RETURN SUCCESS RESPONSE
    // ========================================================================
    console.log(`[ack-pricing-ready] Case ${case_id} transitioned to ACK_READY_FOR_PRICING`);

    const response: AckPricingReadyResponse = {
      status: 'ACK_READY_FOR_PRICING',
      decisions_summary: decisionsSummary
    };

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[ack-pricing-ready] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
