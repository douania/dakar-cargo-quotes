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

      case 'create_knowledge': {
        const entries = Array.isArray(data) ? data : [data];
        
        console.log(`Creating ${entries.length} knowledge entries`);

        const { data: inserted, error } = await supabase
          .from('learned_knowledge')
          .insert(entries)
          .select();

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, count: inserted?.length || 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // NEW: Global search across learned_knowledge
      case 'search': {
        const { query, categories } = data;
        
        if (!query || query.length < 2) {
          return new Response(
            JSON.stringify({ success: true, results: [] }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const searchQuery = `%${query.toLowerCase()}%`;
        
        let dbQuery = supabase
          .from('learned_knowledge')
          .select('*')
          .or(`name.ilike.${searchQuery},description.ilike.${searchQuery}`)
          .order('is_validated', { ascending: false })
          .order('confidence', { ascending: false })
          .limit(50);

        if (categories && categories.length > 0) {
          dbQuery = dbQuery.in('category', categories);
        }

        const { data: results, error } = await dbQuery;

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, results: results || [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // NEW: Search tariffs specifically
      case 'search_tariffs': {
        const { destination, cargoType, service } = data;
        
        console.log('Searching tariffs:', { destination, cargoType, service });

        // Get all tariff-related knowledge
        const { data: knowledge, error } = await supabase
          .from('learned_knowledge')
          .select('*')
          .in('category', ['tarif', 'quotation_template', 'quotation_exchange'])
          .order('is_validated', { ascending: false })
          .order('confidence', { ascending: false });

        if (error) throw error;

        // Filter and score tariffs
        const tariffs: Array<{
          service: string;
          amount: number;
          currency: string;
          unit?: string;
          confidence: number;
          source: string;
          sourceId: string;
          isValidated: boolean;
        }> = [];

        for (const k of knowledge || []) {
          const kData = k.data as Record<string, unknown>;
          const kDestination = (kData.destination as string)?.toLowerCase() || '';
          const kCargoType = (kData.type_transport as string)?.toLowerCase() || '';
          const kService = (kData.service as string)?.toLowerCase() || k.name.toLowerCase();
          
          // Check if matches criteria
          let score = k.confidence;
          
          if (destination && kDestination.includes(destination.toLowerCase())) {
            score += 0.2;
          }
          if (cargoType && kCargoType.includes(cargoType.toLowerCase())) {
            score += 0.1;
          }
          if (service && kService.includes(service.toLowerCase())) {
            score += 0.3;
          }
          
          // Only include if has amount
          if (kData.montant && kData.devise) {
            tariffs.push({
              service: k.name.replace(/_/g, ' '),
              amount: Number(kData.montant),
              currency: kData.devise as string,
              unit: kData.unit as string | undefined,
              confidence: Math.min(score, 1),
              source: k.source_type === 'expert_learning' ? 'Expert' : 'Historique',
              sourceId: k.id,
              isValidated: k.is_validated,
            });
          }
        }

        // Sort by confidence and limit
        tariffs.sort((a, b) => b.confidence - a.confidence);
        
        return new Response(
          JSON.stringify({ success: true, tariffs: tariffs.slice(0, 20) }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // NEW: Populate quotation_history from learned_knowledge
      case 'populate_quotation_history': {
        console.log('Populating quotation_history from learned_knowledge...');
        
        // Get tariff-related knowledge
        const { data: knowledge, error: fetchError } = await supabase
          .from('learned_knowledge')
          .select('*')
          .in('category', ['tarif', 'quotation_template', 'quotation_exchange'])
          .eq('is_validated', true);

        if (fetchError) throw fetchError;

        const quotationsToInsert: Array<{
          route_destination: string;
          cargo_type: string;
          tariff_lines: unknown[];
          client_company?: string;
          project_name?: string;
          incoterm?: string;
        }> = [];

        // Group by destination and cargo type
        const grouped = new Map<string, typeof knowledge>();
        
        for (const k of knowledge || []) {
          const kData = k.data as Record<string, unknown>;
          const dest = (kData.destination as string) || 'Unknown';
          const cargo = (kData.type_transport as string) || 'container';
          const key = `${dest}|${cargo}`;
          
          if (!grouped.has(key)) {
            grouped.set(key, []);
          }
          grouped.get(key)!.push(k);
        }

        // Create quotation entries
        for (const [key, items] of grouped.entries()) {
          const [dest, cargo] = key.split('|');
          
          const tariffLines = items
            .filter(k => {
              const kData = k.data as Record<string, unknown>;
              return kData.montant && kData.devise;
            })
            .map(k => {
              const kData = k.data as Record<string, unknown>;
              return {
                service: k.name.replace(/_/g, ' '),
                amount: Number(kData.montant),
                currency: kData.devise as string,
                unit: (kData.unit as string) || 'unité',
              };
            });

          if (tariffLines.length > 0) {
            // Get client from first item
            const firstData = items[0].data as Record<string, unknown>;
            
            quotationsToInsert.push({
              route_destination: dest,
              cargo_type: cargo,
              tariff_lines: tariffLines,
              client_company: firstData.client as string | undefined,
              project_name: firstData.project as string | undefined,
              incoterm: firstData.incoterm as string | undefined,
            });
          }
        }

        if (quotationsToInsert.length > 0) {
          const { error: insertError } = await supabase
            .from('quotation_history')
            .insert(quotationsToInsert);

          if (insertError) throw insertError;
        }

        console.log(`Inserted ${quotationsToInsert.length} quotation entries`);

        return new Response(
          JSON.stringify({ 
            success: true, 
            inserted: quotationsToInsert.length,
            message: `${quotationsToInsert.length} cotations ajoutées à l'historique`
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // NEW: Analyze all unprocessed Excel attachments
      case 'analyze_all_excel': {
        console.log('Fetching unanalyzed Excel attachments...');
        
        // Get all Excel attachments that haven't been analyzed
        const { data: attachments, error: fetchError } = await supabase
          .from('email_attachments')
          .select('id, filename, content_type')
          .eq('is_analyzed', false)
          .or('content_type.ilike.%excel%,content_type.ilike.%spreadsheet%,filename.ilike.%.xlsx,filename.ilike.%.xls');

        if (fetchError) throw fetchError;

        if (!attachments || attachments.length === 0) {
          return new Response(
            JSON.stringify({ 
              success: true, 
              processed: 0,
              message: 'Aucun fichier Excel à analyser'
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log(`Found ${attachments.length} Excel files to analyze`);

        // Trigger analysis for each attachment
        const results: Array<{ id: string; filename: string; success: boolean; error?: string }> = [];
        
        for (const attachment of attachments) {
          try {
            const { error } = await supabase.functions.invoke('analyze-attachments', {
              body: { attachmentId: attachment.id }
            });

            results.push({
              id: attachment.id,
              filename: attachment.filename,
              success: !error,
              error: error?.message
            });
          } catch (err) {
            results.push({
              id: attachment.id,
              filename: attachment.filename,
              success: false,
              error: err instanceof Error ? err.message : 'Unknown error'
            });
          }
        }

        const successCount = results.filter(r => r.success).length;

        return new Response(
          JSON.stringify({ 
            success: true, 
            processed: results.length,
            successful: successCount,
            failed: results.length - successCount,
            details: results,
            message: `${successCount}/${results.length} fichiers Excel analysés`
          }),
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
