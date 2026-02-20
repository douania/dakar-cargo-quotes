import { corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { createSupabaseClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { currency_code } = await req.json();
    if (!currency_code || typeof currency_code !== "string") {
      return new Response(
        JSON.stringify({ error: "currency_code is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cur = currency_code.trim().toUpperCase();
    const supabase = createSupabaseClient();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("exchange_rates")
      .select("rate_to_xof, source, valid_until")
      .eq("currency_code", cur)
      .lte("valid_from", now)
      .gte("valid_until", now)
      .order("valid_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!data) {
      return new Response(
        JSON.stringify({ error: `No active exchange rate for ${cur}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        rate_to_xof: Number(data.rate_to_xof),
        source: data.source,
        valid_until: data.valid_until,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
