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
- Tu utilises UNIQUEMENT les tarifs officiels fournis dans les sections PORT_TARIFFS, CARRIER_BILLING et TAX_RATES

SOURCES DE TARIFS AUTORISÉES (dans l'ordre de priorité):
1. PORT_TARIFFS - Tarifs THC DP World (Arrêté 2025) - SOURCE PRIMAIRE pour les THC
2. CARRIER_BILLING_TEMPLATES - Structure de facturation par compagnie maritime
3. TAX_RATES - Taux réglementaires (DD, TVA, COSEC, PCS, PCC, RS, BIC)
4. HS_CODES - Droits par code SH de la marchandise
5. CONNAISSANCES APPRISES - Tarifs validés des opérations précédentes
6. Si le tarif n'est dans AUCUNE de ces sources → "À CONFIRMER AVEC LE SERVICE"

CALCUL DES THC DP WORLD:
- 20 pieds = 1 EVP
- 40 pieds = 2 EVP
- 45 pieds = 2,25 EVP
- Le tarif dans PORT_TARIFFS est par EVP, multiplier par le nombre d'EVP

STRUCTURE DE FACTURATION PAR COMPAGNIE:
- MSC, CMA CGM, Grimaldi: Facture unique consolidée
- Hapag-Lloyd: 3 factures séparées (PORT_CHARGES, DOCUMENTATION, SERVICES)
- Maersk: Factures séparées (PORT_CHARGES, DOCUMENTATION)

ANALYSE EXPERTE REQUISE:
1. Identifier le transporteur (MSC, Hapag-Lloyd, Maersk, CMA CGM, Grimaldi)
2. Appliquer le template de facturation correspondant
3. Identifier le régime douanier CORRECT (TRIE pour Mali, pas ATE)
4. Calculer droits et taxes avec les TAUX OFFICIELS fournis
5. Ne jamais inventer de montant - indiquer "À CONFIRMER" si absent
6. Séparer clairement: débours officiels vs honoraires transitaire
7. Pour chaque montant THC/manutention, utiliser EXACTEMENT le tarif de PORT_TARIFFS

FORMAT DE SORTIE JSON:
{
  "subject": "Objet email professionnel",
  "body": "Corps complet avec détail des postes, tous les montants doivent être justifiés par une source (tarif officiel, code HS, etc.)",
  "carrier_detected": "Nom de la compagnie maritime identifiée",
  "container_info": {
    "type": "20|40|45",
    "evp_multiplier": 1|2|2.25,
    "cargo_nature": "STANDARD|REEFER|DANGEROUS|SPECIAL|BASIC|COTON"
  },
  "regulatory_analysis": {
    "requested_regime": "Régime demandé par le client",
    "recommended_regime": "Régime recommandé",
    "regime_code": "Code (ex: S120)",
    "regime_appropriate": true/false,
    "correction_needed": true/false,
    "correction_explanation": "Explication si correction"
  },
  "billing_structure": {
    "invoice_count": 1|2|3,
    "invoices": [
      {
        "type": "CONSOLIDATED|PORT_CHARGES|DOCUMENTATION|SERVICES",
        "sequence": 1|2|3,
        "posts": [
          { 
            "charge_code": "THO|TBL|ISPS|etc",
            "description": "Description",
            "montant": number,
            "devise": "FCFA|EUR",
            "tva": number,
            "source": "PORT_TARIFFS|CARRIER_BILLING|A_CONFIRMER",
            "calculation": "Ex: 155000 x 2 EVP = 310000"
          }
        ],
        "subtotal_ht": number,
        "tva": number,
        "subtotal_ttc": number
      }
    ]
  },
  "quotation_details": {
    "operation_type": "import|export|transit",
    "destination": "Pays destination",
    "posts": [
      { 
        "category": "thc_dpw|frais_compagnie|droits_douane|taxes_internes|honoraires|transport|autres",
        "description": "Description",
        "montant": number,
        "devise": "FCFA",
        "source": "PORT_TARIFFS|CARRIER_BILLING|TAX_RATES|HS_CODE|A_CONFIRMER",
        "source_document": "Référence document si disponible",
        "is_estimate": false,
        "base_calcul": "Ex: 0.4% x CAF"
      }
    ],
    "total_debours": number,
    "total_honoraires": number,
    "total_general": number,
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

    // ============ FETCH OFFICIAL PORT TARIFFS (PRIMARY SOURCE) ============
    const { data: portTariffs } = await supabase
      .from('port_tariffs')
      .select('*')
      .eq('is_active', true)
      .order('provider')
      .order('operation_type');

    let portTariffsContext = '\n\n=== TARIFS PORTUAIRES OFFICIELS (port_tariffs) ===\n';
    portTariffsContext += '⚠️ UTILISER CES MONTANTS EXACTS - NE PAS ESTIMER\n\n';
    
    if (portTariffs && portTariffs.length > 0) {
      // Group by provider
      const byProvider = portTariffs.reduce((acc: Record<string, typeof portTariffs>, t) => {
        if (!acc[t.provider]) acc[t.provider] = [];
        acc[t.provider].push(t);
        return acc;
      }, {});

      for (const [provider, tariffs] of Object.entries(byProvider)) {
        portTariffsContext += `## ${provider} (Source: ${tariffs[0]?.source_document || 'Officiel'})\n`;
        portTariffsContext += '| Opération | Classification | Cargo | Montant (FCFA) | Surcharge |\n';
        portTariffsContext += '|-----------|----------------|-------|----------------|------------|\n';
        for (const t of tariffs) {
          const surcharge = t.surcharge_percent > 0 ? `+${t.surcharge_percent}% (${t.surcharge_conditions || 'conditions'})` : '-';
          portTariffsContext += `| ${t.operation_type} | ${t.classification} | ${t.cargo_type || 'N/A'} | ${t.amount.toLocaleString('fr-FR')} | ${surcharge} |\n`;
        }
        portTariffsContext += '\n';
      }
    } else {
      portTariffsContext += '⚠️ AUCUN TARIF PORTUAIRE CONFIGURÉ - TOUS LES THC/MANUTENTION À CONFIRMER\n';
    }

    // ============ FETCH CARRIER BILLING TEMPLATES ============
    const { data: carrierTemplates } = await supabase
      .from('carrier_billing_templates')
      .select('*')
      .eq('is_active', true)
      .order('carrier')
      .order('invoice_sequence')
      .order('charge_code');

    let carrierBillingContext = '\n\n=== TEMPLATES DE FACTURATION PAR COMPAGNIE (carrier_billing_templates) ===\n';
    carrierBillingContext += '⚠️ UTILISER CETTE STRUCTURE POUR IDENTIFIER LES FRAIS SELON LE TRANSPORTEUR\n\n';
    
    if (carrierTemplates && carrierTemplates.length > 0) {
      // Group by carrier
      const byCarrier = carrierTemplates.reduce((acc: Record<string, typeof carrierTemplates>, t) => {
        if (!acc[t.carrier]) acc[t.carrier] = [];
        acc[t.carrier].push(t);
        return acc;
      }, {});

      for (const [carrier, templates] of Object.entries(byCarrier)) {
        // Check if multi-invoice structure
        const invoiceTypes = [...new Set(templates.map(t => t.invoice_type))];
        const isMultiInvoice = invoiceTypes.length > 1 || templates.some(t => t.invoice_sequence > 1);
        
        carrierBillingContext += `## ${carrier.replace('_', '-')}`;
        if (isMultiInvoice) {
          carrierBillingContext += ` (${invoiceTypes.length} factures séparées)`;
        } else {
          carrierBillingContext += ' (facture unique consolidée)';
        }
        carrierBillingContext += '\n';

        // Group by invoice_type for multi-invoice carriers
        const byInvoiceType = templates.reduce((acc: Record<string, typeof templates>, t) => {
          const key = `${t.invoice_type}_${t.invoice_sequence}`;
          if (!acc[key]) acc[key] = [];
          acc[key].push(t);
          return acc;
        }, {});

        for (const [invoiceKey, charges] of Object.entries(byInvoiceType)) {
          const firstCharge = charges[0];
          if (isMultiInvoice) {
            carrierBillingContext += `\n### Facture ${firstCharge.invoice_sequence}: ${firstCharge.invoice_type}\n`;
          }
          carrierBillingContext += '| Code | Frais | Méthode | Montant | Devise | TVA | Notes |\n';
          carrierBillingContext += '|------|-------|---------|---------|--------|-----|-------|\n';
          for (const c of charges) {
            const montant = c.is_variable ? 'VARIABLE' : (c.default_amount?.toLocaleString('fr-FR') || 'À CONFIRMER');
            const notes = [c.base_reference, c.notes].filter(Boolean).join(' - ') || '-';
            carrierBillingContext += `| ${c.charge_code} | ${c.charge_name} | ${c.calculation_method} | ${montant} | ${c.currency} | ${c.vat_rate}% | ${notes.substring(0, 50)} |\n`;
          }
        }
        carrierBillingContext += '\n';
      }
    } else {
      carrierBillingContext += '⚠️ AUCUN TEMPLATE DE FACTURATION CONFIGURÉ\n';
    }

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

    // ============ FETCH AND ANALYZE ATTACHMENTS ============
    let { data: attachments } = await supabase
      .from('email_attachments')
      .select('*')
      .eq('email_id', emailId);

    // Auto-analyze unanalyzed attachments
    if (attachments && attachments.some(att => !att.is_analyzed)) {
      console.log("Found unanalyzed attachments, triggering analysis...");
      
      const unanalyzedIds = attachments.filter(att => !att.is_analyzed).map(att => att.id);
      
      for (const attId of unanalyzedIds) {
        try {
          console.log(`Analyzing attachment ${attId}...`);
          
          // Get the attachment details
          const attachment = attachments.find(a => a.id === attId);
          if (!attachment) continue;
          
          const isImage = attachment.content_type?.startsWith('image/');
          const isPdf = attachment.content_type === 'application/pdf';
          
          if (!isImage && !isPdf) {
            // Mark non-visual files as analyzed
            await supabase
              .from('email_attachments')
              .update({ 
                is_analyzed: true,
                extracted_data: { type: 'unsupported', content_type: attachment.content_type }
              })
              .eq('id', attId);
            continue;
          }
          
          // Download the file
          const { data: fileData, error: downloadError } = await supabase
            .storage
            .from('documents')
            .download(attachment.storage_path);
          
          if (downloadError || !fileData) {
            console.error(`Failed to download ${attachment.filename}:`, downloadError);
            continue;
          }
          
          // Convert to base64
          const arrayBuffer = await fileData.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          const CHUNK_SIZE = 8192;
          let base64 = '';
          for (let i = 0; i < uint8Array.length; i += CHUNK_SIZE) {
            const chunk = uint8Array.slice(i, i + CHUNK_SIZE);
            base64 += String.fromCharCode.apply(null, Array.from(chunk));
          }
          base64 = btoa(base64);
          
          const mimeType = attachment.content_type || 'image/jpeg';
          const dataUrl = `data:${mimeType};base64,${base64}`;
          
          // Analyze with AI
          const aiAnalysisResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${LOVABLE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                {
                  role: 'system',
                  content: `Tu es un assistant expert en analyse de documents commerciaux et logistiques.
Analyse l'image fournie et extrais TOUTES les informations pertinentes pour une cotation:
- Valeur CAF/FOB des marchandises
- Description des produits
- Codes SH si visibles
- Nom du fournisseur/client
- Coordonnées bancaires
- Quantités et poids
- Conditions de paiement
Réponds en JSON: { "type": "facture|proforma|bl|autre", "valeur_caf": number|null, "devise": "USD|EUR|FCFA", "descriptions": [], "codes_hs": [], "fournisseur": "", "quantites": "", "poids": "", "text_content": "texte visible", "confidence": 0.0-1.0 }`
                },
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: `Analyse cette pièce jointe (${attachment.filename}) pour en extraire les données commerciales.` },
                    { type: 'image_url', image_url: { url: dataUrl } }
                  ]
                }
              ]
            }),
          });
          
          if (aiAnalysisResponse.ok) {
            const aiData = await aiAnalysisResponse.json();
            const content = aiData.choices?.[0]?.message?.content || '';
            
            let extractedData: any = { raw_response: content };
            let extractedText = '';
            
            try {
              const jsonMatch = content.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                extractedData = JSON.parse(jsonMatch[0]);
                extractedText = extractedData.text_content || extractedData.descriptions?.join('\n') || '';
              }
            } catch {
              extractedText = content;
            }
            
            await supabase
              .from('email_attachments')
              .update({
                is_analyzed: true,
                extracted_text: extractedText,
                extracted_data: extractedData
              })
              .eq('id', attId);
              
            console.log(`Successfully analyzed: ${attachment.filename}`);
          } else {
            console.error(`AI analysis failed for ${attachment.filename}:`, aiAnalysisResponse.status);
          }
        } catch (error) {
          console.error(`Error analyzing attachment ${attId}:`, error);
        }
      }
      
      // Re-fetch attachments after analysis
      const { data: updatedAttachments } = await supabase
        .from('email_attachments')
        .select('*')
        .eq('email_id', emailId);
      
      if (updatedAttachments) {
        attachments = updatedAttachments;
      }
    }

    let attachmentsContext = '';
    if (attachments && attachments.length > 0) {
      attachmentsContext = '\n\n=== PIÈCES JOINTES ANALYSÉES ===\n';
      for (const att of attachments) {
        attachmentsContext += `📎 ${att.filename} (${att.content_type})\n`;
        if (att.extracted_text) {
          attachmentsContext += `Contenu extrait:\n${att.extracted_text.substring(0, 3000)}\n`;
        }
        if (att.extracted_data) {
          const data = att.extracted_data as any;
          if (data.valeur_caf) {
            attachmentsContext += `💰 VALEUR CAF: ${data.valeur_caf} ${data.devise || ''}\n`;
          }
          if (data.descriptions?.length) {
            attachmentsContext += `📦 Descriptions: ${data.descriptions.join(', ')}\n`;
          }
          if (data.codes_hs?.length) {
            attachmentsContext += `🏷️ Codes HS: ${data.codes_hs.join(', ')}\n`;
          }
          if (data.fournisseur) {
            attachmentsContext += `🏢 Fournisseur: ${data.fournisseur}\n`;
          }
          attachmentsContext += `Données complètes: ${JSON.stringify(data)}\n`;
        }
        if (!att.is_analyzed) {
          attachmentsContext += `⚠️ Analyse impossible - format non supporté\n`;
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

${portTariffsContext}
${carrierBillingContext}
${taxRatesContext}
${regimesContext}
${attachmentsContext}
${tariffKnowledgeContext}
${threadContext}
${expertContext}

${customInstructions ? `INSTRUCTIONS SUPPLÉMENTAIRES: ${customInstructions}` : ''}

RAPPEL CRITIQUE:
- IDENTIFIER LE TRANSPORTEUR dans l'email (MSC, Hapag-Lloyd, Maersk, CMA CGM, Grimaldi)
- Pour les THC DP World: utilise EXACTEMENT les montants de PORT_TARIFFS (Arrêté 2025)
- Calcul EVP: 20'=1 EVP, 40'=2 EVP, 45'=2.25 EVP
- Pour les frais compagnie: utilise les templates de CARRIER_BILLING selon le transporteur
- IMPORTANT pour Hapag-Lloyd: prévoir 3 factures séparées (PORT_CHARGES, DOCUMENTATION, SERVICES)
- Pour les droits et taxes: utilise les TAUX OFFICIELS de TAX_RATES
- Pour tout tarif non disponible → "À CONFIRMER"
- Si destination = Mali ou autre pays tiers → régime TRIE (S120) obligatoire, pas ATE
- Chaque montant doit indiquer sa SOURCE (PORT_TARIFFS, CARRIER_BILLING, TAX_RATES, etc.)
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
