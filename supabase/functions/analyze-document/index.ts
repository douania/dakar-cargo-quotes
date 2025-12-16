import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { documentId, analysisType } = await req.json();

    if (!documentId) {
      return new Response(
        JSON.stringify({ error: 'documentId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch document
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !doc) {
      return new Response(
        JSON.stringify({ error: 'Document not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Analyzing document:', doc.filename);

    // Build analysis prompt based on type
    let systemPrompt = '';
    let userPrompt = '';

    if (analysisType === 'cotation' || doc.tags?.includes('cotation')) {
      systemPrompt = `Tu es un expert en logistique maritime et douanes au Sénégal. 
Analyse ce document et extrait les informations de cotation suivantes:
- Montant total
- Détail des frais (transport, manutention, douane, etc.)
- Incoterm utilisé
- Port d'origine et destination
- Type de marchandise
- Poids/volume
- Références (numéros de conteneur, BL, etc.)

Réponds en JSON structuré.`;
      userPrompt = `Analyse cette cotation:\n\n${doc.content_text?.substring(0, 8000)}`;
    } else if (analysisType === 'douane' || doc.tags?.includes('douane')) {
      systemPrompt = `Tu es un expert en douanes sénégalaises.
Analyse ce document douanier et extrait:
- Code SH des produits
- Valeur CAF/CIF
- Droits et taxes (DD, RS, PCS, TVA, etc.)
- Références déclaration
- Importateur/Exportateur

Réponds en JSON structuré.`;
      userPrompt = `Analyse ce document douanier:\n\n${doc.content_text?.substring(0, 8000)}`;
    } else if (analysisType === 'bl' || doc.tags?.includes('BL')) {
      systemPrompt = `Tu es un expert en documents de transport maritime.
Analyse ce Bill of Lading et extrait:
- Numéro BL
- Shipper (expéditeur)
- Consignee (destinataire)
- Port d'embarquement
- Port de déchargement
- Description marchandises
- Poids brut
- Nombre de conteneurs
- Numéros conteneurs

Réponds en JSON structuré.`;
      userPrompt = `Analyse ce BL:\n\n${doc.content_text?.substring(0, 8000)}`;
    } else {
      systemPrompt = `Tu es un assistant expert en logistique et douanes.
Analyse ce document et extrait les informations clés pertinentes.
Identifie le type de document et les données importantes.

Réponds en JSON structuré avec les champs trouvés.`;
      userPrompt = `Analyse ce document:\n\n${doc.content_text?.substring(0, 8000)}`;
    }

    // Call Lovable AI
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI error:', aiResponse.status, errorText);
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Limite de requêtes atteinte, réessayez dans quelques instants' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw new Error('AI analysis failed');
    }

    const aiData = await aiResponse.json();
    const analysisResult = aiData.choices?.[0]?.message?.content;

    // Parse JSON result
    let parsedAnalysis = null;
    try {
      parsedAnalysis = JSON.parse(analysisResult);
    } catch {
      parsedAnalysis = { raw_analysis: analysisResult };
    }

    // Update document with analysis
    const { error: updateError } = await supabase
      .from('documents')
      .update({
        extracted_data: {
          ...doc.extracted_data,
          ai_analysis: parsedAnalysis,
          analysis_type: analysisType,
          analyzed_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    if (updateError) {
      console.error('Update error:', updateError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        analysis: parsedAnalysis,
        document_type: doc.tags,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Analyze document error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
