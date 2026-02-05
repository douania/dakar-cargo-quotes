/**
 * Phase 7.0.2: ensure-quote-case
 * Creates or retrieves a quote_case for a given email thread
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface EnsureCaseRequest {
  thread_id: string;
}

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

    // User client for auth validation
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = userData.user.id;

    // Service client for DB operations
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Parse request
    const { thread_id }: EnsureCaseRequest = await req.json();

    if (!thread_id) {
      return new Response(
        JSON.stringify({ error: "thread_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Verify thread exists
    const { data: thread, error: threadError } = await serviceClient
      .from("email_threads")
      .select("id, is_quotation_thread, subject_normalized")
      .eq("id", thread_id)
      .single();

    if (threadError || !thread) {
      return new Response(
        JSON.stringify({ error: "Thread not found", details: threadError?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Check for existing case
    const { data: existingCase } = await serviceClient
      .from("quote_cases")
      .select("id, status, request_type")
      .eq("thread_id", thread_id)
      .single();

    if (existingCase) {
      // Return existing case
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
    const initialStatus = thread.is_quotation_thread ? "RFQ_DETECTED" : "NEW_THREAD";

    const { data: newCase, error: insertError } = await serviceClient
      .from("quote_cases")
      .insert({
        thread_id,
        status: initialStatus,
        created_by: userId,  // Explicit, not relying on default
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
        thread_subject: thread.subject_normalized,
        is_quotation_thread: thread.is_quotation_thread,
      },
      actor_type: "user",
      actor_user_id: userId,
    });

    // If auto-transitioned to RFQ_DETECTED, log that too
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
