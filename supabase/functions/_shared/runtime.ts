/**
 * Phase 14 — Shared Runtime Helper
 * 
 * Standardized error handling, correlation, structured logging, and rate limiting
 * for Edge Functions observability and resilience.
 * 
 * CTO CORRECTIONS INTÉGRÉES:
 * - A1: respondOk<T> avec générique explicite
 * - A2: JsonObject type alias pour Record<string, unknown>
 * - A3: truncateMeta() appliqué dans respondError (pas de meta brut au client)
 * - A4: TextEncoder pour mesure bytes réels
 */

import { corsHeaders } from "./cors.ts";

// ============================================================================
// UTILITY TYPES (CTO FIX A2)
// ============================================================================

/** Type alias for JSON-safe objects - used throughout runtime */
export type JsonObject = Record<string, unknown>;

// ============================================================================
// ERROR CODES TAXONOMY
// ============================================================================

export type ErrorCode =
  | 'AUTH_MISSING_JWT'
  | 'AUTH_INVALID_JWT'
  | 'FORBIDDEN_OWNER'
  | 'VALIDATION_FAILED'
  | 'CONFLICT_INVALID_STATE'
  | 'RATE_LIMITED'
  | 'EDGE_TIMEOUT'
  | 'UPSTREAM_DB_ERROR'
  | 'UNKNOWN';

export const ERROR_CONFIG: Record<ErrorCode, { httpStatus: number; retryable: boolean }> = {
  AUTH_MISSING_JWT: { httpStatus: 401, retryable: false },
  AUTH_INVALID_JWT: { httpStatus: 401, retryable: false },
  FORBIDDEN_OWNER: { httpStatus: 403, retryable: false },
  VALIDATION_FAILED: { httpStatus: 400, retryable: false },
  CONFLICT_INVALID_STATE: { httpStatus: 409, retryable: false },
  RATE_LIMITED: { httpStatus: 429, retryable: true },
  EDGE_TIMEOUT: { httpStatus: 504, retryable: true },
  UPSTREAM_DB_ERROR: { httpStatus: 500, retryable: true },
  UNKNOWN: { httpStatus: 500, retryable: false },
};

// ============================================================================
// TYPES
// ============================================================================

export type RuntimeStatus = 'ok' | 'retryable_error' | 'fatal_error';

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  service: string;
  op?: string;
  correlationId: string;
  userId?: string;
  status?: RuntimeStatus;
  durationMs?: number;
  errorCode?: ErrorCode;
  meta?: JsonObject;
}

export interface RuntimeEventEntry {
  correlationId: string;
  functionName: string;
  op?: string;
  userId?: string;
  status: RuntimeStatus;
  errorCode?: ErrorCode;
  httpStatus: number;
  durationMs: number;
  meta?: JsonObject;
}

export interface ErrorResponseOpts {
  code: ErrorCode;
  message: string;
  correlationId: string;
  meta?: JsonObject;
}

export interface RateLimitResult {
  allowed: boolean;
  requestCount?: number;
  retryAfterMs?: number;
}

// ============================================================================
// CORRELATION ID
// ============================================================================

/**
 * Extract correlation ID from request header or generate a new one.
 */
export function getCorrelationId(req: Request): string {
  const headerValue = req.headers.get('x-correlation-id');
  if (headerValue && isValidUuid(headerValue)) {
    return headerValue;
  }
  return crypto.randomUUID();
}

function isValidUuid(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// ============================================================================
// RESPONSE HELPERS
// ============================================================================

/**
 * Create a standardized success response.
 */
export function respondOk<T>(data: T, correlationId: string): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      data,
      correlation_id: correlationId,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Create a standardized error response.
 * CTO FIX A3: meta is truncated before being sent to client (security + size limit)
 */
export function respondError(opts: ErrorResponseOpts): Response {
  const { code, message, correlationId, meta } = opts;
  const config = ERROR_CONFIG[code];

  // CTO FIX A3: Truncate meta to avoid PII/payload leak to client
  const safeMeta = truncateMeta(meta);

  const body: JsonObject = {
    ok: false,
    error: {
      code,
      message,
      retryable: config.retryable,
      // Only include meta if present and has content
      ...(safeMeta && Object.keys(safeMeta).length > 0 ? { meta: safeMeta } : {}),
    },
    correlation_id: correlationId,
  };

  return new Response(JSON.stringify(body), {
    status: config.httpStatus,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ============================================================================
// STRUCTURED LOGGING
// ============================================================================

const MAX_META_SIZE_BYTES = 1024; // 1KB limit for meta field

/**
 * Emit a structured JSON log to console.
 */
export function structuredLog(entry: LogEntry): void {
  const logObj = {
    timestamp: new Date().toISOString(),
    level: entry.level,
    service: entry.service,
    op: entry.op,
    correlation_id: entry.correlationId,
    user_id: entry.userId,
    status: entry.status,
    duration_ms: entry.durationMs,
    error_code: entry.errorCode,
    meta: truncateMeta(entry.meta),
  };

  const logFn = entry.level === 'error' ? console.error :
                entry.level === 'warn' ? console.warn :
                entry.level === 'debug' ? console.debug :
                console.log;

  logFn(JSON.stringify(logObj));
}

/**
 * Truncate meta to avoid PII/payload bloat (max 1KB).
 * CTO FIX A4: Use TextEncoder for proper byte measurement (not character count)
 */
function truncateMeta(meta?: JsonObject): JsonObject | undefined {
  if (!meta) return undefined;

  const serialized = JSON.stringify(meta);
  // CTO FIX A4: Measure actual bytes, not characters
  const byteLength = new TextEncoder().encode(serialized).length;
  
  if (byteLength <= MAX_META_SIZE_BYTES) {
    return meta;
  }

  // Truncate and add marker
  return {
    _truncated: true,
    _original_size_bytes: byteLength,
    preview: serialized.substring(0, 200),
  };
}

// ============================================================================
// RUNTIME EVENTS (DB LOGGING)
// ============================================================================

/**
 * Log a runtime event to the runtime_events table (append-only).
 * Uses service role client for insert.
 */
export async function logRuntimeEvent(
  serviceClient: { from: (table: string) => { insert: (data: unknown) => Promise<{ error: unknown }> } },
  entry: RuntimeEventEntry
): Promise<void> {
  try {
    const { error } = await serviceClient.from('runtime_events').insert({
      correlation_id: entry.correlationId,
      function_name: entry.functionName,
      op: entry.op,
      user_id: entry.userId,
      status: entry.status,
      error_code: entry.errorCode,
      http_status: entry.httpStatus,
      duration_ms: entry.durationMs,
      meta: truncateMeta(entry.meta),
    });

    if (error) {
      console.error('[runtime] Failed to log runtime event:', error);
    }
  } catch (err) {
    console.error('[runtime] Exception logging runtime event:', err);
  }
}

// ============================================================================
// RATE LIMITING (ATOMIC UPSERT)
// ============================================================================

const DEFAULT_RATE_LIMITS: Record<string, { limit: number; windowSeconds: number }> = {
  'commit-decision': { limit: 10, windowSeconds: 60 },
  'generate-response': { limit: 5, windowSeconds: 60 },
  'generate-case-outputs': { limit: 5, windowSeconds: 60 },
  'generate-quotation': { limit: 10, windowSeconds: 60 },
  'generate-quotation-pdf': { limit: 10, windowSeconds: 60 },
};

/**
 * Check rate limit using atomic UPSERT.
 * Returns { allowed: true } if under limit, otherwise { allowed: false, retryAfterMs }.
 */
export async function checkRateLimit(
  serviceClient: { rpc: (fn: string, params: unknown) => Promise<{ data: unknown; error: unknown }> },
  userId: string,
  functionName: string,
  customLimit?: number,
  customWindowSeconds?: number
): Promise<RateLimitResult> {
  const config = DEFAULT_RATE_LIMITS[functionName] || { limit: 10, windowSeconds: 60 };
  const limit = customLimit ?? config.limit;
  const windowSeconds = customWindowSeconds ?? config.windowSeconds;

  try {
    // Use raw SQL via RPC for atomic UPSERT
    // This assumes we create an RPC function, but for now we do direct insert
    const windowStart = new Date(
      Math.floor(Date.now() / (windowSeconds * 1000)) * (windowSeconds * 1000)
    ).toISOString();

    // Atomic upsert: INSERT or UPDATE, then check count
    const { data, error } = await serviceClient.rpc('upsert_rate_limit_bucket', {
      p_user_id: userId,
      p_function_name: functionName,
      p_window_start: windowStart,
    });

    if (error) {
      // On error, allow request (fail open) but log
      console.error('[runtime] Rate limit check failed:', error);
      return { allowed: true };
    }

    const requestCount = typeof data === 'number' ? data : 1;

    if (requestCount > limit) {
      const retryAfterMs = windowSeconds * 1000 - (Date.now() % (windowSeconds * 1000));
      return {
        allowed: false,
        requestCount,
        retryAfterMs,
      };
    }

    return { allowed: true, requestCount };
  } catch (err) {
    console.error('[runtime] Rate limit exception:', err);
    return { allowed: true }; // Fail open
  }
}

/**
 * Simplified rate limit check without RPC (direct table access).
 * Falls back to this if RPC is not available.
 */
export async function checkRateLimitDirect(
  serviceClient: { from: (table: string) => unknown },
  userId: string,
  functionName: string,
  customLimit?: number,
  customWindowSeconds?: number
): Promise<RateLimitResult> {
  const config = DEFAULT_RATE_LIMITS[functionName] || { limit: 10, windowSeconds: 60 };
  const limit = customLimit ?? config.limit;
  const windowSeconds = customWindowSeconds ?? config.windowSeconds;

  try {
    const windowStart = new Date(
      Math.floor(Date.now() / (windowSeconds * 1000)) * (windowSeconds * 1000)
    ).toISOString();

    // Atomic UPSERT using Supabase's upsert with onConflict
    const client = serviceClient.from('rate_limit_buckets') as {
      upsert: (data: unknown, opts: unknown) => { select: (cols: string) => { single: () => Promise<{ data: unknown; error: unknown }> } }
    };

    const { data, error } = await client
      .upsert(
        {
          user_id: userId,
          function_name: functionName,
          window_start: windowStart,
          request_count: 1,
        },
        {
          onConflict: 'user_id,function_name,window_start',
          ignoreDuplicates: false,
        }
      )
      .select('request_count')
      .single();

    if (error) {
      // Try increment if upsert failed (row exists)
      const updateClient = serviceClient.from('rate_limit_buckets') as {
        update: (data: unknown) => { 
          eq: (col: string, val: string) => { 
            eq: (col: string, val: string) => { 
              eq: (col: string, val: string) => { 
                select: (cols: string) => { 
                  single: () => Promise<{ data: unknown; error: unknown }> 
                } 
              } 
            } 
          } 
        }
      };

      const { data: updateData, error: updateError } = await updateClient
        .update({ request_count: 1 }) // Will be incremented by trigger/RLS
        .eq('user_id', userId)
        .eq('function_name', functionName)
        .eq('window_start', windowStart)
        .select('request_count')
        .single();

      if (updateError) {
        console.error('[runtime] Rate limit update failed:', updateError);
        return { allowed: true };
      }

      const count = (updateData as { request_count?: number })?.request_count ?? 1;
      if (count > limit) {
        return {
          allowed: false,
          requestCount: count,
          retryAfterMs: windowSeconds * 1000,
        };
      }
      return { allowed: true, requestCount: count };
    }

    const requestCount = (data as { request_count?: number })?.request_count ?? 1;
    if (requestCount > limit) {
      return {
        allowed: false,
        requestCount,
        retryAfterMs: windowSeconds * 1000,
      };
    }

    return { allowed: true, requestCount };
  } catch (err) {
    console.error('[runtime] Rate limit exception:', err);
    return { allowed: true };
  }
}

// ============================================================================
// HELPER: Determine status from error code
// ============================================================================

export function getStatusFromErrorCode(code: ErrorCode): RuntimeStatus {
  const config = ERROR_CONFIG[code];
  return config.retryable ? 'retryable_error' : 'fatal_error';
}
