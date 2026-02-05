import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CONTACT_LEARNING_PROMPT = `Tu es un expert en analyse de communication d'affaires pour une entreprise de transit logistique au Sénégal (SODATRA).

Analyse les emails suivants provenant d'un même contact professionnel et extrais:

1. **STYLE DE COMMUNICATION** (category: "communication_style")
   - Ton utilisé (formel, semi-formel, direct)
   - Formules de politesse préférées
   - Structure typique des messages
   - Langue et expressions caractéristiques
   Format: { ton, formules_ouverture, formules_fermeture, signature, langue_principale }

2. **EXPERTISE MÉTIER** (category: "expertise")
   - Domaines de compétence démontrés
   - Connaissances techniques (codes HS, règles douanières, etc.)
   - Termes techniques utilisés
   Format: { domaines, connaissances_cles, terminologie }

3. **PATTERNS DE RÉPONSE** (category: "response_pattern")
   - Comment cette personne répond aux demandes de cotation
   - Comment elle gère les objections ou questions
   - Délais et conditions qu'elle mentionne fréquemment
   Format: { type_demande, structure_reponse, elements_cles, conditions_mentionnees }

4. **INSTRUCTIONS RÉCURRENTES** (category: "instructions")
   - Consignes données aux équipes/partenaires
   - Règles métier appliquées
   - Points de vigilance soulignés
   Format: { type, instruction, contexte, frequence }

5. **RELATIONS COMMERCIALES** (category: "relations")
   - Partenaires mentionnés
   - Clients référencés
   - Style de négociation
   Format: { partenaires, clients, approche_commerciale }

Réponds UNIQUEMENT avec un JSON valide au format:
{
  "contact": {
    "name": "Nom du contact",
    "email": "email",
    "company": "Société",
    "role": "Rôle estimé"
  },
  "extractions": [
    {
      "category": "communication_style|expertise|response_pattern|instructions|relations",
      "name": "Nom descriptif",
      "description": "Description détaillée avec exemples",
      "data": { ... données structurées ... },
      "confidence": 0.0-1.0
    }
  ],
  "summary": "Résumé du profil de communication de ce contact"
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { contactEmail, contactName } = await req.json();
    
    if (!contactEmail && !contactName) {
      throw new Error("contactEmail ou contactName requis");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`Learning from contact: ${contactEmail || contactName}`);

    // Get all emails from this contact
    let query = supabase.from('emails').select('*');
    
    if (contactEmail) {
      query = query.eq('from_address', contactEmail);
    } else if (contactName) {
      query = query.or(`from_address.ilike.%${contactName}%,body_text.ilike.%${contactName}%`);
    }
    
    const { data: emails, error: emailError } = await query.order('sent_at', { ascending: true });

    if (emailError) throw emailError;

    if (!emails || emails.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Aucun email trouvé pour ce contact" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${emails.length} emails from contact`);

    // Compile all emails into a single context
    const emailsContext = emails.map((email, index) => `
--- EMAIL ${index + 1} ---
SUJET: ${email.subject}
DATE: ${email.sent_at}
DE: ${email.from_address}

${email.body_text?.substring(0, 3000) || '(contenu vide)'}
`).join('\n\n');

    // Call AI for comprehensive analysis
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: CONTACT_LEARNING_PROMPT },
          { role: "user", content: `Analyse ces ${emails.length} emails du contact ${contactEmail || contactName}:\n\n${emailsContext}` }
        ]
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI error:", response.status, errorText);
      
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: "Crédits AI insuffisants" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error("Erreur d'analyse IA");
    }

    const aiResult = await response.json();
    const contentResult = aiResult.choices?.[0]?.message?.content;
    
    console.log("AI response received, parsing...");

    let analysisResult = null;
    try {
      // Extract JSON from response
      const jsonMatch = contentResult.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error("Failed to parse AI response:", e);
      analysisResult = { extractions: [], summary: contentResult };
    }

    if (!analysisResult) {
      throw new Error("Impossible de parser la réponse IA");
    }

    console.log(`Extracted ${analysisResult.extractions?.length || 0} knowledge items`);

    // Store learned knowledge
    const stored = [];
    for (const extraction of (analysisResult.extractions || [])) {
      if (extraction.confidence < 0.4) {
        console.log("Skipping low confidence:", extraction.name);
        continue;
      }

      // Check for existing
      const { data: existing } = await supabase
        .from('learned_knowledge')
        .select('id')
        .eq('category', extraction.category)
        .eq('name', extraction.name)
        .maybeSingle();

      if (existing) {
        // Update
        await supabase
          .from('learned_knowledge')
          .update({
            data: extraction.data,
            confidence: extraction.confidence,
            description: extraction.description,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
        
        stored.push({ ...extraction, updated: true });
      } else {
        // Insert
        const { data: inserted, error } = await supabase
          .from('learned_knowledge')
          .insert({
            category: extraction.category,
            name: extraction.name,
            description: extraction.description,
            data: extraction.data,
            source_type: 'contact_emails',
            source_id: null,
            confidence: extraction.confidence,
            is_validated: extraction.confidence >= 0.8
          })
          .select()
          .single();

        if (!error && inserted) {
          stored.push(inserted);
        }
      }
    }

    // Mark all emails as learned
    for (const email of emails) {
      await supabase
        .from('emails')
        .update({
          extracted_data: {
            ...email.extracted_data,
            learned: true,
            learned_at: new Date().toISOString(),
            learned_from: 'contact_analysis'
          }
        })
        .eq('id', email.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        contact: analysisResult.contact,
        summary: analysisResult.summary,
        emails_analyzed: emails.length,
        extracted: analysisResult.extractions?.length || 0,
        stored: stored.length,
        knowledge: stored
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Contact learning error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Erreur d'apprentissage" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
