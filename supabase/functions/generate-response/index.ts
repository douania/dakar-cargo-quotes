import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXPERT_SYSTEM_PROMPT = `Tu es l'ASSISTANT VIRTUEL EXPERT de Taleb Hoballah, transitaire senior chez SODATRA/2HL Group, spécialisé en logistique internationale et réglementation douanière au Sénégal.

RÈGLE ABSOLUE: TU N'INVENTES JAMAIS DE TARIF.
- Si un tarif exact n'est PAS dans les données fournies → tu écris "À CONFIRMER" ou "SUR DEMANDE"
- Tu ne donnes JAMAIS d'estimation de prix si le tarif officiel n'est pas disponible
- Tu utilises UNIQUEMENT les tarifs officiels fournis ci-dessous

SOURCES DE TARIFS AUTORISÉES (dans l'ordre de priorité):
1. TARIFS OFFICIELS TAX_RATES - taux réglementaires (DD, TVA, COSEC, PCS, PCC, RS, BIC)
2. TARIFS HS_CODES - droits par code SH de la marchandise
3. TARIFS DP WORLD / PAD - THC, magasinage, manutention (voir GRILLES ci-dessous)
4. CONNAISSANCES APPRISES - tarifs validés des opérations précédentes
5. Si le tarif n'est dans AUCUNE de ces sources → "À CONFIRMER AVEC LE SERVICE"

GRILLES TARIFAIRES OFFICIELLES (Port Autonome de Dakar / DP World):

## THC DP WORLD DAKAR (Arrêté ministériel - homologué)
EXPORT (par TEU = 20'):
| Classification | THC (FCFA) |
|----------------|------------|
| C1 - Coton (Mali/Sénégal) | 70 000 |
| C2 - Produits Frigorifiques | 80 000 |
| C3 - Produits Standards | 110 000 (+50% dangereux, +20% lourds) |

IMPORT (par TEU = 20'):
| Classification | THC (FCFA) |
|----------------|------------|
| C4 - Produits de Base | 87 000 |
| C5 - Produits Standards | 133 500 |

TRANSIT (par TEU = 20'):
| Classification | THC (FCFA) |
|----------------|------------|
| C6 - Import/Export | 110 000 |

Note: Pour 40', multiplier par 2.

## FRANCHISES MAGASINAGE PAD
| Type | Franchise |
|------|-----------|
| Import Sénégal | 7 jours |
| Transit conventionnel | 20 jours |
| Véhicules en transit | 12 jours |

## MAGASINAGE (après franchise)
| Période | Tarif/TEU/jour |
|---------|----------------|
| 1-10 jours | 3 500 FCFA |
| 11-20 jours | 5 250 FCFA |
| 21+ jours | 7 000 FCFA |

## HONORAIRES SODATRA (base, ajustables selon complexité)
| Opération | Montant FCFA |
|-----------|--------------|
| Dédouanement conteneur | 150 000 |
| Dédouanement véhicule | 120 000 |
| Dédouanement aérien | 100 000 |
| TRIE/Transit international | 200 000 |
| Constitution dossier | 50 000 |

## RÉGIMES TRANSIT VERS MALI
- TRIE (S120): PAS de DD, PAS de TVA mais COSEC, PCS, PCC applicables
- Transit Ordinaire (S110): Mêmes exonérations

ANALYSE EXPERTE REQUISE:
1. Identifier le régime douanier CORRECT (TRIE pour Mali, pas ATE)
2. Calculer droits et taxes avec les TAUX OFFICIELS fournis
3. Ne jamais inventer de montant - indiquer "À CONFIRMER" si absent
4. Séparer clairement: débours officiels vs honoraires transitaire

FORMAT DE SORTIE JSON:
{
  "subject": "Objet email professionnel",
  "body": "Corps complet avec détail des postes, tous les montants doivent être justifiés par une source (tarif officiel, code HS, etc.)",
  "regulatory_analysis": {
    "requested_regime": "Régime demandé par le client",
    "recommended_regime": "Régime recommandé",
    "regime_code": "Code (ex: S120)",
    "regime_appropriate": true/false,
    "correction_needed": true/false,
    "correction_explanation": "Explication si correction"
  },
  "quotation_details": {
    "operation_type": "import|export|transit",
    "destination": "Pays destination",
    "posts": [
      { 
        "category": "droits_douane|taxes_internes|thc|manutention|honoraires|transport|autres",
        "description": "Description",
        "montant": number,
        "devise": "FCFA",
        "source": "TAX_RATES|HS_CODE|DP_WORLD|PAD|SODATRA|A_CONFIRMER",
        "is_estimate": false,
        "base_calcul": "Ex: 0.4% x CAF"
      }
    ],
    "total": number,
    "devise": "FCFA"
  },
  "attachments_analysis": {
    "analyzed": true/false,
    "extracted_info": "Valeur CAF, descriptions, etc.",
    "missing_info": []
  },
  "feasibility": {
    "is_feasible": true/false,
    "concerns": [],
    "recommendations": []
  },
  "confidence": 0.0-1.0,
  "missing_info": ["Éléments manquants pour cotation exacte"]
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

    // ============ FETCH OFFICIAL TAX RATES ============
    const { data: taxRates } = await supabase
      .from('tax_rates')
      .select('*')
      .eq('is_active', true);

    let taxRatesContext = '\n\n=== TAUX OFFICIELS (tax_rates) ===\n';
    if (taxRates && taxRates.length > 0) {
      taxRatesContext += '| Code | Nom | Taux (%) | Base de calcul | Applicable à |\n';
      taxRatesContext += '|------|-----|----------|----------------|---------------|\n';
      for (const rate of taxRates) {
        taxRatesContext += `| ${rate.code} | ${rate.name} | ${rate.rate}% | ${rate.base_calculation} | ${rate.applies_to || 'Tous'} |\n`;
      }
    }

    // ============ FETCH ATTACHMENTS ============
    const { data: attachments } = await supabase
      .from('email_attachments')
      .select('*')
      .eq('email_id', emailId);

    let attachmentsContext = '';
    if (attachments && attachments.length > 0) {
      attachmentsContext = '\n\n=== PIÈCES JOINTES ===\n';
      for (const att of attachments) {
        attachmentsContext += `📎 ${att.filename} (${att.content_type})\n`;
        if (att.extracted_text) {
          attachmentsContext += `Contenu:\n${att.extracted_text.substring(0, 3000)}\n`;
        }
        if (att.extracted_data) {
          attachmentsContext += `Données: ${JSON.stringify(att.extracted_data)}\n`;
        }
        if (!att.is_analyzed) {
          attachmentsContext += `⚠️ Non analysée - demander la facture pro forma pour calcul exact\n`;
        }
      }
    }

    // ============ FETCH CUSTOMS REGIMES ============
    const { data: regimes } = await supabase
      .from('customs_regimes')
      .select('*')
      .eq('is_active', true);

    let regimesContext = '\n\n=== RÉGIMES DOUANIERS ===\n';
    if (regimes && regimes.length > 0) {
      regimesContext += '| Code | Nom | DD | TVA | COSEC | PCS | PCC | RS | Usage |\n';
      regimesContext += '|------|-----|----|----|-------|-----|-----|----|---------|\n';
      for (const r of regimes) {
        regimesContext += `| ${r.code} | ${r.name} | ${r.dd ? 'Oui' : 'Non'} | ${r.tva ? 'Oui' : 'Non'} | ${r.cosec ? 'Oui' : 'Non'} | ${r.pcs ? 'Oui' : 'Non'} | ${r.pcc ? 'Oui' : 'Non'} | ${r.rs ? 'Oui' : 'Non'} | ${r.use_case || ''} |\n`;
      }
    }

    // ============ FETCH LEARNED TARIFFS (validated only) ============
    const { data: knowledge } = await supabase
      .from('learned_knowledge')
      .select('*')
      .eq('is_validated', true)
      .in('category', ['tarif', 'tariff', 'rate', 'frais', 'honoraires'])
      .order('confidence', { ascending: false })
      .limit(50);

    let tariffKnowledgeContext = '';
    if (knowledge && knowledge.length > 0) {
      tariffKnowledgeContext = '\n\n=== TARIFS VALIDÉS (opérations précédentes) ===\n';
      for (const k of knowledge) {
        tariffKnowledgeContext += `• ${k.name}: ${k.description}\n`;
        if (k.data) {
          const data = k.data as any;
          if (data.montant) {
            tariffKnowledgeContext += `  Montant: ${data.montant} ${data.devise || 'FCFA'}\n`;
          }
          if (data.conditions) {
            tariffKnowledgeContext += `  Conditions: ${data.conditions}\n`;
          }
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
      expertContext = `\n\n=== PROFIL EXPERT (${expert.name}) ===\n`;
      if (expert.communication_style) {
        expertContext += `Style: ${JSON.stringify(expert.communication_style)}\n`;
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
        threadContext = '\n\n=== HISTORIQUE DU FIL ===\n';
        for (const e of threadEmails) {
          threadContext += `--- ${e.from_address} (${new Date(e.sent_at).toLocaleDateString('fr-FR')}) ---\n`;
          threadContext += e.body_text?.substring(0, 1500) + '\n';
        }
      }
    }

    // ============ BUILD PROMPT ============
    const userPrompt = `
DEMANDE CLIENT À ANALYSER:
De: ${email.from_address}
Objet: ${email.subject}
Date: ${email.sent_at}

${email.body_text}

${attachmentsContext}
${taxRatesContext}
${regimesContext}
${tariffKnowledgeContext}
${threadContext}
${expertContext}

${customInstructions ? `INSTRUCTIONS SUPPLÉMENTAIRES: ${customInstructions}` : ''}

RAPPEL CRITIQUE:
- Utilise UNIQUEMENT les tarifs fournis ci-dessus
- Pour tout tarif non disponible → "À CONFIRMER"
- Si destination = Mali ou autre pays tiers → régime TRIE (S120) obligatoire, pas ATE
- Calcule les droits/taxes avec les TAUX OFFICIELS de tax_rates
`;

    console.log("Calling AI with official tariffs context...");

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
      console.error("Parse error, raw content:", generatedContent?.substring(0, 500));
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

    console.log("Generated expert draft with official tariffs:", draft.id);

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
