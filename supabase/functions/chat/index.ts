import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Tu es un AGENT IA EXPERT EN COTATION LOGISTIQUE MARITIME ET AÉRIENNE POUR LE SÉNÉGAL, spécialisé exclusivement sur le Port Autonome de Dakar et ses pratiques réelles.

Tu opères comme un transitaire sénégalais senior, avec une parfaite maîtrise :
- des Incoterms® 2020 (ICC)
- des pratiques portuaires locales (PAD / DP World Dakar)
- des procédures douanières sénégalaises (GAINDE / ORBUS)
- de la distinction stricte entre débours, honoraires et chiffre d'affaires

Tu n'improvises jamais.
Tu n'inventes jamais de frais.
Tu refuses toute cotation incomplète ou approximative.

CAPACITÉS SPÉCIALES - APPRENTISSAGE ET EMAILS

Tu as accès à:
1. **Emails de l'entreprise** - Tu peux rechercher et analyser les emails, suivre les fils de discussion
2. **Connaissances apprises** - Tu utilises les tarifs, templates et processus appris des échanges précédents
3. **Documents uploadés** - Cotations, factures, BL, manifestes

COMMANDES SPÉCIALES (l'utilisateur peut te demander):
- "Cherche l'email de [client/sujet]" - Tu recherches dans les emails
- "Trouve la cotation pour [...]" - Tu cherches dans les documents et emails
- "Quel tarif pour [...]" - Tu consultes les connaissances apprises
- "Réponds à la demande de [...]" - Tu génères un brouillon de réponse
- "Apprends de ce document/email" - Tu extrais des connaissances

PÉRIMÈTRE STRICT
- Pays : Sénégal uniquement
- Port : Port Autonome de Dakar
- Modes : Maritime (conteneur, RORO, breakbulk), Aérien (AIBD – fret commercial)
- Langues : Français 🇫🇷, Anglais 🇬🇧

RÈGLES ABSOLUES (NON NÉGOCIABLES)

1. Aucune cotation ne peut être produite sans informations minimales :
   - Incoterm
   - Mode de transport
   - Type de marchandise
   - Type d'unité (conteneur, colis, véhicule, poids/volume)
   - Port ou aéroport d'origine
   ➜ Si une information manque, tu DOIS poser une question précise avant toute cotation.

2. Tu sépares TOUJOURS les postes suivants :
   - Transport international
   - Frais portuaires / aéroportuaires
   - Manutention (DP World / handling)
   - Dédouanement
   - Débours douaniers (droits & taxes)
   - Honoraires du transitaire

3. Les débours douaniers :
   - Ne sont JAMAIS intégrés au chiffre d'affaires
   - Sont refacturés à l'identique
   - Peuvent être estimés mais doivent être clairement indiqués comme tels

4. Les Incoterms sont contraignants :
   - Tu appliques strictement les responsabilités de chaque Incoterm
   - Tu n'inclus jamais un coût non supporté par le client selon l'Incoterm

5. Tu appliques les franchises et délais réels du Port de Dakar :
   - Franchise magasinage
   - Périodes tarifaires successives
   - Dates réelles d'arrivée et de sortie

6. Tu privilégies toujours l'exactitude à la rapidité :
   - Si une donnée n'est pas vérifiable → tu l'indiques
   - Si un tarif est estimatif → tu le qualifies comme tel

SOURCES AUTORISÉES
Tu t'appuies uniquement sur :
- Grilles tarifaires officielles du Port Autonome de Dakar
- Tarifs et notices DP World Dakar
- Règlementations de la Douane sénégalaise
- Tarifs publiés par les compagnies maritimes desservant Dakar
- Informations validées et fournies par l'utilisateur
- **Documents uploadés dans le système** (cotations, factures, BL, manifestes)
- **Connaissances apprises** des échanges emails et documents précédents
Tu ignores toute source vague, non datée ou non officielle.

GRILLES TARIFAIRES OFFICIELLES

**TARIFS THC DP WORLD DAKAR (Arrêté ministériel - homologué)**
EXPORT (par TEU = 20') :
| Classification | THC (FCFA) | Surcharge |
|----------------|------------|-----------|
| C1 - Coton (Mali/Sénégal) | 70 000 | Néant |
| C2 - Produits Frigorifiques | 80 000 | Néant |
| C3 - Produits Standards | 110 000 | +50% produits dangereux, +20% colis lourds |

IMPORT (par TEU = 20') :
| Classification | THC (FCFA) |
|----------------|------------|
| C4 - Produits de Base | 87 000 |
| C5 - Produits Standards | 133 500 |

TRANSIT (par TEU = 20') :
| Classification | THC (FCFA) |
|----------------|------------|
| C6 - Import/Export | 110 000 |

Note : Pour conteneur 40', multiplier par 2 le tarif TEU.

**FRANCHISES MAGASINAGE PORT AUTONOME DE DAKAR**
| Type de marchandise | Franchise |
|---------------------|-----------|
| Import Sénégal | 7 jours |
| Transit conventionnel | 20 jours |
| Véhicules en transit | 12 jours |

**HONORAIRES SODATRA (base) :**
- Dédouanement conteneur : ~150 000 FCFA
- Dédouanement véhicule : ~120 000 FCFA
- Dédouanement aérien : ~100 000 FCFA`;

// Extract keywords from user message for document search
function extractSearchKeywords(message: string): string[] {
  const keywords: string[] = [];
  const lowerMsg = message.toLowerCase();
  
  const docTerms = ['cotation', 'facture', 'bl', 'manifeste', 'document', 'douane'];
  docTerms.forEach(term => {
    if (lowerMsg.includes(term)) keywords.push(term);
  });
  
  return keywords;
}

// Check if message is asking about documents/emails/knowledge
function detectQueryType(message: string): { isDocument: boolean; isEmail: boolean; isKnowledge: boolean; isLearnRequest: boolean } {
  const lowerMsg = message.toLowerCase();
  
  return {
    isDocument: ['document', 'fichier', 'pdf', 'excel', 'uploadé', 'analyse'].some(t => lowerMsg.includes(t)),
    isEmail: ['email', 'mail', 'message', 'envoyer', 'répondre', 'boîte', 'inbox', 'client'].some(t => lowerMsg.includes(t)),
    isKnowledge: ['tarif', 'prix', 'combien', 'coût', 'template', 'modèle', 'contact'].some(t => lowerMsg.includes(t)),
    isLearnRequest: ['apprend', 'mémorise', 'retiens', 'note', 'enregistre'].some(t => lowerMsg.includes(t))
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("Received chat request with", messages.length, "messages");

    // Get the latest user message
    const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop();
    const userQuery = lastUserMessage?.content || '';

    const queryType = detectQueryType(userQuery);
    let contextAdditions = '';

    // Search documents if relevant
    if (queryType.isDocument) {
      console.log("Searching documents...");
      const keywords = extractSearchKeywords(userQuery);
      
      const { data: docs } = await supabase
        .from('documents')
        .select('filename, file_type, content_text, extracted_data, tags, created_at')
        .order('created_at', { ascending: false })
        .limit(5);

      if (docs && docs.length > 0) {
        contextAdditions += `\n\n📁 DOCUMENTS DISPONIBLES (${docs.length}):\n`;
        for (const doc of docs) {
          contextAdditions += `\n• ${doc.filename} (${doc.file_type})`;
          if (doc.content_text) {
            contextAdditions += `\n  Contenu: ${doc.content_text.substring(0, 2000)}...`;
          }
          if (doc.extracted_data?.ai_analysis) {
            contextAdditions += `\n  Analyse: ${JSON.stringify(doc.extracted_data.ai_analysis)}`;
          }
        }
      }
    }

    // Search emails if relevant
    if (queryType.isEmail) {
      console.log("Searching emails...");
      
      const { data: emails } = await supabase
        .from('emails')
        .select('from_address, subject, body_text, sent_at, is_quotation_request')
        .order('sent_at', { ascending: false })
        .limit(10);

      if (emails && emails.length > 0) {
        contextAdditions += `\n\n📧 EMAILS RÉCENTS (${emails.length}):\n`;
        for (const email of emails) {
          const marker = email.is_quotation_request ? '⭐' : '';
          contextAdditions += `\n${marker} De: ${email.from_address}`;
          contextAdditions += `\n  Objet: ${email.subject}`;
          contextAdditions += `\n  Date: ${new Date(email.sent_at).toLocaleDateString('fr-FR')}`;
          if (email.body_text) {
            contextAdditions += `\n  Extrait: ${email.body_text.substring(0, 500)}...`;
          }
        }
      }
    }

    // Get learned knowledge if relevant
    if (queryType.isKnowledge || queryType.isDocument || queryType.isEmail) {
      console.log("Fetching learned knowledge...");
      
      const { data: knowledge } = await supabase
        .from('learned_knowledge')
        .select('category, name, description, data, confidence')
        .gte('confidence', 0.5)
        .order('usage_count', { ascending: false })
        .limit(15);

      if (knowledge && knowledge.length > 0) {
        contextAdditions += `\n\n🧠 CONNAISSANCES APPRISES (${knowledge.length}):\n`;
        
        const grouped: Record<string, any[]> = {};
        knowledge.forEach(k => {
          if (!grouped[k.category]) grouped[k.category] = [];
          grouped[k.category].push(k);
        });

        for (const [cat, items] of Object.entries(grouped)) {
          contextAdditions += `\n**${cat.toUpperCase()}**`;
          for (const item of items) {
            contextAdditions += `\n• ${item.name} (confiance: ${Math.round(item.confidence * 100)}%)`;
            contextAdditions += `\n  ${item.description}`;
            if (cat === 'tarif' || cat === 'contact') {
              contextAdditions += `\n  Données: ${JSON.stringify(item.data)}`;
            }
          }
        }
      }
    }

    // Check for email drafts if user wants to respond
    if (userQuery.toLowerCase().includes('répond') || userQuery.toLowerCase().includes('brouillon')) {
      const { data: drafts } = await supabase
        .from('email_drafts')
        .select('*, original_email:emails(subject, from_address)')
        .eq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(5);

      if (drafts && drafts.length > 0) {
        contextAdditions += `\n\n✏️ BROUILLONS EN ATTENTE (${drafts.length}):\n`;
        for (const draft of drafts) {
          contextAdditions += `\n• Réponse à: ${draft.original_email?.from_address || 'N/A'}`;
          contextAdditions += `\n  Sujet: ${draft.subject}`;
        }
      }
    }

    // Build enhanced prompt
    let enhancedPrompt = SYSTEM_PROMPT;
    if (contextAdditions) {
      enhancedPrompt += '\n\n--- CONTEXTE ACTUEL ---' + contextAdditions;
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: enhancedPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requêtes atteinte. Veuillez réessayer." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Crédits insuffisants." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "Erreur du service IA" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Streaming response with context:", {
      hasDocuments: queryType.isDocument,
      hasEmails: queryType.isEmail,
      hasKnowledge: queryType.isKnowledge
    });

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Chat function error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur inconnue" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
