import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const search = url.searchParams.get('search');
    const chapter = url.searchParams.get('chapter');
    const dd = url.searchParams.get('dd');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    console.log('HS Lookup params:', { code, search, chapter, dd, limit, offset });

    let query = supabase.from('hs_codes').select('*', { count: 'exact' });

    if (code) {
      // Normalize the search code
      const normalizedCode = code.replace(/[\.\s]/g, '');
      query = query.or(`code.ilike.%${code}%,code_normalized.ilike.%${normalizedCode}%`);
    }

    if (search) {
      query = query.ilike('description', `%${search}%`);
    }

    if (chapter) {
      query = query.eq('chapter', parseInt(chapter));
    }

    if (dd) {
      query = query.eq('dd', parseFloat(dd));
    }

    // Apply pagination
    query = query.order('code').range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('Query error:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        data,
        pagination: {
          total: count,
          limit,
          offset,
          hasMore: (offset + limit) < (count || 0)
        }
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: unknown) {
    console.error('HS Lookup error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
