import { corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { createSupabaseClient } from "../_shared/supabase.ts";

/**
 * Calcule le prochain mardi 23:59:59 UTC (cycle GAINDE hebdomadaire).
 */
function nextTuesday2359(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon, 2=Tue, ...
  // Jours jusqu'au prochain mardi (si aujourd'hui mardi, +7)
  const daysUntilTuesday = ((2 - day + 7) % 7) || 7;
  const next = new Date(now);
  next.setUTCDate(now.getUTCDate() + daysUntilTuesday);
  next.setUTCHours(23, 59, 59, 0);
  return next.toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { currency_code, rate_to_xof, valid_until: bodyValidUntil, source: bodySource } = await req.json();

    if (!currency_code || typeof currency_code !== "string") {
      return new Response(
        JSON.stringify({ error: "currency_code is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rate = Number(rate_to_xof);
    if (!Number.isFinite(rate) || rate <= 0) {
      return new Response(
        JSON.stringify({ error: "rate_to_xof must be a positive number" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cur = currency_code.trim().toUpperCase();
    const supabase = createSupabaseClient();

    const { data, error } = await supabase
      .from("exchange_rates")
      .insert({
        currency_code: cur,
        rate_to_xof: rate,
        valid_from: new Date().toISOString(),
        valid_until: bodyValidUntil || nextTuesday2359(),
        source: bodySource || "GAINDE",
        updated_by: auth.user.id,
      })
      .select()
      .single();

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify(data),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
