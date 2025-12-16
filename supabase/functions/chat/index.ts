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
Tu ignores toute source vague, non datée ou non officielle.

CAPACITÉS D'ANALYSE DE DOCUMENTS
Tu peux accéder aux documents uploadés par l'utilisateur (PDF, Excel, CSV).
Quand des documents pertinents sont trouvés, ils te sont fournis dans le contexte.
Tu peux :
- Analyser les cotations reçues pour les comparer ou les valider
- Extraire les données des BL et manifestes
- Vérifier les calculs de débours douaniers
- Répondre aux questions sur le contenu des documents

FORMAT DE SORTIE OBLIGATOIRE
Toute cotation doit être présentée de manière professionnelle et exploitable, avec :
- Un tableau Markdown clair par poste de coût
- Les montants unitaires et totaux
- La devise utilisée (FCFA par défaut)
- Les hypothèses retenues
- Les exclusions explicites
- La validité de la cotation

La cotation doit être directement envoyable à un client final, sans retraitement.

COMPORTEMENT PROFESSIONNEL
- Ton ton est neutre, rigoureux et professionnel
- Tu agis comme un responsable cotation senior
- Tu alertes l'utilisateur en cas de risque, d'incertitude ou d'information manquante
- Tu refuses toute demande contraire aux règles douanières ou aux pratiques légales

MÉTHODOLOGIE DE COTATION SODATRA

Toute cotation SODATRA suit strictement cette structure :
1. Transport international
2. Frais portuaires ou aéroportuaires
3. Manutention terminal (DP World / Handling)
4. Dédouanement
5. Débours douaniers (droits & taxes)
6. Honoraires SODATRA

GRILLES TARIFAIRES OFFICIELLES

**TARIFS THC DP WORLD DAKAR (Arrêté ministériel - homologué)**
Source : Arrêté portant homologation des tarifs de manutention de conteneurs (THC)

EXPORT (par TEU = 20') :
| Classification | THC (FCFA) | Surcharge |
|----------------|------------|-----------|
| C1 - Coton (Mali/Sénégal) | 70 000 | Néant |
| C2 - Produits Frigorifiques | 80 000 | Néant |
| C3 - Produits Standards | 110 000 | +50% produits dangereux (Classe 1-5), +20% colis lourds (20'>15T, 40'>26T), +50% pénalité (20'>20T, 40'>30T) |

IMPORT (par TEU = 20') :
| Classification | THC (FCFA) | Surcharge |
|----------------|------------|-----------|
| C4 - Produits de Base (Farine, huile, lait, pharma, riz, sucre) | 87 000 | Néant |
| C5 - Produits Standards | 133 500 | Mêmes surcharges que C3 |

TRANSIT (par TEU = 20') :
| Classification | THC (FCFA) | Surcharge |
|----------------|------------|-----------|
| C6 - Import/Export (sauf coton) | 110 000 | Néant |

RELEVAGE (par TEU = 20') :
| Classification | THC (FCFA) |
|----------------|------------|
| C1 à C5 | 18 280 |
| C6 (Transit) | 36 560 |

Note : Pour conteneur 40', multiplier par 2 le tarif TEU.

**FRANCHISES MAGASINAGE PORT AUTONOME DE DAKAR**
Source : portdakar.sn - Stockage/Entreposage

| Type de marchandise | Franchise (jours après fin opérations navire) |
|---------------------|----------------------------------------------|
| Import Sénégal (conventionnel + véhicules) | 7 jours |
| Transit conventionnel | 20 jours |
| Véhicules en transit | 12 jours |

Après expiration franchise : +30% sur tarif de base par m² et par jour sur totalité des surfaces non libérées (à partir du 8ème jour après fin de franchise).

**HONORAIRES SODATRA (base) :**
- Dédouanement conteneur : ~150 000 FCFA
- Dédouanement véhicule : ~120 000 FCFA
- Dédouanement aérien (base) : ~100 000 FCFA

Tu dois être capable de :
- Produire une cotation complète sans assistance
- Détecter les erreurs humaines
- Expliquer chaque ligne de coût
- T'adapter aux évolutions tarifaires sans perdre la logique métier
- Analyser et répondre aux questions sur les documents uploadés`;

// Extract keywords from user message for document search
function extractSearchKeywords(message: string): string[] {
  const keywords: string[] = [];
  const lowerMsg = message.toLowerCase();
  
  // Document type keywords
  if (lowerMsg.includes('cotation') || lowerMsg.includes('devis') || lowerMsg.includes('quote')) {
    keywords.push('cotation');
  }
  if (lowerMsg.includes('facture') || lowerMsg.includes('invoice')) {
    keywords.push('facture');
  }
  if (lowerMsg.includes('bl') || lowerMsg.includes('connaissement') || lowerMsg.includes('bill of lading')) {
    keywords.push('BL');
  }
  if (lowerMsg.includes('manifeste') || lowerMsg.includes('manifest')) {
    keywords.push('manifeste');
  }
  if (lowerMsg.includes('document') || lowerMsg.includes('fichier') || lowerMsg.includes('pdf') || lowerMsg.includes('excel')) {
    keywords.push('document');
  }
  
  // Customs keywords
  if (lowerMsg.includes('douane') || lowerMsg.includes('débours') || lowerMsg.includes('customs')) {
    keywords.push('douane');
  }
  
  return keywords;
}

// Check if message is asking about documents
function isDocumentQuery(message: string): boolean {
  const lowerMsg = message.toLowerCase();
  const docTerms = [
    'document', 'fichier', 'pdf', 'excel', 'csv', 'uploadé', 'téléchargé',
    'analyse', 'analyser', 'lire', 'contenu', 'extrait', 'extraction',
    'cotation reçue', 'devis reçu', 'facture reçue', 'bl reçu',
    'dans le', 'dans les', 'selon le', 'selon les', 'd\'après le',
    'montre', 'affiche', 'trouve', 'cherche', 'recherche'
  ];
  return docTerms.some(term => lowerMsg.includes(term));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    console.log("Received chat request with", messages.length, "messages");

    // Get the latest user message
    const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop();
    const userQuery = lastUserMessage?.content || '';

    // Search for relevant documents if the query seems document-related
    let documentContext = '';
    let documentsFound: any[] = [];

    if (isDocumentQuery(userQuery)) {
      console.log("Document query detected, searching documents...");
      
      const keywords = extractSearchKeywords(userQuery);
      console.log("Search keywords:", keywords);

      // Build query
      let query = supabase
        .from('documents')
        .select('id, filename, file_type, content_text, extracted_data, tags, created_at')
        .order('created_at', { ascending: false })
        .limit(5);

      // If specific tags were found, filter by them
      if (keywords.length > 0) {
        // Search in content and tags
        const searchTerms = keywords.join(' | ');
        query = query.or(`content_text.ilike.%${keywords[0]}%,tags.cs.{${keywords.join(',')}}`);
      }

      const { data: docs, error } = await query;

      if (error) {
        console.error("Document search error:", error);
      } else if (docs && docs.length > 0) {
        documentsFound = docs;
        console.log(`Found ${docs.length} relevant documents`);

        // Build context from documents
        documentContext = `\n\n📁 DOCUMENTS DISPONIBLES DANS LE SYSTÈME (${docs.length} trouvés):\n`;
        
        for (const doc of docs) {
          documentContext += `\n---\n📄 **${doc.filename}** (${doc.file_type.toUpperCase()})`;
          documentContext += `\n   Tags: ${doc.tags?.join(', ') || 'aucun'}`;
          documentContext += `\n   Date: ${new Date(doc.created_at).toLocaleDateString('fr-FR')}`;
          
          // Include content preview (limit to avoid token overflow)
          if (doc.content_text) {
            const contentPreview = doc.content_text.substring(0, 3000);
            documentContext += `\n\n   CONTENU:\n   ${contentPreview}${doc.content_text.length > 3000 ? '\n   [...]' : ''}`;
          }
          
          // Include AI analysis if available
          if (doc.extracted_data?.ai_analysis) {
            documentContext += `\n\n   ANALYSE IA:\n   ${JSON.stringify(doc.extracted_data.ai_analysis, null, 2)}`;
          }
        }
        
        documentContext += '\n---\n';
      } else {
        documentContext = '\n\n📁 Aucun document pertinent trouvé dans le système. L\'utilisateur peut uploader des documents via /admin/documents.\n';
      }
    }

    // Prepare enhanced system prompt with document context
    let enhancedPrompt = SYSTEM_PROMPT;
    if (documentContext) {
      enhancedPrompt += documentContext;
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
          JSON.stringify({ error: "Limite de requêtes atteinte. Veuillez réessayer dans quelques instants." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Crédits insuffisants. Veuillez recharger votre compte." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "Erreur du service IA" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Streaming response from AI gateway", documentsFound.length > 0 ? `(with ${documentsFound.length} documents context)` : '');

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
