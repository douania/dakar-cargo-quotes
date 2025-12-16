import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESPONSE_PROMPT = `Tu es un agent IA qui génère des réponses professionnelles pour des demandes de cotation logistique.

Tu dois créer une réponse de cotation basée sur:
1. La demande originale du client
2. Les connaissances apprises (tarifs, templates, processus)
3. Les pratiques SODATRA

La réponse doit:
- Être professionnelle et complète
- Inclure tous les postes de coûts détaillés
- Respecter les Incoterms mentionnés
- Utiliser les tarifs appris si disponibles
- Inclure les conditions et validité

Format de sortie:
{
  "subject": "Objet de l'email de réponse",
  "body": "Corps de l'email en texte formaté",
  "quotation_details": {
    "posts": [
      { "description": "...", "montant": 0, "devise": "FCFA" }
    ],
    "total": 0,
    "devise": "FCFA",
    "validite": "X jours",
    "conditions": ["..."]
  },
  "confidence": 0.0-1.0,
  "missing_info": ["liste des infos manquantes si applicable"]
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

    // Get relevant learned knowledge
    const { data: knowledge } = await supabase
      .from('learned_knowledge')
      .select('*')
      .gte('confidence', 0.5)
      .order('confidence', { ascending: false })
      .limit(20);

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

${knowledgeContext}

${customInstructions ? `\nINSTRUCTIONS SUPPLÉMENTAIRES:\n${customInstructions}` : ''}

Génère une réponse de cotation professionnelle.
    `;

    // Generate response
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: RESPONSE_PROMPT },
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
