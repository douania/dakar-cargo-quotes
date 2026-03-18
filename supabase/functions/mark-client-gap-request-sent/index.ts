/**
 * Phase CL1 — Mark client gap requests as sent
 * 
 * Allows the operator to confirm they have manually sent
 * the clarification email to the client.
 * 
 * Input: { case_id, gap_keys: string[] }
 * Effect: drafted → sent, sent_at = now()
 * Idempotence: no-op if already sent/answered/validated/cancelled
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { case_id, gap_keys } = await req.json();

    if (!case_id || !Array.isArray(gap_keys) || gap_keys.length === 0) {
      return errorResponse("case_id and gap_keys (non-empty array) are required", 400);
    }

    // Verify case access via RLS
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
      auth: { persistSession: false },
    });

    const { data: caseRow, error: caseErr } = await userClient
      .from("quote_cases")
      .select("id")
      .eq("id", case_id)
      .maybeSingle();

    if (caseErr || !caseRow) {
      return errorResponse("Case not found or access denied", 404);
    }

    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    let updated = 0;
    let skipped = 0;

    for (const gapKey of gap_keys) {
      if (typeof gapKey !== "string" || !gapKey.trim()) {
        skipped++;
        continue;
      }

      // Find row with status = 'drafted'
      const { data: row } = await serviceClient
        .from("client_gap_requests")
        .select("id, status")
        .eq("case_id", case_id)
        .eq("gap_key", gapKey)
        .in("status", ["drafted", "sent", "answered"])
        .maybeSingle();

      if (!row) {
        skipped++;
        continue;
      }

      // Only update if currently drafted
      if (row.status !== "drafted") {
        skipped++;
        continue;
      }

      const { error: updateErr } = await serviceClient
        .from("client_gap_requests")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", row.id);

      if (updateErr) {
        console.warn(`[mark-client-gap-request-sent] Update failed for ${gapKey}:`, updateErr.message);
        skipped++;
      } else {
        updated++;
      }
    }

    return jsonResponse({ ok: true, updated, skipped });
  } catch (err) {
    console.error("[mark-client-gap-request-sent] Error:", (err as Error).message);
    return errorResponse("Internal server error", 500);
  }
});
