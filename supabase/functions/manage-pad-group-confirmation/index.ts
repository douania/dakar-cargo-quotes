import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { handleCors, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { loadPadGroupState, syncPadGroupGap, syncPadGroupGapAfterDecision } from "../_shared/pad-group-store.ts";
import { groupEvidence } from "./evidence.ts";
import { proposalFingerprint } from "../_shared/scenario-proposal-domain.ts";

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
      !["read", "record", "reconcile_weight"].includes(body.action) || (body.action === "read" && body.decision !== undefined)) return errorResponse("Requête invalide", 400);
    const caller = dependencies.client(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${auth.token}` } }, auth: { persistSession: false },
    });
    const access = await caller.rpc(body.action !== "read" ? "has_case_write_access" : "has_case_read_access", { _case_id: body.case_id });
    if (access.error || access.data !== true) return errorResponse("Accès au dossier refusé", 403);
    const service = dependencies.client(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    if (body.action === "record") {
      // Exact SQL contract validates keys, scope, CAS and idempotence; actor comes
      // only from verified JWT. No fact promotion, tariff update or email.
      const recorded = await service.rpc("record_pad_group_confirmation", { p_case_id: body.case_id, p_actor: auth.user.id, p_request: body.decision });
      if (recorded.error) return errorResponse("Confirmation refusée : actualisez les groupes et vérifiez les sources.", recorded.error.code === "40001" ? 409 : 422);
    }
    const state = await loadPadGroupState(service, body.case_id);
    if (body.action === "reconcile_weight") {
      const onlyWeightConflict = state.issues.length === 1 && state.issues[0].code === "PAD_GROUP_WEIGHT_CONFLICT";
      // A successful retain may be replayed after a lost response. The SQL
      // writer checks its fingerprint before CAS; a different request still fails.
      if (!state.context || (body.decision?.action === "retain" && !onlyWeightConflict && !state.retained_weight)) return errorResponse("Résolvez d’abord les autres contrôles des groupes.", 422);
      const recorded = await service.rpc("record_pad_weight_reconciliation", { p_case_id: body.case_id, p_actor: auth.user.id, p_request: body.decision });
      if (recorded.error) return errorResponse("Rapprochement refusé : actualisez les sources et les confirmations.", recorded.error.code === "40001" ? 409 : 422);
      const fresh = await loadPadGroupState(service, body.case_id);
      await syncPadGroupGap(service, body.case_id, fresh);
      return jsonResponse(fresh);
    }
    // MULTI-LOT-TERMINAL-1: in multi-lot a decision never (re)opens the dossier PAD gap.
    if (body.action === "record") await syncPadGroupGapAfterDecision(service, body.case_id, state);
    // Optional read-only assistance, scoped to the authenticated caller. Never
    // use an unavailable or changed source as evidence for a confirmation.
    let assistance = {};
    let dossierWeight: number | null = null;
    if (state.context) {
      try {
        const current = await service.rpc("read_pad_group_context", { p_case_id: body.case_id });
        if (current.error || current.data?.context_hash !== state.context.context_hash) throw new Error("changed");
        const facts = current.data.facts ?? [];
        const weight = facts.filter((f: { key: string }) => f.key === "cargo.weight_kg");
        const n = weight.length === 1 ? Number(weight[0].number ?? weight[0].text) : NaN;
        dossierWeight = Number.isFinite(n) && n > 0 ? n : null;
        const record = await caller.from("quote_cases").select("thread_id,request_type").eq("id", body.case_id).single();
        if (record.error) throw new Error("case");
        if (record.data.thread_id) {
          const [thread, emails] = await Promise.all([
            caller.from("email_threads").select("client_email").eq("id", record.data.thread_id).single(),
            caller.from("emails").select("id,from_address,body_text,sent_at", { count: "exact" }).eq("thread_ref", record.data.thread_id).order("id").limit(201),
          ]);
          if (thread.error || emails.error || emails.count === null || emails.count > 200 || emails.count !== emails.data?.length) throw new Error("source");
          const scope = facts.filter((f: { key: string }) => ["routing.transport_mode", "routing.movement_direction", "service.package", "contacts.client_email"].includes(f.key))
            .map((f: { key: string; text: unknown; json: unknown; number: unknown }) => ({ fact_key: f.key, value_text: f.text, value_json: f.json, value_number: f.number }))
            .sort((a: { fact_key: string }, b: { fact_key: string }) => a.fact_key.localeCompare(b.fact_key));
          const fingerprint = await proposalFingerprint({ case_id: body.case_id, thread_id: record.data.thread_id,
            request_type: record.data.request_type, client: thread.data.client_email, scope }, emails.data);
          assistance = groupEvidence(state.context.groups, thread.data.client_email, scope, emails.data, fingerprint);
        }
        const fresh = await service.rpc("read_pad_group_context", { p_case_id: body.case_id });
        if (fresh.error || fresh.data?.context_hash !== state.context.context_hash) throw new Error("changed");
      } catch { assistance = {}; dossierWeight = null; }
    }
    return jsonResponse({ ...state, assistance, dossier_weight_kg: dossierWeight });
  } catch { return errorResponse("Confirmation PAD indisponible ; aucune validation ne doit être présumée.", 503); }
}
if (import.meta.main) Deno.serve(req => handleRequest(req));
