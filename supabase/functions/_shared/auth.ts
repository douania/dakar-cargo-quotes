/**
 * Phase S0 — Centralized Auth Helper
 * 
 * Single mechanism for JWT validation across all Edge Functions.
 * CTO Corrections:
 * - Client anon standard (no header in constructor)
 * - Token passed explicitly to getUser(token)
 * - All error responses include corsHeaders
 * - Admin allowlist loaded from ADMIN_EMAIL_ALLOWLIST env var
 */

import { createClient, type User } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";

export interface AuthResult {
  user: User;
  token: string;
}

/**
 * Require a valid authenticated user.
 * Returns AuthResult on success, or a 401 Response on failure.
 */
export async function requireUser(req: Request): Promise<AuthResult | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing authorization header" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const token = authHeader.replace("Bearer ", "");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Standard anon client — no Authorization header in constructor
  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });

  const { data: { user }, error } = await anonClient.auth.getUser(token);

  if (error || !user) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return await requireWorkspaceAccess({ user, token });
}

/**
 * Require an authenticated admin user.
 * Loads allowlist from ADMIN_EMAIL_ALLOWLIST env var.
 * Returns AuthResult on success, 401 if not authenticated, 403 if not admin.
 */
export async function requireAdmin(req: Request): Promise<AuthResult | Response> {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const allowlistRaw = Deno.env.get("ADMIN_EMAIL_ALLOWLIST") || "";
  const allowedEmails = allowlistRaw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);

  const userEmail = (auth.user.email || "").toLowerCase();

  if (allowedEmails.length === 0 || !allowedEmails.includes(userEmail)) {
    return new Response(
      JSON.stringify({ error: "Forbidden: admin access required" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return auth;
}

/** Explicit admission to the shared internal workspace, checked with the user JWT.
 * Never elevate to service_role until this returns AuthResult.
 */
export async function requireWorkspaceAccess(auth: AuthResult): Promise<AuthResult | Response> {
  return await requireWorkspaceToken(auth.token) ?? auth;
}

/** For existing inline JWT guards; identity validation remains at their entrypoint. */
export async function requireWorkspaceToken(token: string): Promise<Response | null> {
  try {
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await client.rpc("has_workspace_access", {}, { get: true });
    if (error) throw new Error();
    if (data === true) return null;
    return new Response(JSON.stringify({ error: "Forbidden: internal workspace access required" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Workspace authorization unavailable" }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
