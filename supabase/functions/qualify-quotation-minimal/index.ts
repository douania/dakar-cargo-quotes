/**
 * Phase 8.8 — Edge Function de qualification minimale
 * 
 * GARDE-FOU CTO #1: STATEless et NON persistante
 * ❌ Ne crée aucune ligne DB
 * ❌ Ne modifie aucun quote_fact
 * ❌ Ne modifie aucun quote_gap
 * ✅ Retourne uniquement un payload éphémère pour l'UI
 * 
 * GARDE-FOU CTO #3: Langage questionnant, jamais suggestif
 * ❌ Pas de "Le régime le plus adapté est…"
 * ❌ Pas de "Nous recommandons…"
 * ✅ Uniquement "Merci de préciser…" / "Pouvez-vous confirmer…"
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { callAI, parseAIResponse } from "../_shared/ai-client.ts";
import { corsHeaders } from "../_shared/cors.ts";

interface DetectedAmbiguity {
  type: 'temporary_import' | 'multi_destination' | 'unclear_incoterm' | 'service_scope' | 'cargo_detail' | 'timing';
  excerpt: string;
  question_fr: string;
  question_en: string;
}

interface ClarificationQuestion {
  question_fr: string;
  question_en: string;
  category: string;
  priority: 'critical' | 'high' | 'medium';
}

interface QualifyMinimalResult {
  detected_ambiguities: DetectedAmbiguity[];
  questions: ClarificationQuestion[];
  clarification_draft: {
    subject_fr: string;
    subject_en: string;
    body_fr: string;
    body_en: string;
  };
  completeness_score: number;
  can_proceed: false; // CTO: Pricing is NEVER allowed in Phase 8.8
}

// Prompt IA strict - GARDE-FOU #3 intégré
const QUALIFICATION_PROMPT = `Tu es un ASSISTANT de pré-qualification logistique pour SODATRA (transitaire au Sénégal).

== RÔLE STRICT ==
Tu NE décides RIEN. Tu DÉTECTES et QUESTIONNES.

❌ Tu n'imposes aucun code HS
❌ Tu ne suggères aucun régime douanier
❌ Tu ne mentionnes aucun prix ou taux
❌ Tu n'écris JAMAIS "Nous recommandons..." ou "Le plus adapté est..."
❌ Tu ne fais AUCUNE hypothèse métier

✅ Tu détectes les ambiguïtés dans l'email
✅ Tu formules des questions claires pour le client
✅ Tu génères un email de clarification professionnel

== DÉTECTIONS REQUISES ==
1. "temporary import" / "admission temporaire" → question sur la durée prévue et la date de réexport
2. Multi-destinations (Dakar ET Bamako, site A ET site B) → demander laquelle prioriser ou si cotation séparée
3. Incoterm flou ("local delivery", "door to door", "DDU/DDP") → demander précision sur l'Incoterm exact souhaité
4. Services ambigus ("full service", "all-in", "tout compris") → demander de lister les services attendus
5. Poids/dimensions manquants ou "TBC" → demander les valeurs exactes
6. NE JAMAIS demander la date d'arrivée souhaitée ou l'ETA. Les cotations sont indicatives et non engageantes sur les délais.

== RÈGLES ANTI-FAUX-POSITIFS (PRIORITAIRES) ==
1. Si un Incoterm (DAP, FOB, CIF, CFR, EXW, etc.) est présent dans les faits extraits ci-dessous, NE PAS générer d'ambiguïté "unclear_incoterm"
2. Les dimensions de conteneurs standards (20DV, 40HC, 40FR, 40OT, etc.) sont connues ISO et NE nécessitent PAS de question. Ne demander les dimensions que pour du breakbulk ou du cargo hors-gabarit (OOG)
3. Si un service.package est identifié dans les faits, NE PAS générer d'ambiguïté "service_scope"
4. Si des conteneurs sont présents dans les faits, NE PAS demander le poids par conteneur sauf si explicitement marqué "TBC" ou "à confirmer"
5. Ne JAMAIS questionner un fait déjà extrait avec une confiance >= 0.80
6. Si des codes HS sont présents dans les faits extraits (cargo.hs_code), NE PAS générer de question demandant les codes HS ou la classification tarifaire
7. Si la valeur CIF/CAF est présente dans les faits (cargo.value), NE PAS demander la valeur de la marchandise

== FORMAT DE SORTIE JSON ==
{
  "detected_ambiguities": [
    {
      "type": "temporary_import|multi_destination|unclear_incoterm|service_scope|cargo_detail|timing",
      "excerpt": "texte exact de l'email concerné",
      "question_fr": "Question claire en français",
      "question_en": "Clear question in English"
    }
  ],
  "questions": [
    {
      "question_fr": "Question en français",
      "question_en": "Question in English",
      "category": "cargo|routing|timing|documentation|service",
      "priority": "critical|high|medium"
    }
  ],
  "clarification_draft": {
    "subject_fr": "Re: [sujet original] - Demande de précisions",
    "subject_en": "Re: [original subject] - Request for clarification",
    "body_fr": "Corps de l'email en français, professionnel, avec les questions numérotées",
    "body_en": "Email body in English, professional, with numbered questions"
  },
  "completeness_score": 0.0 à 1.0,
  "can_proceed": false
}

== RÈGLES POUR LE DRAFT ==
- Commencer par "Bonjour" (FR) ou "Dear" (EN)
- Remercier pour la demande
- Expliquer brièvement pourquoi les précisions sont nécessaires
- Lister les questions de manière numérotée
- NE JAMAIS mentionner de prix, taux, ou montants
- NE JAMAIS faire de suggestions techniques
- Terminer par une formule de politesse professionnelle
- Signer "L'équipe SODATRA" / "SODATRA Team"`;

serve(async (req) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth validation
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const token = authHeader.replace('Bearer ', '');

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { thread_id } = await req.json();

    if (!thread_id) {
      return new Response(
        JSON.stringify({ error: 'thread_id requis' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Créer client Supabase (lecture seule)
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // ⚠️ CTO RULE: NO supabase.from(...).insert/update/delete ALLOWED HERE
    // This function is READ-ONLY: emails + quote_cases + quote_gaps SELECT only

    // Récupérer les emails du thread (LECTURE SEULE)
    const { data: emails, error: emailsError } = await supabase
      .from('emails')
      .select('id, subject, body_text, from_address, to_addresses, sent_at, received_at')
      .eq('thread_ref', thread_id)
      .order('sent_at', { ascending: true });

    if (emailsError) {
      console.error('Error fetching emails:', emailsError);
      throw emailsError;
    }

    const isSyntheticRef = thread_id.startsWith('subject:');

    if (!emails || emails.length === 0) {
      if (!isSyntheticRef) {
        // Fallback: chercher par ID si thread_ref est en fait un email ID (UUID only)
        const { data: singleEmail, error: singleError } = await supabase
          .from('emails')
          .select('id, subject, body_text, from_address, to_addresses, sent_at, received_at')
          .eq('id', thread_id)
          .single();

        if (!singleError && singleEmail) {
          emails.push(singleEmail);
        }
      }
      // Si toujours pas d'emails, on continue avec un tableau vide (fonction read-only)
    }

    // Récupérer les gaps existants du quote_case (LECTURE SEULE)
    let quoteCase: { id: string; status: string } | null = null;
    if (!isSyntheticRef) {
      const { data } = await supabase
        .from('quote_cases')
        .select('id, status')
        .eq('thread_id', thread_id)
        .maybeSingle();
      quoteCase = data;
    }

    let existingGaps: Array<{ gap_key: string; question_fr: string | null; gap_category: string }> = [];
    let existingFacts: Array<{ fact_key: string; value_text: string | null; value_number: number | null; confidence: number }> = [];
    
    if (quoteCase?.id) {
      const [gapsResult, factsResult] = await Promise.all([
        supabase
          .from('quote_gaps')
          .select('gap_key, question_fr, gap_category')
          .eq('case_id', quoteCase.id)
          .eq('status', 'open')
          .eq('is_blocking', true),
        supabase
          .from('quote_facts')
          .select('fact_key, value_text, value_number, confidence')
          .eq('case_id', quoteCase.id)
          .eq('is_current', true),
      ]);
      
      existingGaps = gapsResult.data || [];
      existingFacts = factsResult.data || [];
    }

    // Construire le contexte pour l'IA
    const emailContext = emails.map(e => {
      // Décoder le body_text si en base64
      let bodyText = e.body_text || '';
      try {
        if (bodyText && /^[A-Za-z0-9+/=]+$/.test(bodyText.replace(/\s/g, ''))) {
          const decoded = atob(bodyText);
          if (decoded.length > 0 && !decoded.includes('\ufffd')) {
            bodyText = decoded;
          }
        }
      } catch {
        // Garder le texte original si décodage échoue
      }
      
      return `
--- Email de: ${e.from_address} ---
Date: ${e.sent_at || e.received_at}
Sujet: ${e.subject || '(sans sujet)'}
Contenu:
${bodyText}
---`;
    }).join('\n\n');

    const gapsContext = existingGaps.length > 0 
      ? `\n\nLacunes déjà identifiées:\n${existingGaps.map(g => `- ${g.gap_category}: ${g.question_fr || g.gap_key}`).join('\n')}`
      : '';

    const factsContext = existingFacts.length > 0
      ? `\n\nFaits déjà extraits et confirmés (NE PAS re-questionner) :\n${existingFacts.map(f => `- ${f.fact_key}: ${f.value_text || f.value_number} (confiance: ${f.confidence})`).join('\n')}`
      : '';

    // Appel IA
    const response = await callAI([
      { role: 'system', content: QUALIFICATION_PROMPT },
      { role: 'user', content: `Analyse cette demande de cotation et génère les questions de clarification nécessaires.\n\n${emailContext}${gapsContext}${factsContext}` }
    ], {
      model: 'google/gemini-2.5-flash',
      temperature: 0.3,
    });

    const aiContent = await parseAIResponse(response);
    
    // Parser la réponse JSON
    let result: QualifyMinimalResult;
    try {
      // Extraire le JSON de la réponse (peut être entouré de markdown)
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Pas de JSON trouvé dans la réponse IA');
      }
      result = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      console.error('AI content:', aiContent);
      
      // Fallback: construire une réponse basique à partir des gaps existants
      result = {
        detected_ambiguities: [],
        questions: existingGaps.map(g => ({
          question_fr: g.question_fr || g.gap_key,
          question_en: g.gap_key, // Fallback anglais
          category: g.gap_category,
          priority: 'high' as const,
        })),
        clarification_draft: {
          subject_fr: `Re: ${emails[0]?.subject || 'Demande de cotation'} - Demande de précisions`,
          subject_en: `Re: ${emails[0]?.subject || 'Quotation request'} - Request for clarification`,
          body_fr: `Bonjour,

Merci pour votre demande de cotation. Afin de vous fournir une offre précise, nous aurions besoin des précisions suivantes :

${existingGaps.map((g, i) => `${i + 1}. ${g.question_fr || g.gap_key}`).join('\n')}

Nous restons à votre disposition.

Cordialement,
L'équipe SODATRA`,
          body_en: `Dear Sir/Madam,

Thank you for your quotation request. In order to provide you with an accurate offer, we would need the following clarifications:

${existingGaps.map((g, i) => `${i + 1}. ${g.gap_key}`).join('\n')}

We remain at your disposal.

Best regards,
SODATRA Team`,
        },
        completeness_score: existingGaps.length === 0 ? 1.0 : Math.max(0, 1 - (existingGaps.length * 0.15)),
        can_proceed: false, // CTO: ALWAYS false in Phase 8.8 regardless of completeness
      };
    }

    // CTO RULE: Force can_proceed to false - Phase 8.8 is qualification only, NOT pricing
    result.can_proceed = false;

    // V4.2.3b: Filter medium-priority questions from clarification draft
    const blockingQuestions = (result.questions || []).filter(
      (q: ClarificationQuestion) => q.priority === 'critical' || q.priority === 'high'
    );
    if (blockingQuestions.length < (result.questions || []).length) {
      console.log(`[V4.2.3b] Filtered ${(result.questions || []).length - blockingQuestions.length} medium-priority questions from draft`);
      // Rebuild clarification draft with only blocking questions
      if (blockingQuestions.length === 0) {
        result.clarification_draft.body_fr = '';
        result.clarification_draft.body_en = '';
      } else {
        result.clarification_draft.body_fr = `Bonjour,\n\nMerci pour votre demande de cotation. Afin de vous fournir une offre précise, nous aurions besoin des précisions suivantes :\n\n${blockingQuestions.map((q: ClarificationQuestion, i: number) => `${i + 1}. ${q.question_fr}`).join('\n')}\n\nNous restons à votre disposition.\n\nCordialement,\nL'équipe SODATRA`;
        result.clarification_draft.body_en = `Dear Sir/Madam,\n\nThank you for your quotation request. In order to provide you with an accurate offer, we would need the following clarifications:\n\n${blockingQuestions.map((q: ClarificationQuestion, i: number) => `${i + 1}. ${q.question_en}`).join('\n')}\n\nWe remain at your disposal.\n\nBest regards,\nSODATRA Team`;
      }
      result.questions = blockingQuestions;
    }

    // GARDE-FOU #1: On ne persiste RIEN, on retourne juste le payload
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in qualify-quotation-minimal:', error);
    const message = error instanceof Error ? error.message : 'Erreur interne';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
