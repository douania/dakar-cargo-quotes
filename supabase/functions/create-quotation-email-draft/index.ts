/**
 * Phase 18 E2E — Patch B: create-quotation-email-draft
 * 
 * Creates an email draft linked to a specific quotation version.
 * Idempotent: returns existing draft if one already exists for the version.
 * Anti-duplication: unique partial index + fallback on constraint violation (23505).
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

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
    lotSummaryLines = snapData.lots.map((lot: any) =>
      `  - ${lot.label || `Lot ${lot.lot_index}`}: ${new Intl.NumberFormat('fr-FR').format(lot.totals?.ht ?? 0)} ${lot.totals?.currency ?? 'XOF'} HT`
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
  const subject = isMultiLot
    ? `Votre devis SODATRA - version v${version.version_number} (${lotCount} lots)`
    : `Votre devis SODATRA - version v${version.version_number}`;

  const bodyParts = [
    "Bonjour,",
    "",
    `Veuillez trouver ci-joint notre devis SODATRA, version v${version.version_number}.`,
  ];

  if (isMultiLot && lotSummaryLines.length > 0) {
    bodyParts.push("");
    bodyParts.push(`Ce devis couvre ${lotCount} lots:`);
    bodyParts.push(...lotSummaryLines);
  }

  bodyParts.push(
    "",
    "Merci de bien vouloir le relire et revenir vers nous pour toute precision complementaire.",
    "",
    "Cordialement,",
    "L'equipe SODATRA",
  );
  const bodyText = bodyParts.join("\n");

  // 7. Insert via serviceClient (to guarantee created_by is set)
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: newDraft, error: insertError } = await serviceClient
    .from("email_drafts")
    .insert({
      quotation_version_id: versionId,
      subject,
      to_addresses: toAddresses,
      status: "draft",
      ai_generated: true,
      created_by: user.id,
      body_text: bodyText,
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

  return jsonResponse({ ok: true, draft_id: newDraft.id, idempotent: false });
});
