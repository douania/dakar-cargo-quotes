import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Analysis prompts for each puzzle phase
const PUZZLE_PHASES = {
  extract_request: {
    name: "Demande initiale",
    weight: 20,
    prompt: `Tu es un expert en analyse de demandes de cotation logistique pour le Sénégal/Afrique de l'Ouest.

Analyse l'email initial de demande de cotation et extrais les informations suivantes:

1. **CARGO** (marchandises):
   - Description détaillée des marchandises
   - Dimensions (L x l x H), poids unitaire et total
   - Nombre de colis/pièces
   - Type de conditionnement (vrac, palettes, conteneurs, caisses)
   - Dangereux ? (IMO class si applicable)

2. **ROUTING** (itinéraire):
   - Origine (ville, pays, port)
   - Destination finale (ville, site, pays)
   - Incoterm demandé ou implicite
   - Ports de transit mentionnés

3. **TIMING** (délais):
   - Date de chargement souhaitée
   - Deadline de livraison
   - Urgence mentionnée

4. **DOCUMENTS** mentionnés:
   - Packing list jointe ?
   - Facture commerciale ?
   - Autres documents

Réponds en JSON:
{
  "cargo": { "description": "", "pieces": N, "weight_kg": N, "volume_cbm": N, "dimensions": [], "packaging": "", "hazardous": false, "imo_class": null },
  "routing": { "origin_city": "", "origin_country": "", "destination_city": "", "destination_site": "", "destination_country": "", "incoterm_requested": "", "transit_ports": [] },
  "timing": { "loading_date": "", "delivery_deadline": "", "urgency": "normal|urgent|critical" },
  "documents_mentioned": [],
  "missing_info": ["liste des infos manquantes critiques"],
  "request_type": "FCL|LCL|BREAKBULK|RORO|AIR|ROAD|MULTIMODAL",
  "confidence": 0.0-1.0
}`
  },

  extract_clarifications: {
    name: "Clarifications",
    weight: 15,
    prompt: `Analyse les échanges de clarification dans ce fil de discussion.

Identifie:
1. **Questions posées** par le client ou l'agent
2. **Réponses apportées** avec les informations obtenues
3. **Corrections** aux informations initiales
4. **Contraintes supplémentaires** découvertes

Réponds en JSON:
{
  "clarifications": [
    {
      "question": "Question posée",
      "answer": "Réponse obtenue",
      "info_type": "cargo|routing|timing|pricing|other",
      "source": "client|agent",
      "date": "ISO date"
    }
  ],
  "corrections": [
    { "field": "nom du champ", "original": "valeur initiale", "corrected": "valeur corrigée" }
  ],
  "additional_constraints": ["liste des contraintes découvertes"],
  "puzzle_updates": {
    "cargo": {},
    "routing": {},
    "timing": {}
  }
}`
  },

  extract_quotation: {
    name: "Structure cotation",
    weight: 30,
    prompt: `Analyse la cotation envoyée dans ce fil de discussion.

Extrais la STRUCTURE COMPLÈTE de la cotation:

1. **TARIFS** (chaque ligne de coût):
   - Service/Description
   - Montant et devise
   - Unité (par conteneur, par tonne, forfait, etc.)
   - Base de calcul

2. **TOTAUX**:
   - Sous-totaux par catégorie
   - Total général
   - Devise finale

3. **CONDITIONS**:
   - Validité de l'offre
   - Inclusions
   - Exclusions
   - Termes de paiement

4. **MATCHING CRITERIA** pour réutilisation:
   - Type de conteneur applicable
   - Port de destination
   - Terminal
   - Corridor/route
   - Type de cargo

5. **COMPAGNIE MARITIME / TRANSPORTEUR**:
   - Nom de la compagnie (CMA CGM, MSC, Maersk, Hapag-Lloyd, etc.)
   - Numéro de réservation/booking si mentionné
   - Date de départ navire prévue
   - ETA (Estimated Time of Arrival)

Réponds en JSON:
{
  "quotation_found": true/false,
  "quotation_date": "ISO date",
  "carrier": "string | null - Compagnie maritime identifiée",
  "booking_reference": "string | null - Numéro de réservation",
  "departure_date": "string | null - Date départ navire (ISO)",
  "arrival_date": "string | null - ETA (ISO)",
  "tariff_lines": [
    {
      "category": "FREIGHT|PORT|TRANSPORT|CUSTOMS|OTHER",
      "service": "Description du service",
      "amount": N,
      "currency": "EUR|USD|XOF",
      "unit": "per_container|per_tonne|per_cbm|lumpsum",
      "container_types": ["20'", "40'", "40HC"],
      "notes": ""
    }
  ],
  "totals": {
    "by_category": { "FREIGHT": N, "PORT": N, ... },
    "grand_total": N,
    "currency": ""
  },
  "conditions": {
    "validity_days": N,
    "inclusions": [],
    "exclusions": [],
    "payment_terms": ""
  },
  "matching_criteria": {
    "container_types": [],
    "destination_port": "",
    "destination_city": "",
    "terminal": "",
    "corridor": "",
    "cargo_category": "DRY|DG|OOG|REEFER"
  },
  "quotation_template": "Structure type détectée",
  "confidence": 0.0-1.0
}`
  },

  extract_negotiation: {
    name: "Résultat négociation",
    weight: 20,
    prompt: `Analyse le résultat de la négociation dans ce fil de discussion.

Identifie:
1. **Acceptation/Refus** de l'offre
2. **Contre-offres** et révisions demandées
3. **Révisions** effectuées par l'agent
4. **Décision finale** du client

Réponds en JSON:
{
  "negotiation_occurred": true/false,
  "rounds": [
    {
      "round": N,
      "client_feedback": "Feedback du client",
      "revision_requested": [],
      "agent_response": "Réponse de l'agent",
      "date": "ISO date"
    }
  ],
  "final_outcome": "accepted|rejected|pending|negotiating",
  "accepted_amount": N,
  "accepted_currency": "",
  "concessions_made": [
    { "original": N, "final": N, "service": "", "reason": "" }
  ],
  "negotiation_patterns": {
    "avg_response_time_hours": N,
    "total_duration_days": N,
    "key_objections": [],
    "winning_arguments": []
  },
  "confidence": 0.0-1.0
}`
  },

  extract_contacts: {
    name: "Contacts enrichis",
    weight: 15,
    prompt: `Extrais les informations de contact enrichies depuis ce fil de discussion.

Pour chaque participant identifié:
1. **Nom complet** et titre
2. **Email** et téléphone
3. **Entreprise** et rôle
4. **Préférences** observées (mode de communication, langue, etc.)
5. **Historique** avec cette personne

Réponds en JSON:
{
  "contacts": [
    {
      "email": "",
      "name": "",
      "company": "",
      "role": "client|agent|partner|carrier|forwarder",
      "title": "",
      "phone": "",
      "country": "",
      "language_preference": "fr|en|ar",
      "communication_style": "formal|casual|technical",
      "decision_maker": true/false,
      "preferences": [],
      "notes": ""
    }
  ],
  "relationships": [
    { "from": "email1", "to": "email2", "relationship": "works_with|reports_to|client_of" }
  ]
}`
  }
};

const PHASE_ORDER = ["extract_request", "extract_clarifications", "extract_quotation", "extract_negotiation", "extract_contacts"];

interface PuzzleResult {
  phase: string;
  success: boolean;
  data: unknown;
  error?: string;
}

interface PuzzleState {
  thread_id: string;
  email_count: number;
  attachment_count: number;
  phases_completed: string[];
  puzzle_completeness: number;
  cargo: unknown;
  routing: unknown;
  timing: unknown;
  tariff_lines: unknown[];
  matching_criteria: unknown;
  contacts: unknown[];
  negotiation: unknown;
  missing_info: string[];
  carrier?: string;
  booking_reference?: string;
  departure_date?: string;
  arrival_date?: string;
}

// Helper functions
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message, success: false }, status);
}

// Extract user ID from JWT
async function getUserIdFromRequest(req: Request, supabaseUrl: string, supabaseAnonKey: string): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  
  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } }
  });
  
  const { data: { user } } = await anonClient.auth.getUser();
  return user?.id || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Phase S0: Auth guard (replaces getUserIdFromRequest — no more anonymous mode)
  const authResult = await requireUser(req);
  if (authResult instanceof Response) return authResult;
  const { user: authUser } = authResult;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

  if (!lovableApiKey) {
    return errorResponse("LOVABLE_API_KEY not configured", 500);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { threadId, emailId, mode = "sync", job_id, forceRefresh = false, phases = null } = body;

    // User ID from auth guard (no more null/anonymous)
    const userId = authUser.id as string;

    // ============================================
    // MODE: START - Create job and launch worker
    // ============================================
    if (mode === "start") {
      if (!threadId) {
        return errorResponse("threadId required for start mode", 400);
      }
      if (!userId) {
        return errorResponse("Authentication required", 401);
      }

      // Check for existing active job (anti-doublon)
      const { data: existingJob } = await supabase
        .from("puzzle_jobs")
        .select("id, status, progress, current_phase")
        .eq("thread_id", threadId)
        .eq("created_by", userId)
        .in("status", ["pending", "running"])
        .maybeSingle();

      if (existingJob) {
        return jsonResponse({
          job_id: existingJob.id,
          status: existingJob.status,
          progress: existingJob.progress,
          current_phase: existingJob.current_phase,
          message: "Job déjà en cours"
        });
      }

      // Create new job
      const { data: newJob, error: createError } = await supabase
        .from("puzzle_jobs")
        .insert({
          thread_id: threadId,
          email_id: emailId || null,
          status: "running",
          created_by: userId,
          started_at: new Date().toISOString(),
          last_heartbeat: new Date().toISOString()
        })
        .select("id")
        .single();

      if (createError) {
        console.error("[Puzzle] Failed to create job:", createError);
        return errorResponse(`Failed to create job: ${createError.message}`, 500);
      }

      console.log(`[Puzzle] Created job ${newJob.id} for thread ${threadId}`);

      // Launch background worker (best-effort via waitUntil)
      // @ts-ignore - EdgeRuntime is available in Deno Deploy
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(
          processAllPhases(supabase, lovableApiKey, newJob.id, threadId)
        );
      } else {
        // Fallback: process first phase synchronously, rest will be via tick
        console.log("[Puzzle] EdgeRuntime.waitUntil not available, starting first phase...");
        processAllPhases(supabase, lovableApiKey, newJob.id, threadId).catch(e => {
          console.error("[Puzzle] Background worker error:", e);
        });
      }

      return jsonResponse({
        job_id: newJob.id,
        status: "started",
        message: "Analyse démarrée en arrière-plan"
      });
    }

    // ============================================
    // MODE: POLL - Get job status
    // ============================================
    if (mode === "poll" && job_id) {
      const { data: job, error: jobError } = await supabase
        .from("puzzle_jobs")
        .select("*")
        .eq("id", job_id)
        .single();

      if (jobError || !job) {
        return errorResponse("Job not found", 404);
      }

      // Detect stale job (heartbeat > 2 min without completion)
      const staleThreshold = 2 * 60 * 1000; // 2 minutes
      const isStale = job.status === "running" &&
        (Date.now() - new Date(job.last_heartbeat).getTime() > staleThreshold);

      return jsonResponse({
        ...job,
        is_stale: isStale,
        can_resume: isStale && job.status === "running"
      });
    }

    // ============================================
    // MODE: TICK - Execute single phase (resume)
    // ============================================
    if (mode === "tick" && job_id) {
      const { data: job, error: jobError } = await supabase
        .from("puzzle_jobs")
        .select("*")
        .eq("id", job_id)
        .single();

      if (jobError || !job) {
        return errorResponse("Job not found", 404);
      }

      if (job.status === "cancelled") {
        return jsonResponse({ cancelled: true, job_id });
      }
      if (job.status === "completed") {
        return jsonResponse(job);
      }
      if (job.status === "failed") {
        return jsonResponse(job);
      }

      // Execute single phase
      const result = await runSinglePhase(supabase, lovableApiKey, job);
      return jsonResponse(result);
    }

    // ============================================
    // MODE: CANCEL - Stop the job
    // ============================================
    if (mode === "cancel" && job_id) {
      // Use service_role since worker writes, but verify ownership first
      if (userId) {
        const { data: job } = await supabase
          .from("puzzle_jobs")
          .select("created_by")
          .eq("id", job_id)
          .single();

        // Mono-tenant app: all authenticated users can cancel any job
        // Ownership check removed — JWT auth is sufficient
      }

      await supabase
        .from("puzzle_jobs")
        .update({ status: "cancelled" })
        .eq("id", job_id);

      return jsonResponse({ cancelled: true, job_id });
    }

    // ============================================
    // MODE: SYNC (legacy) - Full synchronous processing
    // ============================================
    if (!threadId && !emailId) {
      return errorResponse("threadId or emailId required", 400);
    }

    // Determine thread from emailId if needed
    let targetThreadId = threadId;
    if (!targetThreadId && emailId) {
      const { data: email } = await supabase
        .from("emails")
        .select("thread_ref")
        .eq("id", emailId)
        .single();

      targetThreadId = email?.thread_ref || emailId;
    }

    console.log(`[Puzzle] Starting SYNC analysis for thread: ${targetThreadId}`);

    // Load thread data
    const { emails, attachments } = await loadThreadData(supabase, supabaseUrl, supabaseKey, targetThreadId);
    const threadContent = buildThreadContent(emails, attachments);

    // Run all phases synchronously
    const phasesToRun = phases || PHASE_ORDER;
    const results: PuzzleResult[] = [];

    for (const phaseName of phasesToRun) {
      const phase = PUZZLE_PHASES[phaseName as keyof typeof PUZZLE_PHASES];
      if (!phase) continue;

      console.log(`[Puzzle] Running phase: ${phaseName}`);

      try {
        const phaseResult = await runPhase(lovableApiKey, phaseName, phase.prompt, threadContent);
        results.push({ phase: phaseName, success: true, data: phaseResult });
      } catch (error) {
        console.error(`[Puzzle] Phase ${phaseName} failed:`, error);
        results.push({ phase: phaseName, success: false, data: null, error: String(error) });
      }
    }

    // Build puzzle state
    const puzzleState = buildPuzzleState(targetThreadId, emails, attachments, results);

    // Store knowledge
    const emailIds = (emails as Array<{ id: string }>).map(e => e.id);
    const storedCount = await storeKnowledge(supabase, puzzleState, targetThreadId, emailIds, attachments);

    console.log(`[Puzzle] SYNC analysis complete. Stored ${storedCount} knowledge items`);

    return jsonResponse({
      success: true,
      thread_id: targetThreadId,
      email_count: emails.length,
      attachment_count: attachments.length,
      phases_completed: results.filter(r => r.success).map(r => r.phase),
      puzzle: puzzleState,
      knowledge_stored: storedCount,
    });

  } catch (error) {
    console.error("[Puzzle] Error:", error);
    return errorResponse(String(error), 500);
  }
});

// ============================================
// BACKGROUND WORKER: Process all phases
// ============================================
async function processAllPhases(
  supabase: SupabaseClient,
  apiKey: string,
  jobId: string,
  threadId: string
) {
  const startTime = Date.now();
  let currentPhase = "";
  
  try {
    // Load thread data
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Phase B: Check for previously analyzed emails to enable incremental processing
    // Phase B: Check for previously analyzed emails + their puzzle to enable incremental processing
    const { data: previousJob } = await supabase
      .from("puzzle_jobs")
      .select("emails_analyzed_ids, final_puzzle, knowledge_stored")
      .eq("thread_id", threadId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const previouslyAnalyzedIds: string[] = previousJob?.emails_analyzed_ids || [];
    console.log(`[Puzzle] Thread ${threadId}: ${previouslyAnalyzedIds.length} emails previously analyzed`);

    // Load all thread data
    const { emails: allEmails, attachments: allAttachments } = await loadThreadData(supabase, supabaseUrl, supabaseKey, threadId);
    const allEmailIds = (allEmails as Array<{ id: string }>).map(e => e.id);
    
    // Phase B: Filter to only new emails not previously analyzed
    const previousSet = new Set(previouslyAnalyzedIds);
    const newEmails = (allEmails as Array<{ id: string }>).filter(e => !previousSet.has(e.id));
    const newAttachments = (allAttachments as Array<{ email_id: string }>).filter(a => 
      newEmails.some(e => e.id === a.email_id)
    );

    console.log(`[Puzzle] Thread has ${allEmails.length} emails total, ${newEmails.length} new (${previouslyAnalyzedIds.length} already analyzed)`);

    // Phase B: Skip if no new emails (early exit) - reuse previous puzzle
    if (newEmails.length === 0 && previouslyAnalyzedIds.length > 0) {
      console.log(`[Puzzle] No new emails for thread ${threadId}, reusing previous puzzle (no-op)`);
      await updateJob(supabase, jobId, {
        status: "completed",
        progress: 100,
        current_phase: null,
        completed_at: new Date().toISOString(),
        final_puzzle: previousJob?.final_puzzle || null,
        knowledge_stored: previousJob?.knowledge_stored || 0,
        emails_analyzed_ids: previouslyAnalyzedIds,
        duration_ms: Date.now() - startTime
      });
      return;
    }

    // Build content from NEW emails only (but include all for context if needed)
    const threadContent = buildThreadContent(newEmails.length > 0 ? newEmails : allEmails, newAttachments);

    // Update job with counts
    await updateJob(supabase, jobId, {
      email_count: allEmails.length,
      attachment_count: allAttachments.length,
      last_heartbeat: new Date().toISOString()
    });

    const partialResults: Record<string, unknown> = {};
    const completedPhases: string[] = [];
    let currentProgress = 0;

    // Process each phase
    for (const phaseName of PHASE_ORDER) {
      // Check for cancellation BEFORE each phase
      const { data: jobStatus } = await supabase
        .from("puzzle_jobs")
        .select("status")
        .eq("id", jobId)
        .single();

      if (jobStatus?.status === "cancelled") {
        console.log(`[Puzzle] Job ${jobId} cancelled, stopping worker`);
        return;
      }

      currentPhase = phaseName;
      const phase = PUZZLE_PHASES[phaseName as keyof typeof PUZZLE_PHASES];

      // Update current phase + heartbeat
      await updateJob(supabase, jobId, {
        current_phase: phaseName,
        last_heartbeat: new Date().toISOString()
      });

      console.log(`[Puzzle] Job ${jobId}: Running phase ${phaseName}`);

      try {
        // Execute phase
        const phaseResult = await runPhase(apiKey, phaseName, phase.prompt, threadContent);
        
        // Persist IMMEDIATELY after each phase
        partialResults[phaseName] = phaseResult;
        completedPhases.push(phaseName);
        currentProgress += phase.weight;

        await updateJob(supabase, jobId, {
          progress: currentProgress,
          phases_completed: completedPhases,
          partial_results: partialResults,
          last_heartbeat: new Date().toISOString()
        });

        console.log(`[Puzzle] Job ${jobId}: Phase ${phaseName} complete (${currentProgress}%)`);
      } catch (phaseError) {
        console.error(`[Puzzle] Job ${jobId}: Phase ${phaseName} failed:`, phaseError);
        // Continue to next phase, don't fail the whole job
        partialResults[phaseName] = { error: String(phaseError) };
      }
    }

    // Build final puzzle state (using ALL emails for complete picture)
    const results: PuzzleResult[] = PHASE_ORDER.map(p => ({
      phase: p,
      success: !!partialResults[p] && !(partialResults[p] as { error?: string }).error,
      data: partialResults[p]
    }));
    
    const finalPuzzle = buildPuzzleState(threadId, allEmails, allAttachments, results);

    // Store knowledge
    const storedCount = await storeKnowledge(supabase, finalPuzzle, threadId, allEmailIds, allAttachments);

    // Mark as completed - save ALL email IDs as analyzed for future incremental runs
    const duration = Date.now() - startTime;
    await updateJob(supabase, jobId, {
      status: "completed",
      progress: 100,
      current_phase: null,
      final_puzzle: finalPuzzle,
      knowledge_stored: storedCount,
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      emails_analyzed_ids: allEmailIds  // Phase B: Track ALL emails now analyzed
    });

    console.log(`[Puzzle] Job ${jobId} completed in ${duration}ms. Stored ${storedCount} knowledge items. Analyzed ${allEmailIds.length} emails.`);

  } catch (error) {
    console.error(`[Puzzle] Job ${jobId} failed:`, error);
    await updateJob(supabase, jobId, {
      status: "failed",
      error_message: String(error),
      error_phase: currentPhase || null
    });
  }
}

// ============================================
// TICK MODE: Execute single phase
// ============================================
async function runSinglePhase(
  supabase: SupabaseClient,
  apiKey: string,
  job: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const jobId = job.id as string;
  const threadId = job.thread_id as string;
  const completedPhases = (job.phases_completed as string[]) || [];
  const partialResults = (job.partial_results as Record<string, unknown>) || {};
  const attempt = (job.attempt as number) || 1;

  const nextPhaseIndex = completedPhases.length;

  // All phases done, finalize
  if (nextPhaseIndex >= PHASE_ORDER.length) {
    return await finalizeJob(supabase, job);
  }

  const nextPhaseName = PHASE_ORDER[nextPhaseIndex];
  const phase = PUZZLE_PHASES[nextPhaseName as keyof typeof PUZZLE_PHASES];

  console.log(`[Puzzle] Tick: Job ${jobId} executing phase ${nextPhaseName} (attempt ${attempt + 1})`);

  try {
    // Load thread content
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const { emails, attachments } = await loadThreadData(supabase, supabaseUrl, supabaseKey, threadId);
    const threadContent = buildThreadContent(emails, attachments);

    // Execute phase
    const phaseResult = await runPhase(apiKey, nextPhaseName, phase.prompt, threadContent);

    // Update job
    const newCompletedPhases = [...completedPhases, nextPhaseName];
    const newPartialResults = { ...partialResults, [nextPhaseName]: phaseResult };
    const progress = newCompletedPhases.reduce((sum, p) => {
      const ph = PUZZLE_PHASES[p as keyof typeof PUZZLE_PHASES];
      return sum + (ph?.weight || 0);
    }, 0);

    await updateJob(supabase, jobId, {
      current_phase: PHASE_ORDER[nextPhaseIndex + 1] || null,
      phases_completed: newCompletedPhases,
      partial_results: newPartialResults,
      progress,
      last_heartbeat: new Date().toISOString(),
      attempt: attempt + 1
    });

    return {
      job_id: jobId,
      phase_completed: nextPhaseName,
      progress,
      phases_remaining: PHASE_ORDER.length - newCompletedPhases.length,
      status: newCompletedPhases.length >= PHASE_ORDER.length ? "completing" : "running"
    };

  } catch (error) {
    console.error(`[Puzzle] Tick failed for phase ${nextPhaseName}:`, error);
    
    // Store error but don't fail job - let next tick retry or skip
    await updateJob(supabase, jobId, {
      error_message: String(error),
      error_phase: nextPhaseName,
      last_heartbeat: new Date().toISOString(),
      attempt: attempt + 1
    });

    return {
      job_id: jobId,
      error: String(error),
      phase_failed: nextPhaseName,
      can_retry: true
    };
  }
}

// Finalize a completed job
async function finalizeJob(
  supabase: SupabaseClient,
  job: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const jobId = job.id as string;
  const threadId = job.thread_id as string;
  const partialResults = (job.partial_results as Record<string, unknown>) || {};
  const startedAt = job.started_at as string;

  console.log(`[Puzzle] Finalizing job ${jobId}`);

  // Load data for final puzzle
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  
  const { emails, attachments } = await loadThreadData(supabase, supabaseUrl, supabaseKey, threadId);

  // Build puzzle state
  const results: PuzzleResult[] = PHASE_ORDER.map(p => ({
    phase: p,
    success: !!partialResults[p] && !(partialResults[p] as { error?: string }).error,
    data: partialResults[p]
  }));
  
  const finalPuzzle = buildPuzzleState(threadId, emails, attachments, results);

  // Store knowledge
  const emailIds = (emails as Array<{ id: string }>).map(e => e.id);
  const storedCount = await storeKnowledge(supabase, finalPuzzle, threadId, emailIds, attachments);

  // Calculate duration
  const duration = startedAt ? Date.now() - new Date(startedAt).getTime() : null;

  // Update job
  await updateJob(supabase, jobId, {
    status: "completed",
    progress: 100,
    current_phase: null,
    final_puzzle: finalPuzzle,
    knowledge_stored: storedCount,
    completed_at: new Date().toISOString(),
    duration_ms: duration
  });

  return {
    job_id: jobId,
    status: "completed",
    final_puzzle: finalPuzzle,
    knowledge_stored: storedCount,
    duration_ms: duration
  };
}

// Update job in database
async function updateJob(
  supabase: SupabaseClient,
  jobId: string,
  updates: Record<string, unknown>
) {
  const { error } = await supabase
    .from("puzzle_jobs")
    .update(updates)
    .eq("id", jobId);

  if (error) {
    console.error(`[Puzzle] Failed to update job ${jobId}:`, error);
  }
}

// ============================================
// DATA LOADING
// ============================================

// Type pour traçabilité de l'origine des emails dans le puzzle
type EmailSourceType = 'thread_ref' | 'subject_match';

interface EnrichedEmail {
  id: string;
  from_address: string;
  to_addresses: string[];
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  sent_at: string | null;
  received_at: string | null;
  thread_ref: string | null;
  source_type: EmailSourceType;
}

async function loadThreadData(
  supabase: SupabaseClient,
  supabaseUrl: string,
  supabaseKey: string,
  threadId: string
): Promise<{ emails: EnrichedEmail[]; attachments: unknown[] }> {
  // Fetch all emails in thread (NIVEAU 1 - SOURCE: emails métier stricts)
  const { data: emails, error: emailsError } = await supabase
    .from("emails")
    .select(`
      id, 
      from_address, 
      to_addresses, 
      subject, 
      body_text, 
      body_html, 
      sent_at, 
      received_at,
      thread_ref
    `)
    .or(`thread_ref.eq.${threadId},id.eq.${threadId}`)
    .order("sent_at", { ascending: true });

  if (emailsError) throw emailsError;

  // Marquer les emails SOURCE avec source_type: 'thread_ref'
  let allEmails: EnrichedEmail[] = (emails || []).map(e => ({
    ...e,
    source_type: 'thread_ref' as EmailSourceType
  }));
  
  // NIVEAU 2 - CONTEXTE: emails par sujet approché (aide IA)
  if (allEmails.length > 0) {
    const sampleSubject = allEmails[0].subject || "";
    const normalizedSubject = normalizeSubject(sampleSubject);
    
    const { data: relatedEmails } = await supabase
      .from("emails")
      .select(`
        id, 
        from_address, 
        to_addresses, 
        subject, 
        body_text, 
        body_html, 
        sent_at, 
        received_at,
        thread_ref
      `)
      .ilike("subject", `%${normalizedSubject.substring(0, 50)}%`)
      .order("sent_at", { ascending: true });

    if (relatedEmails) {
      const existingIds = new Set(allEmails.map(e => e.id));
      for (const email of relatedEmails) {
        if (!existingIds.has(email.id)) {
          // Marquer les emails CONTEXTE avec source_type: 'subject_match'
          allEmails.push({
            ...email,
            source_type: 'subject_match' as EmailSourceType
          });
        }
      }
      allEmails.sort((a, b) => 
        new Date(a.sent_at || 0).getTime() - new Date(b.sent_at || 0).getTime()
      );
    }
  }

  // Log de traçabilité pour audit
  const sourceCount = allEmails.filter(e => e.source_type === 'thread_ref').length;
  const contextCount = allEmails.filter(e => e.source_type === 'subject_match').length;
  console.log(`[Puzzle] Thread ${threadId}: ${sourceCount} source + ${contextCount} context = ${allEmails.length} total emails`);

  // Fetch attachments
  const emailIds = allEmails.map((e: { id: string }) => e.id);
  let attachments: unknown[] = [];
  
  if (emailIds.length > 0) {
    const { data: initialAttachments } = await supabase
      .from("email_attachments")
      .select(`
        id,
        email_id,
        filename,
        content_type,
        extracted_text,
        extracted_data,
        is_analyzed,
        storage_path
      `)
      .in("email_id", emailIds);

    attachments = initialAttachments || [];

    // Identify unanalyzed PDF/Excel attachments
    const unanalyzedPdfs = (attachments as Array<{ filename?: string; content_type?: string; is_analyzed?: boolean; storage_path?: string }>).filter(a => {
      const filename = a.filename?.toLowerCase() || "";
      const contentType = a.content_type?.toLowerCase() || "";
      const isPdfOrExcel = 
        contentType.includes("pdf") || 
        contentType.includes("spreadsheet") || 
        contentType.includes("excel") ||
        contentType.includes("sheet") ||
        filename.endsWith('.pdf') || 
        filename.endsWith('.xlsx') || 
        filename.endsWith('.xls');
      return isPdfOrExcel && !a.is_analyzed && a.storage_path;
    });

    // Auto-analyze (max 5)
    if (unanalyzedPdfs.length > 0) {
      console.log(`[Puzzle] Analyzing ${unanalyzedPdfs.length} unanalyzed attachments...`);
      
      const toAnalyze = unanalyzedPdfs.slice(0, 5);
      
      for (const att of toAnalyze) {
        try {
          const response = await fetch(`${supabaseUrl}/functions/v1/analyze-attachments`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ attachmentId: (att as { id: string }).id, mode: 'sync' })
          });
          
          if (response.ok) {
            console.log(`[Puzzle] Analyzed ${(att as { filename: string }).filename}`);
          }
        } catch (e) {
          console.error(`[Puzzle] Failed to analyze ${(att as { filename: string }).filename}:`, e);
        }
      }
      
      // Re-fetch attachments
      const { data: refreshedAttachments } = await supabase
        .from("email_attachments")
        .select(`
          id,
          email_id,
          filename,
          content_type,
          extracted_text,
          extracted_data,
          is_analyzed,
          storage_path
        `)
        .in("email_id", emailIds);
      
      attachments = refreshedAttachments || [];
    }
  }

  // Filter relevant attachments
  const relevantAttachments = (attachments as Array<{ filename?: string; content_type?: string; is_analyzed?: boolean; extracted_data?: { type?: string; tariff_lines?: unknown }; extracted_text?: string }>).filter(a => {
    const filename = a.filename?.toLowerCase() || "";
    const contentType = a.content_type?.toLowerCase() || "";
    
    if (contentType.includes("pdf") || 
        contentType.includes("spreadsheet") || 
        contentType.includes("excel") ||
        contentType.includes("sheet") ||
        filename.endsWith(".pdf") || 
        filename.endsWith(".xlsx") || 
        filename.endsWith(".xls")) {
      return true;
    }
    
    if (contentType.startsWith("image/")) {
      if (filename.includes("image00") || 
          filename.includes("~wrd") || 
          filename.startsWith("~") || 
          filename.match(/^image\d+\.(jpg|png|gif)$/i) ||
          a.extracted_data?.type === "signature") {
        return false;
      }
      return !!(a.extracted_data?.tariff_lines || (a.extracted_text && a.extracted_text.length > 100));
    }
    
    return a.is_analyzed === true;
  });

  return { emails: allEmails, attachments: relevantAttachments };
}

// ============================================
// AI PHASE EXECUTION
// ============================================
async function runPhase(
  apiKey: string,
  phaseName: string,
  prompt: string,
  threadContent: string
): Promise<unknown> {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: threadContent }
      ],
      response_format: { type: "json_object" }
    }),
  });

  if (!response.ok) {
    throw new Error(`AI error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "{}";

  try {
    return JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error("Invalid JSON response from AI");
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================
function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(Re|Fwd|Fw|Tr):\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildThreadContent(emails: unknown[], attachments: unknown[]): string {
  const sortedEmails = [...emails].sort((a: unknown, b: unknown) => 
    new Date((a as { sent_at: string }).sent_at).getTime() - new Date((b as { sent_at: string }).sent_at).getTime()
  );

  let content = `=== FIL DE DISCUSSION: ${sortedEmails.length} EMAILS ===\n\n`;

  for (let i = 0; i < sortedEmails.length; i++) {
    const email = sortedEmails[i] as { sent_at: string; from_address: string; to_addresses?: string[]; subject: string; body_text?: string; body_html?: string };
    content += `--- EMAIL ${i + 1}/${sortedEmails.length} ---\n`;
    content += `DATE: ${email.sent_at}\n`;
    content += `DE: ${email.from_address}\n`;
    content += `À: ${email.to_addresses?.join(", ") || "N/A"}\n`;
    content += `SUJET: ${email.subject}\n\n`;
    content += `CONTENU:\n${email.body_text || stripHtml(email.body_html || null) || "(vide)"}\n\n`;
  }

  if (attachments.length > 0) {
    content += "\n=== PIÈCES JOINTES ANALYSÉES ===\n\n";
    
    for (const att of attachments as Array<{ filename: string; extracted_text?: string; extracted_data?: { tariff_lines?: unknown; transport_rates?: unknown } }>) {
      content += `--- ${att.filename} ---\n`;
      if (att.extracted_text) {
        content += `${att.extracted_text.substring(0, 3000)}\n`;
      }
      if (att.extracted_data?.tariff_lines) {
        content += `TARIFS EXTRAITS: ${JSON.stringify(att.extracted_data.tariff_lines, null, 2)}\n`;
      }
      if (att.extracted_data?.transport_rates) {
        content += `TARIFS TRANSPORT: ${JSON.stringify(att.extracted_data.transport_rates, null, 2)}\n`;
      }
      content += "\n";
    }
  }

  return content;
}

function stripHtml(html: string | null): string {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPuzzleState(
  threadId: string,
  emails: unknown[],
  attachments: unknown[],
  results: PuzzleResult[]
): PuzzleState {
  const state: PuzzleState = {
    thread_id: threadId,
    email_count: emails.length,
    attachment_count: attachments.length,
    phases_completed: results.filter(r => r.success).map(r => r.phase),
    puzzle_completeness: 0,
    cargo: null,
    routing: null,
    timing: null,
    tariff_lines: [],
    matching_criteria: null,
    contacts: [],
    negotiation: null,
    missing_info: [],
    carrier: undefined,
    booking_reference: undefined,
    departure_date: undefined,
    arrival_date: undefined,
  };

  for (const result of results) {
    if (!result.success || !result.data) continue;
    const data = result.data as Record<string, unknown>;

    switch (result.phase) {
      case "extract_request":
        state.cargo = data.cargo;
        state.routing = data.routing;
        state.timing = data.timing;
        if (Array.isArray(data.missing_info)) {
          state.missing_info.push(...data.missing_info as string[]);
        }
        break;

      case "extract_clarifications":
        if (data.puzzle_updates) {
          const updates = data.puzzle_updates as Record<string, unknown>;
          state.cargo = { ...(state.cargo as object || {}), ...(updates.cargo as object || {}) };
          state.routing = { ...(state.routing as object || {}), ...(updates.routing as object || {}) };
          state.timing = { ...(state.timing as object || {}), ...(updates.timing as object || {}) };
        }
        break;

      case "extract_quotation":
        if (data.quotation_found) {
          state.tariff_lines = (data.tariff_lines as unknown[]) || [];
          state.matching_criteria = data.matching_criteria;
          state.carrier = (data.carrier as string) || undefined;
          state.booking_reference = (data.booking_reference as string) || undefined;
          state.departure_date = (data.departure_date as string) || undefined;
          state.arrival_date = (data.arrival_date as string) || undefined;
        }
        break;

      case "extract_negotiation":
        state.negotiation = {
          occurred: data.negotiation_occurred,
          outcome: data.final_outcome,
          accepted_amount: data.accepted_amount,
          patterns: data.negotiation_patterns,
        };
        break;

      case "extract_contacts":
        state.contacts = (data.contacts as unknown[]) || [];
        break;
    }
  }

  // Calculate completeness
  let score = 0;
  if (state.cargo) score += 20;
  if (state.routing) score += 20;
  if (state.timing) score += 10;
  if (state.tariff_lines.length > 0) score += 30;
  if (state.matching_criteria) score += 10;
  if ((state.negotiation as Record<string, unknown>)?.outcome) score += 10;
  
  state.puzzle_completeness = score;

  return state;
}

// Store knowledge (abbreviated - same logic as original)
async function storeKnowledge(
  supabase: SupabaseClient,
  puzzle: PuzzleState,
  threadId: string,
  emailIds: string[],
  attachments: unknown[] = []
): Promise<number> {
  let stored = 0;

  // Store tariff lines
  for (const line of puzzle.tariff_lines as Array<{ amount?: number; service?: string; category?: string; currency?: string }>) {
    if (!line.amount || line.amount <= 0) continue;

    const name = `${line.service} - ${(puzzle.matching_criteria as Record<string, unknown>)?.destination_port || ""}`;
    
    const { error } = await supabase
      .from("learned_knowledge")
      .upsert({
        category: "tarif",
        name: name.substring(0, 100),
        description: `${line.category}: ${line.service}`,
        data: {
          ...line,
          carrier: puzzle.carrier,
          source_thread: threadId,
          extracted_from_puzzle: true,
        },
        matching_criteria: puzzle.matching_criteria,
        source_type: "email",
        source_id: emailIds[0],
        confidence: 0.85,
        is_validated: false,
        knowledge_type: "historical_tariff",
      }, { onConflict: "name,category", ignoreDuplicates: false });

    if (!error) stored++;
  }

  // Store contacts
  for (const contact of puzzle.contacts as Array<{ email?: string; name?: string; company?: string; role?: string; country?: string; notes?: string }>) {
    if (!contact.email) continue;

    const { error } = await supabase
      .from("contacts")
      .upsert({
        email: contact.email,
        name: contact.name,
        company: contact.company,
        role: contact.role,
        country: contact.country,
        notes: contact.notes,
        is_trusted: contact.role === "partner" || contact.role === "carrier",
      }, { onConflict: "email" });

    if (!error) stored++;
  }

  // Store quotation exchange
  if (puzzle.tariff_lines.length > 0) {
    const totalAmount = (puzzle.tariff_lines as Array<{ amount?: number }>).reduce((sum, l) => sum + (l.amount || 0), 0);
    
    await supabase
      .from("learned_knowledge")
      .upsert({
        category: "quotation_exchange",
        name: `Cotation ${(puzzle.routing as Record<string, unknown>)?.destination_city || "Unknown"} - Thread ${threadId.substring(0, 8)}`,
        description: `Cotation complète: ${puzzle.tariff_lines.length} lignes, ${totalAmount} ${(puzzle.tariff_lines[0] as { currency?: string })?.currency || "EUR"}`,
        data: {
          cargo: puzzle.cargo,
          routing: puzzle.routing,
          timing: puzzle.timing,
          carrier: puzzle.carrier,
          booking_reference: puzzle.booking_reference,
          departure_date: puzzle.departure_date,
          arrival_date: puzzle.arrival_date,
          tariff_summary: {
            line_count: puzzle.tariff_lines.length,
            total_amount: totalAmount,
            currency: (puzzle.tariff_lines[0] as { currency?: string })?.currency,
          },
          negotiation: puzzle.negotiation,
          source_thread: threadId,
          email_count: puzzle.email_count,
          attachment_count: puzzle.attachment_count,
        },
        matching_criteria: puzzle.matching_criteria,
        source_type: "email",
        source_id: emailIds[0],
        confidence: puzzle.puzzle_completeness / 100,
        is_validated: false,
        knowledge_type: "complete_quotation",
      }, { onConflict: "name,category" });

    stored++;
  }

  // Store carrier if detected
  if (puzzle.carrier) {
    const carrierName = puzzle.carrier.toUpperCase().includes("CMA") ? "CMA CGM" : puzzle.carrier;
    
    const { error } = await supabase
      .from("learned_knowledge")
      .upsert({
        category: "carrier",
        name: `Armateur: ${carrierName}`,
        description: `Compagnie maritime pour ${(puzzle.routing as Record<string, unknown>)?.origin_city || ""} → ${(puzzle.routing as Record<string, unknown>)?.destination_city || ""}`,
        data: {
          carrier_name: carrierName,
          route: {
            origin: (puzzle.routing as Record<string, unknown>)?.origin_city,
            destination: (puzzle.routing as Record<string, unknown>)?.destination_city,
          },
          booking_reference: puzzle.booking_reference,
          departure_date: puzzle.departure_date,
          arrival_date: puzzle.arrival_date,
          source_thread_id: threadId,
        },
        matching_criteria: {
          origin_port: (puzzle.routing as Record<string, unknown>)?.origin_city,
          destination_port: (puzzle.routing as Record<string, unknown>)?.destination_port || (puzzle.routing as Record<string, unknown>)?.destination_city,
          mode: "maritime",
        },
        source_type: "email",
        source_id: emailIds[0],
        confidence: 0.85,
        is_validated: false,
        knowledge_type: "carrier_info",
      }, { onConflict: "name,category" });

    if (!error) stored++;
  }

  // Store tariff lines from attachments
  for (const att of attachments as Array<{ id: string; filename: string; extracted_data?: { tariff_lines?: Array<{ amount?: number; service?: string; description?: string; currency?: string; unit?: string; details?: string; notes?: string; container_types?: string[] }> } }>) {
    if (!att.extracted_data?.tariff_lines) continue;
    
    for (const line of att.extracted_data.tariff_lines) {
      if (!line.amount || line.amount <= 0) continue;
      
      const lineName = `${line.service || line.description || "Service"} - ${(puzzle.routing as Record<string, unknown>)?.destination_port || (puzzle.routing as Record<string, unknown>)?.destination_city || "Export"}`;
      
      const { error } = await supabase
        .from("learned_knowledge")
        .upsert({
          category: "tarif",
          name: lineName.substring(0, 100),
          description: `Tarif extrait de ${att.filename}`,
          data: {
            service: line.service || line.description,
            montant: line.amount,
            devise: line.currency || "FCFA",
            unite: line.unit,
            details: line.details || line.notes,
            carrier: puzzle.carrier,
            source_document: att.filename,
            source_thread_id: threadId,
          },
          matching_criteria: {
            destination: (puzzle.routing as Record<string, unknown>)?.destination_city || (puzzle.routing as Record<string, unknown>)?.destination_port,
            container_type: (puzzle.cargo as Record<string, unknown>)?.container_type || line.container_types?.[0],
            mode: "maritime",
          },
          source_type: "document",
          source_id: att.id,
          confidence: 0.95,
          is_validated: false,
          knowledge_type: "document_extracted_tariff",
        }, { onConflict: "name,category" });

      if (!error) stored++;
    }
  }

  return stored;
}
