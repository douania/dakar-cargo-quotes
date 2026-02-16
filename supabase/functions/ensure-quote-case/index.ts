/**
 * Phase 7.0.2+: ensure-quote-case
 * Creates or retrieves a quote_case for a given email thread OR intake case_id.
 *
 * Two modes:
 *   1. { thread_id }          — original thread-based flow
 *   2. { case_id, mode: "intake", workflow_key? } — Intake upsert flow
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface EnsureCaseResponse {
  case_id: string;
  status: string;
  is_new: boolean;
  request_type: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Validate JWT and extract user
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

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = userData.user.id;
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Parse request
    const body = await req.json();
    const mode = body.mode || "thread"; // "thread" (default) or "intake"

    // ─── MODE: INTAKE ───
    // Upsert a quote_case with a known case_id (from Railway)
    if (mode === "intake") {
      const caseId = body.case_id;
      const workflowKey = body.workflow_key || "WF_SIMPLE_QUOTE";

      if (!caseId) {
        return new Response(
          JSON.stringify({ error: "case_id is required for intake mode" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check if case already exists
      const { data: existing } = await serviceClient
        .from("quote_cases")
        .select("id, status, request_type")
        .eq("id", caseId)
        .single();

      if (existing) {
        const response: EnsureCaseResponse = {
          case_id: existing.id,
          status: existing.status,
          is_new: false,
          request_type: existing.request_type,
        };
        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Insert new case with the Railway-provided ID
      const { data: newCase, error: insertError } = await serviceClient
        .from("quote_cases")
        .insert({
          id: caseId,
          status: "INTAKE",
          request_type: workflowKey,
          created_by: userId,
          puzzle_completeness: 0,
        })
        .select("id, status, request_type")
        .single();

      if (insertError) {
        console.error("Error creating intake case:", insertError);
        return new Response(
          JSON.stringify({ error: "Failed to create case", details: insertError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Timeline event
      await serviceClient.from("case_timeline_events").insert({
        case_id: newCase.id,
        event_type: "case_created",
        event_data: { source: "intake", workflow_key: workflowKey },
        actor_type: "user",
        actor_user_id: userId,
      });

      console.log(`[ensure-quote-case] Intake case created: ${newCase.id}`);

      const response: EnsureCaseResponse = {
        case_id: newCase.id,
        status: newCase.status,
        is_new: true,
        request_type: newCase.request_type,
      };
      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── MODE: THREAD (original flow) ───
    const thread_id = body.thread_id;

    if (!thread_id) {
      return new Response(
        JSON.stringify({ error: "thread_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Detect synthetic thread_ref (from QuotationSheet fallback)
    let effectiveThreadRef: string | null = thread_id;
    if (typeof thread_id === 'string' && thread_id.startsWith('subject:')) {
      effectiveThreadRef = null;
    }

    // 3. Verify thread exists (skip if synthetic ref)
    let thread: { id: string; is_quotation_thread: boolean | null; subject_normalized: string } | null = null;

    if (effectiveThreadRef) {
      const { data: threadData, error: threadError } = await serviceClient
        .from("email_threads")
        .select("id, is_quotation_thread, subject_normalized")
        .eq("id", effectiveThreadRef)
        .single();

      if (threadError || !threadData) {
        return new Response(
          JSON.stringify({ error: "Thread not found", details: threadError?.message }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      thread = threadData;
    }

    // 4. Check for existing case
    let existingCase: { id: string; status: string; request_type: string | null } | null = null;

    if (effectiveThreadRef) {
      const { data } = await serviceClient
        .from("quote_cases")
        .select("id, status, request_type")
        .eq("thread_id", effectiveThreadRef)
        .single();
      existingCase = data;
    }

    if (existingCase) {
      const response: EnsureCaseResponse = {
        case_id: existingCase.id,
        status: existingCase.status,
        is_new: false,
        request_type: existingCase.request_type,
      };
      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Create new case with explicit created_by
    const initialStatus = thread?.is_quotation_thread ? "RFQ_DETECTED" : "NEW_THREAD";

    const { data: newCase, error: insertError } = await serviceClient
      .from("quote_cases")
      .insert({
        thread_id: effectiveThreadRef,
        status: initialStatus,
        created_by: userId,
      })
      .select("id, status, request_type")
      .single();

    if (insertError) {
      console.error("Error creating case:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create case", details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Insert timeline event
    await serviceClient.from("case_timeline_events").insert({
      case_id: newCase.id,
      event_type: "case_created",
      event_data: {
        thread_id,
        thread_subject: thread?.subject_normalized ?? null,
        is_quotation_thread: thread?.is_quotation_thread ?? false,
      },
      actor_type: "user",
      actor_user_id: userId,
    });

    if (initialStatus === "RFQ_DETECTED") {
      await serviceClient.from("case_timeline_events").insert({
        case_id: newCase.id,
        event_type: "status_changed",
        previous_value: "NEW_THREAD",
        new_value: "RFQ_DETECTED",
        event_data: { reason: "Thread marked as quotation thread" },
        actor_type: "system",
      });
    }

    const response: EnsureCaseResponse = {
      case_id: newCase.id,
      status: newCase.status,
      is_new: true,
      request_type: newCase.request_type,
    };

    console.log(`Created quote_case ${newCase.id} for thread ${thread_id}`);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in ensure-quote-case:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});