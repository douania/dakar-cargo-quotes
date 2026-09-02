/**
 * P1-C3-B — unique façade Auth/RLS de l'artefact de projection (preuve).
 *
 * Ne calcule rien, n'autorise rien, ne promeut rien : elle vérifie l'identité,
 * confirme l'accès au dossier sous la RLS existante, puis délègue à
 * `frp_mutate`/`frp_read`, qui dérivent la preuve depuis les tables P1-C2 sous
 * le même verrou par dossier. Aucune écriture vers `quote_facts`,
 * `cargo_lines`, `service.overrides`, `pricing_runs`, `quotation_versions`,
 * PDF ou email n'existe ici, ni directement ni par appel.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { handleCors } from "../_shared/cors.ts";
import {
  getCorrelationId,
  logRuntimeEvent,
  respondError,
  respondOk,
} from "../_shared/runtime.ts";
import {
  executeProjectionCommand,
  mapProjectionRpcError,
  OrchestratorError,
  type ProjectionDeps,
  validateProjectionCommand,
} from "./domain.ts";

const FUNCTION_NAME = "manage-final-request-projection";

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      auth: { persistSession: false },
    },
  );
}

async function handleRequest(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  const correlationId = getCorrelationId(req);
  const startedAt = Date.now();
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  let operation = "invalid";
  let caseId: string | undefined;
  let svc: ReturnType<typeof serviceClient> | null = null;
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new OrchestratorError("VALIDATION_FAILED", "Corps JSON invalide");
    }
    const command = validateProjectionCommand(raw);
    operation = command.operation;
    caseId = command.caseId;

    // Accès au dossier décidé par la RLS existante de quote_cases sous le JWT
    // vérifié. Aucun client privilégié n'existe avant ce contrôle. L'habilitation
    // de reviewer, elle, est revalidée en base sous le verrou du dossier.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${auth.token}` } },
      },
    );
    const { data: accessibleCase, error: caseError } = await userClient.from(
      "quote_cases",
    )
      .select("id").eq("id", command.caseId).maybeSingle();
    if (caseError || !accessibleCase) {
      throw new OrchestratorError(
        "FORBIDDEN_OWNER",
        "Dossier introuvable ou accès refusé",
      );
    }

    svc = serviceClient();
    const deps: ProjectionDeps = {
      async read(actorId, requestedCaseId) {
        const { data, error } = await svc!.rpc("frp_read", {
          p_actor: actorId,
          p_case: requestedCaseId,
        });
        if (error) throw mapProjectionRpcError(error.message ?? "");
        return data;
      },
      async mutate(args) {
        const { data, error } = await svc!.rpc("frp_mutate", {
          p_actor: args.actorId,
          p_case: args.caseId,
          p_key: args.key,
          p_action: args.action,
          p_expected_projection: args.expectedProjectionId,
          p_expected_revision: args.expectedRevisionId,
          p_expected_generation: args.expectedGeneration,
          p_payload: args.payload,
        });
        if (error) throw mapProjectionRpcError(error.message ?? "");
        return data;
      },
    };
    const result = await executeProjectionCommand(command, auth.user.id, deps);
    await logRuntimeEvent(
      svc as unknown as Parameters<typeof logRuntimeEvent>[0],
      {
        correlationId,
        functionName: FUNCTION_NAME,
        op: operation,
        userId: auth.user.id,
        status: "ok",
        httpStatus: 200,
        durationMs: Date.now() - startedAt,
        meta: { case_id: command.caseId },
      },
    );
    return respondOk(result, correlationId);
  } catch (error) {
    const known = error instanceof OrchestratorError
      ? error
      : new OrchestratorError(
        "UPSTREAM_DB_ERROR",
        "Service de projection indisponible",
      );
    try {
      if (!svc) {
        return respondError({
          code: known.code,
          message: known.message,
          correlationId,
        });
      }
      await logRuntimeEvent(
        svc as unknown as Parameters<typeof logRuntimeEvent>[0],
        {
          correlationId,
          functionName: FUNCTION_NAME,
          op: operation,
          userId: auth.user.id,
          status: known.code === "UPSTREAM_DB_ERROR"
            ? "retryable_error"
            : "fatal_error",
          errorCode: known.code,
          httpStatus: known.code === "FORBIDDEN_OWNER"
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
      /* observability is best effort; never replace the real response */
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
