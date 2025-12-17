import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AUTONOMOUS_RESPONSE_PROMPT = `Tu es l'ASSISTANT VIRTUEL de Taleb Hoballah, expert opérationnel senior chez SODATRA/2HL Group, spécialisé en transit logistique maritime et aérien au Sénégal.

Tu dois générer des réponses de cotation EXACTEMENT comme Taleb le ferait, en utilisant son style, ses formulations et sa méthode.

PRINCIPES DE TALEB (À RESPECTER ABSOLUMENT):
1. Séparation stricte des postes de coûts (jamais de forfait global opaque)
2. Distinction claire entre débours (refacturés à l'identique) et honoraires
3. Incoterms appliqués rigoureusement - responsabilités selon les termes
4. Jamais de cotation sans infos minimales (Incoterm, mode, type marchandise, unité, origine)
5. Tarifs basés sur les grilles officielles (PAD, DP World, compagnies)
6. Conditions de validité et délais toujours mentionnés

STRUCTURE D'UNE COTATION TALEB:
1. Salutation personnalisée
2. Référence à la demande du client
3. Résumé de l'opération comprise
4. Tableau de cotation avec colonnes: Description | Montant | Devise | Notes
5. Postes obligatoires:
   - Fret maritime/aérien
   - THC (Terminal Handling Charges)
   - Manutention
   - Dédouanement (honoraires)
   - Droits et taxes (estimation ou réels)
   - Frais portuaires/aéroportuaires
   - Transport local si applicable
6. Total avec devise
7. Conditions:
   - Validité (généralement 15 jours)
   - Délais de transit estimés
   - Documents requis
   - Exclusions explicites
8. Formule de clôture professionnelle
9. Signature avec coordonnées

STYLE TALEB:
- Ton: Professionnel mais chaleureux
- Précision: Chiffres exacts ou clairement marqués comme estimations
- Transparence: Explique les bases de calcul
- Réactivité: Propose des alternatives si pertinent
- Expertise: Mentionne les réglementations applicables

FORMAT DE SORTIE JSON:
{
  "subject": "Objet de l'email - clair et professionnel",
  "body": "Corps complet de l'email formaté, prêt à envoyer",
  "quotation_details": {
    "operation_type": "import|export|transit",
    "incoterm": "EXW|FOB|CIF|DAP|etc",
    "mode": "maritime|aerien|routier|multimodal",
    "posts": [
      { 
        "category": "fret|thc|manutention|dedouanement|droits_taxes|portuaires|transport_local|autres",
        "description": "Description détaillée",
        "montant": number,
        "devise": "FCFA|EUR|USD",
        "is_estimate": boolean,
        "notes": "Notes explicatives si besoin"
      }
    ],
    "subtotal_ht": number,
    "taxes_estimate": number,
    "total": number,
    "devise": "FCFA",
    "validite": "15 jours",
    "delai_transit": "X jours",
    "conditions": ["condition 1", "condition 2"],
    "exclusions": ["exclusion 1"],
    "documents_requis": ["document 1"]
  },
  "confidence": 0.0-1.0,
  "autonomous_score": 0.0-1.0,
  "missing_info": ["info manquante si applicable"],
  "requires_validation": boolean,
  "validation_reason": "Raison si validation requise"
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { emailId, customInstructions } = await req.json();
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the original email
    const { data: email, error: emailError } = await supabase
      .from('emails')
      .select('*')
      .eq('id', emailId)
      .single();

    if (emailError || !email) {
      throw new Error("Email non trouvé");
    }

    console.log("Generating response for email:", email.subject);

    // Get primary expert profile
    const { data: expert } = await supabase
      .from('expert_profiles')
      .select('*')
      .eq('is_primary', true)
      .maybeSingle();

    // Get relevant learned knowledge (prioritize validated and high confidence)
    const { data: knowledge } = await supabase
      .from('learned_knowledge')
      .select('*')
      .gte('confidence', 0.5)
      .order('is_validated', { ascending: false })
      .order('confidence', { ascending: false })
      .limit(30);

    // Get recent market intelligence (last 30 days)
    const { data: marketIntel } = await supabase
      .from('market_intelligence')
      .select('*')
      .eq('is_processed', false)
      .gte('detected_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order('impact_level', { ascending: false })
      .limit(10);

    // Build expert context
    let expertContext = '';
    if (expert) {
      expertContext = `\n\nPROFIL EXPERT À IMITER (${expert.name}):\n`;
      if (expert.communication_style) {
        expertContext += `Style: ${JSON.stringify(expert.communication_style)}\n`;
      }
      if (expert.quotation_templates) {
        expertContext += `Templates cotation: ${JSON.stringify(expert.quotation_templates)}\n`;
      }
      if (expert.response_patterns) {
        expertContext += `Patterns de réponse: ${JSON.stringify(expert.response_patterns)}\n`;
      }
    }

    // Build knowledge context
    let knowledgeContext = '';
    if (knowledge && knowledge.length > 0) {
      knowledgeContext = '\n\nCONNAISSANCES DISPONIBLES:\n';
      
      const byCategory: Record<string, any[]> = {};
      knowledge.forEach(k => {
        if (!byCategory[k.category]) byCategory[k.category] = [];
        byCategory[k.category].push(k);
      });

      for (const [cat, items] of Object.entries(byCategory)) {
        knowledgeContext += `\n## ${cat.toUpperCase()}\n`;
        for (const item of items) {
          knowledgeContext += `- ${item.name}: ${item.description}\n`;
          knowledgeContext += `  Données: ${JSON.stringify(item.data)}\n`;
        }
      }
    }

    // Build market intelligence context
    let marketContext = '';
    if (marketIntel && marketIntel.length > 0) {
      marketContext = '\n\nALERTES MARCHÉ RÉCENTES:\n';
      for (const intel of marketIntel) {
        marketContext += `- [${intel.impact_level.toUpperCase()}] ${intel.title}: ${intel.summary}\n`;
      }
    }

    // Get thread context
    let threadContext = '';
    if (email.thread_id) {
      const { data: threadEmails } = await supabase
        .from('emails')
        .select('from_address, subject, body_text, sent_at')
        .eq('thread_id', email.thread_id)
        .order('sent_at', { ascending: true });

      if (threadEmails && threadEmails.length > 1) {
        threadContext = '\n\nHISTORIQUE DU FIL DE DISCUSSION:\n';
        for (const e of threadEmails) {
          threadContext += `\n--- ${e.from_address} (${new Date(e.sent_at).toLocaleDateString('fr-FR')}) ---\n`;
          threadContext += e.body_text?.substring(0, 1000) + '\n';
        }
      }
    }

    // Build prompt
    const userPrompt = `
DEMANDE DU CLIENT:
De: ${email.from_address}
Objet: ${email.subject}
Date: ${email.sent_at}

${email.body_text}

${threadContext}
${expertContext}
${knowledgeContext}
${marketContext}

${customInstructions ? `\nINSTRUCTIONS SUPPLÉMENTAIRES:\n${customInstructions}` : ''}

Génère une réponse de cotation professionnelle EXACTEMENT comme Taleb le ferait.
    `;

    // Generate response with enhanced prompt
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: AUTONOMOUS_RESPONSE_PROMPT },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      }),
    });

    if (!response.ok) {
      throw new Error("Erreur de génération IA");
    }

    const aiResult = await response.json();
    const generatedContent = aiResult.choices?.[0]?.message?.content;
    
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(generatedContent);
    } catch (e) {
      throw new Error("Erreur de parsing de la réponse");
    }

    // Create draft
    const { data: draft, error: draftError } = await supabase
      .from('email_drafts')
      .insert({
        original_email_id: emailId,
        to_addresses: [email.from_address],
        subject: parsedResponse.subject || `Re: ${email.subject}`,
        body_text: parsedResponse.body,
        status: 'draft',
        ai_generated: true
      })
      .select()
      .single();

    if (draftError) {
      console.error("Error creating draft:", draftError);
      throw new Error("Erreur de création du brouillon");
    }

    // Update knowledge usage
    if (knowledge && knowledge.length > 0) {
      const knowledgeIds = knowledge.map(k => k.id);
      await supabase
        .from('learned_knowledge')
        .update({ 
          usage_count: supabase.rpc('increment_count'),
          last_used_at: new Date().toISOString()
        })
        .in('id', knowledgeIds);
    }

    console.log("Generated draft:", draft.id);

    return new Response(
      JSON.stringify({
        success: true,
        draft: draft,
        quotation: parsedResponse.quotation_details,
        confidence: parsedResponse.confidence,
        missing_info: parsedResponse.missing_info
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Response generation error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur de génération" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
