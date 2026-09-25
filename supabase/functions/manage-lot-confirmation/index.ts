/** MULTI-LOT-TERMINAL-1 — read and record explicit per-lot decisions (GO CTO 2026-09-25).
 * Caller JWT required; case access is proven under that JWT before any service-role call.
 * The actor always comes from the verified JWT. No fact, tariff, status or e-mail write; the
 * only side effect besides the decision is the existing PAD gap sync, as after a PAD decision.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { handleCors, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { loadLotConfirmationState } from "../_shared/lot-confirmation-store.ts";
import { loadPadGroupState, syncPadGroupGapAfterDecision } from "../_shared/pad-group-store.ts";

const deps = { authenticate: requireUser, client: createClient };
const CASE_ID = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
/** Refusal codes raised by the SQL writer that the operator can act upon. */
const EXPLAINED = new Set(["LOT_LINE_AMBIGUOUS", "LOT_LINE_CHANGED", "LOT_LINE_ALREADY_BOUND", "LOT_BINDING_REQUIRED",
  "LOT_SCOPE_UNSUPPORTED", "LOT_UNIT_INVALID", "LOT_NOTHING_TO_REVOKE", "LOT_CASE_LOCKED", "LOT_CONTEXT_CHANGED",
  "LOT_HEAD_CHANGED", "LOT_IDEMPOTENCY_CONFLICT", "LOT_REQUEST_INVALID"]);

export async function handleRequest(req: Request, dependencies = deps): Promise<Response> {
  const cors = handleCors(req); if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Méthode non autorisée", 405);
  const auth = await dependencies.authenticate(req); if (auth instanceof Response) return auth;
  try {
    const raw = await req.text(); if (raw.length > 10000) return errorResponse("Requête trop longue", 400);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return errorResponse("Requête invalide", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some(k => !["case_id", "action", "decision"].includes(k)) ||
      typeof body.case_id !== "string" || !CASE_ID.test(body.case_id) || !["read", "record"].includes(String(body.action)) ||
      (body.action === "read" && body.decision !== undefined) ||
      (body.action === "record" && (typeof body.decision !== "object" || body.decision === null || Array.isArray(body.decision)))) {
      return errorResponse("Requête invalide", 400);
    }
    const caseId = body.case_id;
    const caller = dependencies.client(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${auth.token}` } }, auth: { persistSession: false },
    });
    const access = await caller.rpc(body.action === "record" ? "has_case_write_access" : "has_case_read_access", { _case_id: caseId });
    if (access.error || access.data !== true) return errorResponse("Accès au dossier refusé", 403);
    const service = dependencies.client(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    if (body.action === "record") {
      // The SQL writer validates keys, scope, fingerprint, CAS and idempotence.
      const recorded = await service.rpc("record_lot_confirmation", { p_case_id: caseId, p_actor: auth.user.id, p_request: body.decision });
      if (recorded.error) {
        const code = String((recorded.error as { message?: unknown }).message ?? "").trim();
        return jsonResponse({ error: "Décision non enregistrée : actualisez les lots et vérifiez les sources.",
          code: EXPLAINED.has(code) ? code : "LOT_DECISION_REFUSED" }, (recorded.error as { code?: unknown }).code === "40001" ? 409 : 422);
      }
    }
    const state = await loadLotConfirmationState(service, caseId);
    // A binding change can make PAD groups ready or not ready: keep the PAD gap in step with
    // the same readiness rules (never from the global terminal fact). Pricing re-verifies anyway.
    let padGapSynced: boolean | null = null;
    if (body.action === "record") {
      try {
        const pad = await loadPadGroupState(service, caseId, state);
        if (pad.mode === "groups" && pad.context) padGapSynced = await syncPadGroupGapAfterDecision(service, caseId, pad);
      } catch { padGapSynced = false; }
    }
    return jsonResponse({ ...state, pad_gap_synced: padGapSynced });
  } catch {
    return errorResponse("Confirmations par lot indisponibles ; aucune liaison ne doit être présumée.", 503);
  }
}
if (import.meta.main) Deno.serve(req => handleRequest(req));
