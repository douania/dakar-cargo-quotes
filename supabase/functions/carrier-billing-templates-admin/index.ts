import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { createSupabaseClient } from "../_shared/supabase.ts";

type Action = "list" | "create" | "update" | "delete";

const allowedFields = new Set([
  "carrier",
  "invoice_type",
  "invoice_sequence",
  "charge_code",
  "charge_name",
  "operation_type",
  "calculation_method",
  "base_reference",
  "default_amount",
  "currency",
  "vat_rate",
  "is_variable",
  "variable_unit",
  "notes",
  "source_documents",
  "effective_date",
  "is_active",
  "evidence_level",
]);

const requiredCreateFields = [
  "carrier",
  "charge_code",
  "charge_name",
  "calculation_method",
];

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function validatePayload(value: unknown, { requireAll }: { requireAll: boolean }) {
  const payload = assertRecord(value, "data");
  const unknownFields = Object.keys(payload).filter((field) => !allowedFields.has(field));
  if (unknownFields.length > 0) {
    throw new Error(`Unknown field(s): ${unknownFields.join(", ")}`);
  }
  if (Object.keys(payload).length === 0) {
    throw new Error("data must contain at least one allowed field");
  }
  if (requireAll) {
    const missingFields = requiredCreateFields.filter((field) => payload[field] === undefined || payload[field] === null || payload[field] === "");
    if (missingFields.length > 0) {
      throw new Error(`Missing required field(s): ${missingFields.join(", ")}`);
    }
  }
  return payload;
}

function requireId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("id is required");
  }
  return value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;

  try {
    const body = assertRecord(await req.json(), "body");
    const unknownBodyFields = Object.keys(body).filter((field) => !["action", "id", "data"].includes(field));
    if (unknownBodyFields.length > 0) {
      return errorResponse(`Unknown request field(s): ${unknownBodyFields.join(", ")}`, 400);
    }

    const action = body.action as Action;
    if (!["list", "create", "update", "delete"].includes(action)) {
      return errorResponse("Invalid action", 400);
    }

    const supabase = createSupabaseClient();

    if (action === "list") {
      const { data, error } = await supabase
        .from("carrier_billing_templates")
        .select("*")
        .order("carrier")
        .order("invoice_sequence", { ascending: true });
      if (error) throw error;
      return jsonResponse({ success: true, data });
    }

    if (action === "create") {
      const payload = validatePayload(body.data, { requireAll: true });
      const { data, error } = await supabase
        .from("carrier_billing_templates")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return jsonResponse({ success: true, data }, 201);
    }

    if (action === "update") {
      const id = requireId(body.id);
      const payload = validatePayload(body.data, { requireAll: false });
      const { data, error } = await supabase
        .from("carrier_billing_templates")
        .update(payload)
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) throw error;
      return jsonResponse({ success: true, data, updated: data !== null });
    }

    const id = requireId(body.id);
    const { error } = await supabase
      .from("carrier_billing_templates")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return jsonResponse({ success: true, deleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, 400);
  }
});
