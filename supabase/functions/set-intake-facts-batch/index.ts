/**
 * DCQ-P0-INTAKE-ATOMIC-BATCH — set-intake-facts-batch
 *
 * Façade Edge FINE du chemin atomique Intake. Elle ne décide rien :
 *   1. CORS, méthode POST, JWT utilisateur (requireUser) ;
 *   2. validation pure du contrat (contract.ts) ;
 *   3. UN appel RPC public.set_intake_facts_batch SOUS LE JWT UTILISATEUR
 *      (client anon + Authorization Bearer) — auth.uid(), droit d'écriture,
 *      allowlist, idempotence, verrou, provenance et confiance sont tranchés
 *      en SQL, dans une transaction unique tout-ou-rien.
 *
 * Le client service_role n'est utilisé QUE pour l'observabilité
 * (runtime_events), jamais pour écrire les données du dossier : aucune écriture
 * canonique ne contourne le JWT utilisateur. Aucun appel à set-case-fact ni
 * ensure-quote-case n'existe ici.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import {
  getCorrelationId,
  logRuntimeEvent,
  respondError,
  respondOk,
} from "../_shared/runtime.ts";
import {
  buildRpcArgs,
  ContractError,
  mapSifbRpcError,
  validateIntakeBatchCommand,
} from "./contract.ts";

const FUNCTION_NAME = "set-intake-facts-batch";

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

async function handleRequest(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;

  // Méthode verrouillée AVANT toute autre décision : le contrat est un POST.
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          Allow: "POST",
        },
      },
    );
  }

  const correlationId = getCorrelationId(req);
  const startedAt = Date.now();

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  let caseId: string | undefined;
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new ContractError("VALIDATION_FAILED", "Corps JSON invalide");
    }
    const command = validateIntakeBatchCommand(raw);
    caseId = command.case_id;

    // Client SOUS LE JWT UTILISATEUR : la RPC voit auth.uid() et le rôle
    // authenticated — seul rôle titulaire d'EXECUTE sur la fonction.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${auth.token}` } },
      },
    );

    const { data, error } = await userClient.rpc(
      "set_intake_facts_batch",
      buildRpcArgs(command),
    );
    if (error) throw mapSifbRpcError(error.message ?? "");

    try {
      await logRuntimeEvent(
        serviceClient() as unknown as Parameters<typeof logRuntimeEvent>[0],
        {
          correlationId,
          functionName: FUNCTION_NAME,
          op: "apply",
          userId: auth.user.id,
          status: "ok",
          httpStatus: 200,
          durationMs: Date.now() - startedAt,
          meta: {
            case_id: command.case_id,
            fact_count: command.facts.length,
            source_type: command.source_type,
            replayed:
              (data as { replayed?: boolean } | null)?.replayed === true,
          },
        },
      );
    } catch {
      /* observabilité best effort */
    }

    return respondOk(data, correlationId);
  } catch (err) {
    const known = err instanceof ContractError ? err : new ContractError(
      "UNKNOWN",
      err instanceof Error ? err.message : String(err),
    );
    try {
      await logRuntimeEvent(
        serviceClient() as unknown as Parameters<typeof logRuntimeEvent>[0],
        {
          correlationId,
          functionName: FUNCTION_NAME,
          op: "apply",
          userId: auth.user.id,
          status: known.code === "UPSTREAM_DB_ERROR"
            ? "retryable_error"
            : "fatal_error",
          errorCode: known.code,
          httpStatus: known.code === "AUTH_INVALID_JWT"
            ? 401
            : known.code === "FORBIDDEN_OWNER"
            ? 403
            : known.code === "CONFLICT_INVALID_STATE"
            ? 409
            : known.code === "VALIDATION_FAILED"
            ? 400
            : 500,
          durationMs: Date.now() - startedAt,
          ...(caseId ? { meta: { case_id: caseId } } : {}),
        },
      );
    } catch {
      /* observabilité best effort — jamais au détriment de la vraie réponse */
    }
    return respondError({
      code: known.code,
      message: known.message,
      correlationId,
    });
  }
}

if (import.meta.main) Deno.serve(handleRequest);
export { handleRequest };
