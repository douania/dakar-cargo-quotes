/**
 * Phase P1-A2 — manage-quote-scenario
 *
 * SEULE voie d'écriture de public.quote_scenarios, quote_scenario_links,
 * quote_scenario_selections et quote_scenario_mutations. Aucune policy
 * INSERT/UPDATE/DELETE n'existe sur ces tables (migration 20260828200000) et
 * la RPC est révoquée pour public/anon/authenticated : toute mutation passe
 * ici, puis par la RPC atomique service_role-only public.manage_quote_scenario.
 *
 * Chaîne de sécurité (miroir strict de manage-scenario-assumption) :
 *   1. CORS preflight
 *   2. Auth JWT obligatoire (_shared/auth.ts → requireUser)
 *   3. Validation stricte et PURE du payload (domain.ts) — identité, état,
 *      chaîne de révision, points ouverts, promotion et propagation refusés
 *      explicitement et nommément
 *   4. Empreinte de requête calculée SERVEUR (jamais transmise par le client)
 *   5. Contrôle d'accès au dossier via un client USER-SCOPED (anon key + JWT
 *      de l'appelant) → c'est la RLS qui décide ; 403 si inaccessible
 *   6. Client service-role instancié UNIQUEMENT après ce contrôle pour muter.
 *      Les branches de refus n'en créent un que pour JOURNALISER : elles ne
 *      lisent ni n'écrivent aucune donnée de dossier sous ce privilège.
 *   7. Un seul appel RPC, atomique : verrou, transition, supersession,
 *      sélection, idempotence et timeline dans la même transaction
 *
 * HORS PÉRIMÈTRE, garanti : aucun calcul de prix, aucun montant, aucune
 * promotion (ni vers quote_facts, ni vers `promoted_to_final`), aucune
 * propagation d'hypothèse, aucune écriture dans quote_facts /
 * quote_request_lines / quotation_versions / données tarifaires, aucun e-mail,
 * aucun DELETE.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  ERROR_CONFIG,
  getCorrelationId,
  getStatusFromErrorCode,
  logRuntimeEvent,
  respondError,
  respondOk,
} from "../_shared/runtime.ts";
import {
  buildRpcArgs,
  computeRequestFingerprint,
  mapRpcErrorCode,
  validateManageScenarioPayload,
} from "./domain.ts";

export {
  buildFingerprintInput,
  buildRpcArgs,
  computeRequestFingerprint,
  deriveOpenPoints,
  hasMonetaryKeyToken,
  jsonbTextByteLength,
  mapRpcErrorCode,
  snapshotStructuralViolation,
  stableStringify,
  validateManageScenarioPayload,
  validateScopeSnapshot,
} from "./domain.ts";

const FUNCTION_NAME = "manage-quote-scenario";

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

    // Validation pure. PROMOTION_NOT_ALLOWED et PROPAGATION_NOT_ALLOWED sont
    // conservés en `meta.reason` pour que ces deux refus doctrinaux restent
    // lisibles et traçables, au lieu d'être noyés dans une 400 générique.
    const validated = validateManageScenarioPayload(body);
    if (!validated.ok) {
      await logEvent(getServiceClient(), {
        correlationId,
        functionName: FUNCTION_NAME,
        op: "validate",
        userId,
        status: "fatal_error",
        errorCode: "VALIDATION_FAILED",
        httpStatus: 400,
        durationMs: Date.now() - startMs,
        meta: { reason: validated.code },
      });
      return respondError({
        code: "VALIDATION_FAILED",
        message: validated.message,
        correlationId,
        meta: { reason: validated.code },
      });
    }
    const request = validated.value;

    // Contrôle d'accès au dossier sous l'identité de l'appelant : la RLS de
    // quote_cases décide. Aucun client service-role n'est créé avant ce point
    // pour accéder à une donnée de dossier.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      },
    );

    const { data: caseRow, error: caseErr } = await userClient
      .from("quote_cases")
      .select("id")
      .eq("id", request.case_id)
      .maybeSingle();

    if (caseErr || !caseRow) {
      await logEvent(getServiceClient(), {
        correlationId,
        functionName: FUNCTION_NAME,
        op: "ownership",
        userId,
        status: "fatal_error",
        errorCode: "FORBIDDEN_OWNER",
        httpStatus: 403,
        durationMs: Date.now() - startMs,
      });
      return respondError({
        code: "FORBIDDEN_OWNER",
        message: "Dossier introuvable ou accès refusé",
        correlationId,
      });
    }

    // Empreinte calculée serveur : un client ne peut ni la choisir ni la
    // contourner, donc « même clé + contenu différent » échoue toujours.
    // Elle ne couvre PAS `scope_hash` : le hash de périmètre est calculé par la
    // base sur la forme jsonb normalisée, seule autorité sur l'identité d'un
    // périmètre.
    const fingerprint = await computeRequestFingerprint(request);

    const svc = getServiceClient();
    const { data, error: rpcErr } = await svc.rpc(
      "manage_quote_scenario",
      buildRpcArgs(request, userId, fingerprint),
    );

    if (rpcErr) {
      const message = rpcErr.message ?? JSON.stringify(rpcErr);
      const code = mapRpcErrorCode(message);
      // Statut et code HTTP dérivés de la MÊME table que la réponse
      // (`ERROR_CONFIG`) : la RPC P1-A2 lève aussi bien FORBIDDEN_CROSS_CASE
      // (403) qu'IDEMPOTENCY_CONFLICT (409), qu'un couple codé en dur
      // journaliserait à tort en 400.
      await logEvent(svc, {
        correlationId,
        functionName: FUNCTION_NAME,
        op: "rpc",
        userId,
        status: getStatusFromErrorCode(code),
        errorCode: code,
        httpStatus: ERROR_CONFIG[code].httpStatus,
        durationMs: Date.now() - startMs,
        meta: { operation: request.operation },
      });
      return respondError({ code, message, correlationId });
    }

    await logEvent(svc, {
      correlationId,
      functionName: FUNCTION_NAME,
      op: request.operation,
      userId,
      status: "ok",
      httpStatus: 200,
      durationMs: Date.now() - startMs,
      meta: { operation: request.operation, case_id: request.case_id },
    });

    return respondOk(data, correlationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    try {
      await logEvent(getServiceClient(), {
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
