// PAD-ALIAS-ENRICHMENT-PIPELINE-1 / Phase B — Producteur de PROPOSITIONS
// d'enrichissement d'alias PAD (review only).
//
// But métier : quand cargo.description n'a aucun alias PAD validé en match
// exact, permettre à l'opérateur de capturer la désignation inconnue comme une
// PROPOSITION non validée dans public.commodity_designation_matches (CDM).
//
// Garde-fous absolus (Phase B) :
//  - Écrit UNIQUEMENT public.commodity_designation_matches (is_validated=false).
//  - AUCUNE écriture public.pad_designation_aliases (lecture seule, comparaison).
//  - AUCUNE écriture quote_facts / case_facts / cargo.* / pricing.* / CCC.
//  - AUCUN run-pricing, AUCUNE propagation, AUCUNE validation auto d'alias.
//  - AUCUN LLM, AUCUN fuzzy, AUCUNE inférence de catégorie PAD.
//  - Auth = SUPABASE_ANON_KEY + JWT appelant ; écriture sous RLS appelant
//    (has_case_write_access). AUCUN service_role.
//
// Limitation connue (documentée) : Phase B interdit toute migration, donc il
// n'existe pas d'index unique partiel pour les propositions non résolues
// (pad_category_candidate NULL). La déduplication est best-effort via pré-select
// sur (normalized_term, is_validated=false). NE PAS résoudre cela par une
// migration en Phase B.
//
// La logique de décision et la construction de la row sont des fonctions PURES
// exportées (testables sans DB). Le serveur n'est démarré que lorsque ce module
// est le point d'entrée (`import.meta.main`).

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

const MATCH_METHOD = "pad_alias_enrichment_unmatched_description";
const MATCH_REASON = "Unmatched cargo.description captured for PAD alias enrichment review.";
const NOTES_OPERATOR = "Review-only PAD alias enrichment proposal. Not a validated alias. No pricing effect.";
// source_type doit rester dans le CHECK existant de CDM :
// ('manual','document_extraction','operator_correction','seeded_synonym').
const SOURCE_TYPE = "document_extraction";

const FACT_KEYS = [
  "cargo.description",
  "cargo.pad_category",
  "pricing.pad_category",
] as const;
type FactKey = typeof FACT_KEYS[number];

export type QuoteFactRow = {
  fact_key: string;
  value_text: string | null;
};

export type ValidatedAliasRow = {
  normalized_term: string | null;
  is_validated: boolean | null;
};

export type CdmProposalRow = {
  id?: string;
  normalized_term: string | null;
  is_validated: boolean | null;
};

export type EnrichmentDecision =
  | { kind: "missing_cargo_description" }
  | { kind: "already_classified" }
  | { kind: "validated_alias_already_exists" }
  | { kind: "proposal_already_exists"; existing: CdmProposalRow }
  | { kind: "create"; observedTerm: string; normalizedTerm: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Normalisation prudente — IDENTIQUE à produce-pad-classification-candidates :
 * NFD + suppression diacritiques + collapse espaces + trim + lowercase.
 * Pure, déterministe, sans réseau, sans LLM, sans fuzzy.
 */
export function normalizePadAliasText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Décision PURE de la phase d'enrichissement. Aucune écriture, aucune inférence.
 *  - description absente              → missing_cargo_description
 *  - cargo/pricing.pad_category posé  → already_classified
 *  - alias validé exact déjà présent  → validated_alias_already_exists
 *  - proposition CDM non validée déjà → proposal_already_exists (idempotent)
 *  - sinon                            → create
 */
export function selectEnrichmentDecision(args: {
  rawDescription: string | null | undefined;
  existingPadCategory: string | null | undefined;
  validatedAliases: ValidatedAliasRow[];
  existingProposals: CdmProposalRow[];
}): EnrichmentDecision {
  const observedTerm = (args.rawDescription ?? "").trim();
  if (observedTerm.length === 0) return { kind: "missing_cargo_description" };

  if ((args.existingPadCategory ?? "").trim().length > 0) {
    return { kind: "already_classified" };
  }

  const normalizedTerm = normalizePadAliasText(observedTerm);

  const hasValidatedAlias = args.validatedAliases.some(
    (a) => a.is_validated === true && normalizePadAliasText(a.normalized_term) === normalizedTerm,
  );
  if (hasValidatedAlias) return { kind: "validated_alias_already_exists" };

  const existingProposal = args.existingProposals.find(
    (p) => p.is_validated === false && normalizePadAliasText(p.normalized_term) === normalizedTerm,
  );
  if (existingProposal) return { kind: "proposal_already_exists", existing: existingProposal };

  return { kind: "create", observedTerm, normalizedTerm };
}

/**
 * Construction PURE de la row CDM (proposition review-only).
 * Aucune catégorie inférée, aucune confiance revendiquée.
 */
export function buildCommodityDesignationMatchProposal(args: {
  caseId: string;
  observedTerm: string;
  normalizedTerm: string;
}) {
  return {
    observed_term: args.observedTerm,
    normalized_term: args.normalizedTerm,
    commodity_category_id: null,
    pad_category_candidate: null,
    match_score: null,
    match_reason: MATCH_REASON,
    match_method: MATCH_METHOD,
    source_type: SOURCE_TYPE,
    source_reference: `PAD-ALIAS-ENRICHMENT-PIPELINE-1:${args.caseId}:cargo.description`,
    is_validated: false,
    validated_by: null,
    validated_at: null,
    notes_operator: NOTES_OPERATOR,
  };
}

function readTextFact(facts: QuoteFactRow[], key: FactKey): string {
  const row = facts.find((f) => f.fact_key === key);
  return (row?.value_text ?? "").trim();
}

async function findExistingProposal(
  supabase: SupabaseClient,
  normalizedTerm: string,
): Promise<{ data: CdmProposalRow | null; error: { message?: string } | null }> {
  return await supabase
    .from("commodity_designation_matches")
    .select("*")
    .eq("normalized_term", normalizedTerm)
    .eq("is_validated", false)
    .limit(1)
    .maybeSingle<CdmProposalRow>();
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
  const mode = body.mode ?? "unmatched_description_to_cdm";
  if (mode !== "unmatched_description_to_cdm") {
    return json({ ok: false, error: "invalid_input", details: "unsupported_mode" }, 400);
  }
  const caseId = body.case_id;

  // Écriture CDM sous RLS appelant ; has_case_write_access garantit que l'appelant
  // est owner/assigné du dossier d'origine de la proposition.
  const { data: canWrite, error: accessError } = await supabase.rpc("has_case_write_access", { _case_id: caseId });
  if (accessError) {
    console.error("[propose-pad-alias-enrichment] access check failed", accessError);
    return json({ ok: false, error: "internal_error" }, 500);
  }
  if (canWrite !== true) {
    return json({ ok: false, error: "forbidden", reason: "rls_write_denied" }, 403);
  }

  const { data: factsData, error: factsError } = await supabase
    .from("quote_facts")
    .select("fact_key,value_text")
    .eq("case_id", caseId)
    .eq("is_current", true)
    .in("fact_key", [...FACT_KEYS]);

  if (factsError) {
    console.error("[propose-pad-alias-enrichment] facts select failed", factsError);
    return json({ ok: false, error: "internal_error" }, 500);
  }

  const facts = (factsData ?? []) as QuoteFactRow[];
  const rawDescription = readTextFact(facts, "cargo.description");
  const existingPadCategory = readTextFact(facts, "cargo.pad_category") || readTextFact(facts, "pricing.pad_category");

  if (rawDescription.length === 0) {
    return json({ ok: true, case_id: caseId, created_count: 0, idempotent: false, reason: "missing_cargo_description" });
  }
  if (existingPadCategory.length > 0) {
    return json({ ok: true, case_id: caseId, created_count: 0, idempotent: false, reason: "already_classified" });
  }

  const normalizedTerm = normalizePadAliasText(rawDescription);

  // Lecture seule pad_designation_aliases (comparaison exacte) — JAMAIS d'écriture.
  const { data: aliasData, error: aliasError } = await supabase
    .from("pad_designation_aliases")
    .select("normalized_term,is_validated")
    .eq("is_validated", true)
    .eq("normalized_term", normalizedTerm);

  if (aliasError) {
    console.error("[propose-pad-alias-enrichment] aliases select failed", aliasError);
    return json({ ok: false, error: "internal_error" }, 500);
  }

  const { data: existingProposalPre, error: proposalSelError } = await findExistingProposal(supabase, normalizedTerm);
  if (proposalSelError) {
    console.error("[propose-pad-alias-enrichment] proposal pre-select failed", proposalSelError);
    return json({ ok: false, error: "internal_error" }, 500);
  }

  const decision = selectEnrichmentDecision({
    rawDescription,
    existingPadCategory,
    validatedAliases: (aliasData ?? []) as ValidatedAliasRow[],
    existingProposals: existingProposalPre ? [existingProposalPre] : [],
  });

  if (decision.kind === "validated_alias_already_exists") {
    return json({ ok: true, case_id: caseId, created_count: 0, idempotent: false, reason: "validated_alias_already_exists" });
  }
  if (decision.kind === "proposal_already_exists") {
    return json({
      ok: true,
      case_id: caseId,
      created_count: 0,
      idempotent: true,
      reason: "proposal_already_exists",
      proposal: decision.existing,
    });
  }
  // missing_cargo_description / already_classified déjà traités plus haut ; ici → create.
  if (decision.kind !== "create") {
    return json({ ok: true, case_id: caseId, created_count: 0, idempotent: false, reason: decision.kind });
  }

  const insertPayload = buildCommodityDesignationMatchProposal({
    caseId,
    observedTerm: decision.observedTerm,
    normalizedTerm: decision.normalizedTerm,
  });

  const { data: inserted, error: insertError } = await supabase
    .from("commodity_designation_matches")
    .insert(insertPayload)
    .select("*")
    .single();

  if (insertError) {
    // Dédup best-effort : un insert concurrent peut heurter un index unique partiel
    // existant (normalized_term + commodity_category_id|pad_category_candidate).
    // On rejoue alors la proposition non validée existante (idempotent).
    if (insertError.code === "23505") {
      const { data: replay } = await findExistingProposal(supabase, normalizedTerm);
      return json({
        ok: true,
        case_id: caseId,
        created_count: 0,
        idempotent: true,
        reason: "proposal_already_exists",
        proposal: replay ?? undefined,
      });
    }
    console.error("[propose-pad-alias-enrichment] insert failed", insertError);
    return json({ ok: false, error: "internal_error" }, 500);
  }

  return json({
    ok: true,
    case_id: caseId,
    created_count: 1,
    idempotent: false,
    reason: "created",
    proposal: inserted ?? undefined,
  });
}

if (import.meta.main) {
  Deno.serve(handle);
}
