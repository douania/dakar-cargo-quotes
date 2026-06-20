// PAD-PRODUCER-UPSTREAM-1B (Option B) — Producteur PAD séparé et réutilisable.
//
// But métier : quand un dossier contient déjà cargo.description, permettre à
// l'opérateur de générer explicitement des candidats PAD dans
// public.commodity_classification_candidates, SANS calculer le montant PAD et
// SANS écrire cargo.pad_category / pricing.pad_category.
//
// Garde-fous absolus :
//  - Indépendant de build-case-puzzle, run-pricing, quotation-engine, HS10.
//  - Aucune écriture quote_facts / case_facts / cargo.* / pricing.*.
//  - Aucun calcul de montant : droit_passage_value reste null.
//  - Aucun LLM, aucun fuzzy, aucune heuristique commerciale.
//  - Exact match uniquement sur normalized_term (alias PAD validés).
//  - Écriture CCC sous RLS appelant (anon key + JWT), via has_case_write_access.
//    Aucun service_role.
//
// La logique de sélection d'alias et la construction de la row sont des
// fonctions pures exportées (testables sans DB). Le serveur n'est démarré que
// lorsque ce module est le point d'entrée (`import.meta.main`).

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

const VALID_PAD_CATEGORY_RE = /^[TPC][0-9]{2}$/;
const ALIAS_CONFIDENCE = 0.9;

const FACT_KEYS = [
  "cargo.description",
  "cargo.containers",
  "cargo.weight_kg",
  "cargo.pad_category",
  "pricing.pad_category",
] as const;
type FactKey = typeof FACT_KEYS[number];

export type QuoteFactRow = {
  id: string;
  fact_key: string;
  value_text: string | null;
  value_json: unknown;
  confidence: number | null;
  source_type: string | null;
  source_excerpt: string | null;
};

export type PadAliasRow = {
  normalized_term: string | null;
  pad_category: string | null;
  bl_term: string | null;
  commodity_category_id: string | null;
  is_validated: boolean | null;
  source_type: string | null;
  source_reference: string | null;
};

export type AliasDecision =
  | { kind: "match"; pad_category: string; alias: PadAliasRow; match_count: number }
  | { kind: "none"; reason: "no_validated_alias_match" }
  | { kind: "collision"; reason: "alias_collision"; categories: string[] };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Normalisation prudente alignée sur run-pricing.normalizePricingText :
 * NFD + suppression diacritiques + collapse espaces + trim + lowercase.
 * Pure, déterministe, sans réseau.
 */
export function normalizePadText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeCategory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const category = value.trim().toUpperCase();
  return VALID_PAD_CATEGORY_RE.test(category) ? category : null;
}

/**
 * Sélection PURE : exact match uniquement sur normalized_term (des deux côtés
 * re-normalisés à l'identique). Pas de fuzzy. Pas de LLM.
 *  - 1 catégorie PAD distincte parmi les alias exacts validés → match
 *  - 0 match → none (no_validated_alias_match)
 *  - >1 catégories distinctes → collision (alias_collision)
 */
export function selectValidatedAliasDecision(args: {
  normalizedDescription: string;
  aliases: PadAliasRow[];
}): AliasDecision {
  const target = args.normalizedDescription;
  if (!target) return { kind: "none", reason: "no_validated_alias_match" };

  const matches: Array<{ category: string; alias: PadAliasRow }> = [];
  for (const alias of args.aliases) {
    if (alias.is_validated !== true) continue;
    const category = normalizeCategory(alias.pad_category);
    if (!category) continue;
    const term = normalizePadText(alias.normalized_term);
    if (!term) continue;
    if (term === target) matches.push({ category, alias });
  }

  if (matches.length === 0) return { kind: "none", reason: "no_validated_alias_match" };

  const categories = Array.from(new Set(matches.map((m) => m.category))).sort();
  if (categories.length > 1) {
    return { kind: "collision", reason: "alias_collision", categories };
  }

  return {
    kind: "match",
    pad_category: categories[0],
    alias: matches[0].alias,
    match_count: matches.length,
  };
}

/**
 * Construction PURE de la row CCC. Aucun montant. status='suggested'.
 */
export function buildCandidateRow(args: {
  caseId: string;
  padCategory: string;
  designationNormalized: string;
  alias: PadAliasRow;
  descriptionFact: QuoteFactRow | null;
  requestedBy: string | null;
}) {
  const { caseId, padCategory, designationNormalized, alias, descriptionFact, requestedBy } = args;
  return {
    case_id: caseId,
    article_id: null,
    source_fact_id: descriptionFact?.id ?? null,
    designation_normalized: designationNormalized,
    candidate_kind: "pad_category",
    candidate_value: padCategory,
    pad_category: padCategory,
    droit_passage_value: null,
    droit_passage_currency: null,
    droit_passage_unit: null,
    source: "validated_alias",
    confidence: ALIAS_CONFIDENCE,
    score: ALIAS_CONFIDENCE,
    rank: 1,
    status: "suggested",
    is_current: true,
    evidence: {
      schema: "pad_upstream_validated_alias_v1",
      producer: "produce-pad-classification-candidates",
      mode: "validated_alias_only",
      pricing_effect: "none",
      auto_propagate: false,
      requires_operator_acceptance: true,
      requested_by: requestedBy,
      alias: {
        normalized_term: alias.normalized_term,
        bl_term: alias.bl_term,
        pad_category: padCategory,
        commodity_category_id: alias.commodity_category_id,
        source_type: alias.source_type,
        source_reference: alias.source_reference,
      },
      source_fact: {
        fact_key: "cargo.description",
        fact_id: descriptionFact?.id ?? null,
        value_text: descriptionFact?.value_text ?? null,
        confidence: descriptionFact?.confidence ?? null,
        source_type: descriptionFact?.source_type ?? null,
        source_excerpt: descriptionFact?.source_excerpt ?? null,
      },
    },
    rejection_reason: null,
    supersedes_id: null,
    validated_by: null,
    validated_at: null,
  };
}

async function findCurrentAliasCandidate(
  supabase: SupabaseClient,
  caseId: string,
  padCategory: string,
) {
  return await supabase
    .from("commodity_classification_candidates")
    .select("*")
    .eq("case_id", caseId)
    .is("article_id", null)
    .eq("candidate_kind", "pad_category")
    .eq("source", "validated_alias")
    .eq("candidate_value", padCategory)
    .eq("is_current", true)
    .limit(1)
    .maybeSingle();
}

function readTextFact(facts: QuoteFactRow[], key: FactKey): string {
  const row = facts.find((f) => f.fact_key === key);
  return (row?.value_text ?? "").trim();
}

export async function handle(req: Request): Promise<Response> {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader) return json({ ok: false, error: "unauthorized", reason: "missing_authorization" }, 401);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return json({ ok: false, error: "unauthorized", reason: "invalid_token" }, 401);
  }

  let body: { case_id?: unknown; mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_input", details: "invalid_json" }, 400);
  }

  if (typeof body.case_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.case_id)) {
    return json({ ok: false, error: "invalid_input", details: "case_id_invalid" }, 400);
  }
  const mode = body.mode ?? "validated_alias_only";
  if (mode !== "validated_alias_only") {
    return json({ ok: false, error: "invalid_input", details: "unsupported_mode" }, 400);
  }
  const caseId = body.case_id;

  // Écriture CCC sous RLS appelant : has_case_write_access est la précondition
  // de la policy INSERT de commodity_classification_candidates.
  const { data: canWrite, error: accessError } = await supabase.rpc("has_case_write_access", { _case_id: caseId });
  if (accessError) {
    console.error("[produce-pad-classification-candidates] access check failed", accessError);
    return json({ ok: false, error: "internal_error" }, 500);
  }
  if (canWrite !== true) {
    return json({ ok: false, error: "forbidden", reason: "rls_write_denied" }, 403);
  }

  const { data: factsData, error: factsError } = await supabase
    .from("quote_facts")
    .select("id,fact_key,value_text,value_json,confidence,source_type,source_excerpt")
    .eq("case_id", caseId)
    .eq("is_current", true)
    .in("fact_key", [...FACT_KEYS]);

  if (factsError) {
    console.error("[produce-pad-classification-candidates] facts select failed", factsError);
    return json({ ok: false, error: "internal_error" }, 500);
  }

  const facts = (factsData ?? []) as QuoteFactRow[];

  // Anti-doublon métier : ne pas suggérer si déjà classé.
  const existingPadCategory = readTextFact(facts, "cargo.pad_category") || readTextFact(facts, "pricing.pad_category");
  if (existingPadCategory) {
    return json({
      ok: true,
      case_id: caseId,
      mode,
      created_count: 0,
      idempotent: false,
      reason: "already_classified",
      candidates: [],
    });
  }

  const descriptionFact = facts.find((f) => f.fact_key === "cargo.description") ?? null;
  const rawDescription = (descriptionFact?.value_text ?? "").trim();
  if (rawDescription.length === 0) {
    return json({
      ok: true,
      case_id: caseId,
      mode,
      created_count: 0,
      idempotent: false,
      reason: "missing_cargo_description",
      candidates: [],
    });
  }

  const normalizedDescription = normalizePadText(rawDescription);

  const { data: aliasData, error: aliasError } = await supabase
    .from("pad_designation_aliases")
    .select("normalized_term,pad_category,bl_term,commodity_category_id,is_validated,source_type,source_reference")
    .eq("is_validated", true);

  if (aliasError) {
    console.error("[produce-pad-classification-candidates] aliases select failed", aliasError);
    return json({ ok: false, error: "internal_error" }, 500);
  }

  const decision = selectValidatedAliasDecision({
    normalizedDescription,
    aliases: (aliasData ?? []) as PadAliasRow[],
  });

  if (decision.kind === "none") {
    return json({
      ok: true,
      case_id: caseId,
      mode,
      created_count: 0,
      idempotent: false,
      reason: "no_validated_alias_match",
      candidates: [],
    });
  }

  if (decision.kind === "collision") {
    return json({
      ok: true,
      case_id: caseId,
      mode,
      created_count: 0,
      idempotent: false,
      reason: "alias_collision",
      details: { categories: decision.categories },
      candidates: [],
    });
  }

  // decision.kind === "match" — idempotence : pré-check current candidate.
  const { data: existing, error: existingError } = await findCurrentAliasCandidate(
    supabase,
    caseId,
    decision.pad_category,
  );
  if (existingError) {
    console.error("[produce-pad-classification-candidates] existing select failed", existingError);
    return json({ ok: false, error: "internal_error" }, 500);
  }
  if (existing) {
    return json({
      ok: true,
      case_id: caseId,
      mode,
      created_count: 0,
      idempotent: true,
      reason: "already_present",
      candidates: [existing],
    });
  }

  const insertPayload = buildCandidateRow({
    caseId,
    padCategory: decision.pad_category,
    designationNormalized: normalizedDescription,
    alias: decision.alias,
    descriptionFact,
    requestedBy: userData.user.id,
  });

  const { data: inserted, error: insertError } = await supabase
    .from("commodity_classification_candidates")
    .insert(insertPayload)
    .select("*")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      // Insert concurrent : replay idempotent, pas d'erreur utilisateur.
      const { data: replay } = await findCurrentAliasCandidate(supabase, caseId, decision.pad_category);
      return json({
        ok: true,
        case_id: caseId,
        mode,
        created_count: 0,
        idempotent: true,
        reason: "already_present",
        candidates: replay ? [replay] : [],
      });
    }
    console.error("[produce-pad-classification-candidates] insert failed", insertError);
    return json({ ok: false, error: "internal_error" }, 500);
  }

  return json({
    ok: true,
    case_id: caseId,
    mode,
    created_count: 1,
    idempotent: false,
    reason: "created",
    candidates: inserted ? [inserted] : [],
  });
}

if (import.meta.main) {
  Deno.serve(handle);
}
