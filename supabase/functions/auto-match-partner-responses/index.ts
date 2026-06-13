// COM-2A — Auto-match partner responses (suggestions dédiées)
// Actions: scan | confirm | reject
// Doctrine: assistant structurant — suggestions only, no auto-merge, no auto-pricing
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

// ---------- Scoring logic (duplicated from suggestPartnerResponse.ts — controlled debt) ----------

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9àâäéèêëïîôùûüÿçœæ\s]/g, "");
}

function extractKeywords(text: string | null | undefined): string[] {
  if (!text) return [];
  return normalize(text)
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

const REPLY_MARKERS = /^(re|fw|fwd|tr)\s*:/i;

interface ScoringResult {
  bestEmailId: string | null;
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

function scoreEmails(
  request: { partner_name: string; partner_email: string | null; sent_at: string | null; purpose: string; purpose_detail: string | null },
  threadEmails: { id: string; subject: string | null; from_address: string; received_at: string | null }[],
  excludeEmailIds: Set<string>,
): ScoringResult | null {
  const sentTime = request.sent_at ? new Date(request.sent_at).getTime() : null;
  const purposeKeywords = new Set([
    ...extractKeywords(request.purpose),
    ...extractKeywords(request.purpose_detail),
  ]);
  const normalizedPartnerName = normalize(request.partner_name);
  const nameFragments = normalizedPartnerName.split(/\s+/).filter((f) => f.length > 2);

  let bestScore = 0;
  let bestId: string | null = null;
  let bestReasons: string[] = [];

  for (const email of threadEmails) {
    if (excludeEmailIds.has(email.id)) continue;

    const receivedTime = email.received_at ? new Date(email.received_at).getTime() : null;
    if (sentTime && receivedTime && receivedTime < sentTime) continue;

    let score = 0;
    const reasons: string[] = [];
    const fromLower = email.from_address.toLowerCase();

    if (request.partner_email && fromLower === request.partner_email.toLowerCase()) {
      score += 70;
      reasons.push("Email partenaire identique");
    }
    if (nameFragments.length > 0 && nameFragments.some((f) => fromLower.includes(f))) {
      score += 25;
      reasons.push("Nom partenaire reconnu");
    }
    if (sentTime && receivedTime && receivedTime >= sentTime) {
      score += 15;
      reasons.push("Reçu après envoi");
    }
    const subject = email.subject || "";
    if (REPLY_MARKERS.test(subject)) {
      score += 5;
      reasons.push("Marqueur de réponse");
    }
    if (purposeKeywords.size > 0) {
      const subjectWords = extractKeywords(subject);
      if (subjectWords.some((w) => purposeKeywords.has(w))) {
        score += 10;
        reasons.push("Sujet lié à la demande");
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestId = email.id;
      bestReasons = reasons;
    }
  }

  if (bestScore < 40 || !bestId) return null;

  let confidence: "high" | "medium" | "low" = "low";
  if (bestScore >= 70) confidence = "high";
  else if (bestScore >= 40) confidence = "medium";

  return { bestEmailId: bestId, score: bestScore, confidence, reasons: bestReasons };
}

// ---------- Out-of-thread matching (réponse hors thread / nouveau thread) ----------
// Defensive address normalizer — extracts bare address from "Name <addr>" format
function normalizeAddress(raw: string | null | undefined): string {
  const s = String(raw || "").trim();
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

interface OutOfThreadEmail {
  id: string;
  subject: string | null;
  from_address: string;
  received_at: string | null;
  thread_ref: string | null;
  body_text: string | null;
}

// Sender is assumed already matched (exact partner_email) by the caller.
// Scores corroborating signals; out-of-thread is intentionally conservative.
function scoreOutOfThread(
  request: { sent_at: string | null; purpose: string; purpose_detail: string | null },
  email: OutOfThreadEmail,
  caseId: string,
): { score: number; confidence: "high" | "medium" | "low"; reasons: string[] } {
  const reasons: string[] = ["Réponse hors thread détectée", "Expéditeur partenaire exact"];
  let score = 50; // exact partner sender (gate validated by caller)

  const sentTime = request.sent_at ? new Date(request.sent_at).getTime() : null;
  const recvTime = email.received_at ? new Date(email.received_at).getTime() : null;
  if (sentTime && recvTime && recvTime >= sentTime) {
    score += 10;
    reasons.push("Reçu après envoi");
  }

  // NOTE: quote_cases has no `reference` column — the dossier reference signal is case_id.slice(0,8).
  const ref = caseId.slice(0, 8).toLowerCase();
  const subjectLower = (email.subject || "").toLowerCase();
  const bodyLower = (email.body_text || "").toLowerCase();
  let refInSubject = false;
  let refInBody = false;
  if (ref && subjectLower.includes(ref)) {
    score += 40;
    refInSubject = true;
    reasons.push("Référence dossier dans le sujet");
  } else if (ref && bodyLower.includes(ref)) {
    score += 25;
    refInBody = true;
    reasons.push("Référence dossier dans le corps");
  }

  const purposeKeywords = new Set([
    ...extractKeywords(request.purpose),
    ...extractKeywords(request.purpose_detail),
  ]);
  let hasPurpose = false;
  if (purposeKeywords.size > 0) {
    const subjectWords = extractKeywords(email.subject);
    if (subjectWords.some((w) => purposeKeywords.has(w))) {
      score += 15;
      hasPurpose = true;
      reasons.push("Sujet lié à la demande");
    }
  }

  let confidence: "high" | "medium" | "low";
  if (refInSubject) confidence = "high";
  else if (refInBody || hasPurpose) confidence = "medium";
  else {
    confidence = "low";
    reasons.push("Ambiguïté possible");
  }

  return { score, confidence, reasons };
}

// ---------- Handler ----------

serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const authHeader = req.headers.get("Authorization")!;

  try {
    const body = await req.json();
    const { action, case_id, suggestion_id } = body;

    if (!action || !case_id) {
      return errorResponse("action and case_id are required", 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Verify case access via RLS
    const { data: qc, error: qcErr } = await userClient
      .from("quote_cases")
      .select("id, thread_id")
      .eq("id", case_id)
      .maybeSingle();
    if (qcErr || !qc) return errorResponse("Case not found", 404);

    // ---------- SCAN ----------
    if (action === "scan") {
      // 1. Load open requests (sent or response_received) — independent of thread presence
      const { data: openRequests, error: reqErr } = await serviceClient
        .from("external_quote_requests")
        .select("id, partner_name, partner_email, purpose, purpose_detail, sent_at, status")
        .eq("case_id", case_id)
        .in("status", ["sent", "response_received"]);
      if (reqErr) return errorResponse("Failed to load requests: " + reqErr.message, 500);
      if (!openRequests || openRequests.length === 0) {
        return jsonResponse({ suggestions: [], message: "No open requests" });
      }

      // P0-PARTNER-GUARD: exclude requests without partner_email
      const validRequests = openRequests.filter((r) => r.partner_email?.trim());
      const skippedMissingEmail = openRequests.length - validRequests.length;
      if (skippedMissingEmail > 0) {
        console.log(`[auto-match-partner-responses] skipped ${skippedMissingEmail} request(s) without partner_email`);
      }
      if (validRequests.length === 0) {
        return jsonResponse({ suggestions: [], message: "No open requests with partner_email" });
      }

      // 2. Load already used email IDs in external_quote_responses (shared exclusion)
      const { data: existingResponses } = await serviceClient
        .from("external_quote_responses")
        .select("source_email_id")
        .eq("case_id", case_id);
      const usedEmailIds = new Set(
        (existingResponses || []).map((r: { source_email_id: string | null }) => r.source_email_id).filter(Boolean) as string[]
      );

      // 3. Load existing suggestions for this case (to avoid re-suggesting same pair)
      const { data: existingSuggestions } = await serviceClient
        .from("partner_response_suggestions")
        .select("request_id, suggested_email_id")
        .eq("case_id", case_id);
      const existingPairs = new Set(
        (existingSuggestions || []).map(
          (s: { request_id: string; suggested_email_id: string }) => `${s.request_id}:${s.suggested_email_id}`
        )
      );

      const created: Array<{ request_id: string; email_id: string; score: number; confidence: string }> = [];

      // 4. INTRA-THREAD SCAN (existing behavior, unchanged) — requires a linked thread
      if (qc.thread_id) {
        const { data: threadEmails, error: emailErr } = await serviceClient
          .from("emails")
          .select("id, subject, from_address, received_at")
          .eq("thread_ref", qc.thread_id)
          .order("received_at", { ascending: false })
          .limit(100);
        if (emailErr) return errorResponse("Failed to load emails: " + emailErr.message, 500);

        if (threadEmails && threadEmails.length > 0) {
          for (const req of validRequests) {
            const result = scoreEmails(req, threadEmails, usedEmailIds);
            if (!result || !result.bestEmailId) continue;

            const pairKey = `${req.id}:${result.bestEmailId}`;
            if (existingPairs.has(pairKey)) continue;

            // Upsert with ON CONFLICT DO NOTHING
            const { error: insErr } = await serviceClient
              .from("partner_response_suggestions")
              .insert({
                case_id,
                request_id: req.id,
                suggested_email_id: result.bestEmailId,
                score: result.score,
                confidence_level: result.confidence,
                reasons: result.reasons,
                suggestion_status: "pending",
              });

            if (insErr) {
              // 23505 = unique violation → already exists, skip
              if (insErr.code === "23505") continue;
              console.warn("[auto-match] Insert failed:", insErr.message);
              continue;
            }

            created.push({
              request_id: req.id,
              email_id: result.bestEmailId,
              score: result.score,
              confidence: result.confidence,
            });
          }
        }
      }

      // 5. OUT-OF-THREAD SCAN (new) — partner responses landing in a different/new thread.
      // Suggestions only, pending, no auto-merge, no auto-pricing.
      const partnerEmailSet = new Set(
        validRequests
          .map((r) => normalizeAddress(r.partner_email))
          .filter((e) => e.length > 0),
      );
      if (partnerEmailSet.size > 0) {
        // Coarse lower time bound to keep candidates recent/plausible: earliest sent_at (fallback 90d).
        const sentTimes = validRequests
          .map((r) => (r.sent_at ? new Date(r.sent_at).getTime() : NaN))
          .filter((t) => !isNaN(t));
        const lowerBoundMs = sentTimes.length > 0
          ? Math.min(...sentTimes)
          : Date.now() - 90 * 24 * 60 * 60 * 1000;
        const lowerBoundIso = new Date(lowerBoundMs).toISOString();

        // ilike OR filter catches both "addr" and "Name <addr>" stored formats; code-level exact match below.
        const orFilter = Array.from(partnerEmailSet)
          .map((e) => `from_address.ilike.%${e}%`)
          .join(",");

        const { data: candidateEmails, error: oooErr } = await serviceClient
          .from("emails")
          .select("id, subject, from_address, received_at, thread_ref, body_text")
          .or(orFilter)
          .gte("received_at", lowerBoundIso)
          .order("received_at", { ascending: false })
          .limit(200);

        if (oooErr) {
          console.warn("[auto-match] out-of-thread email load failed:", oooErr.message);
        } else if (candidateEmails && candidateEmails.length > 0) {
          const suggestedThisScan = new Set<string>();
          for (const email of candidateEmails as OutOfThreadEmail[]) {
            if (usedEmailIds.has(email.id)) continue;
            // Skip emails already in this case's thread (covered by the intra-thread scan above)
            if (qc.thread_id && email.thread_ref && email.thread_ref === qc.thread_id) continue;
            if (suggestedThisScan.has(email.id)) continue;

            const sender = normalizeAddress(email.from_address);

            // Pick the single best matching request for this email (avoid suggesting one email to many requests)
            let best:
              | { req: (typeof validRequests)[number]; score: number; confidence: "high" | "medium" | "low"; reasons: string[] }
              | null = null;
            for (const req of validRequests) {
              if (normalizeAddress(req.partner_email) !== sender) continue;
              const sentTime = req.sent_at ? new Date(req.sent_at).getTime() : null;
              const recvTime = email.received_at ? new Date(email.received_at).getTime() : null;
              if (sentTime && recvTime && recvTime < sentTime) continue;
              if (existingPairs.has(`${req.id}:${email.id}`)) continue;

              const scored = scoreOutOfThread(req, email, case_id);
              if (!best || scored.score > best.score) {
                best = { req, ...scored };
              }
            }
            if (!best) continue;

            const { error: insErr } = await serviceClient
              .from("partner_response_suggestions")
              .insert({
                case_id,
                request_id: best.req.id,
                suggested_email_id: email.id,
                score: best.score,
                confidence_level: best.confidence,
                reasons: best.reasons,
                suggestion_status: "pending",
              });

            if (insErr) {
              if (insErr.code === "23505") { suggestedThisScan.add(email.id); continue; }
              console.warn("[auto-match] out-of-thread insert failed:", insErr.message);
              continue;
            }

            suggestedThisScan.add(email.id);
            created.push({
              request_id: best.req.id,
              email_id: email.id,
              score: best.score,
              confidence: best.confidence,
            });
          }
        }
      }

      return jsonResponse({ suggestions: created, total_scanned: validRequests.length });
    }

    // ---------- CONFIRM ----------
    if (action === "confirm") {
      if (!suggestion_id) return errorResponse("suggestion_id is required", 400);

      // Load suggestion
      const { data: suggestion, error: sugErr } = await serviceClient
        .from("partner_response_suggestions")
        .select("*")
        .eq("id", suggestion_id)
        .eq("case_id", case_id)
        .maybeSingle();

      if (sugErr || !suggestion) return errorResponse("Suggestion not found", 404);
      if (suggestion.suggestion_status === "accepted") {
        return jsonResponse({ ok: true, idempotent: true });
      }
      if (suggestion.suggestion_status !== "pending") {
        return errorResponse("Suggestion is not pending (status: " + suggestion.suggestion_status + ")", 400);
      }

      // Call analyze-partner-response FIRST, only accept if it succeeds
      const analyzeUrl = `${supabaseUrl}/functions/v1/analyze-partner-response`;
      let analyzeResult: Record<string, unknown> | null = null;
      try {
        const analyzeResp = await fetch(analyzeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({
            case_id,
            request_id: suggestion.request_id,
            email_id: suggestion.suggested_email_id,
            // Authorize out-of-thread analysis for this confirmed suggestion only
            suggestion_id,
          }),
        });
        if (!analyzeResp.ok) {
          const errText = await analyzeResp.text();
          console.warn("[auto-match] analyze-partner-response failed:", analyzeResp.status, errText);
          return errorResponse("Analyse partenaire échouée: " + errText, 502);
        }
        analyzeResult = await analyzeResp.json();
      } catch (e) {
        console.warn("[auto-match] analyze-partner-response call error:", (e as Error).message);
        return errorResponse("Analyse partenaire inaccessible: " + (e as Error).message, 502);
      }

      // Analysis succeeded — now mark accepted
      const { error: updErr } = await serviceClient
        .from("partner_response_suggestions")
        .update({
          suggestion_status: "accepted",
          confirmed_by: auth.user.id,
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", suggestion_id);

      if (updErr) return errorResponse("Failed to update suggestion: " + updErr.message, 500);

      // Timeline event (reusing manual_action to avoid CHECK constraint issues)
      await serviceClient.from("case_timeline_events").insert({
        case_id,
        event_type: "manual_action",
        actor_type: "operator",
        actor_user_id: auth.user.id,
        new_value: "Suggestion partenaire confirmée",
        event_data: {
          action_code: "PARTNER_SUGGESTION_CONFIRMED",
          dedupe_key: `partner_suggestion_confirmed:${suggestion_id}`,
          suggestion_id,
          request_id: suggestion.request_id,
          email_id: suggestion.suggested_email_id,
          score: suggestion.score,
          confidence: suggestion.confidence_level,
        },
      });

      return jsonResponse({
        ok: true,
        idempotent: false,
        suggestion_id,
        analyze_result: analyzeResult,
      });
    }

    // ---------- REJECT ----------
    if (action === "reject") {
      if (!suggestion_id) return errorResponse("suggestion_id is required", 400);

      const { data: suggestion, error: sugErr } = await serviceClient
        .from("partner_response_suggestions")
        .select("id, suggestion_status, request_id, suggested_email_id")
        .eq("id", suggestion_id)
        .eq("case_id", case_id)
        .maybeSingle();

      if (sugErr || !suggestion) return errorResponse("Suggestion not found", 404);
      if (suggestion.suggestion_status === "rejected") {
        return jsonResponse({ ok: true, idempotent: true });
      }
      if (suggestion.suggestion_status !== "pending") {
        return errorResponse("Suggestion is not pending (status: " + suggestion.suggestion_status + ")", 400);
      }

      const { error: updErr } = await serviceClient
        .from("partner_response_suggestions")
        .update({
          suggestion_status: "rejected",
          rejected_by: auth.user.id,
          rejected_at: new Date().toISOString(),
        })
        .eq("id", suggestion_id);

      if (updErr) return errorResponse("Failed to update suggestion: " + updErr.message, 500);

      // Optional timeline (lightweight, no action_code required for reject)
      await serviceClient.from("case_timeline_events").insert({
        case_id,
        event_type: "manual_action",
        actor_type: "operator",
        actor_user_id: auth.user.id,
        new_value: "Suggestion partenaire rejetée",
        event_data: {
          action_code: "PARTNER_SUGGESTION_REJECTED",
          dedupe_key: `partner_suggestion_rejected:${suggestion_id}`,
          suggestion_id,
          request_id: suggestion.request_id,
          email_id: suggestion.suggested_email_id,
        },
      });

      return jsonResponse({ ok: true, idempotent: false, suggestion_id });
    }

    return errorResponse("Unknown action: " + action, 400);
  } catch (err) {
    console.error("[auto-match-partner-responses] Unexpected error:", (err as Error).message);
    return errorResponse("Internal server error", 500);
  }
});
