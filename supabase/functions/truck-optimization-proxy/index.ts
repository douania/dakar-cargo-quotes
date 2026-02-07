import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { requireUser } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

const RAILWAY_API_URL = 'https://web-production-8afea.up.railway.app';
const TIMEOUT_MS = 300000; // 5 minutes for genetic algorithm / heavy 3D cases

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Phase S0: Auth guard
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

    const url = new URL(req.url);

    // Read incoming body once (needed because calls via invoke() are POST even for GET-like actions)
    let rawBody = '';
    let bodyJson: any = null;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      rawBody = await req.text();
      console.log(`[truck-optimization-proxy] Raw body length: ${rawBody.length}`);

      if (rawBody.length > 0) {
        try {
          bodyJson = JSON.parse(rawBody);
          console.log(`[truck-optimization-proxy] Body keys: ${Object.keys(bodyJson).join(', ')}`);
        } catch (parseError) {
          console.error(`[truck-optimization-proxy] Invalid JSON body:`, rawBody.substring(0, 200));
          return new Response(
            JSON.stringify({ error: 'Invalid JSON body' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
      }
    }

    const action =
      url.searchParams.get('action') ||
      (bodyJson && typeof bodyJson === 'object' ? bodyJson.action : null) ||
      req.headers.get('x-action');

    console.log(`[truck-optimization-proxy] Action: ${action}, Method: ${req.method}`);

    if (!action) {
      return new Response(
        JSON.stringify({
          error: 'Missing action parameter. Use: suggest-fleet, optimize, truck-specs, visualize',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
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
        JSON.stringify({
          error: `Unknown action: ${action}. Valid actions: ${Object.keys(endpointMap).join(', ')}`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
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
      // If action is provided via JSON body, strip it before forwarding
      if (bodyJson && typeof bodyJson === 'object' && 'action' in bodyJson) {
        delete bodyJson.action;
      }

      if (bodyJson && typeof bodyJson === 'object') {
        fetchOptions.body = JSON.stringify(bodyJson);
      } else if (rawBody.length > 0) {
        fetchOptions.body = rawBody;
      } else {
        fetchOptions.body = '{}';
      }
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

    // Check content type to determine how to read response
    const contentType = response.headers.get('content-type') || '';
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[truck-optimization-proxy] Railway error (first 500 chars):`, errorText.substring(0, 500));
      
      // Try to extract error message from HTML if present
      let errorMessage = 'Erreur du serveur d\'optimisation';
      if (errorText.includes('AttributeError')) {
        errorMessage = 'Erreur backend: format de données incorrect';
      } else if (errorText.includes('KeyError')) {
        errorMessage = 'Erreur backend: champ manquant dans les données';
      }
      
      return new Response(
        JSON.stringify({ 
          error: errorMessage, 
          status: response.status,
          details: errorText.substring(0, 1000)
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Success - return the response as JSON
    if (contentType.includes('application/json')) {
      const data = await response.json();
      console.log(`[truck-optimization-proxy] Success, data keys:`, Object.keys(data));
      return new Response(
        JSON.stringify(data),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      // Non-JSON response
      const text = await response.text();
      console.log(`[truck-optimization-proxy] Non-JSON response (${contentType}):`, text.substring(0, 200));
      return new Response(
        JSON.stringify({ error: 'Unexpected response format from optimization server', raw: text.substring(0, 500) }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error('[truck-optimization-proxy] Error:', error);
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return new Response(
          JSON.stringify({ error: 'Timeout: le serveur d\'optimisation n\'a pas répondu dans les 5 minutes' }),
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
