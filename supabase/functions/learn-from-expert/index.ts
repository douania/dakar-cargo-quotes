import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXPERT_LEARNING_PROMPT = `Tu es un système d'apprentissage spécialisé pour une entreprise de transit logistique (SODATRA/2HL Group) au Sénégal.

Tu analyses les emails d'un EXPERT OPÉRATIONNEL pour apprendre son style de travail, ses techniques et méthodes afin de pouvoir le remplacer de manière autonome.

OBJECTIF: Extraire tout ce qui permettrait à une IA de répondre EXACTEMENT comme cet expert le ferait.

Analyse en profondeur:

1. **STYLE DE COTATION** (category: "quotation_style")
   - Structure des cotations (postes, ordre, niveau de détail)
   - Formulations utilisées pour présenter les prix
   - Mise en forme (tableaux, listes, paragraphes)
   - Mentions légales et conditions récurrentes
   Format: { structure, formulations, mise_en_forme, conditions_types, exemples }

2. **TECHNIQUES DE NÉGOCIATION** (category: "negotiation")
   - Stratégies de réponse aux objections prix
   - Techniques de relance client
   - Gestion des demandes de remise
   - Arguments de vente récurrents
   Format: { strategies, arguments, reponses_objections, relances }

3. **TEMPLATES DE RÉPONSE** (category: "email_template")
   - Modèles de réponse par type de demande
   - Phrases d'accroche
   - Formules de politesse personnalisées
   - Signatures et mentions
   Format: { type_demande, template_complet, variables, contexte_utilisation }

4. **EXPERTISE TECHNIQUE** (category: "technical_expertise")
   - Connaissance des tarifs (THC, magasinage, manutention)
   - Règles douanières appliquées
   - Spécificités Incoterms maîtrisées
   - Particularités du Port de Dakar
   Format: { domaine, connaissances, applications_pratiques, sources_citees }

5. **PROCESSUS MÉTIER** (category: "business_process")
   - Étapes de traitement d'une demande
   - Vérifications systématiques
   - Points de contrôle qualité
   - Gestion des urgences
   Format: { processus, etapes, verifications, priorites }

6. **RELATIONS CLIENTS** (category: "client_relations")
   - Adaptation du discours par client
   - Historique des négociations
   - Préférences client connues
   Format: { client, historique, preferences, approche_personnalisee }

Réponds UNIQUEMENT avec un JSON valide:
{
  "expert": {
    "name": "Nom complet",
    "email": "email",
    "role": "Rôle",
    "expertise_domains": ["domaines"],
    "years_experience_estimated": number
  },
  "communication_style": {
    "tone": "formel|semi-formel|direct|chaleureux",
    "language": "fr|en|bilingue",
    "formulas": {
      "opening": ["formules d'ouverture"],
      "closing": ["formules de clôture"],
      "signature": "signature type"
    },
    "distinctive_traits": ["traits distinctifs"]
  },
  "quotation_patterns": {
    "structure": ["ordre des sections"],
    "mandatory_elements": ["éléments toujours présents"],
    "pricing_presentation": "comment les prix sont présentés",
    "conditions": ["conditions standards"],
    "validity_period": "durée type de validité"
  },
  "response_patterns": [
    {
      "trigger": "type de demande/situation",
      "response_template": "structure de réponse",
      "key_elements": ["éléments clés"],
      "examples": ["exemples tirés des emails"]
    }
  ],
  "extractions": [
    {
      "category": "quotation_style|negotiation|email_template|technical_expertise|business_process|client_relations",
      "name": "Nom descriptif unique",
      "description": "Description détaillée",
      "data": { ... },
      "confidence": 0.0-1.0
    }
  ],
  "summary": "Profil complet de l'expert en 3-4 phrases"
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { expertEmail, forceRelearn } = await req.json();
    
    if (!expertEmail) {
      throw new Error("expertEmail requis");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`Learning from expert: ${expertEmail}`);

    // Get or create expert profile
    let { data: expert, error: expertError } = await supabase
      .from('expert_profiles')
      .select('*')
      .eq('email', expertEmail)
      .maybeSingle();

    if (!expert) {
      const { data: newExpert, error } = await supabase
        .from('expert_profiles')
        .insert({ 
          name: expertEmail.split('@')[0], 
          email: expertEmail,
          is_primary: true
        })
        .select()
        .single();
      
      if (error) throw error;
      expert = newExpert;
    }

    // Get ALL emails from and to this expert (both sent and received)
    const { data: emails, error: emailError } = await supabase
      .from('emails')
      .select('*')
      .or(`from_address.eq.${expertEmail},to_addresses.cs.{${expertEmail}}`)
      .order('sent_at', { ascending: true });

    if (emailError) throw emailError;

    if (!emails || emails.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Aucun email trouvé pour cet expert" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${emails.length} emails involving expert`);

    // Group by thread for better context
    const threads: Record<string, typeof emails> = {};
    for (const email of emails) {
      const threadKey = email.thread_id || email.id;
      if (!threads[threadKey]) threads[threadKey] = [];
      threads[threadKey].push(email);
    }

    // Build comprehensive context (limit to avoid token overflow)
    const maxEmails = 50;
    const selectedEmails = emails.slice(-maxEmails); // Most recent
    
    const emailsContext = selectedEmails.map((email, index) => `
--- EMAIL ${index + 1}/${selectedEmails.length} ---
DIRECTION: ${email.from_address === expertEmail ? 'ENVOYÉ PAR EXPERT' : 'REÇU PAR EXPERT'}
SUJET: ${email.subject}
DATE: ${email.sent_at}
DE: ${email.from_address}
À: ${email.to_addresses.join(', ')}
${email.cc_addresses?.length ? `CC: ${email.cc_addresses.join(', ')}` : ''}

${email.body_text?.substring(0, 2500) || '(contenu vide)'}
`).join('\n\n');

    console.log(`Analyzing ${selectedEmails.length} emails...`);

    // Call AI for comprehensive expert analysis
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: EXPERT_LEARNING_PROMPT },
          { role: "user", content: `Analyse ces ${selectedEmails.length} emails de l'expert ${expertEmail} (${expert.name}):\n\n${emailsContext}` }
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
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: "Limite de requêtes atteinte, réessayez dans quelques minutes" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error("Erreur d'analyse IA");
    }

    const aiResult = await response.json();
    const contentResult = aiResult.choices?.[0]?.message?.content;
    
    console.log("AI response received, parsing...");

    let analysisResult = null;
    try {
      const jsonMatch = contentResult.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error("Failed to parse AI response:", e);
      throw new Error("Impossible de parser la réponse IA");
    }

    if (!analysisResult) {
      throw new Error("Réponse IA vide");
    }

    console.log(`Extracted ${analysisResult.extractions?.length || 0} knowledge items`);

    // Update expert profile with learned patterns
    const { error: updateError } = await supabase
      .from('expert_profiles')
      .update({
        name: analysisResult.expert?.name || expert.name,
        expertise: analysisResult.expert?.expertise_domains || expert.expertise,
        communication_style: analysisResult.communication_style,
        response_patterns: analysisResult.response_patterns,
        quotation_templates: analysisResult.quotation_patterns,
        learned_from_count: (expert.learned_from_count || 0) + selectedEmails.length,
        last_learned_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', expert.id);

    if (updateError) {
      console.error("Error updating expert profile:", updateError);
    }

    // Store individual knowledge items
    const stored = [];
    for (const extraction of (analysisResult.extractions || [])) {
      if (extraction.confidence < 0.5) {
        console.log("Skipping low confidence:", extraction.name);
        continue;
      }

      // Check for existing
      const { data: existing } = await supabase
        .from('learned_knowledge')
        .select('id, confidence')
        .eq('category', extraction.category)
        .eq('name', extraction.name)
        .maybeSingle();

      if (existing) {
        // Update only if higher confidence or force relearn
        if (forceRelearn || extraction.confidence > existing.confidence) {
          await supabase
            .from('learned_knowledge')
            .update({
              data: extraction.data,
              confidence: extraction.confidence,
              description: extraction.description,
              source_type: 'expert_learning',
              updated_at: new Date().toISOString()
            })
            .eq('id', existing.id);
          
          stored.push({ ...extraction, updated: true });
        }
      } else {
        // Insert new
        const { data: inserted, error } = await supabase
          .from('learned_knowledge')
          .insert({
            category: extraction.category,
            name: extraction.name,
            description: extraction.description,
            data: { ...extraction.data, expert_email: expertEmail },
            source_type: 'expert_learning',
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

    console.log(`Stored ${stored.length} knowledge items`);

    return new Response(
      JSON.stringify({
        success: true,
        expert: {
          ...expert,
          ...analysisResult.expert,
          communication_style: analysisResult.communication_style,
          quotation_patterns: analysisResult.quotation_patterns
        },
        summary: analysisResult.summary,
        emails_analyzed: selectedEmails.length,
        threads_analyzed: Object.keys(threads).length,
        extracted: analysisResult.extractions?.length || 0,
        stored: stored.length,
        knowledge: stored
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Expert learning error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Erreur d'apprentissage" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
