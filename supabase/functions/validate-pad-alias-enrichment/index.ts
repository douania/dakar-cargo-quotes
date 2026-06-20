// PAD-ALIAS-ENRICHMENT-PIPELINE-1 / Phase C2-D — Validation CDM → PDA
//
// But métier : permettre à un utilisateur pad_admin de valider une proposition
// CDM (commodity_designation_matches) en créant un alias PAD validé dans
// public.pad_designation_aliases (PDA).
//
// Garde-fous absolus (Phase C2-D) :
//  - Auth : JWT appelant validé via requireUser. Rôle vérifié via RPC
//    public.has_pad_admin_role() (STABLE SECURITY DEFINER). Jamais de trust
//    frontend sur le rôle.
//  - validated_by = user.id résolu par auth. JAMAIS depuis le body de la requête.
//  - Écrit public.pad_designation_aliases (is_validated=true, source_type=ai_suggestion_validated).
//  - Écrit public.commodity_designation_matches (is_validated=true, commodity_category_id résolu).
//  - AUCUNE écriture quote_facts, pricing, quote_cases, CCC, case_facts.
//  - AUCUN appel run-pricing, build-case-puzzle, quotation-engine, set-case-fact.
//  - AUCUN LLM, AUCUNE inférence de catégorie.
//  - Clé service_role utilisée pour les écritures DB uniquement, après vérification
//    du rôle appelant. Jamais exposée dans les réponses.
//
// Idempotence / robustesse partielle :
//  - Si PDA existe déjà (même normalized_term, même commodity_category_id) :
//    le CDM est mis à jour si nécessaire, puis retour already_exists.
//  - Si PDA insert échoue par conflit de race (23505) : re-lecture et réponse
//    idempotente si même catégorie, PAD_ALIAS_COLLISION sinon.
//  - Si PDA insert réussit mais CDM update échoue : une relance détectera le
//    PDA existant et complétera le CDM update (retry-safe).
//
// La logique pure (validateInput, detectCollision, buildPdaInsertPayload,
// buildCdmUpdatePayload) est exportée pour tests sans DB.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ─────────────────────────────────────────────────────────────────────────────
// Types publics exportés pour les tests
// ─────────────────────────────────────────────────────────────────────────────

export type ValidatedInput = {
  cdm_id: string;
  commodity_category_id: string;
  source_reference: string | null;
};

export type InputValidationResult =
  | { ok: true; input: ValidatedInput }
  | { ok: false; error: string; details: string };

export type CollisionResult =
  | { kind: "none" }
  | { kind: "same_category"; existingId: string }
  | { kind: "different_category"; existingId: string; existingCategoryId: string };

export type CdmRow = {
  id: string;
  observed_term: string | null;
  normalized_term: string;
  source_reference: string | null;
};

export type CategoryRow = {
  id: string;
  pad_category: string;
};

export type PdaInsertPayload = {
  bl_term: string | null;
  normalized_term: string;
  commodity_category_id: string;
  pad_category: string;
  is_validated: true;
  validated_by: string;
  validated_at: string;
  source_type: "ai_suggestion_validated";
  source_reference: string | null;
};

export type CdmUpdatePayload = {
  commodity_category_id: string;
  pad_category_candidate: null;
  is_validated: true;
  validated_by: string;
  validated_at: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Fonctions pures (exportées, testables sans DB ni réseau)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valide le body de la requête et retourne les inputs normalisés.
 * Pure, sans side-effects.
 */
export function validateInput(body: unknown): InputValidationResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_input", details: "body_not_object" };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.cdm_id !== "string" || !UUID_RE.test(b.cdm_id)) {
    return { ok: false, error: "invalid_input", details: "cdm_id_invalid" };
  }
  if (
    typeof b.commodity_category_id !== "string" ||
    !UUID_RE.test(b.commodity_category_id)
  ) {
    return { ok: false, error: "invalid_input", details: "commodity_category_id_invalid" };
  }

  const raw = b.source_reference;
  const sourceReference =
    raw !== null && raw !== undefined ? String(raw).trim() || null : null;

  return {
    ok: true,
    input: {
      cdm_id: b.cdm_id,
      commodity_category_id: b.commodity_category_id,
      source_reference: sourceReference,
    },
  };
}

/**
 * Détecte une collision de normalized_term dans les aliases PDA existants.
 * Pure, sans side-effects.
 *
 *  - "none"              → aucune ligne existante → créer
 *  - "same_category"     → même catégorie demandée → idempotent
 *  - "different_category" → catégorie différente → 409
 */
export function detectCollision(
  existingAliases: Array<{ id: string; commodity_category_id: string | null }>,
  requestedCategoryId: string,
): CollisionResult {
  // Priorité à tout alias contradictoire, quelle que soit sa position dans le tableau.
  // Un alias avec une catégorie différente bloque même si un alias identique existe aussi.
  const different = existingAliases.find(
    (a) => a.commodity_category_id !== requestedCategoryId,
  );
  if (different) {
    return {
      kind: "different_category",
      existingId: different.id,
      existingCategoryId: different.commodity_category_id ?? "",
    };
  }

  const same = existingAliases.find(
    (a) => a.commodity_category_id === requestedCategoryId,
  );
  if (same) {
    return { kind: "same_category", existingId: same.id };
  }

  return { kind: "none" };
}

/**
 * Construit la payload d'insertion PDA.
 * source_reference : priorité à l'input explicite, fallback CDM.
 * validated_by est toujours l'id caller résolu par auth — jamais le body.
 */
export function buildPdaInsertPayload(args: {
  cdm: CdmRow;
  category: CategoryRow;
  callerId: string;
  sourceReference: string | null;
  now: string;
}): PdaInsertPayload {
  return {
    bl_term: args.cdm.observed_term,
    normalized_term: args.cdm.normalized_term,
    commodity_category_id: args.category.id,
    pad_category: args.category.pad_category,
    is_validated: true,
    validated_by: args.callerId,
    validated_at: args.now,
    source_type: "ai_suggestion_validated",
    source_reference: args.sourceReference ?? args.cdm.source_reference,
  };
}

/**
 * Construit la payload de mise à jour CDM (résolution de la proposition).
 * pad_category_candidate est mis à null car la catégorie est maintenant confirmée.
 */
export function buildCdmUpdatePayload(args: {
  requestedCategoryId: string;
  callerId: string;
  now: string;
}): CdmUpdatePayload {
  return {
    commodity_category_id: args.requestedCategoryId,
    pad_category_candidate: null,
    is_validated: true,
    validated_by: args.callerId,
    validated_at: args.now,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler HTTP
// ─────────────────────────────────────────────────────────────────────────────

export async function handle(req: Request): Promise<Response> {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  // 1. Authentification : résolution caller par JWT
  const authResult = await requireUser(req);
  if (authResult instanceof Response) return authResult;
  const { user, token } = authResult;

  // 2. Vérification du rôle pad_admin via RPC SECURITY DEFINER (caller JWT client).
  //    Jamais de trust frontend — le rôle est vérifié en DB côté serveur.
  const callerClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const { data: isAdmin, error: roleError } = await callerClient.rpc("has_pad_admin_role");
  if (roleError) {
    console.error("[validate-pad-alias-enrichment] role check error", roleError.message);
    return json({ ok: false, error: "internal_error" }, 500);
  }
  if (isAdmin !== true) {
    return json({ ok: false, error: "PAD_ADMIN_REQUIRED" }, 403);
  }

  // 3. Validation de l'input
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_input", details: "invalid_json" }, 400);
  }

  const validation = validateInput(body);
  if (!validation.ok) {
    return json({ ok: false, error: validation.error, details: validation.details }, 400);
  }
  const { input } = validation;

  // 4. Lectures et écritures DB via service_role.
  //    Rôle caller vérifié ci-dessus. Service_role utilisé pour bypasser RLS
  //    sur PDA (post C2-C) et pour garantir les lectures CDM/category sans
  //    dépendre des policies authenticated.
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 4a. Lecture CDM
  const { data: cdm, error: cdmReadError } = await serviceClient
    .from("commodity_designation_matches")
    .select(
      "id, observed_term, normalized_term, commodity_category_id, pad_category_candidate, is_validated, source_reference",
    )
    .eq("id", input.cdm_id)
    .maybeSingle();

  if (cdmReadError) {
    console.error("[validate-pad-alias-enrichment] CDM read error", cdmReadError.message);
    return json({ ok: false, error: "internal_error" }, 500);
  }
  if (!cdm) {
    return json({ ok: false, error: "CDM_NOT_FOUND" }, 404);
  }
  if (!cdm.normalized_term || cdm.normalized_term.trim() === "") {
    return json({ ok: false, error: "CDM_NORMALIZED_TERM_REQUIRED" }, 422);
  }

  // 4b. Lecture catégorie cible
  const { data: category, error: catReadError } = await serviceClient
    .from("commodity_categories")
    .select("id, pad_category, designation_raw")
    .eq("id", input.commodity_category_id)
    .maybeSingle();

  if (catReadError) {
    console.error("[validate-pad-alias-enrichment] category read error", catReadError.message);
    return json({ ok: false, error: "internal_error" }, 500);
  }
  if (!category) {
    return json({ ok: false, error: "TARGET_CATEGORY_NOT_FOUND" }, 404);
  }
  if (!category.pad_category || category.pad_category.trim() === "") {
    return json({ ok: false, error: "TARGET_PAD_CATEGORY_REQUIRED" }, 422);
  }

  // 4c. Détection de collision : recherche PDA par normalized_term (toutes lignes)
  const { data: existingAliases, error: collisionError } = await serviceClient
    .from("pad_designation_aliases")
    .select("id, commodity_category_id")
    .eq("normalized_term", cdm.normalized_term);

  if (collisionError) {
    console.error("[validate-pad-alias-enrichment] collision check error", collisionError.message);
    return json({ ok: false, error: "internal_error" }, 500);
  }

  const collision = detectCollision(existingAliases ?? [], input.commodity_category_id);

  if (collision.kind === "different_category") {
    return json(
      {
        ok: false,
        error: "PAD_ALIAS_COLLISION",
        existing_alias_id: collision.existingId,
        existing_commodity_category_id: collision.existingCategoryId,
        requested_commodity_category_id: input.commodity_category_id,
      },
      409,
    );
  }

  const now = new Date().toISOString();

  // 4d. Chemin idempotent : PDA existe déjà avec la même catégorie
  if (collision.kind === "same_category") {
    // CDM peut être dans un état partiel (PDA inséré lors d'un run précédent
    // mais CDM update échoué) — on le résout ici si nécessaire.
    let cdmResolved = false;
    if (!cdm.is_validated || cdm.commodity_category_id !== input.commodity_category_id) {
      const cdmUpdate = buildCdmUpdatePayload({
        requestedCategoryId: input.commodity_category_id,
        callerId: user.id,
        now,
      });
      const { error: cdmUpdateErr } = await serviceClient
        .from("commodity_designation_matches")
        .update(cdmUpdate)
        .eq("id", input.cdm_id);
      if (cdmUpdateErr) {
        console.error("[validate-pad-alias-enrichment] CDM update (idempotent) error", cdmUpdateErr.message);
        return json({ ok: false, error: "internal_error" }, 500);
      }
      cdmResolved = true;
    }
    return json({
      ok: true,
      status: cdmResolved ? "validated_existing" : "already_exists",
      pad_designation_alias_id: collision.existingId,
      commodity_designation_match_id: input.cdm_id,
      normalized_term: cdm.normalized_term,
      commodity_category_id: input.commodity_category_id,
    });
  }

  // 4e. Insert PDA (chemin nominal)
  const pdaPayload = buildPdaInsertPayload({
    cdm: cdm as CdmRow,
    category: category as CategoryRow,
    callerId: user.id,
    sourceReference: input.source_reference,
    now,
  });

  const { data: insertedPda, error: pdaInsertError } = await serviceClient
    .from("pad_designation_aliases")
    .insert(pdaPayload)
    .select("id")
    .single();

  if (pdaInsertError) {
    // Race-condition : un insert concurrent a gagné sur le même (normalized_term, commodity_category_id).
    // On re-lit PDA et on retourne idempotent si même catégorie, collision sinon.
    if (pdaInsertError.code === "23505") {
      const { data: raceAliases } = await serviceClient
        .from("pad_designation_aliases")
        .select("id, commodity_category_id")
        .eq("normalized_term", cdm.normalized_term);
      const raceCollision = detectCollision(raceAliases ?? [], input.commodity_category_id);
      if (raceCollision.kind === "same_category") {
        // CDM peut encore être non résolu — même logique que le chemin idempotent.
        let cdmResolved = false;
        if (!cdm.is_validated || cdm.commodity_category_id !== input.commodity_category_id) {
          const cdmUpdate = buildCdmUpdatePayload({
            requestedCategoryId: input.commodity_category_id,
            callerId: user.id,
            now,
          });
          const { error: cdmRaceUpdateErr } = await serviceClient
            .from("commodity_designation_matches")
            .update(cdmUpdate)
            .eq("id", input.cdm_id);
          if (cdmRaceUpdateErr) {
            console.error("[validate-pad-alias-enrichment] CDM update (race) error", cdmRaceUpdateErr.message);
            return json({ ok: false, error: "internal_error" }, 500);
          }
          cdmResolved = true;
        }
        return json({
          ok: true,
          status: cdmResolved ? "validated_existing" : "already_exists",
          pad_designation_alias_id: raceCollision.existingId,
          commodity_designation_match_id: input.cdm_id,
          normalized_term: cdm.normalized_term,
          commodity_category_id: input.commodity_category_id,
        });
      }
      if (raceCollision.kind === "different_category") {
        return json(
          {
            ok: false,
            error: "PAD_ALIAS_COLLISION",
            existing_alias_id: raceCollision.existingId,
            existing_commodity_category_id: raceCollision.existingCategoryId,
            requested_commodity_category_id: input.commodity_category_id,
          },
          409,
        );
      }
    }
    console.error("[validate-pad-alias-enrichment] PDA insert error", pdaInsertError.message);
    return json({ ok: false, error: "internal_error" }, 500);
  }

  // 4f. Update CDM : marquage validé/résolu
  //     Si cette étape échoue, une relance détectera le PDA existant (collision.same_category)
  //     et tentera à nouveau le CDM update → retry-safe sans transaction DB.
  const cdmUpdate = buildCdmUpdatePayload({
    requestedCategoryId: input.commodity_category_id,
    callerId: user.id,
    now,
  });

  const { error: cdmUpdateError } = await serviceClient
    .from("commodity_designation_matches")
    .update(cdmUpdate)
    .eq("id", input.cdm_id);

  if (cdmUpdateError) {
    console.error(
      "[validate-pad-alias-enrichment] CDM update error (PDA inserted, retry-safe)",
      cdmUpdateError.message,
    );
    return json({ ok: false, error: "internal_error" }, 500);
  }

  return json({
    ok: true,
    status: "created",
    pad_designation_alias_id: insertedPda.id,
    commodity_designation_match_id: input.cdm_id,
    normalized_term: cdm.normalized_term,
    commodity_category_id: input.commodity_category_id,
  });
}

if (import.meta.main) {
  Deno.serve(handle);
}
