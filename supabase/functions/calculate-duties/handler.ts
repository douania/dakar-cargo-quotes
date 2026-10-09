// Retired in M26b. The historical implementation must not be executed.
const functionName = "calculate-duties";
const release = "legacy-shutdown-20261009-v1";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "X-Legacy-Shutdown-Release, X-Retired-Function",
  "Cache-Control": "no-store",
  "X-Legacy-Shutdown-Release": release,
  "X-Retired-Function": functionName,
};

/** Unconditional refusal; no body, identity, credentials or business data are read. */
export function handler(req: Request): Response {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  return new Response(
    JSON.stringify({
      ok: false,
      error: "FUNCTION_RETIRED",
      function: functionName,
      release,
    }),
    { status: 410, headers: { ...headers, "Content-Type": "application/json" } },
  );
}
