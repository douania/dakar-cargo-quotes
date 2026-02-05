// Shared CORS headers for all edge functions
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id',
};

// Handle CORS preflight
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  return null;
}

// Create JSON response with CORS
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Create error response
export function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

// Create streaming response with CORS
export function streamResponse(body: ReadableStream | null): Response {
  return new Response(body, {
    headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
  });
}
