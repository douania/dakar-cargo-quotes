// PAD-EXPORT-SUGGEST-BOOTSTRAP-1 Lot 1
// Creates operator-review PAD category candidates for EXPORT/CONTENEUR only.
// Writes only public.commodity_classification_candidates under caller RLS.
// No quote_facts/case_facts/cargo.* writes. No propagation.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { callAI, parseAIResponse } from "../_shared/ai-client.ts";
import { extractAndParseJSON } from "../_shared/json-parser.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const VALID_PAD_CATEGORY_RE = /^[TPC][0-9]{2}$/;
const MAX_RECOMMENDATIONS = 3;
const FACT_KEYS = [
  "service.package",
  "cargo.description",
  "cargo.containers",
  "cargo.pad_category",
] as const;

type FactKey = typeof FACT_KEYS[number];

type QuoteFact = {
  fact_key: FactKey;
  value_text: string | null;
  value_json: unknown;
};

type ExportTariffRow = {
  classification: string | null;
};

type AliasRow = {
  normalized_term: string | null;
  pad_category: string | null;
};

type AIRecommendation = {
  pad_category?: unknown;
  confidence?: unknown;
  justification_fr?: unknown;
  matching_aliases?: unknown;
};

type ValidRecommendation = {
  pad_category: string;
  confidence: number;
  justification_fr: string;
  matching_aliases: string[];
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function readTextFact(facts: QuoteFact[], key: FactKey): string {
  const row = facts.find((f) => f.fact_key === key);
  return (row?.value_text ?? "").trim();
}

function readJsonOrTextFact(facts: QuoteFact[], key: FactKey): unknown {
  const row = facts.find((f) => f.fact_key === key);
  return row?.value_json ?? row?.value_text ?? null;
}

function hasContainers(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "[]") return false;
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.length > 0 : true;
    } catch {
      return true;
    }
  }
  return value != null;
}

function normalizeConfidence(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    const scaled = value > 1 && value <= 100 ? value / 100 : value;
    return Math.round(Math.max(0, Math.min(1, scaled)) * 100) / 100;
  }
  if (typeof value === "string") {
    if (value === "high") return 0.85;
    if (value === "medium") return 0.6;
    if (value === "low") return 0.35;
  }
  return 0.35;
}

function normalizeCategory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const category = value.trim().toUpperCase();
  return VALID_PAD_CATEGORY_RE.test(category) ? category : null;
}

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader) return json({ ok: false, error: "unauthorized", reason: "missing_authorization" }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return json({ ok: false, error: "unauthorized", reason: "invalid_token" }, 401);
  }

  let body: { case_id?: unknown; article_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_input", details: "invalid_json" }, 400);
  }

  if (typeof body.case_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.case_id)) {
    return json({ ok: false, error: "invalid_input", details: "case_id_invalid" }, 400);
  }
  if (body.article_id != null && (typeof body.article_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.article_id))) {
    return json({ ok: false, error: "invalid_input", details: "article_id_invalid" }, 400);
  }

  const caseId = body.case_id;
  const articleId = (body.article_id as string | undefined) ?? null;

  const { data: canWrite, error: accessError } = await supabase.rpc("has_case_write_access", { _case_id: caseId });
  if (accessError) {
    console.error("[create-pad-recommendation-candidates] access check failed", accessError);
    return json({ ok: false, error: "internal_error" }, 500);
  }
  if (canWrite !== true) {
    return json({ ok: false, error: "forbidden", reason: "rls_write_denied" }, 403);
  }

  const { data: facts, error: factsError } = await supabase
    .from("quote_facts")
    .select("fact_key,value_text,value_json")
    .eq("case_id", caseId)
    .eq("is_current", true)
    .in("fact_key", [...FACT_KEYS]);

  if (factsError) {
    console.error("[create-pad-recommendation-candidates] facts select failed", factsError);
    return json({ ok: false, error: "internal_error" }, 500);
  }

  const currentFacts = (facts ?? []) as QuoteFact[];
  const servicePackage = readTextFact(currentFacts, "service.package").toUpperCase();
  const cargoDescription = readTextFact(currentFacts, "cargo.description");
  const containers = readJsonOrTextFact(currentFacts, "cargo.containers");
  const existingPadCategory = readTextFact(currentFacts, "cargo.pad_category");

  if (servicePackage !== "EXPORT_SENEGAL") {
    return json({ ok: false, error: "scope_not_export", details: { service_package: servicePackage || null } }, 422);
  }
  if (!hasContainers(containers)) {
    return json({ ok: false, error: "scope_not_container" }, 422);
  }
  if (existingPadCategory) {
    return json({ ok: false, error: "pad_category_already_set", details: { pad_category: existingPadCategory } }, 409);
  }
  if (cargoDescription.length < 3) {
    return json({ ok: false, error: "missing_cargo_description" }, 422);
  }

  const { data: tariffRows, error: tariffError } = await supabase
    .from("port_tariffs")
    .select("classification")
    .eq("provider", "PAD")
    .eq("category", "DROIT_PASSAGE")
    .eq("operation_type", "EXPORT")
    .eq("cargo_type", "CONTENEUR")
    .eq("is_active", true);

  if (tariffError) {
    console.error("[create-pad-recommendation-candidates] tariff select failed", tariffError);
    return json({ ok: false, error: "internal_error" }, 500);
  }

  const exportCategories = Array.from(
    new Set(
      ((tariffRows ?? []) as ExportTariffRow[])
        .map((row) => normalizeCategory(row.classification))
        .filter((category): category is string => Boolean(category)),
    ),
  ).sort();

  if (exportCategories.length === 0) {
    return json({ ok: false, error: "export_tariffs_not_found" }, 422);
  }

  const { data: aliases } = await supabase
    .from("pad_designation_aliases")
    .select("normalized_term,pad_category")
    .eq("is_validated", true)
    .in("pad_category", exportCategories)
    .order("pad_category");

  const aliasesByCategory: Record<string, string[]> = {};
  for (const row of ((aliases ?? []) as AliasRow[])) {
    const category = normalizeCategory(row.pad_category);
    const term = row.normalized_term?.trim();
    if (!category || !term) continue;
    aliasesByCategory[category] ??= [];
    if (aliasesByCategory[category].length < 5) aliasesByCategory[category].push(term);
  }

  const catalog = exportCategories.map((category) => {
    const examples = aliasesByCategory[category] ?? [];
    return `${category}: ${examples.join(", ") || "aucun alias valide charge"}`;
  }).join("\n");

  const aiResponse = await callAI(
    [
      {
        role: "system",
        content: [
          "Tu aides un operateur a preparer des candidats de classification PAD export.",
          "Tu ne fixes jamais un tarif et tu ne valides jamais automatiquement.",
          "Retourne uniquement des categories presentes dans le catalogue EXPORT/CONTENEUR fourni.",
          `Categories autorisees: ${exportCategories.join(", ")}`,
          "Maximum 3 recommandations. Ne cree pas une recommandation par tarif.",
          "JSON strict: {\"recommendations\":[{\"pad_category\":\"Txx\",\"confidence\":\"high|medium|low\",\"justification_fr\":\"...\",\"matching_aliases\":[\"...\"]}]}",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Marchandise: ${cargoDescription}`,
          "Scope: EXPORT / CONTENEUR",
          "Catalogue PAD export conteneur actif:",
          catalog,
        ].join("\n"),
      },
    ],
    { model: "google/gemini-2.5-flash", temperature: 0.2, maxTokens: 900 },
  );

  if (!aiResponse.ok) {
    if (aiResponse.status === 429) return json({ ok: false, error: "ai_rate_limited" }, 429);
    if (aiResponse.status === 402) return json({ ok: false, error: "ai_credits_exhausted" }, 402);
    const errText = await aiResponse.text();
    console.error("[create-pad-recommendation-candidates] AI service error", aiResponse.status, errText);
    return json({ ok: false, error: "ai_service_error" }, 502);
  }

  let parsed: { recommendations?: AIRecommendation[] };
  try {
    const rawContent = await parseAIResponse(aiResponse);
    parsed = extractAndParseJSON<{ recommendations?: AIRecommendation[] }>(rawContent, {
      label: "create-pad-recommendation-candidates",
      expectRoot: "object",
    });
  } catch (err) {
    console.error("[create-pad-recommendation-candidates] AI JSON parse failed", err);
    return json({ ok: false, error: "ai_invalid_json" }, 502);
  }

  const seen = new Set<string>();
  const recommendations: ValidRecommendation[] = (Array.isArray(parsed.recommendations) ? parsed.recommendations : [])
    .map((rec) => {
      const category = normalizeCategory(rec.pad_category);
      if (!category || !exportCategories.includes(category) || seen.has(category)) return null;
      seen.add(category);
      const justification = typeof rec.justification_fr === "string" && rec.justification_fr.trim()
        ? rec.justification_fr.trim()
        : "Suggestion IA a confirmer par l'operateur.";
      const matchingAliases = Array.isArray(rec.matching_aliases)
        ? rec.matching_aliases.filter((v): v is string => typeof v === "string").slice(0, 5)
        : [];
      return {
        pad_category: category,
        confidence: normalizeConfidence(rec.confidence),
        justification_fr: justification,
        matching_aliases: matchingAliases,
      };
    })
    .filter((rec): rec is ValidRecommendation => Boolean(rec))
    .slice(0, MAX_RECOMMENDATIONS);

  if (recommendations.length === 0) {
    return json({ ok: true, created_count: 0, candidates: [], message: "no_valid_export_recommendation" });
  }

  let existingQuery = supabase
    .from("commodity_classification_candidates")
    .select("id,candidate_value")
    .eq("case_id", caseId)
    .eq("candidate_kind", "pad_category")
    .eq("source", "ai_suggestion")
    .eq("is_current", true)
    .in("candidate_value", recommendations.map((rec) => rec.pad_category));

  existingQuery = articleId === null ? existingQuery.is("article_id", null) : existingQuery.eq("article_id", articleId);

  const { data: existingRows, error: existingError } = await existingQuery;
  if (existingError) {
    console.error("[create-pad-recommendation-candidates] existing select failed", existingError);
    return json({ ok: false, error: "internal_error" }, 500);
  }

  const existingCategories = new Set((existingRows ?? []).map((row) => row.candidate_value));
  const insertPayload = recommendations
    .filter((rec) => !existingCategories.has(rec.pad_category))
    .map((rec, idx) => ({
      case_id: caseId,
      article_id: articleId,
      source_fact_id: null,
      designation_normalized: cargoDescription.toLowerCase().trim(),
      candidate_kind: "pad_category",
      candidate_value: rec.pad_category,
      pad_category: rec.pad_category,
      confidence: rec.confidence,
      score: rec.confidence,
      rank: idx + 1,
      source: "ai_suggestion",
      status: "suggested",
      is_current: true,
      evidence: {
        schema: "pad_export_recommendation_candidate_v1",
        operation_type: "EXPORT",
        cargo_type: "CONTENEUR",
        auto_accept: false,
        auto_propagate: false,
        pricing_effect: "none",
        map8b_export_safe: false,
        requires_operator_acceptance: true,
        propagation_blocked_reason: "MAP-8B is not export-safe",
        recommendation: {
          method: "ai_suggestion_validated_against_active_export_container_port_tariffs",
          justification_fr: rec.justification_fr,
          matching_aliases: rec.matching_aliases,
          max_recommendations: MAX_RECOMMENDATIONS,
        },
        source_facts: {
          service_package: servicePackage,
          cargo_description: cargoDescription,
          containers_present: true,
          cargo_pad_category_absent: true,
        },
        creation: {
          function: "create-pad-recommendation-candidates",
          requested_by: userData.user.id,
        },
      },
      rejection_reason: null,
      supersedes_id: null,
      validated_by: null,
      validated_at: null,
    }));

  if (insertPayload.length === 0) {
    return json({
      ok: true,
      idempotent: true,
      created_count: 0,
      candidates: existingRows ?? [],
    });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("commodity_classification_candidates")
    .insert(insertPayload)
    .select("*");

  if (insertError) {
    console.error("[create-pad-recommendation-candidates] insert failed", insertError);
    return json({ ok: false, error: insertError.code === "23505" ? "state_conflict" : "internal_error" }, insertError.code === "23505" ? 409 : 500);
  }

  return json({
    ok: true,
    idempotent: false,
    created_count: inserted?.length ?? 0,
    candidates: inserted ?? [],
  });
});
