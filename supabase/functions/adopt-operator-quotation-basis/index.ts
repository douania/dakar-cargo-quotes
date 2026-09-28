/** Adoption explicite de bases opérateur dans le parcours canonique. */
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
  mapScenarioOutputRpcError,
  validateScenarioOutputRequest,
} from "./domain.ts";

const FUNCTION_NAME = "adopt-operator-quotation-basis";

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function handler(req: Request): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startedAt = Date.now();
  const correlationId = getCorrelationId(req);
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return respondError({
        code: "VALIDATION_FAILED",
        message: "Corps JSON invalide",
        correlationId,
      });
    }
    const validated = validateScenarioOutputRequest(raw);
    if (!validated.ok) {
      return respondError({
        code: "VALIDATION_FAILED",
        message: validated.message,
        correlationId,
      });
    }
    const request = validated.value;

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${auth.token}` } } },
    );

    const [scenarioAccess, runAccess] = await Promise.all([
      userClient.from("quote_scenarios")
        .select("id,case_id,scope_hash")
        .eq("id", request.scenario_id)
        .eq("case_id", request.case_id)
        .maybeSingle(),
      userClient.from("quote_scenario_pricing_runs")
        .select("id,case_id,scenario_id,status,qualification,scenario_scope_hash")
        .eq("id", request.scenario_pricing_run_id)
        .eq("case_id", request.case_id)
        .eq("scenario_id", request.scenario_id)
        .maybeSingle(),
    ]);
    if (scenarioAccess.error || runAccess.error || !scenarioAccess.data || !runAccess.data) {
      return respondError({
        code: "FORBIDDEN_OWNER",
        message: "Scénario ou calcul introuvable, ou accès refusé",
        correlationId,
      });
    }
    if (
      scenarioAccess.data.scope_hash !== request.expected_scope_hash ||
      runAccess.data.scenario_scope_hash !== request.expected_scope_hash
    ) {
      return respondError({
        code: "CONFLICT_INVALID_STATE",
        message: "Le périmètre du scénario a changé",
        correlationId,
      });
    }
    if (
      runAccess.data.status !== "success" ||
      !["provisional", "partial"].includes(runAccess.data.qualification)
    ) {
      return respondError({
        code: "CONFLICT_INVALID_STATE",
        message: "Seul un calcul de scénario réussi et non ferme peut produire une sortie",
        correlationId,
      });
    }

    const { data, error } = await serviceClient.rpc("adopt_operator_quotation_basis", {
      p_case_id: request.case_id,
      p_scenario_id: request.scenario_id,
      p_scenario_pricing_run_id: request.scenario_pricing_run_id,
      p_expected_scope_hash: request.expected_scope_hash,
      p_idempotency_key: request.idempotency_key,
      p_actor_user_id: userId,
    });
    if (error) {
      const code = mapScenarioOutputRpcError(error.message ?? "");
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: FUNCTION_NAME,
        op: "adopt_operator_basis",
        userId,
        status: "fatal_error",
        errorCode: code,
        httpStatus: code === "FORBIDDEN_OWNER" ? 403 : code === "CONFLICT_INVALID_STATE" ? 409 : 400,
        durationMs: Date.now() - startedAt,
      });
      return respondError({ code, message: error.message, correlationId });
    }

    const result = asObject(data);
    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: FUNCTION_NAME,
      op: result.idempotent_replay === true ? "idempotent_hit" : "adopt_operator_basis",
      userId,
      status: "ok",
      httpStatus: 200,
      durationMs: Date.now() - startedAt,
      meta: {
        case_id: request.case_id,
        scenario_id: request.scenario_id,
        scenario_pricing_run_id: request.scenario_pricing_run_id,
        pricing_run_id: typeof result.pricing_run_id === "string" ? result.pricing_run_id : null,
      },
    });
    return respondOk(result, correlationId);
  } catch (error) {
    console.error(`[${FUNCTION_NAME}]`, error);
    return respondError({
      code: "UNKNOWN",
      message: error instanceof Error ? error.message : "Erreur interne",
      correlationId,
    });
  }
}
if (import.meta.main) Deno.serve(handler);
