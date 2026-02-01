/**
 * Phase 7.0.3-fix: build-case-puzzle
 * Analyzes thread emails/attachments and populates facts/gaps
 * CTO Fix: Uses atomic supersede_fact RPC for fact updates
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// Mandatory facts by request type
const MANDATORY_FACTS: Record<string, string[]> = {
  SEA_FCL_IMPORT: [
    "routing.origin_port",
    "routing.destination_city",
    "routing.incoterm",
    "cargo.description",
    "cargo.containers",
    "contacts.client_email",
  ],
  AIR_IMPORT: [
    "routing.origin_airport",
    "routing.destination_city",
    "routing.incoterm",
    "cargo.description",
    "cargo.weight_kg",
    "cargo.pieces_count",
    "cargo.value",
    "contacts.client_email",
  ],
};

// Gap questions
const GAP_QUESTIONS: Record<string, { fr: string; en: string; priority: string; category: string }> = {
  "routing.incoterm": {
    fr: "Quel Incoterm souhaitez-vous ? (FOB, CFR, CIF, DAP, DDP...)",
    en: "Which Incoterm do you prefer? (FOB, CFR, CIF, DAP, DDP...)",
    priority: "critical",
    category: "routing",
  },
  "routing.destination_city": {
    fr: "Quelle est la destination finale des marchandises ?",
    en: "What is the final destination of the goods?",
    priority: "critical",
    category: "routing",
  },
  "routing.destination_port": {
    fr: "Veuillez confirmer le port de destination (Dakar ou autre)",
    en: "Please confirm the destination port (Dakar or other)",
    priority: "high",
    category: "routing",
  },
  "routing.origin_port": {
    fr: "Quel est le port d'origine ?",
    en: "What is the origin port?",
    priority: "critical",
    category: "routing",
  },
  "routing.origin_airport": {
    fr: "Quel est l'aéroport d'origine ?",
    en: "What is the origin airport?",
    priority: "critical",
    category: "routing",
  },
  "cargo.containers": {
    fr: "Merci de préciser type et nombre de conteneurs (ex: 2x40HC)",
    en: "Please specify container type and quantity (e.g., 2x40HC)",
    priority: "critical",
    category: "cargo",
  },
  "cargo.weight_kg": {
    fr: "Quel est le poids total en kg ?",
    en: "What is the total weight in kg?",
    priority: "high",
    category: "cargo",
  },
  "cargo.value": {
    fr: "Valeur déclarée des marchandises et devise ?",
    en: "Declared value of goods and currency?",
    priority: "high",
    category: "cargo",
  },
  "cargo.description": {
    fr: "Pouvez-vous préciser la nature des marchandises ?",
    en: "Can you specify the nature of the goods?",
    priority: "medium",
    category: "cargo",
  },
  "cargo.pieces_count": {
    fr: "Combien de colis/pièces ?",
    en: "How many packages/pieces?",
    priority: "high",
    category: "cargo",
  },
};

interface BuildPuzzleRequest {
  case_id: string;
  force_refresh?: boolean;
}

interface ExtractedFact {
  key: string;
  category: string;
  value: string | number | object;
  valueType: "text" | "number" | "json" | "date";
  sourceType: string;
  sourceEmailId?: string;
  sourceAttachmentId?: string;
  sourceExcerpt?: string;
  confidence: number;
  isAssumption?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Validate JWT
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
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

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
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Parse request
    const { case_id, force_refresh = false }: BuildPuzzleRequest = await req.json();

    if (!case_id) {
      return new Response(
        JSON.stringify({ error: "case_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Load case and verify ownership
    const { data: caseData, error: caseError } = await serviceClient
      .from("quote_cases")
      .select("*, email_threads!inner(id, subject_normalized)")
      .eq("id", case_id)
      .single();

    if (caseError || !caseData) {
      return new Response(
        JSON.stringify({ error: "Case not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (caseData.created_by !== userId && caseData.assigned_to !== userId) {
      return new Response(
        JSON.stringify({ error: "Access denied" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Load all emails from thread
    const { data: emails } = await serviceClient
      .from("emails")
      .select("id, from_address, to_addresses, subject, body_text, sent_at, is_quotation_request")
      .eq("thread_ref", caseData.thread_id)
      .order("sent_at", { ascending: true });

    if (!emails || emails.length === 0) {
      return new Response(
        JSON.stringify({ error: "No emails found in thread" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Load attachments
    const emailIds = emails.map((e) => e.id);
    const { data: attachments } = await serviceClient
      .from("email_attachments")
      .select("id, email_id, filename, content_type, extracted_data, extracted_text, is_analyzed")
      .in("email_id", emailIds);

    // 6. Build context for AI extraction
    const threadContext = emails
      .map((e) => `[${e.sent_at}] From: ${e.from_address}\nSubject: ${e.subject}\n\n${e.body_text || ""}`)
      .join("\n\n---\n\n");

    const attachmentContext = (attachments || [])
      .filter((a) => a.extracted_text || a.extracted_data)
      .map((a) => `[Attachment: ${a.filename}]\n${a.extracted_text || JSON.stringify(a.extracted_data)}`)
      .join("\n\n");

    // 7. Call AI for fact extraction
    const extractedFacts = await extractFactsWithAI(
      threadContext,
      attachmentContext,
      emails,
      attachments || [],
      lovableApiKey
    );

    // 8. Detect request type from content
    const detectedType = detectRequestType(threadContext, extractedFacts);

    // 9. Store facts using ATOMIC RPC supersede_fact
    // CTO FIX Phase 7.0.3: Fail fast + error tracking + skip identical values
    let factsAdded = 0;
    let factsUpdated = 0;
    let factsSkipped = 0;
    const factErrors: Array<{ key: string; error: string; isCritical: boolean }> = [];
    
    // Get mandatory facts for this request type to mark critical errors
    const mandatoryFactsForType = MANDATORY_FACTS[detectedType] || MANDATORY_FACTS.SEA_FCL_IMPORT;

    for (const fact of extractedFacts) {
      try {
        // Check if fact already exists
        const { data: existingFact } = await serviceClient
          .from("quote_facts")
          .select("id, value_text, value_number, value_json")
          .eq("case_id", case_id)
          .eq("fact_key", fact.key)
          .eq("is_current", true)
          .single();

        const factValue = getFactValue(fact);

        if (existingFact) {
          // CTO FIX: Skip if value is identical (avoid unnecessary writes)
          const existingValue = existingFact.value_text || existingFact.value_number || existingFact.value_json;
          if (JSON.stringify(existingValue) === JSON.stringify(factValue)) {
            factsSkipped++;
            continue; // No change, skip
          }

          // Values differ - supersede
          const { data: newFactId, error: supersedeError } = await serviceClient.rpc('supersede_fact', {
            p_case_id: case_id,
            p_fact_key: fact.key,
            p_fact_category: fact.category,
            p_value_text: fact.valueType === 'text' ? String(fact.value) : null,
            p_value_number: fact.valueType === 'number' ? Number(fact.value) : null,
            p_value_json: fact.valueType === 'json' ? fact.value : null,
            p_value_date: fact.valueType === 'date' ? String(fact.value) : null,
            p_source_type: fact.isAssumption ? 'ai_assumption' : fact.sourceType,
            p_source_email_id: fact.sourceEmailId || null,
            p_source_attachment_id: fact.sourceAttachmentId || null,
            p_source_excerpt: fact.sourceExcerpt || null,
            p_confidence: fact.confidence,
          });

          if (supersedeError) {
            const isCritical = mandatoryFactsForType.includes(fact.key);
            factErrors.push({ key: fact.key, error: supersedeError.message, isCritical });
            
            // CTO FIX: Log error to timeline for observability
            await serviceClient.from("case_timeline_events").insert({
              case_id,
              event_type: "fact_insert_failed",
              event_data: { 
                fact_key: fact.key, 
                error: supersedeError.message,
                is_critical: isCritical,
                operation: "supersede"
              },
              actor_type: "system",
            });
            
            console.error(`Failed to supersede fact ${fact.key}:`, supersedeError);
            continue;
          }

          factsUpdated++;

          await serviceClient.from("case_timeline_events").insert({
            case_id,
            event_type: "fact_superseded",
            event_data: { fact_key: fact.key, old_value: existingValue, new_value: factValue },
            related_fact_id: existingFact.id,
            actor_type: "ai",
          });
        } else {
          // Insert new fact via RPC
          const { data: newFactId, error: insertError } = await serviceClient.rpc('supersede_fact', {
            p_case_id: case_id,
            p_fact_key: fact.key,
            p_fact_category: fact.category,
            p_value_text: fact.valueType === 'text' ? String(fact.value) : null,
            p_value_number: fact.valueType === 'number' ? Number(fact.value) : null,
            p_value_json: fact.valueType === 'json' ? fact.value : null,
            p_value_date: fact.valueType === 'date' ? String(fact.value) : null,
            p_source_type: fact.isAssumption ? 'ai_assumption' : fact.sourceType,
            p_source_email_id: fact.sourceEmailId || null,
            p_source_attachment_id: fact.sourceAttachmentId || null,
            p_source_excerpt: fact.sourceExcerpt || null,
            p_confidence: fact.confidence,
          });

          if (insertError) {
            const isCritical = mandatoryFactsForType.includes(fact.key);
            factErrors.push({ key: fact.key, error: insertError.message, isCritical });
            
            // CTO FIX: Log error to timeline for observability
            await serviceClient.from("case_timeline_events").insert({
              case_id,
              event_type: "fact_insert_failed",
              event_data: { 
                fact_key: fact.key, 
                error: insertError.message,
                is_critical: isCritical,
                operation: "insert"
              },
              actor_type: "system",
            });
            
            console.error(`Failed to insert fact ${fact.key}:`, insertError);
            continue;
          }

          factsAdded++;

          await serviceClient.from("case_timeline_events").insert({
            case_id,
            event_type: "fact_added",
            event_data: { fact_key: fact.key, value: factValue },
            related_fact_id: newFactId,
            actor_type: "ai",
          });
        }
      } catch (factError: any) {
        const isCritical = mandatoryFactsForType.includes(fact.key);
        factErrors.push({ key: fact.key, error: String(factError), isCritical });
        console.error(`Unexpected error processing fact ${fact.key}:`, factError);
      }
    }

    // CTO FIX Phase 7.0.3: Block READY_TO_PRICE if any fact errors occurred
    if (factErrors.length > 0) {
      const criticalErrors = factErrors.filter(e => e.isCritical);
      console.error(`${factErrors.length} fact errors for case ${case_id} (${criticalErrors.length} critical):`, factErrors);
      
      // Force status to FACTS_PARTIAL - cannot proceed to pricing with failed facts
      await serviceClient
        .from("quote_cases")
        .update({
          status: "FACTS_PARTIAL",
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", case_id);

      return new Response(
        JSON.stringify({
          case_id,
          new_status: "FACTS_PARTIAL",
          facts_added: factsAdded,
          facts_updated: factsUpdated,
          facts_skipped: factsSkipped,
          fact_errors: factErrors,
          critical_errors_count: criticalErrors.length,
          ready_to_price: false,
          error_summary: `${factErrors.length} facts failed to save (${criticalErrors.length} critical)`
        }),
        { status: 207, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 10. Identify gaps
    const mandatoryFacts = MANDATORY_FACTS[detectedType] || MANDATORY_FACTS.SEA_FCL_IMPORT;
    const extractedKeys = extractedFacts.map((f) => f.key);
    
    let gapsIdentified = 0;

    for (const requiredKey of mandatoryFacts) {
      const hasFact = extractedKeys.includes(requiredKey);
      const hasAssumption = extractedFacts.find((f) => f.key === requiredKey && f.isAssumption);

      // Check if gap already exists
      const { data: existingGap } = await serviceClient
        .from("quote_gaps")
        .select("id, status")
        .eq("case_id", case_id)
        .eq("gap_key", requiredKey)
        .eq("status", "open")
        .single();

      if (!hasFact || hasAssumption) {
        if (!existingGap) {
          const gapInfo = GAP_QUESTIONS[requiredKey] || {
            fr: `Information manquante: ${requiredKey}`,
            en: `Missing information: ${requiredKey}`,
            priority: "medium",
            category: requiredKey.split(".")[0],
          };

          await serviceClient.from("quote_gaps").insert({
            case_id,
            gap_key: requiredKey,
            gap_category: gapInfo.category,
            question_fr: gapInfo.fr,
            question_en: gapInfo.en,
            priority: gapInfo.priority,
            is_blocking: gapInfo.priority === "critical" || gapInfo.priority === "high",
          });

          gapsIdentified++;

          await serviceClient.from("case_timeline_events").insert({
            case_id,
            event_type: "gap_identified",
            event_data: { gap_key: requiredKey, priority: gapInfo.priority },
            actor_type: "ai",
          });
        }
      } else if (hasFact && !hasAssumption && existingGap) {
        // Resolve gap
        const { data: factRecord } = await serviceClient
          .from("quote_facts")
          .select("id")
          .eq("case_id", case_id)
          .eq("fact_key", requiredKey)
          .eq("is_current", true)
          .single();

        await serviceClient
          .from("quote_gaps")
          .update({
            status: "resolved",
            resolved_by_fact_id: factRecord?.id,
            resolved_at: new Date().toISOString(),
          })
          .eq("id", existingGap.id);

        await serviceClient.from("case_timeline_events").insert({
          case_id,
          event_type: "gap_resolved",
          event_data: { gap_key: requiredKey },
          related_gap_id: existingGap.id,
          actor_type: "ai",
        });
      }
    }

    // 11. Calculate completeness
    const { count: currentFactsCount } = await serviceClient
      .from("quote_facts")
      .select("*", { count: "exact", head: true })
      .eq("case_id", case_id)
      .eq("is_current", true);

    const { count: openGapsCount } = await serviceClient
      .from("quote_gaps")
      .select("*", { count: "exact", head: true })
      .eq("case_id", case_id)
      .eq("status", "open");

    const { count: blockingGapsCount } = await serviceClient
      .from("quote_gaps")
      .select("*", { count: "exact", head: true })
      .eq("case_id", case_id)
      .eq("status", "open")
      .eq("is_blocking", true);

    const completeness = mandatoryFacts.length > 0
      ? Math.round((Math.max(0, mandatoryFacts.length - (openGapsCount || 0)) / mandatoryFacts.length) * 100)
      : 0;

    // 12. Determine new status
    let newStatus = caseData.status;
    if (blockingGapsCount === 0 && (currentFactsCount || 0) > 0) {
      newStatus = "READY_TO_PRICE";
    } else if ((openGapsCount || 0) > 0) {
      newStatus = "NEED_INFO";
    } else {
      newStatus = "FACTS_PARTIAL";
    }

    // 13. Update case
    await serviceClient
      .from("quote_cases")
      .update({
        status: newStatus,
        request_type: detectedType,
        facts_count: currentFactsCount || 0,
        gaps_count: openGapsCount || 0,
        puzzle_completeness: completeness,
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", case_id);

    if (newStatus !== caseData.status) {
      await serviceClient.from("case_timeline_events").insert({
        case_id,
        event_type: "status_changed",
        previous_value: caseData.status,
        new_value: newStatus,
        actor_type: "system",
      });
    }

    console.log(`Built puzzle for case ${case_id}: ${factsAdded} added, ${factsUpdated} updated, ${factsSkipped} skipped, ${gapsIdentified} gaps`);

    return new Response(
      JSON.stringify({
        case_id,
        new_status: newStatus,
        request_type: detectedType,
        facts_added: factsAdded,
        facts_updated: factsUpdated,
        gaps_identified: gapsIdentified,
        puzzle_completeness: completeness,
        ready_to_price: newStatus === "READY_TO_PRICE",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in build-case-puzzle:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function extractFactsWithAI(
  threadContext: string,
  attachmentContext: string,
  emails: any[],
  attachments: any[],
  apiKey?: string
): Promise<ExtractedFact[]> {
  if (!apiKey) {
    console.warn("No LOVABLE_API_KEY, using basic extraction");
    return extractFactsBasic(emails, attachments);
  }

  const systemPrompt = `You are an expert freight forwarding analyst. Extract structured facts from email threads about quotation requests.

Return a JSON array of facts with this structure:
{
  "facts": [
    {
      "key": "routing.origin_port", 
      "category": "routing",
      "value": "Shanghai",
      "valueType": "text",
      "confidence": 0.95,
      "sourceExcerpt": "...from Shanghai to Dakar...",
      "isAssumption": false
    }
  ]
}

Fact keys to extract:
- routing.origin_port, routing.destination_port, routing.destination_city, routing.incoterm
- routing.origin_airport, routing.destination_airport
- cargo.description, cargo.containers (as JSON array [{type, quantity, coc_soc}])
- cargo.weight_kg, cargo.volume_cbm, cargo.value, cargo.value_currency, cargo.pieces_count
- timing.loading_date, timing.delivery_deadline
- carrier.name
- contacts.client_email, contacts.client_company

CRITICAL RULES:
1. Set isAssumption=true and confidence=0.4 for assumed values (e.g., destination_port=Dakar if not explicit)
2. Only extract what is explicitly stated unless making a documented assumption
3. For containers, always try to extract as JSON array
4. Extract exact source excerpts for traceability`;

  const userPrompt = `Extract facts from this email thread:

${threadContext}

${attachmentContext ? `\n\nAttachment content:\n${attachmentContext}` : ""}`;

  try {
    const response = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.error("AI extraction failed:", await response.text());
      return extractFactsBasic(emails, attachments);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*"facts"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const facts = parsed.facts || [];
      
      // Enrich with source email IDs
      return facts.map((f: any) => ({
        ...f,
        sourceType: f.isAssumption ? "ai_assumption" : "ai_extraction",
        sourceEmailId: emails[0]?.id,
      }));
    }

    return extractFactsBasic(emails, attachments);
  } catch (error) {
    console.error("AI extraction error:", error);
    return extractFactsBasic(emails, attachments);
  }
}

function extractFactsBasic(emails: any[], attachments: any[]): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const firstEmail = emails[0];

  if (firstEmail) {
    // Always extract client email
    facts.push({
      key: "contacts.client_email",
      category: "contacts",
      value: firstEmail.from_address,
      valueType: "text",
      sourceType: "email_body",
      sourceEmailId: firstEmail.id,
      confidence: 1.0,
    });

    // Basic text extraction patterns
    const body = (firstEmail.body_text || "").toLowerCase();
    
    // Incoterm detection
    const incoterms = ["exw", "fob", "cfr", "cif", "dap", "ddp", "fca", "cpt", "cip", "dat", "dpu"];
    for (const term of incoterms) {
      if (body.includes(term)) {
        facts.push({
          key: "routing.incoterm",
          category: "routing",
          value: term.toUpperCase(),
          valueType: "text",
          sourceType: "email_body",
          sourceEmailId: firstEmail.id,
          confidence: 0.7,
        });
        break;
      }
    }

    // Container detection
    const containerMatch = body.match(/(\d+)\s*x?\s*(20|40)\s*'?\s*(hc|dv|rf|gp|ot|fr)?/gi);
    if (containerMatch) {
      const containers = containerMatch.map((m: string) => {
        const parts = m.match(/(\d+)\s*x?\s*(20|40)\s*'?\s*(hc|dv|rf|gp|ot|fr)?/i);
        return {
          quantity: parseInt(parts?.[1] || "1"),
          type: `${parts?.[2]}${(parts?.[3] || "DV").toUpperCase()}`,
        };
      });
      facts.push({
        key: "cargo.containers",
        category: "cargo",
        value: containers,
        valueType: "json",
        sourceType: "email_body",
        sourceEmailId: firstEmail.id,
        confidence: 0.8,
      });
    }
  }

  return facts;
}

function detectRequestType(context: string, facts: ExtractedFact[]): string {
  const lowerContext = context.toLowerCase();
  
  // Check for air indicators
  if (lowerContext.includes("air freight") || 
      lowerContext.includes("airfreight") ||
      lowerContext.includes("awb") ||
      facts.some(f => f.key === "routing.origin_airport")) {
    return "AIR_IMPORT";
  }

  // Check for container indicators
  if (lowerContext.includes("container") ||
      lowerContext.includes("fcl") ||
      lowerContext.includes("40hc") ||
      lowerContext.includes("20dv") ||
      facts.some(f => f.key === "cargo.containers")) {
    return "SEA_FCL_IMPORT";
  }

  // Check for breakbulk indicators
  if (lowerContext.includes("breakbulk") ||
      lowerContext.includes("project cargo") ||
      lowerContext.includes("heavy lift")) {
    return "SEA_BREAKBULK_IMPORT";
  }

  // Default
  return "SEA_FCL_IMPORT";
}

function getFactValue(fact: ExtractedFact): string | number | object {
  return fact.value;
}
