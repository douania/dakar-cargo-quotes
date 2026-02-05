/**
 * Phase 15.1 — Smoke Tests Runtime Contract
 * 
 * Validates Phase 14 runtime contract across all hardened Edge Functions.
 * Uses only fetch (no external dependencies) for maximum compatibility.
 * 
 * Run: deno test --allow-net --allow-env --allow-read supabase/functions/_tests/phase15_smoke_test.ts
 */

import "https://deno.land/std@0.224.0/dotenv/load.ts";

// ============================================================================
// CONFIGURATION
// ============================================================================

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PHASE15_TEST_JWT = Deno.env.get("PHASE15_TEST_JWT");
const TEST_EMAIL = Deno.env.get("PHASE15_TEST_EMAIL");
const TEST_PASSWORD = Deno.env.get("PHASE15_TEST_PASSWORD");

const TIMEOUT_MS = 15000; // 15s timeout for AI-heavy functions

// ============================================================================
// TYPES
// ============================================================================

type TestScenario = 'AUTH' | 'VALIDATION' | 'EXECUTION';
type ExpectedOutcome = 'OK' | 'EXPECTED_ERROR';

interface TestCase {
  function: string;
  scenario: TestScenario;
  expectedOutcome: ExpectedOutcome;
  expectedStatuses: number[];
  expectedErrorCodes?: string[];
  body: unknown;
  requiresAuth: boolean;
  verifyRuntimeEvent?: boolean;
}

interface TestResult {
  function: string;
  scenario: TestScenario;
  expectedOutcome: ExpectedOutcome;
  pass: boolean;
  httpStatus: number;
  errorCode?: string;
  correlationId?: string;
  durationMs: number;
  runtimeEventVerified?: boolean;
  error?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function isValidUuid(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

async function getTestToken(): Promise<string | null> {
  // Option A: Static token from env
  if (PHASE15_TEST_JWT) {
    console.log("  📌 Using static JWT from PHASE15_TEST_JWT");
    return PHASE15_TEST_JWT;
  }
  
  // Option B: Dynamic auth via Supabase REST API
  if (TEST_EMAIL && TEST_PASSWORD) {
    console.log("  🔐 Authenticating with TEST_EMAIL/TEST_PASSWORD...");
    
    try {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
        }),
      });
      
      if (!response.ok) {
        const text = await response.text();
        console.error("  ❌ Auth failed:", text);
        return null;
      }
      
      const data = await response.json();
      console.log("  ✅ Auth successful");
      return data.access_token || null;
    } catch (err) {
      console.error("  ❌ Auth error:", (err as Error).message);
      return null;
    }
  }
  
  console.warn("  ⚠️ No JWT available - auth tests will use missing token scenario");
  return null;
}

async function callEdgeFunction(
  functionName: string,
  body: unknown,
  options: { noAuth?: boolean; token?: string } = {}
): Promise<{ status: number; json: Record<string, unknown>; correlationId: string | null; durationMs: number }> {
  const url = `${SUPABASE_URL}/functions/v1/${functionName}`;
  const sentCorrelationId = crypto.randomUUID();
  
  // Timeout guard
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'x-correlation-id': sentCorrelationId,
  };
  
  if (!options.noAuth && options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  
  const start = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    let json: Record<string, unknown>;
    const text = await response.text();
    try {
      json = JSON.parse(text);
    } catch {
      json = { ok: false, error: { code: 'PARSE_ERROR', message: text.substring(0, 200) } };
    }
    
    // Extract correlation_id from response or use sent one
    const correlationId = (json.correlation_id as string) || sentCorrelationId;
    
    return {
      status: response.status,
      json,
      correlationId,
      durationMs: Date.now() - start,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if ((error as Error).name === 'AbortError') {
      return {
        status: 504,
        json: { ok: false, error: { code: 'EDGE_TIMEOUT' } },
        correlationId: sentCorrelationId,
        durationMs: Date.now() - start,
      };
    }
    return {
      status: 0,
      json: { ok: false, error: { code: 'NETWORK_ERROR', message: (error as Error).message } },
      correlationId: sentCorrelationId,
      durationMs: Date.now() - start,
    };
  }
}

async function verifyRuntimeEvent(
  correlationId: string,
  expectedFunctionName: string
): Promise<boolean> {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.log("    ⚠️ SUPABASE_SERVICE_ROLE_KEY not set - skipping runtime_event verification");
    return false;
  }
  
  // Wait a moment for async log to be written
  await new Promise(resolve => setTimeout(resolve, 500));
  
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/runtime_events?correlation_id=eq.${correlationId}&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    
    if (!response.ok) {
      console.log(`    ⚠️ runtime_events query failed: ${response.status}`);
      return false;
    }
    
    const data = await response.json();
    
    if (!data || data.length === 0) {
      console.log(`    ⚠️ No runtime_event found for correlation_id: ${correlationId}`);
      return false;
    }
    
    const event = data[0];
    if (event.function_name !== expectedFunctionName) {
      console.log(`    ⚠️ Function name mismatch: expected ${expectedFunctionName}, got ${event.function_name}`);
      return false;
    }
    
    console.log(`    ✅ runtime_event verified: status=${event.status}, error_code=${event.error_code || 'none'}`);
    return true;
  } catch (err) {
    console.log(`    ⚠️ runtime_events query error: ${(err as Error).message}`);
    return false;
  }
}

// ============================================================================
// TEST CASES
// ============================================================================

const FAKE_UUID = '00000000-0000-0000-0000-000000000001';

const TEST_CASES: TestCase[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // commit-decision (3 tests)
  // ─────────────────────────────────────────────────────────────────────────
  {
    function: 'commit-decision',
    scenario: 'AUTH',
    expectedOutcome: 'EXPECTED_ERROR',
    expectedStatuses: [401],
    expectedErrorCodes: ['AUTH_MISSING_JWT'],
    body: { case_id: FAKE_UUID },
    requiresAuth: false,
  },
  {
    function: 'commit-decision',
    scenario: 'VALIDATION',
    expectedOutcome: 'EXPECTED_ERROR',
    expectedStatuses: [400],
    expectedErrorCodes: ['VALIDATION_FAILED'],
    body: {},
    requiresAuth: true,
    verifyRuntimeEvent: true,
  },
  {
    function: 'commit-decision',
    scenario: 'EXECUTION',
    expectedOutcome: 'EXPECTED_ERROR',
    expectedStatuses: [400, 403, 404, 500],
    body: {
      case_id: FAKE_UUID,
      decision_type: 'cargo_confirmation',
      selected_key: 'test_key',
      proposal_id: FAKE_UUID,
    },
    requiresAuth: true,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // generate-response (2 tests - no auth required by function)
  // ─────────────────────────────────────────────────────────────────────────
  {
    function: 'generate-response',
    scenario: 'VALIDATION',
    expectedOutcome: 'EXPECTED_ERROR',
    expectedStatuses: [400, 500],
    body: {},
    requiresAuth: false,
    verifyRuntimeEvent: true,
  },
  {
    function: 'generate-response',
    scenario: 'EXECUTION',
    expectedOutcome: 'OK',
    expectedStatuses: [200],
    body: {
      quotationData: {
        projectContext: { project_name: 'Phase 15 Smoke Test' },
        cargoDetails: { description: 'Test cargo for smoke test' },
      },
    },
    requiresAuth: false,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // generate-case-outputs (3 tests)
  // ─────────────────────────────────────────────────────────────────────────
  {
    function: 'generate-case-outputs',
    scenario: 'AUTH',
    expectedOutcome: 'EXPECTED_ERROR',
    expectedStatuses: [401],
    expectedErrorCodes: ['AUTH_MISSING_JWT'],
    body: { case_id: FAKE_UUID },
    requiresAuth: false,
  },
  {
    function: 'generate-case-outputs',
    scenario: 'VALIDATION',
    expectedOutcome: 'EXPECTED_ERROR',
    expectedStatuses: [400],
    expectedErrorCodes: ['VALIDATION_FAILED'],
    body: {},
    requiresAuth: true,
    verifyRuntimeEvent: true,
  },
  {
    function: 'generate-case-outputs',
    scenario: 'EXECUTION',
    expectedOutcome: 'EXPECTED_ERROR',
    expectedStatuses: [400, 403, 404, 500],
    body: { case_id: FAKE_UUID },
    requiresAuth: true,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // generate-quotation (3 tests)
  // ─────────────────────────────────────────────────────────────────────────
  {
    function: 'generate-quotation',
    scenario: 'AUTH',
    expectedOutcome: 'EXPECTED_ERROR',
    expectedStatuses: [401],
    expectedErrorCodes: ['AUTH_MISSING_JWT'],
    body: { quotation_id: FAKE_UUID },
    requiresAuth: false,
  },
  {
    function: 'generate-quotation',
    scenario: 'VALIDATION',
    expectedOutcome: 'EXPECTED_ERROR',
    expectedStatuses: [400],
    expectedErrorCodes: ['VALIDATION_FAILED'],
    body: {},
    requiresAuth: true,
    verifyRuntimeEvent: true,
  },
  {
    function: 'generate-quotation',
    scenario: 'EXECUTION',
    expectedOutcome: 'EXPECTED_ERROR',
    expectedStatuses: [400, 403, 404, 500],
    body: { quotation_id: FAKE_UUID },
    requiresAuth: true,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // generate-quotation-pdf (3 tests)
  // ─────────────────────────────────────────────────────────────────────────
  {
    function: 'generate-quotation-pdf',
    scenario: 'AUTH',
    expectedOutcome: 'EXPECTED_ERROR',
    expectedStatuses: [401],
    expectedErrorCodes: ['AUTH_MISSING_JWT'],
    body: { quotation_id: FAKE_UUID },
    requiresAuth: false,
  },
  {
    function: 'generate-quotation-pdf',
    scenario: 'VALIDATION',
    expectedOutcome: 'EXPECTED_ERROR',
    expectedStatuses: [400],
    expectedErrorCodes: ['VALIDATION_FAILED'],
    body: {},
    requiresAuth: true,
    verifyRuntimeEvent: true,
  },
  {
    function: 'generate-quotation-pdf',
    scenario: 'EXECUTION',
    expectedOutcome: 'EXPECTED_ERROR',
    expectedStatuses: [400, 403, 404, 500],
    body: { quotation_id: FAKE_UUID },
    requiresAuth: true,
  },
];

// ============================================================================
// TEST RUNNER
// ============================================================================

async function runTest(test: TestCase, token: string | null): Promise<TestResult> {
  const result: TestResult = {
    function: test.function,
    scenario: test.scenario,
    expectedOutcome: test.expectedOutcome,
    pass: false,
    httpStatus: 0,
    durationMs: 0,
  };
  
  try {
    const response = await callEdgeFunction(
      test.function,
      test.body,
      {
        noAuth: !test.requiresAuth,
        token: test.requiresAuth ? (token || undefined) : undefined,
      }
    );
    
    result.httpStatus = response.status;
    result.durationMs = response.durationMs;
    result.correlationId = response.correlationId || undefined;
    
    // Extract error code from response
    const errorObj = response.json?.error as Record<string, unknown> | undefined;
    result.errorCode = (errorObj?.code as string) || undefined;
    
    // Validate correlation_id format
    const hasValidCorrelationId = result.correlationId && isValidUuid(result.correlationId);
    
    // Check if status matches expected
    const statusMatches = test.expectedStatuses.includes(response.status);
    
    // Check error code if expected
    let errorCodeMatches = true;
    if (test.expectedErrorCodes && test.expectedErrorCodes.length > 0) {
      errorCodeMatches = test.expectedErrorCodes.includes(result.errorCode || '');
    }
    
    // Check outcome
    const isOkResponse = response.json?.ok === true;
    const outcomeMatches = test.expectedOutcome === 'OK' ? isOkResponse : !isOkResponse;
    
    result.pass = statusMatches && errorCodeMatches && outcomeMatches && !!hasValidCorrelationId;
    
    // Verify runtime_event if required
    if (test.verifyRuntimeEvent && result.correlationId) {
      result.runtimeEventVerified = await verifyRuntimeEvent(
        result.correlationId,
        test.function
      );
    }
    
    if (!result.pass) {
      result.error = `Status: ${statusMatches ? '✓' : `✗(got ${response.status})`}, ErrorCode: ${errorCodeMatches ? '✓' : `✗(got ${result.errorCode})`}, Outcome: ${outcomeMatches ? '✓' : '✗'}, CorrelationId: ${hasValidCorrelationId ? '✓' : '✗'}`;
    }
    
  } catch (err) {
    result.error = (err as Error).message;
    result.pass = false;
  }
  
  return result;
}

// ============================================================================
// OUTPUT FORMATTING
// ============================================================================

function printHeader(runId: string, hasJwt: boolean) {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                       PHASE 15.1 — SMOKE TESTS RUNTIME CONTRACT                           ║');
  console.log('╠═══════════════════════════════════════════════════════════════════════════════════════════╣');
  console.log(`║ Run ID: ${runId.substring(0, 8)} | Date: ${new Date().toISOString()} | JWT: ${hasJwt ? '✅ Available' : '⚠️ None'}          ║`);
  console.log('╠══════════════════════╦══════════════╦══════════════════╦══════╦════════════════════════════╣');
  console.log('║ Function             ║ Scenario     ║ Expected Outcome ║ Pass ║ Details                    ║');
  console.log('╠══════════════════════╬══════════════╬══════════════════╬══════╬════════════════════════════╣');
}

function printResult(result: TestResult) {
  const fn = result.function.padEnd(20);
  const scenario = result.scenario.padEnd(12);
  const outcome = result.expectedOutcome.padEnd(16);
  const pass = result.pass ? '✅  ' : '❌  ';
  
  let details = `${result.httpStatus}`;
  if (result.errorCode) {
    details += ` ${result.errorCode}`;
  }
  if (result.runtimeEventVerified) {
    details += ' [RE]';
  }
  details += ` (${result.durationMs}ms)`;
  details = details.substring(0, 26).padEnd(26);
  
  console.log(`║ ${fn} ║ ${scenario} ║ ${outcome} ║ ${pass} ║ ${details} ║`);
}

function printFooter(results: TestResult[]) {
  console.log('╚══════════════════════╩══════════════╩══════════════════╩══════╩════════════════════════════╝');
  
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  const correlationIds = results.filter(r => r.correlationId).length;
  const runtimeEventsVerified = results.filter(r => r.runtimeEventVerified).length;
  const runtimeEventsExpected = results.filter(r => 
    TEST_CASES.find(t => t.function === r.function && t.scenario === r.scenario)?.verifyRuntimeEvent
  ).length;
  
  console.log('\nLegend: [RE] = runtime_event verified');
  console.log(`\nSummary: ${passed}/${total} PASS | ${total - passed} FAIL`);
  console.log(`correlation_ids captured: ${correlationIds}`);
  console.log(`runtime_events verified: ${runtimeEventsVerified}/${runtimeEventsExpected} (selected tests)`);
  
  // Print failures details
  const failures = results.filter(r => !r.pass);
  if (failures.length > 0) {
    console.log('\n❌ FAILURES:');
    for (const f of failures) {
      console.log(`  - ${f.function} / ${f.scenario}: ${f.error || 'Unknown error'}`);
    }
  }
  
  console.log('\n');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const runId = crypto.randomUUID();
  
  console.log('\n🚀 Phase 15.1 Smoke Tests Starting...\n');
  console.log(`📍 Supabase URL: ${SUPABASE_URL}`);
  
  // Get auth token
  console.log('\n🔐 Acquiring test token...');
  const token = await getTestToken();
  
  printHeader(runId, !!token);
  
  const results: TestResult[] = [];
  
  for (const test of TEST_CASES) {
    console.log(`  Testing ${test.function} / ${test.scenario}...`);
    const result = await runTest(test, token);
    results.push(result);
    printResult(result);
  }
  
  printFooter(results);
  
  // Throw if any test failed (for Deno.test)
  const allPassed = results.every(r => r.pass);
  if (!allPassed) {
    throw new Error(`${results.filter(r => !r.pass).length} tests failed`);
  }
}

// Deno test wrapper
Deno.test({
  name: "Phase 15.1 - Smoke Tests Runtime Contract",
  fn: async () => {
    await main();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
