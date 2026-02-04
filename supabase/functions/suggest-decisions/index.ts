/**
 * ============================================================================
 * Phase 9.2 — suggest-decisions (STATELESS)
 * ============================================================================
 * 
 * ⚠️ CTO RULE: This function is STRICTLY STATELESS
 * ❌ NO supabase.from(...).insert() ALLOWED
 * ❌ NO supabase.from(...).update() ALLOWED  
 * ❌ NO supabase.from(...).delete() ALLOWED
 * ❌ NO supabase.rpc() that writes
 * ❌ NO timeline events
 * ✅ SELECT queries ONLY
 * ✅ Return JSON ONLY
 * ✅ Emails access = BEST EFFORT (non-blocking)
 * 
 * OUTPUT CONTRACT: { proposals, missing_info, can_proceed: false }
 * ============================================================================
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, parseAIResponse } from "../_shared/ai-client.ts";
import { corsHeaders } from "../_shared/cors.ts";

// ============================================================================
// TYPES
// ============================================================================

type DecisionType = 'regime' | 'routing' | 'services' | 'incoterm' | 'container';

interface SuggestDecisionsRequest {
  case_id: string;
  decision_types?: DecisionType[];
}

interface DecisionOption {
  key: string;
  label_fr: string;
  label_en: string;
  justification_fr: string;
  justification_en: string;
  pros: string[];
  cons: string[];
  confidence_level: 'low' | 'medium' | 'high';
  is_recommended: boolean;
}

interface DecisionProposal {
  decision_type: DecisionType;
  options: DecisionOption[];
  source_fact_ids: string[];
}

interface SuggestDecisionsResponse {
  proposals: DecisionProposal[];
  missing_info: string[];
  can_proceed: false; // HARD-CODED, always false
}

interface QuoteFact {
  id: string;
  fact_key: string;
  fact_category: string;
  value_text: string | null;
  value_number: number | null;
  value_json: Record<string, unknown> | null;
}

interface QuoteGap {
  gap_key: string;
  gap_category: string;
  question_fr: string | null;
  is_blocking: boolean;
}

// ============================================================================
// PROMPT IA (GÉNÉRIQUE, SANS CODES MÉTIER)
// ============================================================================

const SYSTEM_PROMPT = `Tu es un ASSISTANT de pré-décision logistique pour un transitaire sénégalais.

== RÔLE STRICT ==
Tu PROPOSES des options comparables. Tu NE CHOISIS PAS.
L'opérateur humain prendra la décision finale.

== FORMAT DE SORTIE JSON ==
Tu dois retourner un JSON valide avec cette structure exacte :
{
  "options": [
    {
      "key": "identifiant_snake_case",
      "label_fr": "Libellé en français",
      "label_en": "Label in English",
      "justification_fr": "Pourquoi cette option pourrait convenir",
      "justification_en": "Why this option could be suitable",
      "pros": ["Avantage 1", "Avantage 2"],
      "cons": ["Inconvénient 1", "Inconvénient 2"],
      "confidence_level": "low|medium|high",
      "is_recommended": true ou false
    }
  ],
  "missing_info": ["Information manquante 1", "Information manquante 2"]
}

== RÈGLES ABSOLUES ==
❌ JAMAIS moins de 2 options
❌ JAMAIS de calcul de prix ou mention de montants
❌ JAMAIS de codes réglementaires spécifiques (pas de "code 1700", "regime T1", etc.)
❌ JAMAIS d'affirmation "obligatoire" ou "seule option viable" sans contexte
✅ Si tu manques d'information, l'indiquer dans missing_info ET dans la justification
✅ Formuler en hypothèses ("Si la destination finale est...", "Dans l'hypothèse où...")
✅ Une seule option avec is_recommended: true
✅ Si une seule option semble légalement possible, ajouter une 2ème option :
   { "key": "alternative_non_identifiee", "label_fr": "Aucune alternative identifiée avec les informations actuelles", "label_en": "No alternative identified with current information", "justification_fr": "Les informations disponibles ne permettent pas d'identifier d'autre option viable", "justification_en": "Available information does not allow identifying another viable option", "pros": [], "cons": ["Option par défaut"], "confidence_level": "high", "is_recommended": false }`;

const DECISION_PROMPTS: Record<DecisionType, string> = {
  regime: `Propose des options de RÉGIME DOUANIER applicable.
Exemples de régimes possibles (sans imposer de code) :
- Import définitif standard
- Transit vers pays tiers
- Admission temporaire (pour projets/chantiers)
- Entrepôt sous douane
- Zone franche économique
Base-toi sur les informations de destination, type de marchandise, et caractère temporaire/permanent.`,

  routing: `Propose des options d'ITINÉRAIRE LOGISTIQUE.
Considère :
- Port d'arrivée principal
- Destination(s) finale(s) mentionnée(s)
- Possibilité de multi-destinations
- Contraintes de transit terrestre si applicable
Base-toi sur les informations d'origine, destination et incoterm.`,

  services: `Propose des options de PÉRIMÈTRE DE PRESTATION.
Considère différents niveaux de service :
- Service complet (dédouanement + transport + livraison)
- Opérations portuaires uniquement
- Dédouanement seul
- Assistance documentaire minimale
Base-toi sur l'incoterm demandé et le type de client.`,

  incoterm: `Propose des options d'INCOTERM à proposer au client.
Considère les termes commerciaux standards :
- FOB (si client gère le fret)
- CFR/CIF (si organisation du fret maritime)
- DAP (livraison destination incluse)
- DDP (service complet droits payés)
Base-toi sur les capacités du transitaire et la demande client.`,

  container: `Propose des options de STRATÉGIE CONTENEUR.
Considère :
- Conteneur armateur (COC) - standard
- Conteneur client (SOC) - pour transit longue durée
- Stratégie mixte selon disponibilité
Base-toi sur la destination finale et la durée de transit prévue.`
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function buildContextFromFacts(facts: QuoteFact[], gaps: QuoteGap[]): string {
  const factsByCategory: Record<string, string[]> = {};
  
  for (const fact of facts) {
    const category = fact.fact_category || 'general';
    if (!factsByCategory[category]) {
      factsByCategory[category] = [];
    }
    
    let value = fact.value_text || '';
    if (fact.value_number !== null) {
      value = String(fact.value_number);
    }
    if (fact.value_json) {
      value = JSON.stringify(fact.value_json);
    }
    
    if (value) {
      factsByCategory[category].push(`${fact.fact_key}: ${value}`);
    }
  }
  
  let context = "== FAITS CONNUS ==\n";
  for (const [category, items] of Object.entries(factsByCategory)) {
    context += `\n[${category}]\n`;
    context += items.map(i => `- ${i}`).join('\n');
  }
  
  if (gaps.length > 0) {
    context += "\n\n== LACUNES IDENTIFIÉES ==\n";
    for (const gap of gaps) {
      context += `- ${gap.gap_category}: ${gap.question_fr || gap.gap_key}${gap.is_blocking ? ' (BLOQUANT)' : ''}\n`;
    }
  }
  
  return context;
}

function parseAIOptions(aiContent: string, decisionType: DecisionType): { options: DecisionOption[]; missing: string[] } {
  try {
    // Extract JSON from response (may be wrapped in markdown)
    const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`[suggest-decisions] No JSON found in AI response for ${decisionType}`);
      return createFallbackOptions(decisionType);
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    const options: DecisionOption[] = parsed.options || [];
    const missing: string[] = parsed.missing_info || [];
    
    // Validate minimum 2 options
    if (options.length < 2) {
      console.warn(`[suggest-decisions] Less than 2 options for ${decisionType}, adding fallback`);
      options.push({
        key: "alternative_non_identifiee",
        label_fr: "Aucune alternative identifiée avec les informations actuelles",
        label_en: "No alternative identified with current information",
        justification_fr: "Les informations disponibles ne permettent pas d'identifier d'autre option viable",
        justification_en: "Available information does not allow identifying another viable option",
        pros: [],
        cons: ["Option par défaut en l'absence d'alternatives"],
        confidence_level: "low",
        is_recommended: false
      });
    }
    
    // Validate confidence_level enum
    for (const opt of options) {
      if (!['low', 'medium', 'high'].includes(opt.confidence_level)) {
        opt.confidence_level = 'low';
      }
    }
    
    // Ensure exactly one is_recommended
    const recommended = options.filter(o => o.is_recommended);
    if (recommended.length === 0 && options.length > 0) {
      options[0].is_recommended = true;
    } else if (recommended.length > 1) {
      for (let i = 1; i < options.length; i++) {
        options[i].is_recommended = false;
      }
    }
    
    return { options, missing };
  } catch (error) {
    console.error(`[suggest-decisions] Error parsing AI response for ${decisionType}:`, error);
    return createFallbackOptions(decisionType);
  }
}

function createFallbackOptions(decisionType: DecisionType): { options: DecisionOption[]; missing: string[] } {
  return {
    options: [
      {
        key: `${decisionType}_option_standard`,
        label_fr: "Option standard (informations insuffisantes)",
        label_en: "Standard option (insufficient information)",
        justification_fr: "Option par défaut en raison d'un manque d'informations pour une analyse détaillée",
        justification_en: "Default option due to lack of information for detailed analysis",
        pros: ["Option conservatrice"],
        cons: ["Analyse limitée par le manque de données"],
        confidence_level: "low",
        is_recommended: true
      },
      {
        key: "alternative_non_identifiee",
        label_fr: "Aucune alternative identifiée avec les informations actuelles",
        label_en: "No alternative identified with current information",
        justification_fr: "Les informations disponibles ne permettent pas d'identifier d'autre option viable",
        justification_en: "Available information does not allow identifying another viable option",
        pros: [],
        cons: ["Option par défaut en l'absence d'alternatives"],
        confidence_level: "low",
        is_recommended: false
      }
    ],
    missing: [`Informations insuffisantes pour ${decisionType}`]
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. AUTH VALIDATION (verify_jwt = true in config.toml handles JWT validation)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User client for auth validation
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = userData.user.id;

    // Service client for DB reads (SELECT ONLY)
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // 2. PARSE REQUEST
    const { case_id, decision_types }: SuggestDecisionsRequest = await req.json();

    if (!case_id) {
      return new Response(
        JSON.stringify({ error: "case_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. OWNERSHIP CHECK (MINIMAL: created_by = auth.uid() ONLY)
    const { data: quoteCase, error: caseError } = await serviceClient
      .from("quote_cases")
      .select("id, created_by, thread_id, status, request_type")
      .eq("id", case_id)
      .single();

    if (caseError || !quoteCase) {
      return new Response(
        JSON.stringify({ error: "Case not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // CTO RULE: Ownership check minimal - created_by uniquement
    if (quoteCase.created_by !== userId) {
      console.warn(`[suggest-decisions] Ownership denied: user ${userId} tried to access case ${case_id} owned by ${quoteCase.created_by}`);
      return new Response(
        JSON.stringify({ error: "Access denied" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. LOAD CONTEXT (SELECT ONLY)
    
    // 4a. Load facts
    const { data: facts, error: factsError } = await serviceClient
      .from("quote_facts")
      .select("id, fact_key, fact_category, value_text, value_number, value_json")
      .eq("case_id", case_id)
      .eq("is_current", true);

    if (factsError) {
      console.error("[suggest-decisions] Error loading facts:", factsError);
    }

    const loadedFacts: QuoteFact[] = facts || [];

    // 4b. Load gaps
    const { data: gaps, error: gapsError } = await serviceClient
      .from("quote_gaps")
      .select("gap_key, gap_category, question_fr, is_blocking")
      .eq("case_id", case_id)
      .eq("status", "open");

    if (gapsError) {
      console.error("[suggest-decisions] Error loading gaps:", gapsError);
    }

    const loadedGaps: QuoteGap[] = gaps || [];

    // 4c. Load emails (BEST EFFORT - non-blocking if thread_id is NULL or no emails found)
    let emailContext = "";
    if (quoteCase.thread_id) {
      try {
        const { data: emails, error: emailsError } = await serviceClient
          .from("emails")
          .select("subject, body_text, from_address")
          .eq("thread_ref", quoteCase.thread_id)
          .order("sent_at", { ascending: true })
          .limit(5);

        if (!emailsError && emails && emails.length > 0) {
          emailContext = "\n\n== CONTEXTE EMAILS (extrait) ==\n";
          for (const email of emails) {
            let body = email.body_text || '';
            // Truncate long bodies
            if (body.length > 500) {
              body = body.substring(0, 500) + '...';
            }
            emailContext += `\nDe: ${email.from_address}\nSujet: ${email.subject || '(sans sujet)'}\n${body}\n---\n`;
          }
        }
        // If emailsError or no emails, continue silently (best effort)
      } catch (emailErr) {
        console.warn("[suggest-decisions] Best effort email loading failed:", emailErr);
        // Continue without emails
      }
    }

    // 5. DETERMINE DECISION TYPES
    // CTO RULE: No "intelligent" deduction - if absent, generate ALL 5 types
    const ALL_DECISION_TYPES: DecisionType[] = ['regime', 'routing', 'services', 'incoterm', 'container'];
    const typesToGenerate: DecisionType[] = decision_types && decision_types.length > 0 
      ? decision_types 
      : ALL_DECISION_TYPES;

    // 6. BUILD CONTEXT
    const factsContext = buildContextFromFacts(loadedFacts, loadedGaps);
    const fullContext = factsContext + emailContext;

    // 7. GENERATE PROPOSALS (AI)
    const proposals: DecisionProposal[] = [];
    const allMissingInfo: string[] = [];
    const factIds = loadedFacts.map(f => f.id);

    for (const decisionType of typesToGenerate) {
      console.log(`[suggest-decisions] Generating proposals for: ${decisionType}`);
      
      const typePrompt = DECISION_PROMPTS[decisionType];
      const userPrompt = `${typePrompt}\n\n${fullContext}`;

      try {
        const response = await callAI([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ], {
          model: 'google/gemini-2.5-flash',
          temperature: 0.3,
        });

        const aiContent = await parseAIResponse(response);
        const { options, missing } = parseAIOptions(aiContent, decisionType);

        proposals.push({
          decision_type: decisionType,
          options,
          source_fact_ids: factIds
        });

        // Collect missing info
        for (const m of missing) {
          if (!allMissingInfo.includes(m)) {
            allMissingInfo.push(m);
          }
        }
      } catch (aiError) {
        console.error(`[suggest-decisions] AI error for ${decisionType}:`, aiError);
        
        // Fallback: add default options with low confidence
        const fallback = createFallbackOptions(decisionType);
        proposals.push({
          decision_type: decisionType,
          options: fallback.options,
          source_fact_ids: factIds
        });
        allMissingInfo.push(`Erreur IA pour ${decisionType} - options par défaut générées`);
      }
    }

    // Add gaps as missing info
    for (const gap of loadedGaps) {
      if (gap.is_blocking && gap.question_fr) {
        const gapInfo = `[${gap.gap_category}] ${gap.question_fr}`;
        if (!allMissingInfo.includes(gapInfo)) {
          allMissingInfo.push(gapInfo);
        }
      }
    }

    // 8. RETURN JSON (STRICT CONTRACT)
    // CTO RULE: can_proceed = false ALWAYS
    const result: SuggestDecisionsResponse = {
      proposals,
      missing_info: allMissingInfo,
      can_proceed: false // HARD-CODED
    };

    console.log(`[suggest-decisions] Generated ${proposals.length} proposals for case ${case_id}`);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("[suggest-decisions] Unexpected error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
