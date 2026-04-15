/**
 * Phase 18 E2E — A4: create-quotation-email-draft
 * 
 * Creates an email draft linked to a specific quotation version.
 * Idempotent: returns existing draft if one already exists for the version.
 * Anti-duplication: unique partial index + fallback on constraint violation (23505).
 * 
 * A4.1: Enriched deterministic template using snapshot data
 * A4.2: Optional AI enrichment on body text with 15s timeout + deterministic fallback
 * A4.3: Traceability via case_timeline_events (best-effort)
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { callAI, parseAIResponse } from "../_shared/ai-client.ts";
import { extractAndParseJSON } from "../_shared/json-parser.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatAmountFR(amount: number): string {
  return new Intl.NumberFormat('fr-FR').format(amount);
}

// deno-lint-ignore no-explicit-any
function buildDeterministicBody(snapshot: Record<string, any> | null, versionNumber: number, isMultiLot: boolean, lotSummaryLines: string[], hasPdf: boolean): string {
  const clientBlock = snapshot?.client as Record<string, unknown> | undefined;
  const inputsBlock = snapshot?.inputs as Record<string, unknown> | undefined;
  const totalsBlock = snapshot?.totals as Record<string, unknown> | undefined;

  const company = typeof clientBlock?.company === "string" ? clientBlock.company : null;
  const origin = typeof inputsBlock?.origin === "string" ? inputsBlock.origin : null;
  const destination = typeof inputsBlock?.destination === "string" ? inputsBlock.destination : null;
  const incoterm = typeof inputsBlock?.incoterm === "string" ? inputsBlock.incoterm : null;
  const totalHt = typeof totalsBlock?.total_ht === "number" ? totalsBlock.total_ht : null;
  const currency = typeof totalsBlock?.currency === "string" ? totalsBlock.currency : "XOF";

  const parts: string[] = [];

  // Salutation
  parts.push(company ? `Bonjour ${company},` : "Bonjour,");
  parts.push("");

  // Attachment wording
  if (hasPdf) {
    parts.push(`Veuillez trouver ci-joint notre devis SODATRA, version v${versionNumber}.`);
  } else {
    parts.push(`Nous avons le plaisir de vous adresser notre devis SODATRA, version v${versionNumber}.`);
    parts.push("Le document PDF vous sera transmis séparément.");
  }

  // Route + incoterm
  if (origin && destination) {
    const routeLine = incoterm
      ? `Ce devis concerne votre expédition ${origin} → ${destination} (${incoterm}).`
      : `Ce devis concerne votre expédition ${origin} → ${destination}.`;
    parts.push("");
    parts.push(routeLine);
  }

  // Total HT
  if (totalHt !== null) {
    parts.push("");
    parts.push(`Montant total HT : ${formatAmountFR(totalHt)} ${currency}.`);
  }

  // Multi-lot summary
  if (isMultiLot && lotSummaryLines.length > 0) {
    parts.push("");
    parts.push(`Ce devis couvre ${lotSummaryLines.length} lots :`);
    parts.push(...lotSummaryLines);
  }

  parts.push(
    "",
    "Merci de bien vouloir le relire et revenir vers nous pour toute précision complémentaire.",
    "",
    "Cordialement,",
    "L'équipe SODATRA",
  );

  return parts.join("\n");
}

// deno-lint-ignore no-explicit-any
function buildAiContextPack(snapshot: Record<string, any> | null, versionNumber: number, isMultiLot: boolean, lotCount: number, hasPdf: boolean): Record<string, unknown> {
  const clientBlock = snapshot?.client as Record<string, unknown> | undefined;
  const inputsBlock = snapshot?.inputs as Record<string, unknown> | undefined;
  const totalsBlock = snapshot?.totals as Record<string, unknown> | undefined;

  return {
    company: typeof clientBlock?.company === "string" ? clientBlock.company : null,
    origin: typeof inputsBlock?.origin === "string" ? inputsBlock.origin : null,
    destination: typeof inputsBlock?.destination === "string" ? inputsBlock.destination : null,
    incoterm: typeof inputsBlock?.incoterm === "string" ? inputsBlock.incoterm : null,
    version_number: versionNumber,
    total_ht: typeof totalsBlock?.total_ht === "number" ? totalsBlock.total_ht : null,
    currency: typeof totalsBlock?.currency === "string" ? totalsBlock.currency : "XOF",
    lot_count: lotCount,
    is_multi_lot: isMultiLot,
    has_pdf: hasPdf,
  };
}

async function tryAiEnrichment(contextPack: Record<string, unknown>): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const systemPrompt = `Tu es un assistant commercial pour SODATRA, un transitaire en Afrique de l'Ouest.
Rédige un email commercial professionnel en français pour accompagner un devis de transit.
Utilise UNIQUEMENT les données fournies dans le contexte. Ne jamais inventer de chiffres, délais, ou promesses commerciales.
Le ton doit être professionnel, courtois et commercial.
Retourne un JSON strict : { "body_text": "..." }
Le body_text doit commencer par une salutation et finir par "Cordialement,\\nL'équipe SODATRA".`;

    const userPrompt = `Contexte du devis :\n${JSON.stringify(contextPack, null, 2)}`;

    const response = await callAI(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.3, signal: controller.signal }
    );

    const rawText = await parseAIResponse(response);
    const parsed = extractAndParseJSON<{ body_text: string }>(rawText, {
      label: "email-draft-ai",
      expectRoot: "object",
    });

    if (typeof parsed.body_text !== "string" || parsed.body_text.trim().length < 50) {
      console.warn("[create-quotation-email-draft] AI output too short or invalid, falling back");
      return null;
    }

    return parsed.body_text.trim();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes("abort") || errMsg.includes("Abort")) {
      console.warn("[create-quotation-email-draft] AI timeout (15s), falling back to deterministic");
    } else {
      console.warn("[create-quotation-email-draft] AI enrichment failed, falling back:", errMsg);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  // 1. Auth
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const { user, token } = auth;

  // 2. Defensive body parse
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const caseId = body.case_id;
  const versionId = body.version_id;
  const useAiEnrichment = body.use_ai_enrichment === true;

  if (!caseId || typeof caseId !== "string" || caseId.trim().length === 0) {
    return errorResponse("case_id is required", 400);
  }
  if (!versionId || typeof versionId !== "string" || versionId.trim().length === 0) {
    return errorResponse("version_id is required", 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 3. userClient for RLS reads
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  // 4. Load quotation_versions via userClient (RLS)
  const { data: version, error: versionError } = await userClient
    .from("quotation_versions")
    .select("id, version_number, snapshot, case_id")
    .eq("id", versionId)
    .eq("case_id", caseId)
    .maybeSingle();

  if (versionError) {
    console.error("[create-quotation-email-draft] version lookup error:", versionError);
    return errorResponse("Failed to load quotation version", 500);
  }
  if (!version) {
    return errorResponse("Quotation version not found for this case", 404);
  }

  // 5. Idempotence check via userClient
  const { data: existingDraft } = await userClient
    .from("email_drafts")
    .select("id")
    .eq("quotation_version_id", versionId)
    .in("status", ["draft", "sent"])
    .limit(1)
    .maybeSingle();

  if (existingDraft) {
    return jsonResponse({ ok: true, draft_id: existingDraft.id, idempotent: true });
  }

  // 6. Extract client email: snapshot first, then fallback to email_threads
  const snapshot = version.snapshot as Record<string, unknown> | null;
  const clientBlock = snapshot?.client as Record<string, unknown> | undefined;
  let clientEmailFinal = typeof clientBlock?.email === "string" ? clientBlock.email : null;

  // Fallback: email_threads.client_email via case → thread link
  if (!clientEmailFinal) {
    const { data: caseData, error: caseErr } = await userClient
      .from("quote_cases")
      .select("thread_id")
      .eq("id", caseId)
      .maybeSingle();

    if (caseErr) console.warn("[create-quotation-email-draft] thread_id lookup failed", { caseId, error: String(caseErr?.message ?? caseErr) });

    if (caseData?.thread_id) {
      const { data: threadData, error: threadErr } = await userClient
        .from("email_threads")
        .select("client_email")
        .eq("id", caseData.thread_id)
        .maybeSingle();

      if (threadErr) console.warn("[create-quotation-email-draft] client_email lookup failed", { caseId, threadId: caseData.thread_id, error: String(threadErr?.message ?? threadErr) });

      if (typeof threadData?.client_email === "string" && threadData.client_email) {
        clientEmailFinal = threadData.client_email;
      }
    }
  }

  const toAddresses = clientEmailFinal ? [clientEmailFinal] : [];

  // --- Multi-lot detection (primary: snapshot.lots, fallback: raw_lines tags) ---
  // deno-lint-ignore no-explicit-any
  const snapData = snapshot as Record<string, any> | null;
  let lotSummaryLines: string[] = [];
  let isMultiLot = false;

  if (snapData?.is_multi_lot === true && Array.isArray(snapData.lots) && snapData.lots.length > 1) {
    isMultiLot = true;
    // deno-lint-ignore no-explicit-any
    lotSummaryLines = snapData.lots.map((lot: any) =>
      `  - ${lot.label || `Lot ${lot.lot_index}`}: ${formatAmountFR(lot.totals?.ht ?? 0)} ${lot.totals?.currency ?? 'XOF'} HT`
    );
  } else if (Array.isArray(snapData?.raw_lines) && snapData.raw_lines.some((r: any) => r.lot_index != null)) {
    // Legacy fallback: derive lot count from raw_lines tags
    const lotLabels = new Map<number, string>();
    for (const r of snapData.raw_lines) {
      if (r.lot_index != null && !lotLabels.has(r.lot_index)) {
        lotLabels.set(r.lot_index, r.lot_label ?? `Lot ${r.lot_index}`);
      }
    }
    if (lotLabels.size > 1) {
      isMultiLot = true;
      lotSummaryLines = Array.from(lotLabels.values()).map(label => `  - ${label}`);
    }
  }

  const lotCount = lotSummaryLines.length;

  // --- Subject (always deterministic) ---
  const subject = isMultiLot
    ? `Votre devis SODATRA - version v${version.version_number} (${lotCount} lots)`
    : `Votre devis SODATRA - version v${version.version_number}`;

  // --- PDF detection via serviceClient (RLS owner-only on quotation_documents) ---
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: pdfDoc } = await serviceClient
    .from("quotation_documents")
    .select("id")
    .eq("quotation_version_id", versionId)
    .eq("document_type", "pdf")
    .limit(1)
    .maybeSingle();

  const hasPdf = !!pdfDoc;

  // --- Body text generation (A4.1 deterministic + A4.2 optional AI) ---
  const deterministicBody = buildDeterministicBody(snapshot, version.version_number, isMultiLot, lotSummaryLines, hasPdf);
  let finalBody = deterministicBody;
  let generationMode: "ai" | "deterministic" = "deterministic";

  if (useAiEnrichment) {
    const contextPack = buildAiContextPack(snapshot, version.version_number, isMultiLot, lotCount, hasPdf);
    const aiBody = await tryAiEnrichment(contextPack);
    if (aiBody) {
      let sanitized = aiBody;
      // A4-fix: deterministic guard — never claim attachment when no PDF exists
      if (!hasPdf) {
        sanitized = sanitized
          .replace(/ci[- ]?joint[es]?/gi, "séparément")
          .replace(/en pièce[s]? jointe[s]?/gi, "séparément")
          .replace(/vous trouverez joint/gi, "vous sera transmis séparément");
      }
      finalBody = sanitized;
      generationMode = "ai";
    } else {
      console.log("[create-quotation-email-draft] AI fallback → deterministic template used");
    }
  }

  // 7. Insert via serviceClient (to guarantee created_by is set)
  const { data: newDraft, error: insertError } = await serviceClient
    .from("email_drafts")
    .insert({
      quotation_version_id: versionId,
      subject,
      to_addresses: toAddresses,
      status: "draft",
      ai_generated: generationMode === "ai",
      created_by: user.id,
      body_text: finalBody,
    })
    .select("id")
    .single();

  if (insertError) {
    // 8. Fallback on unique constraint violation (double-click race)
    if (insertError.code === "23505") {
      console.log("[create-quotation-email-draft] Constraint violation, fetching existing draft");
      const { data: raceDraft } = await serviceClient
        .from("email_drafts")
        .select("id")
        .eq("quotation_version_id", versionId)
        .in("status", ["draft", "sent"])
        .limit(1)
        .maybeSingle();

      if (raceDraft) {
        return jsonResponse({ ok: true, draft_id: raceDraft.id, idempotent: true });
      }
    }

    console.error("[create-quotation-email-draft] insert error:", insertError);
    return errorResponse("Failed to create email draft", 500);
  }

  // A4.3 — Traceability: best-effort timeline event (NOT on idempotent hit)
  try {
    await serviceClient.from("case_timeline_events").insert({
      case_id: caseId as string,
      event_type: "output_generated",
      actor_user_id: user.id,
      actor_type: "user",
      event_data: {
        kind: "quotation_email_draft_v1",
        dedupe_key: `quotation_email_draft_v1:${versionId}`,
        draft_id: newDraft.id,
        version_id: versionId,
        generation_mode: generationMode,
      },
    });
  } catch (e) {
    console.warn("[create-quotation-email-draft] timeline insert failed (best-effort)", e);
  }

  return jsonResponse({ ok: true, draft_id: newDraft.id, idempotent: false, generation_mode: generationMode });
});
