// MAP-5B — Edge Function write contrôlé `update-commodity-classification-candidate`
// Action opérateur Accepter / Rejeter sur public.commodity_classification_candidates.
// - Auth en code modèle MAP-4 (SUPABASE_ANON_KEY + Authorization caller, supabase.auth.getUser).
// - AUCUN service_role.
// - RLS finale: has_case_write_access (owner/assigned).
// - Idempotence stricte via evidence.idempotency_key.
// - AUCUN appel run-pricing, AUCUNE écriture quote_facts / case_facts / cargo.* / pricing_runs.
// - AUCUN moteur automatique.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  candidate_id: z.string().uuid(),
  case_id: z.string().uuid(),
  action: z.enum(["accept", "reject"]),
  rejection_reason: z.string().min(3).max(500).optional(),
  idempotency_key: z.string().min(8).max(128),
}).refine(
  (v) => v.action !== "reject" || (v.rejection_reason && v.rejection_reason.trim().length >= 3),
  { message: "rejection_reason required for reject", path: ["rejection_reason"] },
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function isRlsOrPermissionError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42501") return true;
  const m = (err.message ?? "").toLowerCase();
  return m.includes("row-level security") || m.includes("permission denied") || m.includes("violates row-level security");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // --- Auth modèle MAP-4 ---
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader) return json({ error: "unauthorized", reason: "missing_authorization" }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return json({ error: "unauthorized", reason: "invalid_token" }, 401);
  }
  const userId = userData.user.id;

  // --- Body validation ---
  let raw: unknown;
  try { raw = await req.json(); } catch {
    return json({ error: "invalid_input", details: "invalid_json" }, 400);
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid_input", details: parsed.error.flatten() }, 400);
  }
  const { candidate_id, case_id, action, rejection_reason, idempotency_key } = parsed.data;

  // --- SELECT du candidat (RLS read) ---
  const { data: candidate, error: selectError } = await supabase
    .from("commodity_classification_candidates")
    .select("id, case_id, status, is_current, evidence, updated_at")
    .eq("id", candidate_id)
    .eq("case_id", case_id)
    .maybeSingle();

  if (selectError) {
    console.error("[update-ccc] select error", selectError);
    return json({ error: "internal_error" }, 500);
  }
  if (!candidate) {
    return json({ error: "candidate_not_found" }, 404);
  }

  const targetStatus = action === "accept" ? "accepted" : "rejected";
  const currentStatus = candidate.status as string;
  const existingEvidence =
    candidate.evidence && typeof candidate.evidence === "object" && !Array.isArray(candidate.evidence)
      ? (candidate.evidence as Record<string, unknown>)
      : {};
  const existingKey = typeof existingEvidence.idempotency_key === "string"
    ? (existingEvidence.idempotency_key as string)
    : null;

  // --- Idempotence stricte ---
  if (currentStatus === targetStatus) {
    if (existingKey === idempotency_key) {
      return json({ ok: true, idempotent: true, candidate });
    }
    return json({
      error: "state_conflict",
      reason: "already_processed_different_key",
      current_status: currentStatus,
    }, 409);
  }

  // --- Garde-fou état ---
  // rejected/superseded → pas de transition (sauf déjà traité ci-dessus).
  if (currentStatus === "rejected" || currentStatus === "superseded") {
    return json({ error: "state_conflict", current_status: currentStatus }, 409);
  }
  // accepted + reject reste autorisé (aucun downstream existant).

  // --- Préparation update ---
  const nowIso = new Date().toISOString();
  const nextEvidence: Record<string, unknown> = {
    ...existingEvidence,
    idempotency_key,
    last_action: action,
    acted_at: nowIso,
  };

  const updatePayload: Record<string, unknown> = {
    status: targetStatus,
    is_current: action === "accept",
    validated_by: userId,
    validated_at: nowIso,
    evidence: nextEvidence,
  };
  if (action === "reject") {
    updatePayload.rejection_reason = rejection_reason;
  }

  // --- UPDATE (RLS write) ---
  const { data: updated, error: updateError } = await supabase
    .from("commodity_classification_candidates")
    .update(updatePayload)
    .eq("id", candidate_id)
    .eq("case_id", case_id)
    .select("*");

  if (updateError) {
    if (isRlsOrPermissionError(updateError)) {
      return json({ error: "forbidden", reason: "rls_write_denied" }, 403);
    }
    console.error("[update-ccc] update error", updateError);
    return json({ error: "internal_error" }, 500);
  }
  if (!updated || updated.length === 0) {
    // SELECT initial OK mais UPDATE filtré → RLS write denied.
    return json({ error: "forbidden", reason: "rls_write_denied" }, 403);
  }

  return json({ ok: true, idempotent: false, candidate: updated[0] });
});
