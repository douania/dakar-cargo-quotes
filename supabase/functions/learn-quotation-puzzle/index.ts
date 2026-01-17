import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Analysis prompts for each puzzle phase
const PUZZLE_PHASES = {
  detect_operations: {
    name: "Détection opérations distinctes",
    prompt: `Tu es un expert en logistique maritime et routière pour l'Afrique de l'Ouest.

MISSION CRITIQUE: Identifier les OPÉRATIONS LOGISTIQUES DISTINCTES dans ce fil de discussion.

Une NOUVELLE OPÉRATION est détectée quand l'un de ces éléments change SIGNIFICATIVEMENT:
1. **Référence BL/Booking** différente (ex: HLCUJE2251207250 vs HLCUJE2251207251)
2. **Type de marchandise** radicalement différent (ex: "Holy Qurans" ≠ "Dates/Dattes")
3. **Destination finale** différente (ex: "Banjul" ≠ "Dakar Embassy")
4. **Type de conteneur** incompatible (ex: "Reefer" ≠ "Dry")
5. **Client/Destinataire** différent

ATTENTION:
- Des emails avec le même sujet principal peuvent concerner des opérations DIFFÉRENTES
- Un thread Outlook peut regrouper plusieurs demandes distinctes
- Chaque conteneur avec un contenu différent = opération distincte

Réponds en JSON:
{
  "has_multiple_operations": true/false,
  "operations": [
    {
      "operation_id": "op_1",
      "cargo_type": "Description marchandise (ex: 'Holy Qurans', 'Dates/Dattes')",
      "destination": "Destination finale",
      "container_type": "Type conteneur (20' DRY, 40' REEFER, etc.)",
      "bl_reference": "Référence BL ou null",
      "email_indices": [0, 2, 4],
      "key_emails": ["indices des emails concernés"],
      "distinguishing_factors": ["Pourquoi c'est une opération distincte"]
    }
  ],
  "separation_confidence": 0.0-1.0,
  "separation_reason": "Explication de la séparation"
}`
  },

  extract_request: {
    name: "Demande initiale",
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

5. **INFORMATIONS MANQUANTES** (CRITIQUE - catégoriser précisément):

CATÉGORIE "CRITICAL" (BLOQUENT le devis):
- Poids total de l'expédition (si non mentionné)
- Nombre de colis/pièces (si non mentionné)  
- Dimensions des colis (si non mentionnées et cargo non-conteneurisé)
- Incoterm souhaité (si ambigu)
- Port/lieu de chargement précis

CATÉGORIE "IMPORTANT" (devis approximatif sans):
- Volume total CBM (si non calculable)
- Date de chargement souhaitée
- Nature exacte des marchandises (pour code douanier)
- Conditionnement précis

CATÉGORIE "OPTIONAL" (utile mais non bloquant):
- Contact destinataire
- Préférences de transport
- Assurance souhaitée ou non

Réponds en JSON:
{
  "cargo": { "description": "", "pieces": N, "weight_kg": N, "volume_cbm": N, "dimensions": [], "packaging": "", "hazardous": false, "imo_class": null },
  "routing": { "origin_city": "", "origin_country": "", "destination_city": "", "destination_site": "", "destination_country": "", "incoterm_requested": "", "transit_ports": [] },
  "timing": { "loading_date": "", "delivery_deadline": "", "urgency": "normal|urgent|critical" },
  "documents_mentioned": [],
  "missing_info": {
    "critical": ["Liste des infos BLOQUANTES pour tout devis"],
    "important": ["Liste des infos pour devis précis"],
    "optional": ["Liste des infos bonus"]
  },
  "request_type": "FCL|LCL|BREAKBULK|RORO|AIR|ROAD|MULTIMODAL",
  "confidence": 0.0-1.0
}`
  },

  extract_clarifications: {
    name: "Clarifications",
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

interface DetectedOperation {
  operation_id: string;
  cargo_type: string;
  destination: string;
  container_type: string;
  bl_reference: string | null;
  email_indices: number[];
  key_emails: string[];
  distinguishing_factors: string[];
}

interface PuzzleResult {
  phase: string;
  success: boolean;
  data: any;
  error?: string;
}

interface MissingInfoCategorized {
  critical: string[];
  important: string[];
  optional: string[];
}

interface PuzzleState {
  thread_id: string;
  email_count: number;
  attachment_count: number;
  phases_completed: string[];
  puzzle_completeness: number;
  cargo: any;
  routing: any;
  timing: any;
  tariff_lines: any[];
  matching_criteria: any;
  contacts: any[];
  negotiation: any;
  missing_info: string[];
  missing_info_categorized?: MissingInfoCategorized;
  carrier?: string;
  booking_reference?: string;
  departure_date?: string;
  arrival_date?: string;
  detected_operations?: DetectedOperation[];
  has_multiple_operations?: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

  if (!lovableApiKey) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { threadId, emailId, forceRefresh = false, phases = null } = await req.json();

    if (!threadId && !emailId) {
      throw new Error("threadId or emailId required");
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

    console.log(`[Puzzle] Starting analysis for thread: ${targetThreadId}`);

    // 1. Fetch all emails in thread
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
      .or(`thread_ref.eq.${targetThreadId},id.eq.${targetThreadId}`)
      .order("sent_at", { ascending: true });

    if (emailsError) throw emailsError;

    // Also fetch emails with matching normalized subject
    let allEmails = emails || [];
    
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
            allEmails.push(email);
          }
        }
        allEmails.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
      }
    }

    console.log(`[Puzzle] Found ${allEmails.length} emails in thread`);

    // 2. Fetch ALL attachments (not just analyzed ones - PDF/Excel are always useful)
    const emailIds = allEmails.map(e => e.id);
    let attachments: any[] = [];
    
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

    // Identify unanalyzed PDF/Excel attachments that need analysis
    const unanalyzedPdfs = attachments.filter(a => {
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

    // Automatically analyze unanalyzed attachments (max 5 to avoid timeout)
    if (unanalyzedPdfs.length > 0) {
      console.log(`[Puzzle] Analyzing ${unanalyzedPdfs.length} unanalyzed attachments first...`);
      
      const toAnalyze = unanalyzedPdfs.slice(0, 5); // Limit to 5 to avoid timeout
      
      for (const att of toAnalyze) {
        try {
          console.log(`[Puzzle] Analyzing attachment: ${att.filename} (${att.id})`);
          
          const response = await fetch(`${supabaseUrl}/functions/v1/analyze-attachments`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              attachmentId: att.id,
              mode: 'sync'
            })
          });
          
          if (response.ok) {
            const result = await response.json();
            console.log(`[Puzzle] Analyzed ${att.filename}: ${result.success ? 'OK' : 'FAILED'}`);
          } else {
            console.error(`[Puzzle] Failed to analyze ${att.filename}: HTTP ${response.status}`);
          }
        } catch (e) {
          console.error(`[Puzzle] Failed to analyze ${att.filename}:`, e);
        }
      }
      
      // Re-fetch attachments with updated extracted data
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
      console.log(`[Puzzle] Refreshed attachments after analysis`);
    }

    const relevantAttachments = attachments.filter(a => {
      const filename = a.filename?.toLowerCase() || "";
      const contentType = a.content_type?.toLowerCase() || "";
      
      // Always include PDF and Excel files - they contain quotations
      if (contentType.includes("pdf") || 
          contentType.includes("spreadsheet") || 
          contentType.includes("excel") ||
          contentType.includes("sheet") ||
          filename.endsWith(".pdf") || 
          filename.endsWith(".xlsx") || 
          filename.endsWith(".xls")) {
        return true;
      }
      
      // Filter out Outlook signature images and temp files
      if (contentType.startsWith("image/")) {
        // Exclude common signature image patterns
        if (filename.includes("image00") || 
            filename.includes("~wrd") || 
            filename.startsWith("~") || 
            filename.match(/^image\d+\.(jpg|png|gif)$/i) ||
            a.extracted_data?.type === "signature") {
          return false;
        }
        // Include images with useful extracted data
        return !!(a.extracted_data?.tariff_lines || (a.extracted_text && a.extracted_text.length > 100));
      }
      
      // Include analyzed attachments
      return a.is_analyzed === true;
    });

    // Count analyzed vs total for stats
    const analyzedCount = relevantAttachments.filter(a => a.is_analyzed).length;
    console.log(`[Puzzle] Found ${relevantAttachments.length} relevant attachments (${analyzedCount} analyzed)`);

    // 3. Build thread content for AI analysis
    const threadContent = buildThreadContent(allEmails, relevantAttachments);

    // 4. Run puzzle phases (detect_operations first, then the rest)
    const phasesToRun = phases || ["detect_operations", "extract_request", "extract_clarifications", "extract_quotation", "extract_negotiation", "extract_contacts"];
    const results: PuzzleResult[] = [];

    for (const phaseName of phasesToRun) {
      const phase = PUZZLE_PHASES[phaseName as keyof typeof PUZZLE_PHASES];
      if (!phase) continue;

      console.log(`[Puzzle] Running phase: ${phaseName}`);

      try {
        const phaseResult = await runPhase(
          lovableApiKey,
          phaseName,
          phase.prompt,
          threadContent
        );
        results.push({
          phase: phaseName,
          success: true,
          data: phaseResult,
        });
      } catch (error) {
        console.error(`[Puzzle] Phase ${phaseName} failed:`, error);
        results.push({
          phase: phaseName,
          success: false,
          data: null,
          error: String(error),
        });
      }
    }

    // 5. Build unified puzzle state
    const puzzleState = buildPuzzleState(targetThreadId, allEmails, relevantAttachments, results);

    // 6. Store extracted knowledge (including PDF/Excel tariff lines)
    const storedCount = await storeKnowledge(supabase, puzzleState, targetThreadId, emailIds, relevantAttachments);

    console.log(`[Puzzle] Analysis complete. Stored ${storedCount} knowledge items`);

    // Count analyzed attachments for response
    const finalAnalyzedCount = relevantAttachments.filter(a => a.is_analyzed).length;

    return new Response(JSON.stringify({
      success: true,
      thread_id: targetThreadId,
      email_count: allEmails.length,
      attachment_count: relevantAttachments.length,
      attachments_analyzed: finalAnalyzedCount,
      auto_analyzed: unanalyzedPdfs.length > 0 ? Math.min(unanalyzedPdfs.length, 5) : 0,
      phases_completed: results.filter(r => r.success).map(r => r.phase),
      puzzle: puzzleState,
      knowledge_stored: storedCount,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[Puzzle] Error:", error);
    return new Response(JSON.stringify({ 
      error: String(error),
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Normalize email subject for thread matching
function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(Re|Fwd|Fw|Tr):\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Build thread content for AI
function buildThreadContent(emails: any[], attachments: any[]): string {
  const sortedEmails = [...emails].sort((a, b) => 
    new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
  );

  let content = `=== FIL DE DISCUSSION: ${sortedEmails.length} EMAILS ===\n\n`;

  for (let i = 0; i < sortedEmails.length; i++) {
    const email = sortedEmails[i];
    content += `--- EMAIL ${i + 1}/${sortedEmails.length} ---\n`;
    content += `DATE: ${email.sent_at}\n`;
    content += `DE: ${email.from_address}\n`;
    content += `À: ${email.to_addresses?.join(", ") || "N/A"}\n`;
    content += `SUJET: ${email.subject}\n\n`;
    content += `CONTENU:\n${email.body_text || stripHtml(email.body_html) || "(vide)"}\n\n`;
  }

  if (attachments.length > 0) {
    content += "\n=== PIÈCES JOINTES ANALYSÉES ===\n\n";
    
    for (const att of attachments) {
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

// Strip HTML tags
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

// Run a single puzzle phase
async function runPhase(
  apiKey: string,
  phaseName: string,
  prompt: string,
  threadContent: string
): Promise<any> {
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
    // Try to extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error("Invalid JSON response from AI");
  }
}

// Build unified puzzle state from all phases
function buildPuzzleState(
  threadId: string,
  emails: any[],
  attachments: any[],
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

  // Process each phase result
  for (const result of results) {
    if (!result.success || !result.data) continue;

    switch (result.phase) {
      case "detect_operations":
        state.has_multiple_operations = result.data.has_multiple_operations || false;
        if (result.data.operations && result.data.operations.length > 0) {
          state.detected_operations = result.data.operations.map((op: any) => ({
            operation_id: op.operation_id,
            cargo_type: op.cargo_type,
            destination: op.destination,
            container_type: op.container_type,
            bl_reference: op.bl_reference || null,
            email_count: op.email_indices?.length || 0,
          }));
        }
        break;

      case "extract_request":
        state.cargo = result.data.cargo;
        state.routing = result.data.routing;
        state.timing = result.data.timing;
        
        // Handle categorized missing info
        if (result.data.missing_info) {
          // Check if it's the new categorized format
          if (typeof result.data.missing_info === 'object' && 
              (result.data.missing_info.critical || result.data.missing_info.important || result.data.missing_info.optional)) {
            state.missing_info_categorized = {
              critical: result.data.missing_info.critical || [],
              important: result.data.missing_info.important || [],
              optional: result.data.missing_info.optional || [],
            };
            // Also populate legacy missing_info with critical + important
            state.missing_info = [
              ...(result.data.missing_info.critical || []),
              ...(result.data.missing_info.important || []),
            ];
          } else if (Array.isArray(result.data.missing_info)) {
            // Legacy format - treat all as important
            state.missing_info.push(...result.data.missing_info);
            state.missing_info_categorized = {
              critical: [],
              important: result.data.missing_info,
              optional: [],
            };
          }
        }
        break;

      case "extract_clarifications":
        // Merge corrections into cargo/routing/timing
        if (result.data.puzzle_updates) {
          state.cargo = { ...state.cargo, ...result.data.puzzle_updates.cargo };
          state.routing = { ...state.routing, ...result.data.puzzle_updates.routing };
          state.timing = { ...state.timing, ...result.data.puzzle_updates.timing };
        }
        break;

      case "extract_quotation":
        if (result.data.quotation_found) {
          state.tariff_lines = result.data.tariff_lines || [];
          state.matching_criteria = result.data.matching_criteria;
          state.carrier = result.data.carrier || undefined;
          state.booking_reference = result.data.booking_reference || undefined;
          state.departure_date = result.data.departure_date || undefined;
          state.arrival_date = result.data.arrival_date || undefined;
        }
        break;

      case "extract_negotiation":
        state.negotiation = {
          occurred: result.data.negotiation_occurred,
          outcome: result.data.final_outcome,
          accepted_amount: result.data.accepted_amount,
          patterns: result.data.negotiation_patterns,
        };
        break;

      case "extract_contacts":
        state.contacts = result.data.contacts || [];
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
  if (state.negotiation?.outcome) score += 10;
  
  state.puzzle_completeness = score;

  return state;
}

// Store extracted knowledge in database
async function storeKnowledge(
  supabase: any,
  puzzle: PuzzleState,
  threadId: string,
  emailIds: string[],
  attachments: any[] = []
): Promise<number> {
  let stored = 0;

  // 1. Store tariff lines as individual knowledge entries
  for (const line of puzzle.tariff_lines) {
    if (!line.amount || line.amount <= 0) continue;

    const name = `${line.service} - ${puzzle.matching_criteria?.destination_port || ""}`;
    
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
      }, { 
        onConflict: "name,category",
        ignoreDuplicates: false 
      });

    if (!error) stored++;
  }

  // 2. Store contacts
  for (const contact of puzzle.contacts) {
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

  // 3. Store quotation exchange as knowledge
  if (puzzle.tariff_lines.length > 0) {
    const totalAmount = puzzle.tariff_lines.reduce((sum, l) => sum + (l.amount || 0), 0);
    
    await supabase
      .from("learned_knowledge")
      .upsert({
        category: "quotation_exchange",
        name: `Cotation ${puzzle.routing?.destination_city || "Unknown"} - Thread ${threadId.substring(0, 8)}`,
        description: `Cotation complète: ${puzzle.tariff_lines.length} lignes, ${totalAmount} ${puzzle.tariff_lines[0]?.currency || "EUR"}`,
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
            currency: puzzle.tariff_lines[0]?.currency,
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

  // 4. Store negotiation patterns if detected
  if (puzzle.negotiation?.occurred && puzzle.negotiation.patterns) {
    await supabase
      .from("learned_knowledge")
      .upsert({
        category: "negociation",
        name: `Pattern négo ${puzzle.routing?.destination_city || ""} - ${new Date().toISOString().split("T")[0]}`,
        description: `Négociation ${puzzle.negotiation.outcome}: ${puzzle.negotiation.patterns.total_duration_days || 0} jours`,
        data: {
          outcome: puzzle.negotiation.outcome,
          patterns: puzzle.negotiation.patterns,
          client: puzzle.contacts.find(c => c.role === "client"),
          source_thread: threadId,
        },
        source_type: "email",
        source_id: emailIds[0],
        confidence: 0.7,
        is_validated: false,
        knowledge_type: "negotiation_pattern",
      }, { onConflict: "name,category" });

    stored++;
  }

  // 5. Store carrier as dedicated entity if detected
  if (puzzle.carrier) {
    const carrierName = puzzle.carrier.toUpperCase().includes("CMA") ? "CMA CGM" : puzzle.carrier;
    
    const { error } = await supabase
      .from("learned_knowledge")
      .upsert({
        category: "carrier",
        name: `Armateur: ${carrierName}`,
        description: `Compagnie maritime utilisée pour ${puzzle.routing?.origin_city || puzzle.routing?.origin_country || "Origine"} → ${puzzle.routing?.destination_city || puzzle.routing?.destination_port || "Destination"}`,
        data: {
          carrier_name: carrierName,
          route: {
            origin: puzzle.routing?.origin_city || puzzle.routing?.origin_country,
            destination: puzzle.routing?.destination_city || puzzle.routing?.destination_port,
          },
          container_type: puzzle.cargo?.container_type,
          booking_reference: puzzle.booking_reference,
          departure_date: puzzle.departure_date,
          arrival_date: puzzle.arrival_date,
          source_thread_id: threadId,
        },
        matching_criteria: {
          origin_port: puzzle.routing?.origin_city,
          destination_port: puzzle.routing?.destination_port || puzzle.routing?.destination_city,
          mode: "maritime",
        },
        source_type: "email",
        source_id: emailIds[0],
        confidence: 0.85,
        is_validated: false,
        knowledge_type: "carrier_info",
      }, { onConflict: "name,category" });

    if (!error) stored++;
    console.log(`[Puzzle] Stored carrier: ${carrierName}`);
  }

  // 6. Store tariff lines directly from analyzed PDF/Excel attachments
  for (const att of attachments) {
    if (!att.extracted_data?.tariff_lines) continue;
    
    console.log(`[Puzzle] Processing ${att.extracted_data.tariff_lines.length} tariff lines from ${att.filename}`);
    
    for (const line of att.extracted_data.tariff_lines) {
      if (!line.amount || line.amount <= 0) continue;
      
      const lineName = `${line.service || line.description || "Service"} - ${puzzle.routing?.destination_port || puzzle.routing?.destination_city || "Export"}`;
      
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
            destination: puzzle.routing?.destination_city || puzzle.routing?.destination_port,
            container_type: puzzle.cargo?.container_type || line.container_types?.[0],
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
