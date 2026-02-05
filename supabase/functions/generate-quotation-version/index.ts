/**
 * Phase 12: generate-quotation-version
 * Creates an immutable quotation version from a successful pricing run
 * 
 * CTO Rules:
 * - verify_jwt = true (human-triggered action)
 * - Requires status IN ('PRICED_DRAFT', 'HUMAN_REVIEW')
 * - Atomic version_number via RPC with advisory lock
 * - Snapshot is FROZEN (no recalculation)
 * - Timeline event for audit trail
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

// Snapshot structure for immutable storage
interface VersionSnapshot {
  meta: {
    version_id: string;
    version_number: number;
    created_at: string;
    pricing_run_id: string;
    pricing_run_number: number;
  };
  inputs: {
    origin: string | null;
    destination: string | null;
    incoterm: string | null;
    containers: any[];
    cargo_weight: number | null;
    cargo_volume: number | null;
  };
  client: {
    email: string | null;
    company: string | null;
  };
  lines: Array<{
    service_code: string;
    description: string | null;
    quantity: number;
    unit_price: number;
    amount: number;
    currency: string;
  }>;
  totals: {
    total_ht: number;
    total_ttc: number;
    currency: string;
  };
  sources: any[];
}

Deno.serve(async (req) => {
  // CORS handling
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Auth validation
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse('Unauthorized', 401);
    }

    // User client for ownership check
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return errorResponse('Unauthorized', 401);
    }

    // Service client for privileged operations
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Parse request body
    const { case_id, pricing_run_id } = await req.json();
    if (!case_id) {
      return errorResponse('case_id is required', 400);
    }

    // Step 1: Load quote_case and verify ownership + status
    const { data: caseData, error: caseError } = await userClient
      .from('quote_cases')
      .select('id, status, created_by, assigned_to, thread_id')
      .eq('id', case_id)
      .single();

    if (caseError || !caseData) {
      console.error('Case load error:', caseError);
      return errorResponse('Quote case not found', 404);
    }

    // Ownership check
    if (caseData.created_by !== user.id && caseData.assigned_to !== user.id) {
      console.error('Ownership violation:', { case_owner: caseData.created_by, assigned: caseData.assigned_to, requester: user.id });
      return errorResponse('Access denied', 403);
    }

    // CTO ADJUSTMENT #5: Status gate - must be PRICED_DRAFT or HUMAN_REVIEW
    const allowedStatuses = ['PRICED_DRAFT', 'HUMAN_REVIEW'];
    if (!allowedStatuses.includes(caseData.status)) {
      return errorResponse(`Invalid case status. Expected: ${allowedStatuses.join(' or ')}, Got: ${caseData.status}`, 400);
    }

    // Step 2: Load pricing run (latest success if not specified)
    let pricingRunQuery = serviceClient
      .from('pricing_runs')
      .select('*')
      .eq('case_id', case_id)
      .eq('status', 'success')
      .order('run_number', { ascending: false });

    if (pricing_run_id) {
      pricingRunQuery = serviceClient
        .from('pricing_runs')
        .select('*')
        .eq('id', pricing_run_id)
        .eq('case_id', case_id)
        .eq('status', 'success');
    }

    const { data: pricingRun, error: runError } = await pricingRunQuery.limit(1).single();

    if (runError || !pricingRun) {
      console.error('Pricing run load error:', runError);
      return errorResponse('No successful pricing run found', 404);
    }

    // Step 3: Get atomic version number via RPC
    const { data: versionNumber, error: rpcError } = await serviceClient
      .rpc('get_next_quotation_version_number', { p_case_id: case_id });

    if (rpcError || versionNumber === null) {
      console.error('Version number RPC error:', rpcError);
      return errorResponse('Failed to get version number', 500);
    }

    // Step 4: Deselect all previous versions (ensure only one is_selected per case)
    await serviceClient
      .from('quotation_versions')
      .update({ is_selected: false })
      .eq('case_id', case_id)
      .eq('is_selected', true);

    // Step 5: Extract data for snapshot
    const inputs = pricingRun.inputs_json || {};
    const factsSnapshot = pricingRun.facts_snapshot || {};
    const tariffLines = pricingRun.tariff_lines || [];
    const tariffSources = pricingRun.tariff_sources || [];

    // Build immutable snapshot
    const versionId = crypto.randomUUID();
    const now = new Date().toISOString();

    const snapshot: VersionSnapshot = {
      meta: {
        version_id: versionId,
        version_number: versionNumber,
        created_at: now,
        pricing_run_id: pricingRun.id,
        pricing_run_number: pricingRun.run_number,
      },
      inputs: {
        origin: inputs.origin || factsSnapshot.origin || null,
        destination: inputs.destination || factsSnapshot.destination || null,
        incoterm: inputs.incoterm || factsSnapshot.incoterm || null,
        containers: inputs.containers || factsSnapshot.containers || [],
        cargo_weight: inputs.cargo_weight || factsSnapshot.cargo_weight || null,
        cargo_volume: inputs.cargo_volume || factsSnapshot.cargo_volume || null,
      },
      client: {
        email: factsSnapshot.client_email || inputs.client_email || null,
        company: factsSnapshot.client_company || inputs.client_company || null,
      },
      lines: tariffLines.map((line: any, idx: number) => ({
        service_code: line.service_code || line.charge_code || `LINE_${idx + 1}`,
        description: line.description || line.charge_name || null,
        quantity: line.quantity || 1,
        unit_price: line.unit_price || line.rate || 0,
        amount: line.amount || line.total || 0,
        currency: line.currency || 'XOF',
      })),
      totals: {
        total_ht: pricingRun.total_ht || 0,
        total_ttc: pricingRun.total_ttc || pricingRun.total_ht || 0,
        currency: pricingRun.currency || 'XOF',
      },
      sources: tariffSources,
    };

    // Step 6: Insert quotation_versions record
    const { data: versionRecord, error: insertError } = await serviceClient
      .from('quotation_versions')
      .insert({
        id: versionId,
        case_id,
        pricing_run_id: pricingRun.id,
        version_number: versionNumber,
        status: 'draft',
        is_selected: true,
        snapshot,
        created_by: user.id,
      })
      .select('id, version_number')
      .single();

    if (insertError) {
      console.error('Version insert error:', insertError);
      return errorResponse(`Failed to create version: ${insertError.message}`, 500);
    }

    // Step 7: Copy tariff lines to quotation_version_lines
    const versionLines = snapshot.lines.map((line, idx) => ({
      quotation_version_id: versionId,
      line_order: idx,
      service_code: line.service_code,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unit_price,
      amount: line.amount,
      currency: line.currency,
      breakdown: tariffLines[idx]?.breakdown || null,
    }));

    if (versionLines.length > 0) {
      const { error: linesError } = await serviceClient
        .from('quotation_version_lines')
        .insert(versionLines);

      if (linesError) {
        console.error('Version lines insert error:', linesError);
        // Non-blocking - version is still created
      }
    }

    // Step 8: Insert timeline event for audit trail
    await serviceClient.from('case_timeline_events').insert({
      case_id,
      event_type: 'quotation_version_created',
      event_data: {
        version_id: versionId,
        version_number: versionNumber,
        pricing_run_id: pricingRun.id,
        pricing_run_number: pricingRun.run_number,
        total_ht: snapshot.totals.total_ht,
        lines_count: snapshot.lines.length,
      },
      actor_type: 'user',
      actor_user_id: user.id,
    });

    console.log(`[Phase 12] Created quotation version v${versionNumber} for case ${case_id}`);

    return jsonResponse({
      success: true,
      version_id: versionId,
      version_number: versionNumber,
      lines_count: snapshot.lines.length,
      total_ht: snapshot.totals.total_ht,
      total_ttc: snapshot.totals.total_ttc,
      currency: snapshot.totals.currency,
    });

  } catch (error) {
    console.error('Generate version error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Internal error', 500);
  }
});
