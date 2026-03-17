import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errorResponse("Missing Authorization header", 401);

  try {
    const { case_id, dedupe_key } = await req.json();
    if (!case_id || !dedupe_key) {
      return errorResponse("case_id and dedupe_key are required", 400);
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

    // 1. Verify case access (RLS)
    const { data: qc, error: qcErr } = await userClient
      .from("quote_cases")
      .select("id")
      .eq("id", case_id)
      .maybeSingle();

    if (qcErr || !qc) return errorResponse("Case not found", 404);

    // 2. Load manual_action events for this case (desc)
    const { data: events, error: evErr } = await serviceClient
      .from("case_timeline_events")
      .select("id, event_data, related_email_id, created_at")
      .eq("case_id", case_id)
      .eq("event_type", "manual_action")
      .order("created_at", { ascending: false })
      .limit(200);

    if (evErr) return errorResponse("Failed to load actions", 500);

    // 3. Find the latest event for this dedupe_key (first match = latest because desc)
    const latest = (events ?? []).find((e: { event_data: unknown }) => {
      const ed = e.event_data as Record<string, unknown> | null;
      return ed?.dedupe_key === dedupe_key;
    }) ?? null;

    if (!latest) return errorResponse("Action not found", 404);

    const ed = latest.event_data as Record<string, unknown> | null;
    const latestStatus = (ed?.status as string) ?? "open";

    // 4. Idempotence: already done
    if (latestStatus === "done") {
      return jsonResponse({ ok: true, idempotent: true, case_id, dedupe_key });
    }

    // 5. Insert append-only "done" event — related_email_id at row level (micro-ajustement #1)
    const { error: insErr } = await serviceClient
      .from("case_timeline_events")
      .insert({
        case_id,
        event_type: "manual_action",
        actor_type: "operator",
        related_email_id: latest.related_email_id ?? null,
        event_data: {
          ...(ed ?? {}),
          status: "done",
          done_at: new Date().toISOString(),
          done_by_user_id: auth.user.id ?? null,
        },
      });

    if (insErr) {
      console.warn("[close-manual-action] Insert failed:", insErr.message);
      return jsonResponse({ ok: false, error: "TIMELINE_INSERT_FAILED" }, 200);
    }

    return jsonResponse({ ok: true, idempotent: false, case_id, dedupe_key });
  } catch (err) {
    console.error("[close-manual-action] Unexpected error:", (err as Error).message);
    return errorResponse("Internal server error", 500);
  }
});
