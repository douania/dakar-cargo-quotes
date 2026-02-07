import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANALYSIS_PROMPT = `Tu es un analyste spécialisé en logistique maritime et douanes au Sénégal.

Analyse le contenu suivant et identifie:
1. Nouvelles réglementations ou changements de règles
2. Modifications de tarifs (port, manutention, transport)
3. Alertes sur le marché (grèves, congestion, pénurie)
4. Nouvelles procédures douanières
5. Changements importants pour les transitaires

Pour chaque élément détecté, fournis:
- Un titre clair
- Un résumé de l'impact
- Le niveau d'impact (low/medium/high/critical)
- La catégorie (regulation/tariff/market_change/news)

Réponds en JSON:
{
  "detections": [
    {
      "title": "Titre de l'alerte",
      "summary": "Résumé en 2-3 phrases",
      "impact_level": "low|medium|high|critical",
      "category": "regulation|tariff|market_change|news",
      "relevant_for": ["import", "export", "transit", "customs", "all"],
      "action_required": "Action recommandée si applicable"
    }
  ],
  "no_significant_changes": boolean,
  "analysis_summary": "Résumé global de l'analyse"
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Phase S0: Auth guard
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

    const { sourceId, forceRefresh } = await req.json().catch(() => ({}));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    if (!FIRECRAWL_API_KEY) {
      throw new Error("FIRECRAWL_API_KEY not configured - Connectez le connecteur Firecrawl");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get sources to scrape
    let query = supabase
      .from('surveillance_sources')
      .select('*')
      .eq('is_active', true);

    if (sourceId) {
      query = query.eq('id', sourceId);
    }

    const { data: sources, error: sourcesError } = await query;

    if (sourcesError) throw sourcesError;

    if (!sources || sources.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Aucune source de surveillance active" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Surveilling ${sources.length} sources...`);

    const results = [];
    const allDetections = [];

    for (const source of sources) {
      console.log(`Scraping: ${source.name} (${source.url})`);

      try {
        // Use Firecrawl to scrape the source
        const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: source.url,
            formats: ['markdown'],
            onlyMainContent: true,
            waitFor: 3000,
          }),
        });

        if (!scrapeResponse.ok) {
          console.error(`Firecrawl error for ${source.name}:`, scrapeResponse.status);
          results.push({ source: source.name, success: false, error: "Scraping failed" });
          continue;
        }

        const scrapeData = await scrapeResponse.json();
        const content = scrapeData.data?.markdown || scrapeData.markdown || '';

        if (!content || content.length < 100) {
          console.log(`No significant content from ${source.name}`);
          results.push({ source: source.name, success: true, detections: 0, note: "No content" });
          continue;
        }

        console.log(`Got ${content.length} chars from ${source.name}, analyzing...`);

        // Analyze content with AI
        const analysisResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: ANALYSIS_PROMPT },
              { role: "user", content: `Source: ${source.name} (${source.category})\nURL: ${source.url}\n\nContenu:\n${content.substring(0, 15000)}` }
            ]
          }),
        });

        if (!analysisResponse.ok) {
          console.error(`AI analysis error for ${source.name}`);
          results.push({ source: source.name, success: false, error: "Analysis failed" });
          continue;
        }

        const analysisResult = await analysisResponse.json();
        const analysisContent = analysisResult.choices?.[0]?.message?.content;

        let detections = [];
        try {
          const jsonMatch = analysisContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            detections = parsed.detections || [];
          }
        } catch (e) {
          console.error(`Failed to parse analysis for ${source.name}:`, e);
        }

        // Store detections in market_intelligence
        for (const detection of detections) {
          // Check if similar detection exists recently (last 7 days)
          const { data: existing } = await supabase
            .from('market_intelligence')
            .select('id')
            .eq('source', source.name)
            .eq('title', detection.title)
            .gte('detected_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
            .maybeSingle();

          if (!existing) {
            const { data: inserted, error } = await supabase
              .from('market_intelligence')
              .insert({
                source: source.name,
                category: detection.category,
                title: detection.title,
                summary: detection.summary,
                content: detection.action_required || '',
                url: source.url,
                impact_level: detection.impact_level,
                is_processed: false
              })
              .select()
              .single();

            if (!error && inserted) {
              allDetections.push(inserted);
            }
          }
        }

        // Update last_scraped_at
        await supabase
          .from('surveillance_sources')
          .update({ last_scraped_at: new Date().toISOString() })
          .eq('id', source.id);

        results.push({ 
          source: source.name, 
          success: true, 
          detections: detections.length,
          stored: detections.length
        });

      } catch (sourceError) {
        console.error(`Error processing ${source.name}:`, sourceError);
        results.push({ 
          source: source.name, 
          success: false, 
          error: sourceError instanceof Error ? sourceError.message : "Unknown error" 
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const totalDetections = allDetections.length;

    console.log(`Surveillance complete: ${successCount}/${sources.length} sources, ${totalDetections} new detections`);

    return new Response(
      JSON.stringify({
        success: true,
        sources_processed: sources.length,
        sources_successful: successCount,
        new_detections: totalDetections,
        results,
        detections: allDetections
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Market surveillance error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Erreur de surveillance" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
