import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RAILWAY_API_URL = 'https://web-production-8afea.up.railway.app';
const TIMEOUT_MS = 120000; // 2 minutes for genetic algorithm

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    
    console.log(`[truck-optimization-proxy] Action: ${action}, Method: ${req.method}`);
    
    if (!action) {
      return new Response(
        JSON.stringify({ error: 'Missing action parameter. Use: suggest-fleet, optimize, truck-specs, visualize' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Map action to Railway API endpoint
    const endpointMap: Record<string, { path: string; method: string }> = {
      'suggest-fleet': { path: '/api/optimization/suggest-fleet', method: 'POST' },
      'optimize': { path: '/api/optimization/optimize', method: 'POST' },
      'truck-specs': { path: '/api/optimization/truck-specs', method: 'GET' },
      'visualize': { path: '/api/optimization/visualize', method: 'POST' },
    };

    const endpoint = endpointMap[action];
    if (!endpoint) {
      return new Response(
        JSON.stringify({ error: `Unknown action: ${action}. Valid actions: ${Object.keys(endpointMap).join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const railwayUrl = `${RAILWAY_API_URL}${endpoint.path}`;
    console.log(`[truck-optimization-proxy] Calling Railway: ${railwayUrl}`);

    // Prepare request options
    const fetchOptions: RequestInit = {
      method: endpoint.method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };

    // Add body for POST requests
    if (endpoint.method === 'POST') {
      const body = await req.json();
      fetchOptions.body = JSON.stringify(body);
      console.log(`[truck-optimization-proxy] Request body:`, JSON.stringify(body, null, 2));
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    fetchOptions.signal = controller.signal;

    // Call Railway API
    const startTime = Date.now();
    const response = await fetch(railwayUrl, fetchOptions);
    const elapsed = Date.now() - startTime;
    clearTimeout(timeoutId);

    console.log(`[truck-optimization-proxy] Railway response: ${response.status} (${elapsed}ms)`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[truck-optimization-proxy] Railway error:`, errorText);
      return new Response(
        JSON.stringify({ 
          error: 'Erreur du serveur d\'optimisation', 
          details: errorText,
          status: response.status 
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log(`[truck-optimization-proxy] Success, data keys:`, Object.keys(data));

    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[truck-optimization-proxy] Error:', error);
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return new Response(
          JSON.stringify({ error: 'Timeout: le serveur d\'optimisation n\'a pas répondu dans les 2 minutes' }),
          { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        return new Response(
          JSON.stringify({ error: 'Le serveur d\'optimisation Railway est inaccessible' }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erreur inconnue' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
