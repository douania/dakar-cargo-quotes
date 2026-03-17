import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

// ── Intent → Actions mapping (P0 minimal) ──
interface ActionDef {
  action_code: string;
  title_fr: string;
  description_fr: string;
}

const INTENT_ACTIONS: Record<string, ActionDef[]> = {
  provide_missing_info: [
    {
      action_code: "IDENTIFY_MISSING_INFO",
      title_fr: "Identifier les infos manquantes",
      description_fr: "Examiner l'email et mettre à jour les gaps du dossier",
    },
    {
      action_code: "PREPARE_CLIENT_REPLY_DRAFT",
      title_fr: "Préparer un brouillon de réponse",
      description_fr: "Rédiger une réponse au client pour confirmer la réception des informations",
    },
  ],
  new_quote_request: [
    {
      action_code: "REVIEW_NEW_REQUEST",
      title_fr: "Examiner la nouvelle demande",
      description_fr: "Vérifier les détails de la demande de cotation et créer/mettre à jour le dossier",
    },
  ],
};

const DEFAULT_ACTIONS: ActionDef[] = [
  {
    action_code: "REVIEW_THREAD_INTENT",
    title_fr: "Vérifier l'intent du thread",
    description_fr: "L'IA a détecté une intention — vérifier et agir si nécessaire",
  },
];

serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errorResponse("Missing Authorization header", 401);

  try {
    const { case_id, intent_event_id } = await req.json();
    if (!case_id) return errorResponse("case_id is required", 400);

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

    // 2. Load intent event
    let intentEvent: any = null;

    if (intent_event_id) {
      const { data, error } = await userClient
        .from("case_timeline_events")
        .select("id, related_email_id, event_data, created_at")
        .eq("id", intent_event_id)
        .eq("case_id", case_id)
        .eq("event_type", "thread_intent_v1")
        .maybeSingle();
      if (error || !data) return errorResponse("Intent event not found", 404);
      intentEvent = data;
    } else {
      const { data, error } = await userClient
        .from("case_timeline_events")
        .select("id, related_email_id, event_data, created_at")
        .eq("case_id", case_id)
        .eq("event_type", "thread_intent_v1")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data) return errorResponse("No thread_intent_v1 found", 404);
      intentEvent = data;
    }

    const intentEventId = intentEvent.id;
    const ed = intentEvent.event_data as Record<string, unknown> | null;
    const intentObj = (ed?.["intent"] as Record<string, unknown>) ?? null;

    // 3. Extract intent fields robustly
    const intent_type =
      (intentObj?.["intent_type"] as string) ??
      (ed?.["intent_type"] as string) ??
      "other";

    const confidence =
      (intentObj?.["confidence"] as number) ??
      (ed?.["confidence"] as number) ??
      null;

    const risk_level =
      (intentObj?.["risk_level"] as string) ??
      (ed?.["risk_level"] as string) ??
      null;

    // 4. Map to actions
    const actions = INTENT_ACTIONS[intent_type] ?? DEFAULT_ACTIONS;

    // 5. Idempotence: load existing manual_action events for this case
    const { data: existingActions } = await serviceClient
      .from("case_timeline_events")
      .select("id, event_data")
      .eq("case_id", case_id)
      .eq("event_type", "manual_action")
      .order("created_at", { ascending: false })
      .limit(200);

    const existingDedupeKeys = new Set(
      (existingActions ?? [])
        .map((e: any) => (e.event_data as Record<string, unknown>)?.["dedupe_key"])
        .filter(Boolean)
    );

    // 6. Insert missing actions
    let applied_count = 0;
    let skipped_count = 0;
    const appliedActions: any[] = [];

    for (const action of actions) {
      const dedupe_key = `apply_intent_v1:${intentEventId}:${action.action_code}`;

      if (existingDedupeKeys.has(dedupe_key)) {
        skipped_count++;
        continue;
      }

      const { error: insertErr } = await serviceClient
        .from("case_timeline_events")
        .insert({
          case_id,
          event_type: "manual_action",
          actor_type: "ai",
          related_email_id: intentEvent.related_email_id ?? null,
          event_data: {
            dedupe_key,
            source_intent_event_id: intentEventId,
            intent_type,
            confidence,
            risk_level,
            action_code: action.action_code,
            title_fr: action.title_fr,
            description_fr: action.description_fr,
            status: "open",
          },
        });

      if (insertErr) {
        console.warn("[apply-thread-intent-v1] Insert failed:", insertErr.message);
        return jsonResponse({ ok: false, error: "TIMELINE_INSERT_FAILED" }, 200);
      }

      applied_count++;
      appliedActions.push(action);
    }

    return jsonResponse({
      ok: true,
      case_id,
      intent_event_id: intentEventId,
      intent_type,
      applied_count,
      skipped_count,
      actions: appliedActions,
    });
  } catch (err) {
    console.error("[apply-thread-intent-v1] Unexpected error:", (err as Error).message);
    return errorResponse("Internal server error", 500);
  }
});
