// Phase P2.1 — Send external quote request to partner
// COCKPIT-10: Professional partner email with purpose-specific template
// SECURITY: requireUser is mandatory because verify_jwt=false
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { buildPartnerEmailBody } from "../_shared/partner-email-template.ts";

const PURPOSE_LABELS: Record<string, string> = {
  origin_charges: "Frais d'origine",
  freight_rate: "Taux de fret",
  air_tariff: "Tarif aérien",
  pre_carriage: "Pré-acheminement",
  documentation: "Documentation",
  general: "Demande générale",
};

serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { case_id, request_id } = await req.json();
    if (!case_id) return errorResponse("case_id is required", 400);
    if (!request_id) return errorResponse("request_id is required", 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // 1. Load the request
    const { data: request, error: reqErr } = await serviceClient
      .from("external_quote_requests")
      .select("*")
      .eq("id", request_id)
      .eq("case_id", case_id)
      .maybeSingle();

    if (reqErr) {
      console.error("[send-external-quote-request] Failed to load request:", reqErr.message);
      return errorResponse("Failed to load request", 500);
    }
    if (!request) return errorResponse("Request not found", 404);

    // 2. Idempotence guard
    if (request.status !== "draft") {
      return jsonResponse({
        ok: true,
        idempotent: true,
        request_id,
        status: request.status,
        message: `Request already ${request.status}`,
      });
    }

    // 3. Validate partner_email
    if (!request.partner_email || request.partner_email.trim() === "") {
      return errorResponse("partner_email is required to send request", 400);
    }

    // 4. Load case context for email generation
    const { data: caseData, error: caseErr } = await serviceClient
      .from("quote_cases")
      .select("id, reference, status, thread_id")
      .eq("id", case_id)
      .maybeSingle();

    if (caseErr) {
      console.error("[send-external-quote-request] Failed to load case:", caseErr.message);
      return errorResponse("Failed to load case", 500);
    }
    if (!caseData) return errorResponse("Case not found", 404);

    // 5. Load relevant facts for professional email generation
    const { data: facts, error: factsErr } = await serviceClient
      .from("quote_facts")
      .select("fact_key, value_text, value_number")
      .eq("case_id", case_id)
      .eq("is_current", true)
      .select("fact_key, value_text, value_number, value_json")
      .eq("case_id", case_id)
      .eq("is_current", true)
      .in("fact_key", [
        "cargo.description", "cargo.articles_detail",
        "cargo.container_type", "cargo.container_count",
        "cargo.weight_kg", "cargo.volume_cbm", "cargo.fcl_lcl",
        "cargo.containers",
        "routing.origin_port", "routing.origin_country",
        "routing.destination_port", "routing.destination_city",
        "routing.destination_country", "routing.final_destination",
        "routing.incoterm", "routing.transport_mode",
        "contacts.client_company",
        "timing.loading_date",
      ]);

    if (factsErr) {
      console.warn("[send-external-quote-request] Failed to load facts (non-critical):", factsErr.message);
    }

    // 6. Build email content — COCKPIT-10 rules:
    //    purpose_detail non-empty → operator source of truth
    //    otherwise → deterministic professional template
    const purposeLabel = PURPOSE_LABELS[request.purpose] || request.purpose;
    const caseRef = caseData.reference || case_id.slice(0, 8);

    const subject = `Demande de cotation — ${purposeLabel} — Réf. ${caseRef}`;

    let bodyText: string;
    const purposeDetail = (request.purpose_detail ?? "").trim();

    if (purposeDetail.length > 0) {
      // Operator-provided text is the source of truth
      bodyText = purposeDetail;
    } else {
      // Deterministic fallback using shared template
      const factMap: Record<string, string | null> = {};
      let containersJson: Array<{ type?: string; quantity?: number }> | null = null;
      for (const f of facts || []) {
        factMap[f.fact_key] = f.value_text || (f.value_number != null ? String(f.value_number) : null);
        if (f.fact_key === "cargo.containers" && f.value_json) {
          containersJson = f.value_json as Array<{ type?: string; quantity?: number }>;
        }
      }
      // COCKPIT-11D: Derive synthetic container keys from cargo.containers JSON
      if (Array.isArray(containersJson) && containersJson.length > 0) {
        const typeAgg: Record<string, number> = {};
        for (const entry of containersJson) {
          const t = (entry.type ?? "").trim();
          const q = typeof entry.quantity === "number" ? entry.quantity : 0;
          if (t && q > 0) typeAgg[t] = (typeAgg[t] || 0) + q;
        }
        const types = Object.keys(typeAgg);
        const totalQty = Object.values(typeAgg).reduce((a, b) => a + b, 0);
        if (totalQty > 0) {
          if (types.length === 1) {
            factMap["cargo.container_type"] = factMap["cargo.container_type"] || types[0];
          } else if (types.length > 1) {
            factMap["cargo.container_type"] = factMap["cargo.container_type"] || types.map(t => `${typeAgg[t]}x ${t}`).join(" + ");
          }
          factMap["cargo.container_count"] = factMap["cargo.container_count"] || String(totalQty);
          factMap["cargo.fcl_lcl"] = factMap["cargo.fcl_lcl"] || "FCL";
        }
      }
      bodyText = buildPartnerEmailBody(factMap, request.partner_name, request.purpose, caseRef);
    }

    // 7. Create email draft
    const userId = auth.user.id;
    const { data: draft, error: draftErr } = await serviceClient
      .from("email_drafts")
      .insert({
        subject,
        body_text: bodyText,
        to_addresses: [request.partner_email.trim()],
        status: "draft",
        ai_generated: false,
        created_by: userId,
      })
      .select("id")
      .single();

    if (draftErr) {
      console.error("[send-external-quote-request] Failed to create draft:", draftErr.message);
      return errorResponse("Failed to create email draft", 500);
    }

    // 8. Mark request as sent + store draft link — CRITICAL
    // NOTE: email_sent_at remains NULL — real SMTP transmission (COM-1A) will fill it.
    const now = new Date().toISOString();
    const { error: updateErr } = await serviceClient
      .from("external_quote_requests")
      .update({ status: "sent", sent_at: now, email_draft_id: draft.id })
      .eq("id", request_id);

    if (updateErr) {
      console.error("[send-external-quote-request] Failed to update request status:", updateErr.message);
      return errorResponse("Failed to mark request as sent", 500);
    }

    // 9. Timeline event — NON-CRITICAL
    const dedupeKey = `external_request_sent:${request_id}`;
    const { error: timelineErr } = await serviceClient.from("case_timeline_events").insert({
      case_id,
      event_type: "manual_action",
      actor_type: "operator",
      actor_user_id: userId,
      new_value: `Demande partenaire envoyée: ${request.partner_name} (${purposeLabel})`,
      event_data: {
        dedupe_key: dedupeKey,
        action_code: "PARTNER_REQUEST_SENT",
        status: "done",
        request_id,
        partner_name: request.partner_name,
        partner_email: request.partner_email,
        purpose: request.purpose,
        draft_id: draft.id,
      },
    });

    if (timelineErr) {
      console.warn("[send-external-quote-request] Timeline insert failed (non-critical):", timelineErr.message);
    }

    return jsonResponse({
      ok: true,
      request_id,
      status: "sent",
      draft_id: draft.id,
      subject,
    });
  } catch (err) {
    console.error("[send-external-quote-request] Unexpected error:", (err as Error).message);
    return errorResponse("Internal server error", 500);
  }
});
