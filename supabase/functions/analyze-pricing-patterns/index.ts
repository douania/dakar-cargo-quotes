import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PRICING_ANALYSIS_PROMPT = `Tu es un expert en analyse de structures de prix et cotations logistiques maritimes.

OBJECTIF: Analyser les données de cotations pour identifier les patterns de pricing utilisés par l'expert.

CONTEXTE BUSINESS IMPORTANT:
- Les marges bénéficiaires sont généralement CACHÉES dans les postes de coûts
- Il n'y a JAMAIS de ligne "marge" ou "profit" visible
- Les profits sont intégrés dans chaque poste (transport, handling, clearing, etc.)
- L'objectif est de reproduire exactement cette structure

ANALYSE DEMANDÉE:
1. Identifier tous les postes de coûts récurrents et leur dénomination exacte
2. Calculer les ratios entre postes (ex: handling = X% du transport)
3. Détecter les variations de prix selon le type de cargo/incoterm/destination
4. Identifier où les marges semblent intégrées (postes avec variations importantes)
5. Extraire les formules de calcul si visibles

RÉPONSE ATTENDUE (JSON):
{
  "quotation_structure": {
    "standard_line_items": [
      {
        "name": "Nom du poste",
        "typical_range": {"min": 0, "max": 0, "currency": "EUR"},
        "appears_in_percent": 90,
        "suspected_margin_integration": true/false
      }
    ],
    "optional_line_items": []
  },
  "pricing_patterns": {
    "ratios": [
      {"item1": "Handling", "item2": "Freight", "ratio": 0.15, "description": "Handling = 15% du freight"}
    ],
    "variations_by_cargo_type": {},
    "variations_by_incoterm": {},
    "variations_by_destination": {}
  },
  "margin_analysis": {
    "suspected_margin_items": ["item1", "item2"],
    "estimated_total_margin_percent": 15,
    "margin_distribution": {
      "transport": 5,
      "handling": 10,
      "clearing": 8
    }
  },
  "calculation_formulas": [
    {"name": "formula_name", "formula": "description de la formule"}
  ],
  "templates_identified": [
    {
      "name": "template_name",
      "cargo_type": "container/breakbulk/etc",
      "typical_items": ["item1", "item2"]
    }
  ],
  "confidence": 0.85,
  "notes": "Observations supplémentaires"
}`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { expertEmail, forceReanalyze } = await req.json();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log('Starting pricing pattern analysis...');
    
    // 1. Get expert profile
    const targetEmail = expertEmail || 'th@2hlgroup.com';
    const { data: expert } = await supabase
      .from('expert_profiles')
      .select('*')
      .eq('email', targetEmail)
      .single();
    
    console.log(`Analyzing patterns for expert: ${targetEmail}`);
    
    // 2. Fetch all emails from this expert with attachments
    const { data: emails, error: emailsError } = await supabase
      .from('emails')
      .select('id, subject, body_text, from_address, to_addresses, sent_at')
      .or(`from_address.eq.${targetEmail},to_addresses.cs.{${targetEmail}}`)
      .order('sent_at', { ascending: false })
      .limit(100);
    
    if (emailsError) {
      throw new Error(`Failed to fetch emails: ${emailsError.message}`);
    }
    
    console.log(`Found ${emails?.length || 0} emails`);
    
    // 3. Fetch all analyzed attachments (especially Excel files)
    const emailIds = emails?.map(e => e.id) || [];
    
    const { data: attachments, error: attachmentsError } = await supabase
      .from('email_attachments')
      .select('*')
      .in('email_id', emailIds)
      .eq('is_analyzed', true);
    
    if (attachmentsError) {
      throw new Error(`Failed to fetch attachments: ${attachmentsError.message}`);
    }
    
    console.log(`Found ${attachments?.length || 0} analyzed attachments`);
    
    // 4. Get existing learned knowledge about quotations
    const { data: existingKnowledge } = await supabase
      .from('learned_knowledge')
      .select('*')
      .in('category', ['quotation_style', 'pricing_pattern', 'negotiation']);
    
    console.log(`Found ${existingKnowledge?.length || 0} existing knowledge items`);
    
    // 5. Build context for AI analysis
    let contextData = {
      emails: emails?.slice(0, 30).map(e => ({
        subject: e.subject,
        from: e.from_address,
        date: e.sent_at,
        body_preview: e.body_text?.substring(0, 1000)
      })) || [],
      attachments: attachments?.map(a => ({
        filename: a.filename,
        content_type: a.content_type,
        extracted_data: a.extracted_data,
        extracted_text: a.extracted_text?.substring(0, 2000)
      })) || [],
      existing_knowledge: existingKnowledge?.map(k => ({
        name: k.name,
        category: k.category,
        description: k.description,
        data: k.data
      })) || []
    };
    
    // 6. Call AI to analyze patterns
    console.log('Calling AI for pattern analysis...');
    
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [
          {
            role: 'system',
            content: PRICING_ANALYSIS_PROMPT
          },
          {
            role: 'user',
            content: `Analyse les données suivantes pour identifier les patterns de pricing de l'expert ${targetEmail}:

EMAILS ET COTATIONS:
${JSON.stringify(contextData.emails, null, 2)}

PIÈCES JOINTES ANALYSÉES (Excel, PDF, etc.):
${JSON.stringify(contextData.attachments, null, 2)}

CONNAISSANCES DÉJÀ ACQUISES:
${JSON.stringify(contextData.existing_knowledge, null, 2)}

Identifie les patterns de pricing, les ratios entre postes de coûts, et où les marges semblent être intégrées.`
          }
        ]
      }),
    });
    
    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI analysis failed:', aiResponse.status, errorText);
      
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: 'Crédits AI insuffisants' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`AI analysis failed: ${aiResponse.status}`);
    }
    
    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || '';
    
    console.log('AI response received, parsing...');
    
    // 7. Parse and store the patterns
    let pricingPatterns: any = null;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        pricingPatterns = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.log('Could not parse JSON, storing raw response');
      pricingPatterns = { raw_analysis: content };
    }
    
    // 8. Store patterns in learned_knowledge
    const knowledgeEntries = [];
    
    // Store quotation structure
    if (pricingPatterns.quotation_structure) {
      knowledgeEntries.push({
        name: `Quotation_Structure_${targetEmail.split('@')[0]}`,
        category: 'quotation_style',
        description: 'Structure standard des cotations identifiée par analyse des patterns',
        data: pricingPatterns.quotation_structure,
        source_type: 'pattern_analysis',
        confidence: pricingPatterns.confidence || 0.7,
        is_validated: false
      });
    }
    
    // Store pricing ratios
    if (pricingPatterns.pricing_patterns) {
      knowledgeEntries.push({
        name: `Pricing_Ratios_${targetEmail.split('@')[0]}`,
        category: 'pricing_pattern',
        description: 'Ratios de prix entre postes de coûts',
        data: pricingPatterns.pricing_patterns,
        source_type: 'pattern_analysis',
        confidence: pricingPatterns.confidence || 0.7,
        is_validated: false
      });
    }
    
    // Store margin analysis
    if (pricingPatterns.margin_analysis) {
      knowledgeEntries.push({
        name: `Margin_Integration_${targetEmail.split('@')[0]}`,
        category: 'business_process',
        description: 'Analyse des marges intégrées dans les postes de coûts',
        data: pricingPatterns.margin_analysis,
        source_type: 'pattern_analysis',
        confidence: pricingPatterns.confidence || 0.7,
        is_validated: false
      });
    }
    
    // Store templates
    if (pricingPatterns.templates_identified?.length > 0) {
      knowledgeEntries.push({
        name: `Quotation_Templates_${targetEmail.split('@')[0]}`,
        category: 'quotation_style',
        description: 'Templates de cotation identifiés',
        data: { templates: pricingPatterns.templates_identified },
        source_type: 'pattern_analysis',
        confidence: pricingPatterns.confidence || 0.7,
        is_validated: false
      });
    }
    
    // Store calculation formulas
    if (pricingPatterns.calculation_formulas?.length > 0) {
      knowledgeEntries.push({
        name: `Pricing_Formulas_${targetEmail.split('@')[0]}`,
        category: 'pricing_pattern',
        description: 'Formules de calcul utilisées dans les cotations',
        data: { formulas: pricingPatterns.calculation_formulas },
        source_type: 'pattern_analysis',
        confidence: pricingPatterns.confidence || 0.7,
        is_validated: false
      });
    }
    
    // Upsert knowledge entries
    let savedCount = 0;
    for (const entry of knowledgeEntries) {
      // Check if exists
      const { data: existing } = await supabase
        .from('learned_knowledge')
        .select('id, confidence')
        .eq('name', entry.name)
        .single();
      
      if (existing && !forceReanalyze) {
        // Update only if new confidence is higher
        if ((entry.confidence || 0) > (existing.confidence || 0)) {
          await supabase
            .from('learned_knowledge')
            .update({
              data: entry.data,
              description: entry.description,
              confidence: entry.confidence,
              updated_at: new Date().toISOString()
            })
            .eq('id', existing.id);
          savedCount++;
        }
      } else {
        // Insert new or force update
        if (existing) {
          await supabase
            .from('learned_knowledge')
            .update({
              data: entry.data,
              description: entry.description,
              confidence: entry.confidence,
              updated_at: new Date().toISOString()
            })
            .eq('id', existing.id);
        } else {
          await supabase
            .from('learned_knowledge')
            .insert(entry);
        }
        savedCount++;
      }
    }
    
    console.log(`Saved ${savedCount} knowledge entries`);
    
    // 9. Update expert profile with pricing intelligence
    if (expert) {
      await supabase
        .from('expert_profiles')
        .update({
          quotation_templates: pricingPatterns.templates_identified || expert.quotation_templates,
          updated_at: new Date().toISOString()
        })
        .eq('id', expert.id);
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        expert: targetEmail,
        emails_analyzed: emails?.length || 0,
        attachments_analyzed: attachments?.length || 0,
        patterns_found: {
          quotation_structure: !!pricingPatterns.quotation_structure,
          pricing_ratios: pricingPatterns.pricing_patterns?.ratios?.length || 0,
          margin_items: pricingPatterns.margin_analysis?.suspected_margin_items?.length || 0,
          templates: pricingPatterns.templates_identified?.length || 0,
          formulas: pricingPatterns.calculation_formulas?.length || 0
        },
        knowledge_saved: savedCount,
        full_analysis: pricingPatterns,
        notes: pricingPatterns.notes
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error in analyze-pricing-patterns:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
