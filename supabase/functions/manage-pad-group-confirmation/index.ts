import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { handleCors, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { loadPadGroupState, syncPadGroupGap } from "../_shared/pad-group-store.ts";

const deps = { authenticate: requireUser, client: createClient };
export async function handleRequest(req: Request, dependencies = deps): Promise<Response> {
  const cors = handleCors(req); if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Méthode non autorisée", 405);
  const auth = await dependencies.authenticate(req); if (auth instanceof Response) return auth;
  try {
    const text = await req.text(); if (text.length > 10000) return errorResponse("Requête trop longue", 400);
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some(k => !["case_id", "action", "decision"].includes(k)) ||
      typeof body.case_id !== "string" || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.case_id) ||
      !["read", "record"].includes(body.action) || (body.action === "read" && body.decision !== undefined)) return errorResponse("Requête invalide", 400);
    const caller = dependencies.client(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${auth.token}` } }, auth: { persistSession: false },
    });
    const access = await caller.rpc(body.action === "record" ? "has_case_write_access" : "has_case_read_access", { _case_id: body.case_id });
    if (access.error || access.data !== true) return errorResponse("Accès au dossier refusé", 403);
    const service = dependencies.client(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    if (body.action === "record") {
      // Exact SQL contract validates keys, scope, CAS and idempotence; actor comes
      // only from verified JWT. No fact promotion, tariff update or email.
      const recorded = await service.rpc("record_pad_group_confirmation", { p_case_id: body.case_id, p_actor: auth.user.id, p_request: body.decision });
      if (recorded.error) return errorResponse("Confirmation refusée : actualisez les groupes et vérifiez les sources.", recorded.error.code === "40001" ? 409 : 422);
    }
    const state = await loadPadGroupState(service, body.case_id);
    if (body.action === "record") await syncPadGroupGap(service, body.case_id, state);
    return jsonResponse(state);
  } catch { return errorResponse("Confirmation PAD indisponible ; aucune validation ne doit être présumée.", 503); }
}
if (import.meta.main) Deno.serve(req => handleRequest(req));
