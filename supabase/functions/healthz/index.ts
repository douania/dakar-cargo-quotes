/**
 * Phase 14 — Health Check Endpoint
 * 
 * Verifies database connectivity and environment health.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    // Check required env vars
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({
          ok: false,
          db: false,
          error: "Missing environment variables",
          ts: new Date().toISOString(),
          latency_ms: Date.now() - startTime,
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Test DB connectivity
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    
    const { error: dbError } = await serviceClient
      .from("email_configs") // Using existing table for health check
      .select("id")
      .limit(1);

    const latencyMs = Date.now() - startTime;

    if (dbError) {
      console.error("[healthz] DB check failed:", dbError);
      return new Response(
        JSON.stringify({
          ok: false,
          db: false,
          error: "Database connection failed",
          ts: new Date().toISOString(),
          latency_ms: latencyMs,
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        db: true,
        ts: new Date().toISOString(),
        latency_ms: latencyMs,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[healthz] Error:", error);
    return new Response(
      JSON.stringify({
        ok: false,
        db: false,
        error: "Health check failed",
        ts: new Date().toISOString(),
        latency_ms: Date.now() - startTime,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
