import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { action, data } = await req.json();

    console.log(`Knowledge admin action: ${action}`);

    switch (action) {
      case 'get_all': {
        const { data: knowledge, error } = await supabase
          .from('learned_knowledge')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, knowledge }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'toggle_validation': {
        const { id, currentState } = data;
        
        if (!id) throw new Error("id requis");

        const { error } = await supabase
          .from('learned_knowledge')
          .update({ 
            is_validated: !currentState,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'delete': {
        const { id } = data;
        
        if (!id) throw new Error("id requis");

        const { error } = await supabase
          .from('learned_knowledge')
          .delete()
          .eq('id', id);

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'get_documents': {
        const { data: documents, error } = await supabase
          .from('documents')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, documents }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'delete_document': {
        const { id } = data;
        
        if (!id) throw new Error("id requis");

        const { error } = await supabase
          .from('documents')
          .delete()
          .eq('id', id);

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'get_market_intelligence': {
        const { data: intel, error } = await supabase
          .from('market_intelligence')
          .select('*')
          .order('detected_at', { ascending: false })
          .limit(100);

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, intelligence: intel }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'get_expert_profiles': {
        const { data: experts, error } = await supabase
          .from('expert_profiles')
          .select('*')
          .order('is_primary', { ascending: false });

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, experts }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'get_surveillance_sources': {
        const { data: sources, error } = await supabase
          .from('surveillance_sources')
          .select('*')
          .order('name');

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, sources }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'mark_intel_processed': {
        const { id } = data;
        
        if (!id) throw new Error("id requis");

        const { error } = await supabase
          .from('market_intelligence')
          .update({ is_processed: true, processed_at: new Date().toISOString() })
          .eq('id', id);

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'get_attachments': {
        const { data: attachments, error } = await supabase
          .from('email_attachments')
          .select('id, filename, content_type, size, is_analyzed, extracted_data, email_id, created_at')
          .order('created_at', { ascending: false });

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, attachments }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        throw new Error(`Action inconnue: ${action}`);
    }

  } catch (error) {
    console.error("Knowledge admin error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Erreur inconnue" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
