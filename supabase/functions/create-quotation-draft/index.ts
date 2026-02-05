import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Validate Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Create anon client to verify JWT
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } }
    });
    
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token', details: authError?.message }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Parse request body
    const body = await req.json();
    const {
      route_origin, route_port, route_destination, cargo_type,
      container_types, client_name, client_company, partner_company,
      project_name, incoterm, tariff_lines, total_amount, total_currency,
      source_email_id, regulatory_info,
      // For revision support
      action: requestAction,
      parent_quotation_id,
      current_version
    } = body;

    // 4. Validate required fields
    if (!route_port || !route_destination || !cargo_type) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: route_port, route_destination, cargo_type' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Create service role client (bypass RLS)
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // 6. Handle revision creation
    if (requestAction === 'create_revision' && parent_quotation_id) {
      // Get parent's root_quotation_id
      const { data: parentDraft, error: parentError } = await serviceClient
        .from('quotation_history')
        .select('id, root_quotation_id')
        .eq('id', parent_quotation_id)
        .single();

      if (parentError) throw parentError;

      const rootId = parentDraft.root_quotation_id ?? parentDraft.id;

      const { data: newRevision, error: revisionError } = await serviceClient
        .from('quotation_history')
        .insert({
          route_origin, route_port, route_destination, cargo_type,
          container_types, client_name, client_company, partner_company,
          project_name, incoterm, tariff_lines, total_amount, total_currency,
          source_email_id, regulatory_info,
          version: (current_version || 1) + 1,
          parent_quotation_id: parent_quotation_id,
          root_quotation_id: rootId,
          status: 'draft',
          created_by: user.id
        })
        .select('id, version, status, parent_quotation_id, root_quotation_id')
        .single();

      if (revisionError) throw revisionError;

      return new Response(
        JSON.stringify({ success: true, draft: newRevision, action: 'revision_created' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. Check for existing draft (idempotent by source_email_id)
    if (source_email_id) {
      const { data: existingDraft, error: searchError } = await serviceClient
        .from('quotation_history')
        .select('id, version, status, parent_quotation_id, root_quotation_id')
        .eq('source_email_id', source_email_id)
        .eq('status', 'draft')
        .eq('created_by', user.id)
        .maybeSingle();

      if (searchError) throw searchError;

      if (existingDraft) {
        // Update existing draft
        const { data: updated, error: updateError } = await serviceClient
          .from('quotation_history')
          .update({
            route_origin, route_port, route_destination, cargo_type,
            container_types, client_name, client_company, partner_company,
            project_name, incoterm, tariff_lines, total_amount, total_currency,
            regulatory_info, updated_at: new Date().toISOString()
          })
          .eq('id', existingDraft.id)
          .select('id, version, status, parent_quotation_id, root_quotation_id')
          .single();

        if (updateError) throw updateError;

        return new Response(
          JSON.stringify({ success: true, draft: updated, action: 'updated' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // 8. Insert new draft with service role
    const { data: newDraft, error: insertError } = await serviceClient
      .from('quotation_history')
      .insert({
        route_origin, route_port, route_destination, cargo_type,
        container_types, client_name, client_company, partner_company,
        project_name, incoterm, tariff_lines, total_amount, total_currency,
        source_email_id, regulatory_info,
        version: 1,
        status: 'draft',
        root_quotation_id: null,
        parent_quotation_id: null,
        created_by: user.id
      })
      .select('id, version, status, parent_quotation_id, root_quotation_id')
      .single();

    if (insertError) throw insertError;

    // 9. Update root_quotation_id = id (self-reference for v1)
    await serviceClient
      .from('quotation_history')
      .update({ root_quotation_id: newDraft.id })
      .eq('id', newDraft.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        draft: { ...newDraft, root_quotation_id: newDraft.id },
        action: 'created'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('create-quotation-draft error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorCode = (error as { code?: string })?.code || 'UNKNOWN';
    return new Response(
      JSON.stringify({ 
        error: 'Failed to create draft', 
        details: errorMessage,
        code: errorCode
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
