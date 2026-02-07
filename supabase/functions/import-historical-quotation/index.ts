/**
 * Phase M2.1 — Import Historical Quotation
 * 
 * Inserts a complete historical quotation (quotation + lines + metadata)
 * via the atomic RPC `insert_historical_quotation_atomic`.
 * 
 * Security: verify_jwt = false in config.toml, JWT validated in code via getClaims().
 * Runtime Contract: correlationId, respondOk/respondError, logRuntimeEvent.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import {
  getCorrelationId,
  respondOk,
  respondError,
  logRuntimeEvent,
  getStatusFromErrorCode,
  type JsonObject,
} from "../_shared/runtime.ts";

const FUNCTION_NAME = "import-historical-quotation";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const correlationId = getCorrelationId(req);
  const startMs = Date.now();

  // --- AUTH: validate JWT via getClaims() ---
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    const duration = Date.now() - startMs;
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: FUNCTION_NAME,
      op: "auth",
      status: "fatal_error",
      errorCode: "AUTH_MISSING_JWT",
      httpStatus: 401,
      durationMs: duration,
    });
    return respondError({
      code: "AUTH_MISSING_JWT",
      message: "Authorization header missing or malformed",
      correlationId,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Validate JWT
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    const duration = Date.now() - startMs;
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: FUNCTION_NAME,
      op: "auth",
      status: "fatal_error",
      errorCode: "AUTH_INVALID_JWT",
      httpStatus: 401,
      durationMs: duration,
    });
    return respondError({
      code: "AUTH_INVALID_JWT",
      message: "Invalid or expired JWT",
      correlationId,
    });
  }

  const userId = claimsData.claims.sub as string;
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // --- PARSE BODY ---
    const body = await req.json();
    const { quotation, lines, metadata } = body;

    // --- VALIDATION ---
    if (!quotation?.source_type || !quotation?.destination_country) {
      const duration = Date.now() - startMs;
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: FUNCTION_NAME,
        op: "validate",
        userId,
        status: "fatal_error",
        errorCode: "VALIDATION_FAILED",
        httpStatus: 400,
        durationMs: duration,
        meta: {
          missing: [
            !quotation?.source_type && "source_type",
            !quotation?.destination_country && "destination_country",
          ].filter(Boolean),
        } as JsonObject,
      });
      return respondError({
        code: "VALIDATION_FAILED",
        message: "quotation.source_type and quotation.destination_country are required",
        correlationId,
      });
    }

    // --- CALL ATOMIC RPC ---
    const { data, error } = await serviceClient.rpc(
      "insert_historical_quotation_atomic",
      {
        p_quotation: quotation,
        p_lines: lines || [],
        p_metadata: metadata || null,
      }
    );

    if (error) {
      const duration = Date.now() - startMs;
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: FUNCTION_NAME,
        op: "rpc_insert",
        userId,
        status: "retryable_error",
        errorCode: "UPSTREAM_DB_ERROR",
        httpStatus: 500,
        durationMs: duration,
        meta: { rpcError: error.message } as JsonObject,
      });
      return respondError({
        code: "UPSTREAM_DB_ERROR",
        message: "Failed to insert historical quotation",
        correlationId,
        meta: { detail: error.message } as JsonObject,
      });
    }

    // --- SUCCESS ---
    const linesCount = Array.isArray(lines) ? lines.length : 0;
    const duration = Date.now() - startMs;

    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: FUNCTION_NAME,
      op: "rpc_insert",
      userId,
      status: "ok",
      httpStatus: 200,
      durationMs: duration,
      meta: {
        quotation_id: data,
        lines_count: linesCount,
        has_metadata: metadata != null,
      } as JsonObject,
    });

    return respondOk(
      {
        quotation_id: data,
        lines_inserted: linesCount,
        has_metadata: metadata != null,
      },
      correlationId
    );
  } catch (err) {
    const duration = Date.now() - startMs;
    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: FUNCTION_NAME,
      op: "unhandled",
      userId,
      status: "fatal_error",
      errorCode: "UNKNOWN",
      httpStatus: 500,
      durationMs: duration,
      meta: { error: String(err) } as JsonObject,
    });
    return respondError({
      code: "UNKNOWN",
      message: "Unexpected error",
      correlationId,
    });
  }
});
