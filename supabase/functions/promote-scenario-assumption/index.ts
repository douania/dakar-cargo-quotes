/**
 * Phase P1-A3 — promote-scenario-assumption
 *
 * SEULE voie de promotion d'une hypothèse opérateur vers public.quote_facts.
 * Le front n'a aucun privilège d'écriture ni sur quote_scenario_assumptions
 * (migration 20260828120000) ni sur quote_facts : toute promotion passe ici,
 * puis par la RPC atomique service_role-only
 * public.promote_scenario_assumption.
 *
 * Chaîne de sécurité (alignée sur set-case-fact / manage-scenario-assumption) :
 *   1. CORS preflight
 *   2. Auth JWT obligatoire (_shared/auth.ts → requireUser)
 *   3. Validation stricte et PURE du payload (domain.ts) — masse, attestation
 *      manquante et clé non promouvable sont refusées avec des codes DISTINCTS
 *   4. Empreinte de requête calculée SERVEUR (jamais transmise par le client)
 *   5. Contrôle d'accès au dossier via un client USER-SCOPED (anon key + JWT
 *      de l'appelant) → c'est la RLS qui décide ; 403 si inaccessible
 *   6. Client service-role instancié UNIQUEMENT après ce contrôle
 *   7. Un seul appel RPC, atomique, qui verrouille, vérifie les échos
 *      (statut, valeur, fait courant, périmètre de scénario), écrit le fait via
 *      supersede_fact, clôt l'hypothèse, enregistre le registre append-only et
 *      journalise la timeline dans la MÊME transaction
 *
 * HORS PÉRIMÈTRE, garanti : aucun batch, aucune dé-promotion, aucun calcul de
 * prix, aucune écriture dans quote_gaps / client_gap_requests / quote_scenarios
 * / quote_request_lines / quotation_versions / données tarifaires, aucun DELETE,
 * aucun email, aucun PDF, aucun changement de statut de dossier ou de scénario.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  getCorrelationId,
  respondOk,
  respondError,
  logRuntimeEvent,
} from "../_shared/runtime.ts";
import {
  buildRpcArgs,
  computeRequestFingerprint,
  mapRpcErrorCode,
  validatePromotionPayload,
} from "./domain.ts";

export {
  buildFingerprintInput,
  buildRpcArgs,
  computeRequestFingerprint,
  findPromotableFactKey,
  hasControlCharacter,
  isMonetaryFactKey,
  mapRpcErrorCode,
  promotionViolation,
  stableStringify,
  validatePromotionPayload,
} from "./domain.ts";

const FUNCTION_NAME = "promote-scenario-assumption";

function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/**
 * `logRuntimeEvent` déclare son client via un stub structurel qui ne coïncide
 * pas avec le `SupabaseClient` de jsr:@supabase/supabase-js@2 — dette de types
 * connue de `_shared/runtime.ts`, hors périmètre de ce lot. Une seule
 * conversion, ici, plutôt que cinq erreurs `deno check` ajoutées au baseline.
 */
async function logEvent(
  client: unknown,
  entry: Parameters<typeof logRuntimeEvent>[1],
): Promise<void> {
  await logRuntimeEvent(client as Parameters<typeof logRuntimeEvent>[0], entry);
}

async function handleRequest(req: Request): Promise<Response> {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const correlationId = getCorrelationId(req);
  const startMs = Date.now();

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;
  let serviceClient: ReturnType<typeof getServiceClient> | null = null;

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return respondError({
        code: "VALIDATION_FAILED",
        message: "Corps JSON invalide",
        correlationId,
      });
    }

    // Validation pure. BATCH_NOT_ALLOWED, ATTESTATION_REQUIRED et
    // FACT_KEY_NOT_PROMOTABLE sont distingués pour que ces trois refus — les
    // seuls qui portent une doctrine — soient lisibles et traçables au lieu
    // d'être noyés dans une 400 générique.
    const validated = validatePromotionPayload(body);
    if (!validated.ok) {
      return respondError({
        code: "VALIDATION_FAILED",
        message: validated.message,
        correlationId,
        meta: { reason: validated.code },
      });
    }
    const request = validated.value;

    // Contrôle d'accès au dossier sous l'identité de l'appelant : la RLS de
    // quote_cases décide. Aucun client service-role n'est créé avant ce point.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );

    const { data: caseRow, error: caseErr } = await userClient
      .from("quote_cases")
      .select("id")
      .eq("id", request.case_id)
      .maybeSingle();

    if (caseErr || !caseRow) {
      return respondError({
        code: "FORBIDDEN_OWNER",
        message: "Dossier introuvable ou accès refusé",
        correlationId,
      });
    }

    // Empreinte calculée serveur : un client ne peut ni la choisir ni la
    // contourner, donc « même clé + contenu différent » échoue toujours.
    const fingerprint = await computeRequestFingerprint(request);

    // L'élévation service-role ne se produit qu'APRÈS la preuve d'accès RLS.
    serviceClient = getServiceClient();
    const { data, error: rpcErr } = await serviceClient.rpc(
      "promote_scenario_assumption",
      buildRpcArgs(request, userId, fingerprint),
    );

    if (rpcErr) {
      const message = rpcErr.message ?? JSON.stringify(rpcErr);
      const code = mapRpcErrorCode(message);
      await logEvent(serviceClient, {
        correlationId,
        functionName: FUNCTION_NAME,
        op: "rpc",
        userId,
        status: code === "UPSTREAM_DB_ERROR" ? "retryable_error" : "fatal_error",
        errorCode: code,
        httpStatus: code === "UPSTREAM_DB_ERROR" ? 500 : 400,
        durationMs: Date.now() - startMs,
        meta: { fact_key: request.fact_key },
      });
      return respondError({ code, message, correlationId });
    }

    await logEvent(serviceClient, {
      correlationId,
      functionName: FUNCTION_NAME,
      op: "promote",
      userId,
      status: "ok",
      httpStatus: 200,
      durationMs: Date.now() - startMs,
      meta: {
        case_id: request.case_id,
        assumption_id: request.assumption_id,
        fact_key: request.fact_key,
        promotion_basis: request.promotion_basis,
      },
    });

    return respondOk(data, correlationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    try {
      if (serviceClient) await logEvent(serviceClient, {
        correlationId,
        functionName: FUNCTION_NAME,
        op: "catch",
        userId,
        status: "fatal_error",
        errorCode: "UNKNOWN",
        httpStatus: 500,
        durationMs: Date.now() - startMs,
      });
    } catch { /* best effort */ }
    return respondError({ code: "UNKNOWN", message, correlationId });
  }
}

// Gardé comme manage-scenario-assumption : l'import depuis un test ne démarre
// aucun serveur.
if (import.meta.main) {
  Deno.serve(handleRequest);
}

export { handleRequest };
