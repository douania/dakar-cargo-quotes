/**
 * data-query — Operator-level read-only queries
 * 
 * Auth: requireUser (not requireAdmin)
 * Scope: search, search_tariffs, find_historical_references, get_transport_rates, search_transport_rate
 * 
 * Created in B1-audit to decouple operator reads from admin-only data-admin endpoint.
 * See docs/SECURITY_CONTRACT.md for classification.
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { action, data } = await req.json();

    console.log(`data-query action: ${action} by ${auth.user.email}`);

    switch (action) {
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

        const [knowledgeResult, emailResult] = await Promise.all([
          dbQuery,
          supabase
            .from('emails')
            .select('id, subject, from_address, received_at, is_quotation_request')
            .or(`subject.ilike.${searchQuery},from_address.ilike.${searchQuery},body_text.ilike.${searchQuery},body_html.ilike.${searchQuery}`)
            .order('received_at', { ascending: false })
            .limit(10)
        ]);

        if (knowledgeResult.error) throw knowledgeResult.error;

        return new Response(
          JSON.stringify({ 
            success: true, 
            results: knowledgeResult.data || [],
            emails: emailResult.data || []
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'search_tariffs': {
        const { destination, cargoType, service, transportMode } = data;
        
        console.log('Searching tariffs:', { destination, cargoType, service, transportMode });

        const modeCategory = (mode: string | null | undefined): string | null => {
          if (!mode) return null;
          const m = mode.toLowerCase();
          if (m.includes('air')) return 'AIR';
          if (m.includes('sea') || m.includes('fcl') || m.includes('lcl') 
              || m.includes('container') || m.includes('breakbulk')) return 'SEA';
          if (m.includes('road') || m.includes('truck')) return 'ROAD';
          return null;
        };
        const inputMode = modeCategory(transportMode);

        const { data: knowledge, error } = await supabase
          .from('learned_knowledge')
          .select('*')
          .in('category', ['tarif', 'quotation_template', 'quotation_exchange'])
          .order('is_validated', { ascending: false })
          .order('confidence', { ascending: false });

        if (error) throw error;

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

          if (inputMode) {
            const kTransportType = kData.type_transport as string | undefined;
            const kMode = modeCategory(kTransportType);
            if (kMode && kMode !== inputMode) continue;
          }

          const kDestination = (kData.destination as string)?.toLowerCase() || '';
          const kCargoType = (kData.type_transport as string)?.toLowerCase() || '';
          const kService = (kData.service as string)?.toLowerCase() || k.name.toLowerCase();
          
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

        tariffs.sort((a, b) => b.confidence - a.confidence);
        
        return new Response(
          JSON.stringify({ success: true, tariffs: tariffs.slice(0, 20) }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'get_transport_rates': {
        const { destination, containerType, cargoCategory } = data || {};
        
        console.log('Fetching transport rates:', { destination, containerType, cargoCategory });
        
        let query = supabase
          .from('local_transport_rates')
          .select('*')
          .eq('is_active', true)
          .order('destination')
          .order('container_type');
        
        if (destination) {
          query = query.ilike('destination', `%${destination}%`);
        }
        if (containerType) {
          query = query.eq('container_type', containerType);
        }
        if (cargoCategory) {
          query = query.eq('cargo_category', cargoCategory);
        }
        
        const { data: rates, error } = await query;
        
        if (error) throw error;
        
        return new Response(
          JSON.stringify({ success: true, rates: rates || [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'search_transport_rate': {
        const { destination, containerType, cargoCategory } = data;
        
        console.log('Searching transport rate:', { destination, containerType, cargoCategory });
        
        if (!destination) {
          return new Response(
            JSON.stringify({ success: true, rate: null, message: 'Destination requise' }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        let { data: rate, error } = await supabase
          .from('local_transport_rates')
          .select('*')
          .eq('is_active', true)
          .ilike('destination', destination)
          .eq('container_type', containerType || '40DV')
          .eq('cargo_category', cargoCategory || 'Dry')
          .order('validity_start', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (error) throw error;
        
        if (!rate) {
          const { data: partialRate, error: partialError } = await supabase
            .from('local_transport_rates')
            .select('*')
            .eq('is_active', true)
            .ilike('destination', `%${destination}%`)
            .eq('container_type', containerType || '40DV')
            .order('validity_start', { ascending: false })
            .limit(1)
            .maybeSingle();
          
          if (partialError) throw partialError;
          rate = partialRate;
        }
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            rate: rate,
            found: !!rate,
            message: rate 
              ? `Tarif trouvé: ${rate.destination} ${rate.container_type} = ${rate.rate_amount} ${rate.rate_currency}` 
              : `Pas de tarif pour ${destination}`
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'find_historical_references': {
        const { origin, destination, containerTypes, cargoType } = data || {};
        
        console.log('Finding historical references:', { origin, destination, containerTypes, cargoType });
        
        if (!destination && !origin) {
          return new Response(
            JSON.stringify({ success: true, references: [], evolutions: [] }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const searchTerms: string[] = [];
        if (destination) searchTerms.push(destination.toLowerCase());
        if (origin) searchTerms.push(origin.toLowerCase());
        
        const { data: knowledge, error: fetchError } = await supabase
          .from('learned_knowledge')
          .select('*')
          .in('category', ['tarif', 'quotation_history', 'quotation_template', 'quotation_exchange', 'tarification', 'pricing_pattern'])
          .order('created_at', { ascending: false });

        if (fetchError) throw fetchError;

        const relevantKnowledge = (knowledge || []).filter(k => {
          const kData = k.data as Record<string, unknown>;
          const criteria = k.matching_criteria as Record<string, string> | null;
          
          if (criteria) {
            const criteriaDestMatch = criteria.destination && 
              searchTerms.some(term => criteria.destination.toLowerCase().includes(term));
            const criteriaOriginMatch = criteria.origin && 
              searchTerms.some(term => criteria.origin.toLowerCase().includes(term));
            if (criteriaDestMatch || criteriaOriginMatch) return true;
          }
          
          const kDest = (kData.destination as string)?.toLowerCase() || '';
          const kOrigin = (kData.origine as string)?.toLowerCase() || (kData.origin as string)?.toLowerCase() || '';
          
          return searchTerms.some(term => 
            kDest.includes(term) || kOrigin.includes(term)
          );
        });

        const groupedBySource = new Map<string, typeof relevantKnowledge>();
        
        for (const k of relevantKnowledge) {
          const kData = k.data as Record<string, unknown>;
          const dateStr = k.created_at.substring(0, 7);
          const dest = (kData.destination as string) || 'unknown';
          const key = `${dateStr}|${dest}`;
          
          if (!groupedBySource.has(key)) {
            groupedBySource.set(key, []);
          }
          groupedBySource.get(key)!.push(k);
        }

        const references: Array<{
          year: string;
          origin?: string;
          destination?: string;
          containerTypes: string[];
          cargoType?: string;
          client?: string;
          project?: string;
          rates: Array<{ service: string; amount: number; currency: string; unit?: string }>;
          sourceEmailId?: string;
          createdAt: string;
        }> = [];

        for (const [key, items] of groupedBySource.entries()) {
          const [dateStr] = key.split('|');
          const year = dateStr.substring(0, 4);
          
          const firstItem = items[0];
          const firstData = firstItem.data as Record<string, unknown>;
          const criteria = firstItem.matching_criteria as Record<string, string> | null;
          
          const rates = items
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
                unit: (kData.unit as string) || undefined
              };
            });

          const containerTypesSet = new Set<string>();
          for (const item of items) {
            const kData = item.data as Record<string, unknown>;
            const ct = (kData.type_conteneur as string) || (kData.container_type as string);
            if (ct) containerTypesSet.add(ct);
          }

          if (rates.length > 0) {
            references.push({
              year,
              origin: criteria?.origin || (firstData.origine as string) || (firstData.origin as string),
              destination: criteria?.destination || (firstData.destination as string),
              containerTypes: Array.from(containerTypesSet),
              cargoType: criteria?.cargo_type || (firstData.type_marchandise as string),
              client: firstData.client as string,
              project: firstData.project as string,
              rates,
              sourceEmailId: firstItem.source_id || undefined,
              createdAt: firstItem.created_at
            });
          }
        }

        references.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        const evolutions: Array<{
          service: string;
          oldAmount: number;
          newAmount: number;
          percentChange: number;
          period: string;
        }> = [];

        if (references.length >= 2) {
          const newest = references[0];
          const oldest = references[references.length - 1];
          
          for (const newRate of newest.rates) {
            const oldRate = oldest.rates.find(r => 
              r.service.toLowerCase() === newRate.service.toLowerCase() ||
              r.service.toLowerCase().includes(newRate.service.toLowerCase().split(' ')[0])
            );
            
            if (oldRate && oldRate.amount > 0) {
              const percentChange = ((newRate.amount - oldRate.amount) / oldRate.amount) * 100;
              evolutions.push({
                service: newRate.service,
                oldAmount: oldRate.amount,
                newAmount: newRate.amount,
                percentChange,
                period: `${oldest.year} → ${newest.year}`
              });
            }
          }
        }

        console.log(`Found ${references.length} historical references, ${evolutions.length} evolutions`);

        return new Response(
          JSON.stringify({ 
            success: true, 
            references: references.slice(0, 10),
            evolutions 
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: `Action inconnue: ${action}. Actions disponibles: search, search_tariffs, find_historical_references, get_transport_rates, search_transport_rate` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

  } catch (error) {
    console.error("data-query error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Erreur inconnue" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
