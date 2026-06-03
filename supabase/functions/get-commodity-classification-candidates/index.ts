// MAP-4 — Edge Function read-only `get-commodity-classification-candidates`
// Lecture filtrée de public.commodity_classification_candidates par case_id.
// RLS appliquée sous l'identité du caller (SUPABASE_ANON_KEY + Authorization JWT).
// AUCUN service_role, AUCUNE écriture, AUCUN appel run-pricing, AUCUN moteur de suggestion.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CANDIDATE_KINDS = [
  "cn8", "hs6", "hs10_uemoa", "nhm", "nst2007", "nstr", "pad_label", "pad_category",
] as const;
const STATUSES = ["suggested", "accepted", "rejected", "superseded"] as const;
const SOURCES = [
  "operator", "structured_code_exact", "validated_alias",
  "pad_label_2_3", "reference_label_cn_nhm_nst_nstr",
  "ai_suggestion", "web_hs_lookup", "pad_v5_shadow",
] as const;

const BodySchema = z.object({
  case_id: z.string().uuid(),
  filters: z.object({
    article_id: z.string().uuid().nullable().optional(),
    candidate_kind: z.enum(CANDIDATE_KINDS).optional(),
    status: z.enum(STATUSES).optional(),
    is_current: z.boolean().optional(),
    source: z.enum(SOURCES).optional(),
  }).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  // --- Auth: real check via supabase.auth.getUser() under caller JWT ---
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader) return json({ error: "UNAUTHORIZED", reason: "missing_authorization" }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return json({ error: "UNAUTHORIZED", reason: "invalid_token" }, 401);
  }

  // --- Body validation ---
  let raw: unknown;
  try { raw = await req.json(); } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "VALIDATION_FAILED", details: parsed.error.flatten() }, 400);
  }
  const { case_id, filters = {}, limit = 100, offset = 0 } = parsed.data;
  const isCurrent = filters.is_current ?? true;

  // --- Read-only query (RLS enforced by has_case_read_access) ---
  let q = supabase
    .from("commodity_classification_candidates")
    .select("*", { count: "exact" })
    .eq("case_id", case_id)
    .eq("is_current", isCurrent);

  if (filters.candidate_kind) q = q.eq("candidate_kind", filters.candidate_kind);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.source) q = q.eq("source", filters.source);
  if (filters.article_id === null) q = q.is("article_id", null);
  else if (filters.article_id) q = q.eq("article_id", filters.article_id);

  // Order: is_current desc, rank asc nulls last, confidence desc, created_at desc
  q = q.order("is_current", { ascending: false });
  try {
    // nullsFirst is supported in supabase-js v2 typings
    q = q.order("rank", { ascending: true, nullsFirst: false });
  } catch {
    q = q.order("rank", { ascending: true });
  }
  q = q
    .order("confidence", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  if (error) {
    console.error("[get-commodity-classification-candidates] select error", error);
    return json({ error: "QUERY_FAILED", message: error.message }, 500);
  }

  return json({
    case_id,
    count: count ?? data?.length ?? 0,
    candidates: data ?? [],
  });
});
