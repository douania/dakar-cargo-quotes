import { requireUser } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

interface SuggestionRequest {
  query: string;
  context?: {
    is_import?: boolean;
    is_export?: boolean;
    is_transit?: boolean;
    is_temporary?: boolean;
    destination?: string;
    origin?: string;
    product_type?: string;
    has_investment_code?: boolean;
    is_diplomatic?: boolean;
    is_donation?: boolean;
    is_petroleum?: boolean;
    is_free_zone?: boolean;
  };
  limit?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Phase S0: Auth guard
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: SuggestionRequest = await req.json();
    const { query, context = {}, limit = 5 } = body;

    console.log('Suggest regime for:', { query, context });

    // Fetch all active regimes with keywords
    const { data: regimes, error } = await supabase
      .from('customs_regimes')
      .select('*')
      .eq('is_active', true);

    if (error) {
      console.error('Error fetching regimes:', error);
      throw error;
    }

    // Normalize query for matching
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    // Score each regime based on relevance
    const scoredRegimes = regimes.map(regime => {
      let score = 0;
      const keywords = regime.keywords || [];
      const name = (regime.name || '').toLowerCase();
      const useCase = (regime.use_case || '').toLowerCase();
      const category = regime.category || 'C';

      // Keyword matching
      for (const keyword of keywords) {
        const keywordLower = keyword.toLowerCase();
        if (queryLower.includes(keywordLower)) {
          score += 10;
        }
        for (const word of queryWords) {
          if (keywordLower.includes(word) || word.includes(keywordLower)) {
            score += 5;
          }
        }
      }

      // Name matching
      for (const word of queryWords) {
        if (name.includes(word)) score += 3;
        if (useCase.includes(word)) score += 3;
      }

      // Context-based scoring
      if (context.is_import && category === 'C') score += 5;
      if (context.is_export && category === 'E') score += 10;
      if (context.is_transit && category === 'S') score += 10;
      if (context.is_temporary && (name.includes('temporaire') || useCase.includes('temporaire'))) score += 10;
      
      // Special context bonuses
      if (context.is_diplomatic && (keywords.includes('diplomatique') || name.includes('diplom'))) score += 20;
      if (context.is_donation && (keywords.includes('dons') || name.includes('don'))) score += 20;
      if (context.is_petroleum && (keywords.includes('pétrole') || name.includes('pp') || name.includes('pétrol'))) score += 20;
      if (context.is_free_zone && (keywords.includes('zone franche') || keywords.includes('ZES') || keywords.includes('ZFID'))) score += 20;
      if (context.has_investment_code && (keywords.includes('investissement') || name.includes('invest'))) score += 15;

      // Destination-based scoring for transit
      if (context.destination) {
        const destLower = context.destination.toLowerCase();
        if (['mali', 'burkina', 'niger', 'guinée'].some(c => destLower.includes(c))) {
          if (category === 'S' && (keywords.includes('transit') || name.includes('transit'))) {
            score += 15;
          }
        }
      }

      // Default regime bonus for common imports
      if (regime.code === '1700' && context.is_import && !context.is_diplomatic && !context.is_donation && !context.has_investment_code) {
        score += 8;
      }

      return { ...regime, score };
    });

    // Sort by score and take top results
    const suggestions = scoredRegimes
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ score, ...regime }) => ({
        ...regime,
        relevance_score: score,
        category_label: getCategoryLabel(regime.category),
      }));

    // If no matches, suggest default regime
    if (suggestions.length === 0) {
      const defaultRegime = regimes.find(r => r.code === '1700');
      if (defaultRegime) {
        suggestions.push({
          ...defaultRegime,
          relevance_score: 1,
          category_label: getCategoryLabel(defaultRegime.category),
        });
      }
    }

    console.log(`Found ${suggestions.length} regime suggestions`);

    return new Response(
      JSON.stringify({
        success: true,
        query,
        context,
        suggestions,
        default_regime: suggestions[0] || null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Suggest regime error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function getCategoryLabel(category: string | null): string {
  const labels: Record<string, string> = {
    C: 'Mise à la Consommation',
    S: 'Régime Suspensif',
    R: 'Réexportation',
    E: 'Exportation',
  };
  return labels[category || 'C'] || 'Consommation';
}
