import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXPERT_SYSTEM_PROMPT = `Tu es l'ASSISTANT VIRTUEL EXPERT de Taleb Hoballah, transitaire senior chez SODATRA/2HL Group, spécialisé en logistique internationale et réglementation douanière au Sénégal.

RÔLE PRINCIPAL: Tu analyses les demandes de cotation et génères des réponses EXPERTES en vérifiant:
1. La FAISABILITÉ de l'opération selon la réglementation
2. Le RÉGIME DOUANIER approprié selon la destination et le type de marchandise
3. Les TARIFS exacts en utilisant les données fournies
4. Les PIÈCES JOINTES pour extraire les informations techniques

RÈGLES ABSOLUES DE L'EXPERT:

## DESTINATION MALI / PAYS TIERS (HORS SÉNÉGAL)
- Le régime ATE (Admission Temporaire Exceptionnelle) N'EST PAS APPROPRIÉ pour du transit vers pays tiers
- Pour marchandises destinées au Mali: utiliser TRIE (Transit International Routier Interétatique) - code S120
- Pour transit ordinaire vers pays tiers: codes S110, S111
- L'ATE est réservée aux marchandises restant temporairement au Sénégal pour réexportation

## VÉRIFICATION DES PIÈCES JOINTES
- Si des pièces jointes sont mentionnées (PDF, Excel, facture pro forma), tu DOIS les analyser
- Extraire: valeurs CAF, descriptions marchandises, quantités, origine
- Signaler si les pièces jointes n'ont pas pu être analysées

## CALCUL DES DROITS ET TAXES
- Utiliser les codes HS fournis pour calculs exacts
- Appliquer les taux du régime identifié
- Pour le TRIE: pas de droits de douane mais COSEC, PCS, PCC applicables

## STRUCTURE DE RÉPONSE EXPERTE
1. Analyse de la demande avec vérification réglementaire
2. Régime recommandé avec justification
3. Si ATE demandé mais inapproprié → corriger et expliquer
4. Détail des frais par poste
5. Documents requis selon le régime
6. Risques et points d'attention

PRINCIPES DE TALEB (À RESPECTER ABSOLUMENT):
1. Séparation stricte des postes de coûts (jamais de forfait global opaque)
2. Distinction claire entre débours (refacturés à l'identique) et honoraires
3. Incoterms appliqués rigoureusement
4. Jamais de cotation sans vérification du régime approprié
5. Tarifs basés sur les grilles officielles (PAD, DP World)

FORMAT DE SORTIE JSON:
{
  "subject": "Objet email professionnel",
  "body": "Corps complet de l'email avec analyse experte et recommandations",
  "regulatory_analysis": {
    "requested_regime": "Régime demandé par le client (si mentionné)",
    "recommended_regime": "Régime recommandé par l'expert",
    "regime_code": "Code du régime (ex: S120 pour TRIE)",
    "regime_appropriate": true/false,
    "correction_needed": true/false,
    "correction_explanation": "Explication si correction nécessaire"
  },
  "quotation_details": {
    "operation_type": "import|export|transit",
    "destination": "Pays de destination finale",
    "incoterm": "EXW|FOB|CIF|DAP|etc",
    "mode": "maritime|aerien|routier|multimodal",
    "posts": [
      { 
        "category": "fret|thc|manutention|dedouanement|droits_taxes|portuaires|transport_local|transit_fees|autres",
        "description": "Description détaillée",
        "montant": number,
        "devise": "FCFA|EUR|USD",
        "is_estimate": boolean,
        "notes": "Base de calcul ou référence"
      }
    ],
    "total": number,
    "devise": "FCFA",
    "validite": "15 jours",
    "delai_transit": "X jours"
  },
  "attachments_analysis": {
    "analyzed": true/false,
    "extracted_info": "Résumé des informations extraites",
    "missing_info": ["infos non trouvées dans les PJ"]
  },
  "feasibility": {
    "is_feasible": true/false,
    "concerns": ["préoccupations identifiées"],
    "recommendations": ["recommandations d'expert"]
  },
  "documents_requis": ["liste des documents selon le régime"],
  "confidence": 0.0-1.0,
  "missing_info": ["infos manquantes pour cotation complète"]
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

    console.log("Generating expert response for email:", email.subject);

    // ============ FETCH ATTACHMENTS ============
    const { data: attachments } = await supabase
      .from('email_attachments')
      .select('*')
      .eq('email_id', emailId);

    let attachmentsContext = '';
    if (attachments && attachments.length > 0) {
      attachmentsContext = '\n\nPIÈCES JOINTES DE L\'EMAIL:\n';
      for (const att of attachments) {
        attachmentsContext += `\n📎 ${att.filename} (${att.content_type})\n`;
        if (att.extracted_text) {
          attachmentsContext += `Contenu extrait:\n${att.extracted_text}\n`;
        }
        if (att.extracted_data) {
          attachmentsContext += `Données structurées: ${JSON.stringify(att.extracted_data)}\n`;
        }
        if (!att.is_analyzed) {
          attachmentsContext += `⚠️ ATTENTION: Cette pièce jointe n'a pas encore été analysée. Signaler au client que l'analyse complète nécessite le traitement des documents.\n`;
        }
      }
    }

    // ============ FETCH CUSTOMS REGIMES (for expert context) ============
    const { data: regimes } = await supabase
      .from('customs_regimes')
      .select('*')
      .eq('is_active', true);

    let regimesContext = '\n\nRÉGIMES DOUANIERS DISPONIBLES:\n';
    if (regimes && regimes.length > 0) {
      // Group by category
      const byCategory: Record<string, any[]> = {};
      regimes.forEach(r => {
        const cat = r.category || 'Autre';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(r);
      });

      for (const [cat, items] of Object.entries(byCategory)) {
        const catLabel = cat === 'S' ? 'RÉGIMES SUSPENSIFS' : cat === 'C' ? 'RÉGIMES DÉFINITIFS' : cat === 'R' ? 'RÉEXPORTATION' : cat;
        regimesContext += `\n## ${catLabel}\n`;
        for (const r of items) {
          regimesContext += `- ${r.code} - ${r.name}: ${r.use_case || ''}\n`;
          if (r.keywords && r.keywords.length > 0) {
            regimesContext += `  Mots-clés: ${r.keywords.join(', ')}\n`;
          }
        }
      }
    }

    // ============ FETCH HS CODES CONTEXT (sample for reference) ============
    let hsContext = '\n\nRÉFÉRENCE TARIFS DOUANIERS (échantillon):\n';
    hsContext += '- Droit de Douane (DD): varie selon code HS (0-35%)\n';
    hsContext += '- TVA: 18% standard\n';
    hsContext += '- COSEC: 0.4% de la valeur CAF\n';
    hsContext += '- PCS: 0.8% de la valeur CAF\n';
    hsContext += '- PCC: 0.5% de la valeur CAF\n';
    hsContext += '- RS (Redevance Statistique): 1%\n';
    hsContext += '\nPour TRANSIT (TRIE): DD et TVA non applicables, mais COSEC, PCS, PCC restent dus.\n';

    // ============ FETCH LEARNED KNOWLEDGE ============
    const { data: knowledge } = await supabase
      .from('learned_knowledge')
      .select('*')
      .gte('confidence', 0.5)
      .order('is_validated', { ascending: false })
      .order('confidence', { ascending: false })
      .limit(30);

    let knowledgeContext = '';
    if (knowledge && knowledge.length > 0) {
      knowledgeContext = '\n\nCONNAISSANCES APPRISES (tarifs, pratiques):\n';
      for (const k of knowledge) {
        knowledgeContext += `- ${k.name}: ${k.description}\n`;
        if (k.data) {
          knowledgeContext += `  Données: ${JSON.stringify(k.data)}\n`;
        }
      }
    }

    // ============ FETCH EXPERT PROFILE ============
    const { data: expert } = await supabase
      .from('expert_profiles')
      .select('*')
      .eq('is_primary', true)
      .maybeSingle();

    let expertContext = '';
    if (expert) {
      expertContext = `\n\nPROFIL EXPERT À IMITER (${expert.name}):\n`;
      if (expert.communication_style) {
        expertContext += `Style: ${JSON.stringify(expert.communication_style)}\n`;
      }
      if (expert.quotation_templates) {
        expertContext += `Templates: ${JSON.stringify(expert.quotation_templates)}\n`;
      }
    }

    // ============ GET THREAD CONTEXT ============
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
          threadContext += e.body_text?.substring(0, 1500) + '\n';
        }
      }
    }

    // ============ BUILD COMPREHENSIVE PROMPT ============
    const userPrompt = `
ANALYSE EXPERTE REQUISE:

DEMANDE DU CLIENT:
De: ${email.from_address}
Objet: ${email.subject}
Date: ${email.sent_at}

${email.body_text}

${attachmentsContext}
${threadContext}
${regimesContext}
${hsContext}
${knowledgeContext}
${expertContext}

${customInstructions ? `\nINSTRUCTIONS SUPPLÉMENTAIRES:\n${customInstructions}` : ''}

INSTRUCTIONS CRITIQUES:
1. Analyse si la destination est le SÉNÉGAL ou un PAYS TIERS (Mali, Guinée, etc.)
2. Si pays tiers → le régime TRIE (S120) ou Transit Ordinaire (S110) est probablement plus approprié que l'ATE
3. Vérifie les pièces jointes pour extraire valeurs et descriptions
4. Calcule les frais selon le régime APPROPRIÉ, pas celui demandé si incorrect
5. Génère une réponse professionnelle avec recommandations d'expert

Génère une réponse de cotation EXPERTE avec analyse réglementaire.
    `;

    console.log("Calling AI with comprehensive expert context...");

    // Generate response with enhanced expert prompt
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: EXPERT_SYSTEM_PROMPT },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", errorText);
      throw new Error("Erreur de génération IA");
    }

    const aiResult = await response.json();
    const generatedContent = aiResult.choices?.[0]?.message?.content;
    
    console.log("AI response received, parsing...");
    
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(generatedContent);
    } catch (e) {
      console.error("Parse error, raw content:", generatedContent);
      throw new Error("Erreur de parsing de la réponse");
    }

    // Create draft with expert analysis
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

    console.log("Generated expert draft:", draft.id);

    // Return comprehensive response
    return new Response(
      JSON.stringify({
        success: true,
        draft: draft,
        quotation: parsedResponse.quotation_details,
        regulatory_analysis: parsedResponse.regulatory_analysis,
        attachments_analysis: parsedResponse.attachments_analysis,
        feasibility: parsedResponse.feasibility,
        documents_requis: parsedResponse.documents_requis,
        confidence: parsedResponse.confidence,
        missing_info: parsedResponse.missing_info
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Expert response generation error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur de génération" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
