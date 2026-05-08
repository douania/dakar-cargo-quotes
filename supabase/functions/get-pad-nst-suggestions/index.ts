/**
 * PAD-NST-2E-C-B — Edge Function isolée de lecture DB
 *
 * Lecture SELECT uniquement sur pad_nst_recommendation_rules.
 * Authentification via requireUser (JWT utilisateur, RLS respectée).
 * Aucun service role, aucune écriture DB, aucun amount, aucun OFFICIAL.
 *
 * POST /get-pad-nst-suggestions
 *   Body: { nst_level: "group"|"division", nst_code: string }
 *   Response: { ok, source_type, requires_operator_confirmation, suggestions[] }
 *
 * OPTIONS → 204 preflight CORS
 * Toute autre méthode → 405
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

const NST_CODE_PATTERNS: Record<string, RegExp> = {
  group: /^[0-9]{2}\.[0-9A-Z]$/,
  division: /^[0-9]{2}$/,
};

Deno.serve(async (req: Request) => {
  // CORS preflight — no data
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Only POST allowed
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Auth — requireUser returns AuthResult or 401 Response
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const nstLevel = body.nst_level;
  const nstCode = body.nst_code;

  // Validate nst_level
  if (typeof nstLevel !== "string" || !["group", "division"].includes(nstLevel)) {
    return new Response(
      JSON.stringify({ error: "nst_level must be 'group' or 'division'" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Validate nst_code format
  if (typeof nstCode !== "string" || !NST_CODE_PATTERNS[nstLevel].test(nstCode)) {
    const expected = nstLevel === "group"
      ? "XX.X (e.g. 01.1)"
      : "XX (e.g. 02)";
    return new Response(
      JSON.stringify({ error: `nst_code format invalid for ${nstLevel}. Expected: ${expected}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Build Supabase client with user JWT — respects RLS, no service role
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${auth.token}` } },
    auth: { persistSession: false },
  });

  // SELECT only — no write, no RPC, no raw SQL
  const { data, error } = await userClient
    .from("pad_nst_recommendation_rules")
    .select("id,nst_level,nst_code,pad_category,confidence,evidence_level,notes,source_document,source_reference")
    .eq("nst_level", nstLevel)
    .eq("nst_code", nstCode)
    .eq("is_active", true)
    .eq("validation_status", "candidate")
    .eq("requires_operator_validation", true)
    .order("confidence", { ascending: false });

  if (error) {
    console.error("DB query error:", error.message);
    return new Response(
      JSON.stringify({ error: "Database query failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Map response — TO_CONFIRM only, no amount, no OFFICIAL
  const suggestions = (data || []).map((row: Record<string, unknown>) => ({
    rule_id: row.id,
    nst_level: row.nst_level,
    nst_code: row.nst_code,
    pad_category: row.pad_category,
    confidence: row.confidence,
    evidence_level: row.evidence_level,
    notes: row.notes,
    source_document: row.source_document,
    source_reference: row.source_reference,
  }));

  return new Response(
    JSON.stringify({
      ok: true,
      source_type: "TO_CONFIRM",
      requires_operator_confirmation: true,
      suggestions,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
