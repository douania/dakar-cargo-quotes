/**
 * PAD-R1B — Edge function: recommend-pad-category
 * 
 * Stateless, read-only recommendation engine.
 * - requireUser (auth obligatoire)
 * - SELECT only — zero INSERT, UPDATE, DELETE
 * - No web search
 * - No DB writes
 * - AI proposes categories, CODE decides conservative pick from port_tariffs
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { corsHeaders, handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { callAI, parseAIResponse } from "../_shared/ai-client.ts";
import { extractAndParseJSON } from "../_shared/json-parser.ts";

const VALID_PAD_CATEGORIES = [
  "T01", "T02", "T03", "T04", "T05", "T06", "T07",
  "T08", "T09", "T10", "T11", "T12", "T13", "T14",
  "P01", "P02", "P03", "P04", "P05",
];

interface AIRecommendation {
  pad_category: string;
  confidence: string;
  justification_fr: string;
  matching_aliases?: string[];
}

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  // Auth
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { goods_description, context_hints } = await req.json();

    if (!goods_description || typeof goods_description !== "string" || goods_description.trim().length < 3) {
      return errorResponse("goods_description is required (min 3 chars)", 400);
    }

    const hints: string[] = Array.isArray(context_hints) ? context_hints : [];

    // --- DB reads ---
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

    // Load validated aliases
    const { data: aliases, error: aliasErr } = await db
      .from("pad_designation_aliases")
      .select("normalized_term, pad_category")
      .eq("is_validated", true)
      .order("pad_category");

    if (aliasErr) {
      console.error("alias fetch error:", aliasErr);
      return errorResponse("Failed to load aliases", 500);
    }

    // Group aliases by category, take up to 5 per category (in TypeScript)
    const aliasesByCategory: Record<string, string[]> = {};
    for (const a of aliases || []) {
      if (!aliasesByCategory[a.pad_category]) {
        aliasesByCategory[a.pad_category] = [];
      }
      if (aliasesByCategory[a.pad_category].length < 5) {
        aliasesByCategory[a.pad_category].push(a.normalized_term);
      }
    }

    // Load PAD tariffs
    const { data: tariffs, error: tariffErr } = await db
      .from("port_tariffs")
      .select("classification, amount, unit")
      .eq("provider", "PAD")
      .eq("category", "DROIT_PASSAGE")
      .eq("is_active", true);

    if (tariffErr) {
      console.error("tariff fetch error:", tariffErr);
      return errorResponse("Failed to load tariffs", 500);
    }

    const tariffMap: Record<string, number> = {};
    for (const t of tariffs || []) {
      tariffMap[t.classification] = t.amount;
    }

    // --- Build AI prompt ---
    const catalogLines = VALID_PAD_CATEGORIES.map((cat) => {
      const examples = aliasesByCategory[cat] || [];
      const rate = tariffMap[cat] ?? "N/A";
      return `${cat} (${rate} FCFA/t): ${examples.join(", ") || "(pas d'exemples)"}`;
    });

    const systemPrompt = `Tu es un expert en classification tarifaire portuaire au Sénégal.
Tu dois proposer les catégories PAD (Port Autonome de Dakar) les plus probables pour une marchandise donnée.

Catalogue PAD officiel (19 catégories uniquement) :
${catalogLines.join("\n")}

RÈGLES STRICTES :
- Retourne UNIQUEMENT des catégories existantes parmi : ${VALID_PAD_CATEGORIES.join(", ")}
- Maximum 3 recommandations
- Chaque recommandation DOIT avoir une justification en français
- Indique le niveau de confiance : "high", "medium", ou "low"
- Liste les alias officiels proches si pertinent
- Ne jamais inventer de catégorie
- Retourne un JSON valide avec la structure demandée`;

    // Minimize client data: use generic descriptions
    const userPrompt = `Marchandise : ${goods_description.trim()}
${hints.length > 0 ? `Contexte : ${hints.join(", ")}` : ""}

Retourne un JSON avec cette structure exacte :
{
  "recommendations": [
    {
      "pad_category": "Txx",
      "confidence": "high|medium|low",
      "justification_fr": "Explication en français",
      "matching_aliases": ["alias1", "alias2"]
    }
  ]
}`;

    // --- Call AI ---
    const aiResponse = await callAI(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { model: "google/gemini-2.5-flash", temperature: 0.2, maxTokens: 1024 },
    );

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return errorResponse("Rate limit exceeded, please try again later", 429);
      }
      if (aiResponse.status === 402) {
        return errorResponse("AI credits exhausted, please add funds", 402);
      }
      const errText = await aiResponse.text();
      console.error("AI error:", aiResponse.status, errText);
      return errorResponse("AI service error", 502);
    }

    const rawContent = await parseAIResponse(aiResponse);

    // --- Strict validation ---
    let parsed: { recommendations: AIRecommendation[] };
    try {
      parsed = extractAndParseJSON<{ recommendations: AIRecommendation[] }>(rawContent, {
        label: "recommend-pad-category",
        expectRoot: "object",
      });
    } catch (e) {
      console.error("JSON validation failed:", (e as Error).message);
      return errorResponse("AI returned invalid JSON", 502);
    }

    if (!Array.isArray(parsed.recommendations)) {
      return errorResponse("AI returned invalid structure (missing recommendations array)", 502);
    }

    // Filter and validate recommendations
    const validRecs = parsed.recommendations
      .filter((r) => {
        if (!VALID_PAD_CATEGORIES.includes(r.pad_category)) {
          console.warn(`Rejected invalid category: ${r.pad_category}`);
          return false;
        }
        if (!r.justification_fr || r.justification_fr.trim().length === 0) {
          console.warn(`Rejected recommendation without justification: ${r.pad_category}`);
          return false;
        }
        if (!["high", "medium", "low"].includes(r.confidence)) {
          r.confidence = "low"; // downgrade unknown confidence
        }
        return true;
      })
      .slice(0, 3) // Max 3 recommendations
      .map((r) => ({
        pad_category: r.pad_category,
        confidence: r.confidence,
        justification_fr: r.justification_fr,
        matching_aliases: Array.isArray(r.matching_aliases) ? r.matching_aliases.slice(0, 5) : [],
        pad_rate_fcfa_per_ton: tariffMap[r.pad_category] ?? null,
        requires_operator_confirmation: true,
        is_conservative_pick: false,
      }));

    if (validRecs.length === 0) {
      return jsonResponse({
        qualification: "PAD_CATEGORY_ESTIMATED",
        recommendations: [],
        conservative_category: null,
        message: "Aucune catégorie PAD plausible identifiée par l'IA.",
      });
    }

    // --- Conservative pick: highest tariff among plausible categories (CODE decides, not AI) ---
    let conservativeIdx = 0;
    let maxRate = -1;
    for (let i = 0; i < validRecs.length; i++) {
      const rate = validRecs[i].pad_rate_fcfa_per_ton ?? 0;
      if (rate > maxRate) {
        maxRate = rate;
        conservativeIdx = i;
      }
    }
    validRecs[conservativeIdx].is_conservative_pick = true;

    return jsonResponse({
      qualification: "PAD_CATEGORY_ESTIMATED",
      recommendations: validRecs,
      conservative_category: validRecs[conservativeIdx].pad_category,
    });
  } catch (e) {
    console.error("recommend-pad-category error:", e);
    return errorResponse((e as Error).message || "Internal error", 500);
  }
});
