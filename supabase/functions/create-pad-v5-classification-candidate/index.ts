// PAD-V5 B2.1 - Create a suggested CCC candidate from a V5 shadow row.
// Auth model: SUPABASE_ANON_KEY + caller Authorization JWT. No service_role.
// Writes only public.commodity_classification_candidates under caller RLS.
// No quote_facts / case_facts / cargo.* / pricing_runs writes. No run-pricing.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  case_id: z.string().uuid(),
  shadow_id: z.string().uuid(),
  article_id: z.string().uuid().nullable().optional(),
});

type PadV5ShadowRow = {
  id: string;
  row_key: string;
  cn2008_code: string | null;
  cn2008_label: string | null;
  nst2007_code: string | null;
  nst2007_label: string | null;
  nstr3_code: string;
  nstr_label: string | null;
  v5_pad_category: string | null;
  v5_decision: string;
  v5_confidence: number;
  v5_note: string | null;
  v5_requires_operator: boolean;
  v5_category_source: string;
  source_version: string;
  source_hash: string;
  is_active: boolean;
};

type ExistingCandidate = {
  id: string;
  evidence: unknown;
};

const PAD_V5_SELECT_COLUMNS = [
  "id",
  "row_key",
  "cn2008_code",
  "cn2008_label",
  "nst2007_code",
  "nst2007_label",
  "nstr3_code",
  "nstr_label",
  "v5_pad_category",
  "v5_decision",
  "v5_confidence",
  "v5_note",
  "v5_requires_operator",
  "v5_category_source",
  "source_version",
  "source_hash",
  "is_active",
].join(", ");

const BLOCKED_DECISIONS = new Set(["TO_CONFIRM", "DORMANT", "REJECT"]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function findCurrentCandidate(
  supabase: ReturnType<typeof createClient>,
  caseId: string,
  articleId: string | null,
  padCategory: string,
): Promise<{ data: ExistingCandidate | null; error: { code?: string; message?: string } | null }> {
  let query = supabase
    .from("commodity_classification_candidates")
    .select("id, evidence")
    .eq("case_id", caseId)
    .eq("candidate_kind", "pad_category")
    .eq("candidate_value", padCategory)
    .eq("source", "pad_v5_shadow")
    .eq("is_current", true);

  query = articleId === null
    ? query.is("article_id", null)
    : query.eq("article_id", articleId);

  return await query.limit(1).maybeSingle<ExistingCandidate>();
}

function isRlsOrPermissionError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42501") return true;
  const m = (err.message ?? "").toLowerCase();
  return m.includes("row-level security") || m.includes("permission denied") || m.includes("violates row-level security");
}

function normalizeDesignation(value: string | null | undefined): string | null {
  const normalized = (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = value > 1 && value <= 100 ? value / 100 : value;
  const clamped = Math.max(0, Math.min(1, scaled));
  return Math.round(clamped * 100) / 100;
}

function readShadowIdFromEvidence(evidence: unknown): string | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const shadow = (evidence as { shadow?: unknown }).shadow;
  if (!shadow || typeof shadow !== "object" || Array.isArray(shadow)) return null;
  const id = (shadow as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function readShadowRowKeyFromEvidence(evidence: unknown): string | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const shadow = (evidence as { shadow?: unknown }).shadow;
  if (!shadow || typeof shadow !== "object" || Array.isArray(shadow)) return null;
  const rowKey = (shadow as { row_key?: unknown }).row_key;
  return typeof rowKey === "string" && rowKey.length > 0 ? rowKey : null;
}

function isSameShadowEvidence(evidence: unknown, shadowId: string, rowKey: string): boolean {
  return readShadowIdFromEvidence(evidence) === shadowId
    || readShadowRowKeyFromEvidence(evidence) === rowKey;
}

function buildDesignation(row: PadV5ShadowRow): string {
  return normalizeDesignation(row.cn2008_label)
    ?? normalizeDesignation(row.nst2007_label)
    ?? normalizeDesignation(row.nstr_label)
    ?? normalizeDesignation(row.cn2008_code)
    ?? normalizeDesignation(row.nst2007_code)
    ?? normalizeDesignation(row.nstr3_code)
    ?? row.row_key;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

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

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return json({ error: "invalid_input", details: "invalid_json" }, 400);
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid_input", details: parsed.error.flatten() }, 400);
  }
  const { case_id, shadow_id } = parsed.data;
  const articleId = parsed.data.article_id ?? null;

  const { data: writable, error: accessError } = await supabase
    .rpc("has_case_write_access", { _case_id: case_id });
  if (accessError) {
    console.error("[create-pad-v5-ccc] has_case_write_access error", accessError);
    return json({ error: "internal_error" }, 500);
  }
  if (writable !== true) {
    return json({ error: "forbidden", reason: "rls_write_denied" }, 403);
  }

  const { data: shadowRow, error: shadowError } = await supabase
    .from("pad_cn2008_mapping_v5_shadow")
    .select(PAD_V5_SELECT_COLUMNS)
    .eq("id", shadow_id)
    .maybeSingle<PadV5ShadowRow>();

  if (shadowError) {
    console.error("[create-pad-v5-ccc] shadow select error", shadowError);
    return json({ error: "internal_error" }, 500);
  }
  if (!shadowRow) {
    return json({ error: "shadow_not_found" }, 404);
  }
  if (shadowRow.is_active !== true) {
    return json({ error: "shadow_inactive" }, 422);
  }
  if (BLOCKED_DECISIONS.has(shadowRow.v5_decision)) {
    return json({ error: "v5_decision_blocked", decision: shadowRow.v5_decision }, 422);
  }
  if (shadowRow.v5_decision !== "AUTO_SAFE" && shadowRow.v5_decision !== "AUTO_SAFE_CANDIDATE") {
    return json({ error: "v5_decision_blocked", decision: shadowRow.v5_decision }, 422);
  }

  const padCategory = shadowRow.v5_pad_category?.trim().toUpperCase() ?? "";
  if (!padCategory) {
    return json({ error: "v5_category_missing", decision: shadowRow.v5_decision }, 422);
  }
  const normalizedConfidence = normalizeConfidence(shadowRow.v5_confidence);

  const { data: existing, error: existingError } = await findCurrentCandidate(
    supabase,
    case_id,
    articleId,
    padCategory,
  );

  if (existingError) {
    console.error("[create-pad-v5-ccc] existing candidate select error", existingError);
    return json({ error: "internal_error" }, 500);
  }
  if (existing) {
    if (isSameShadowEvidence(existing.evidence, shadow_id, shadowRow.row_key)) {
      return json({ ok: true, idempotent: true, candidate: existing, candidate_id: existing.id });
    }
    return json({
      error: "state_conflict",
      reason: "current_candidate_exists_different_shadow",
      candidate_id: existing.id,
    }, 409);
  }

  const evidence = {
    schema: "pad_v5_shadow_ccc_v1",
    source: "pad_v5_shadow",
    shadow: {
      id: shadowRow.id,
      row_key: shadowRow.row_key,
      source_version: shadowRow.source_version,
      source_hash: shadowRow.source_hash,
      is_active: shadowRow.is_active,
    },
    v5: {
      decision: shadowRow.v5_decision,
      pad_category: padCategory,
      confidence: normalizedConfidence,
      raw_confidence: shadowRow.v5_confidence,
      note: shadowRow.v5_note,
      requires_operator: shadowRow.v5_requires_operator,
      category_source: shadowRow.v5_category_source,
    },
    codes: {
      cn2008_code: shadowRow.cn2008_code,
      cn2008_label: shadowRow.cn2008_label,
      nst2007_code: shadowRow.nst2007_code,
      nst2007_label: shadowRow.nst2007_label,
      nstr3_code: shadowRow.nstr3_code,
      nstr_label: shadowRow.nstr_label,
    },
    ccc: {
      requires_operator_acceptance: true,
      auto_accept: false,
      auto_propagate: false,
      pricing_effect: "none",
    },
    creation: {
      function: "create-pad-v5-classification-candidate",
      mode: "operator_requested_shadow_to_ccc",
      requested_by: userId,
      dedupe_key: `ccc:pad_v5_shadow:${case_id}:${articleId ?? "null"}:pad_category:${padCategory}:${shadowRow.row_key}`,
    },
  };

  const insertPayload = {
    case_id,
    article_id: articleId,
    source_fact_id: null,
    designation_normalized: buildDesignation(shadowRow),
    candidate_kind: "pad_category",
    candidate_value: padCategory,
    pad_category: padCategory,
    confidence: normalizedConfidence,
    score: normalizedConfidence,
    rank: 1,
    source: "pad_v5_shadow",
    status: "suggested",
    is_current: true,
    evidence,
    rejection_reason: null,
    supersedes_id: null,
    validated_by: null,
    validated_at: null,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("commodity_classification_candidates")
    .insert(insertPayload)
    .select("*")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: replayCandidate, error: replayError } = await findCurrentCandidate(
        supabase,
        case_id,
        articleId,
        padCategory,
      );
      if (replayError) {
        console.error("[create-pad-v5-ccc] replay select error", replayError);
        return json({ error: "internal_error" }, 500);
      }
      if (replayCandidate && isSameShadowEvidence(replayCandidate.evidence, shadow_id, shadowRow.row_key)) {
        return json({ ok: true, idempotent: true, candidate: replayCandidate, candidate_id: replayCandidate.id });
      }
      return json({
        error: "state_conflict",
        reason: "current_candidate_exists",
      }, 409);
    }
    if (isRlsOrPermissionError(insertError)) {
      return json({ error: "forbidden", reason: "rls_write_denied" }, 403);
    }
    console.error("[create-pad-v5-ccc] insert error", insertError);
    return json({ error: "internal_error" }, 500);
  }

  return json({ ok: true, idempotent: false, candidate: inserted });
});
