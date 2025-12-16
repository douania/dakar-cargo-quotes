import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LEARNING_PROMPT = `Tu es un expert en extraction de connaissances pour une entreprise de transit logistique au Sénégal (SODATRA).

Analyse le contenu fourni et extrais les connaissances suivantes si présentes:

1. **TARIFS** (category: "tarif")
   - Prix de transport par destination/origine
   - Frais de manutention
   - Honoraires de dédouanement
   - Frais portuaires
   Format: { origine, destination, type_transport, tarif, devise, conditions, validite }

2. **TEMPLATES** (category: "template")
   - Structure des cotations envoyées
   - Formules de politesse
   - Mentions légales
   Format: { type_document, structure, exemple }

3. **CONTACTS** (category: "contact")
   - Clients avec leurs préférences
   - Fournisseurs et compagnies maritimes
   - Partenaires et agents
   Format: { nom, email, telephone, type, preferences, historique }

4. **PROCESSUS** (category: "processus")
   - Étapes de traitement des demandes
   - Délais habituels
   - Documents requis
   Format: { type_operation, etapes, delai_moyen, documents_requis }

5. **CONDITIONS** (category: "condition")
   - Conditions de paiement
   - Franchises et pénalités
   - Règles spécifiques par client
   Format: { type, description, applicable_a }

Réponds UNIQUEMENT avec un JSON valide au format:
{
  "extractions": [
    {
      "category": "tarif|template|contact|processus|condition",
      "name": "Nom court descriptif",
      "description": "Description détaillée",
      "data": { ... données structurées ... },
      "confidence": 0.0-1.0
    }
  ]
}

Si aucune connaissance exploitable n'est trouvée, retourne: { "extractions": [] }`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { contentType, contentId, content, forceRelearn = false } = await req.json();
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`Learning from ${contentType}:`, contentId);

    // Get content if not provided
    let textContent = content;
    let sourceRecord = null;

    if (!textContent && contentId) {
      if (contentType === 'email') {
        const { data: email } = await supabase
          .from('emails')
          .select('*')
          .eq('id', contentId)
          .single();
        
        if (email) {
          sourceRecord = email;
          textContent = `
SUJET: ${email.subject}
DE: ${email.from_address}
DATE: ${email.sent_at}

CONTENU:
${email.body_text}
          `;
        }
      } else if (contentType === 'document') {
        const { data: doc } = await supabase
          .from('documents')
          .select('*')
          .eq('id', contentId)
          .single();
        
        if (doc) {
          sourceRecord = doc;
          textContent = `
FICHIER: ${doc.filename}
TYPE: ${doc.file_type}

CONTENU:
${doc.content_text}

DONNÉES EXTRAITES:
${JSON.stringify(doc.extracted_data, null, 2)}
          `;
        }
      }
    }

    if (!textContent) {
      throw new Error("Aucun contenu à analyser");
    }

    // Call AI for extraction
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: LEARNING_PROMPT },
          { role: "user", content: textContent }
        ],
        response_format: { type: "json_object" }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI error:", errorText);
      throw new Error("Erreur d'analyse IA");
    }

    const aiResult = await response.json();
    const content_result = aiResult.choices?.[0]?.message?.content;
    
    let extractions = [];
    try {
      const parsed = JSON.parse(content_result);
      extractions = parsed.extractions || [];
    } catch (e) {
      console.error("Failed to parse AI response:", content_result);
      extractions = [];
    }

    console.log(`Extracted ${extractions.length} knowledge items`);

    // Store learned knowledge
    const stored = [];
    for (const extraction of extractions) {
      if (extraction.confidence < 0.3) {
        console.log("Skipping low confidence extraction:", extraction.name);
        continue;
      }

      // Check for duplicates or similar knowledge
      const { data: existing } = await supabase
        .from('learned_knowledge')
        .select('id, confidence, usage_count')
        .eq('category', extraction.category)
        .eq('name', extraction.name)
        .maybeSingle();

      if (existing && !forceRelearn) {
        // Update confidence if new extraction has higher confidence
        if (extraction.confidence > existing.confidence) {
          await supabase
            .from('learned_knowledge')
            .update({
              data: extraction.data,
              confidence: extraction.confidence,
              description: extraction.description
            })
            .eq('id', existing.id);
          
          console.log("Updated existing knowledge:", extraction.name);
        }
        continue;
      }

      const { data: inserted, error } = await supabase
        .from('learned_knowledge')
        .insert({
          category: extraction.category,
          name: extraction.name,
          description: extraction.description,
          data: extraction.data,
          source_type: contentType,
          source_id: contentId,
          confidence: extraction.confidence,
          is_validated: extraction.confidence >= 0.8
        })
        .select()
        .single();

      if (error) {
        console.error("Error storing knowledge:", error);
        continue;
      }

      stored.push(inserted);
    }

    // Mark source as processed
    if (sourceRecord && contentId) {
      if (contentType === 'email') {
        await supabase
          .from('emails')
          .update({ 
            extracted_data: { 
              ...sourceRecord.extracted_data, 
              learned: true, 
              learned_at: new Date().toISOString(),
              knowledge_count: stored.length
            }
          })
          .eq('id', contentId);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        extracted: extractions.length,
        stored: stored.length,
        knowledge: stored
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Learning error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur d'apprentissage" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
