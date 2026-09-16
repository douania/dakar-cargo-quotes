/**
 * P0-B — Sync gap-based client info request actions
 * 
 * Reads open quote_gaps for a case, filters client-resolvable ones,
 * and creates an idempotent manual_action timeline event.
 * 
 * SECURITY: verify_jwt=false + requireUser (Lovable Cloud pattern)
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { isObsoletePadDraft, latestGapActions, PAD_REVIEW_GAP_KEY } from "../_shared/pad-gap-review.ts";
import {
  isClientResolvableGap,
  normalizeGapKeys,
} from "../_shared/client-gap-policy.ts";

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  // ── Auth ──
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  // ── Parse body ──
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const caseId = body["case_id"] as string | undefined;
  if (!caseId) {
    return errorResponse("case_id is required", 400);
  }

  // ── Clients ──
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization")! } },
    auth: { persistSession: false },
  });
  const serviceClient = createClient(supabaseUrl, serviceKey);

  // ── Verify case access (RLS) ──
  const { data: caseRow, error: caseErr } = await userClient
    .from("quote_cases")
    .select("id")
    .eq("id", caseId)
    .maybeSingle();
  if (caseErr || !caseRow) {
    return errorResponse("Case not found", 404);
  }

  // ── Load open gaps ──
  const { data: gaps, error: gapsErr } = await userClient
    .from("quote_gaps")
    .select("gap_key")
    .eq("case_id", caseId)
    .eq("status", "open");

  if (gapsErr) {
    console.error("Failed to load gaps:", gapsErr.message);
    return errorResponse("Failed to load gaps", 500);
  }

  // ── Filter client-resolvable gaps ──
  const clientGaps = (gaps ?? []).filter((g: Record<string, unknown>) =>
    isClientResolvableGap(g["gap_key"] as string)
  );

  const gapKeys = normalizeGapKeys(
    clientGaps.map((g: Record<string, unknown>) => g["gap_key"] as string)
  );

  const dedupeKey = `REQUEST_CLIENT_INFO_FOR_GAPS:${caseId}:${gapKeys.join(",")}`;

  // ── Idempotence: scan existing manual_action events ──
  const { data: existingActions, error: actionsErr } = await userClient
    .from("case_timeline_events")
    .select("id, event_data")
    .eq("case_id", caseId)
    .eq("event_type", "manual_action")
    .order("created_at", { ascending: false })
    .limit(200);

  if (actionsErr) {
    console.error("Failed to load actions:", actionsErr.message);
    return errorResponse("Failed to load existing actions", 500);
  }

  // Reconcile before ANY early return/dedupe: the last client gap may now be
  // an internal PAD review. Old append-only "open" entries must not resurrect.
  const latestActions = latestGapActions(existingActions ?? []);
  const openGapKeySet = new Set(gapKeys);
  for (const evt of latestActions) {
    const ed = evt.event_data as Record<string, unknown>;
    if (ed.status !== "open" || !Array.isArray(ed.requested_gap_keys)) continue;
    const keys = ed.requested_gap_keys as string[];
    if (keys.length && !keys.every(key => openGapKeySet.has(key))) {
      const { error } = await serviceClient.from("case_timeline_events").insert({
        case_id: caseId, event_type: "manual_action", actor_type: "system",
        event_data: { ...ed, status: "done", done_at: new Date().toISOString(),
          done_reason: "client_gap_scope_reconciled" },
      });
      if (error) return errorResponse("Failed to reconcile obsolete action", 500);
      ed.status = "done";
    }
  }

  // Invalidate whole unsent mixed drafts too; never edit their bodies or
  // cancel a sent/answered request. Their original timeline remains intact.
  const { data: outputs, error: outputsErr } = await userClient.from("case_timeline_events")
    .select("id, event_data").eq("case_id", caseId).eq("event_type", "output_generated");
  const { data: drafts, error: draftsErr } = await userClient.from("client_gap_requests")
    .select("id, gap_key, source_timeline_event_id").eq("case_id", caseId).eq("status", "drafted");
  if (outputsErr || draftsErr) return errorResponse("Failed to inspect obsolete drafts", 500);
  const obsoleteSourceIds = new Set((outputs ?? []).filter(e =>
    isObsoletePadDraft(e.event_data as Record<string, unknown>)).map(e => e.id));
  const staleIds = (drafts ?? []).filter(r => r.gap_key === PAD_REVIEW_GAP_KEY ||
    obsoleteSourceIds.has(r.source_timeline_event_id)).map(r => r.id);
  if (staleIds.length) {
    const { error } = await serviceClient.from("client_gap_requests").update({ status: "cancelled" })
      .eq("case_id", caseId).eq("status", "drafted").in("id", staleIds);
    if (error) return errorResponse("Failed to retire obsolete PAD drafts", 500);
  }
  if (!clientGaps.length) {
    return jsonResponse({ created: false, reason: "no_client_resolvable_gaps" });
  }

  // Check 1: exact dedupe_key match — but only block if latest status is NOT "done"
  // This allows re-creation after a previous action was closed/done
  const exactMatch = latestActions.find((e: Record<string, unknown>) => {
    const ed = e["event_data"] as Record<string, unknown> | null;
    return ed?.["dedupe_key"] === dedupeKey;
  });

  if (exactMatch) {
    const matchStatus = (exactMatch["event_data"] as Record<string, unknown>)?.["status"] as string;
    // Only block if the latest event with this dedupe_key is still open
    if (matchStatus !== "done") {
      return jsonResponse({ created: false, reason: "dedupe_key_exists" });
    }
    // If done, allow re-creation (gaps reopened scenario)
  }

  // Check 2: open action with same action_code and same gap keys (legacy robustness)
  const equivalentOpen = latestActions.find((e: Record<string, unknown>) => {
    const ed = e["event_data"] as Record<string, unknown> | null;
    if (!ed) return false;
    if (ed["action_code"] !== "REQUEST_CLIENT_INFO_FOR_GAPS") return false;
    if (ed["status"] !== "open") return false;

    const existingKeys = ed["requested_gap_keys"] as string[] | undefined;
    if (!existingKeys) return false;

    const normalizedExisting = normalizeGapKeys(existingKeys);
    return (
      normalizedExisting.length === gapKeys.length &&
      normalizedExisting.every((k, i) => k === gapKeys[i])
    );
  });

  if (equivalentOpen) {
    return jsonResponse({ created: false, reason: "equivalent_open_action_exists" });
  }

  // ── Insert action ──
  const { error: insertErr } = await serviceClient
    .from("case_timeline_events")
    .insert({
      case_id: caseId,
      event_type: "manual_action",
      actor_type: "system",
      event_data: {
        dedupe_key: dedupeKey,
        action_code: "REQUEST_CLIENT_INFO_FOR_GAPS",
        status: "open",
        requested_gap_keys: gapKeys,
        title_fr: "Demander les informations manquantes au client",
        description_fr: `Gaps à résoudre : ${gapKeys.join(", ")}`,
      },
    });

  if (insertErr) {
    console.error("Timeline insert failed:", insertErr.message);
    return errorResponse("Failed to create action", 500);
  }

  return jsonResponse({
    created: true,
    requested_gap_keys: gapKeys,
    dedupe_key: dedupeKey,
  });
});
