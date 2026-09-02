/**
 * DCQ-P0-INTAKE-ATOMIC-BATCH — contrat pur et preuves statiques locales.
 * Zéro réseau métier, zéro secret, zéro écriture DB/runtime.
 */
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRpcArgs,
  ContractError,
  mapSifbRpcError,
  validateIntakeBatchCommand,
} from "../set-intake-facts-batch/contract.ts";
import { handleRequest } from "../set-intake-facts-batch/index.ts";

const CASE_ID = "0b4e2f6a-8f1d-4b6e-9a3c-2d5e7f901234";

function validCommand(overrides: Record<string, unknown> = {}) {
  return {
    case_id: CASE_ID,
    batch_key: `intake:${CASE_ID}:v1`,
    source_type: "email_body",
    source_excerpt: "Deux conteneurs de 20 pieds.",
    workflow_key: "SEA_FCL_IMPORT",
    facts: [
      { fact_key: "cargo.container_count", value_number: 2 },
      {
        fact_key: "cargo.containers",
        value_json: [{ type: "20'", quantity: 2 }],
      },
    ],
    ...overrides,
  };
}

function assertValidationFailure(input: unknown): void {
  const error = assertThrows(() => validateIntakeBatchCommand(input));
  assert(error instanceof ContractError);
  assertEquals(error.code, "VALIDATION_FAILED");
}

Deno.test("SIFB contract: commande nominale et arguments RPC exacts", () => {
  const command = validateIntakeBatchCommand(validCommand());
  assertEquals(command.source_type, "email_body");
  assertEquals(command.facts.length, 2);
  assertEquals(buildRpcArgs(command), {
    p_case_id: CASE_ID,
    p_batch_key: `intake:${CASE_ID}:v1`,
    p_source_type: "email_body",
    p_source_excerpt: "Deux conteneurs de 20 pieds.",
    p_workflow_key: "SEA_FCL_IMPORT",
    p_facts: command.facts,
  });
});

Deno.test("SIFB contract: extrait absent accepté sans en inventer", () => {
  const input = validCommand({ source_excerpt: null, facts: [] });
  assertEquals(validateIntakeBatchCommand(input).source_excerpt, null);
});

Deno.test("SIFB contract: provenance et confiance contrôlées", () => {
  assertValidationFailure(validCommand({ source_type: "manual_input" }));
  assertValidationFailure({ ...validCommand(), confidence: 1 });
  assertValidationFailure({ ...validCommand(), source_email_id: CASE_ID });
  assertEquals(
    validateIntakeBatchCommand(
      validCommand({ source_type: "attachment_extracted" }),
    )
      .source_type,
    "attachment_extracted",
  );
});

Deno.test("SIFB contract: allowlist, colonnes et doublons fail-closed", () => {
  assertValidationFailure(validCommand({
    facts: [{ fact_key: "pricing.total", value_number: 1 }],
  }));
  assertValidationFailure(validCommand({
    facts: [{
      fact_key: "cargo.weight_kg",
      value_number: 10,
      value_text: "10",
    }],
  }));
  assertValidationFailure(validCommand({
    facts: [
      { fact_key: "cargo.weight_kg", value_number: 10 },
      { fact_key: "cargo.weight_kg", value_number: 20 },
    ],
  }));
});

Deno.test("SIFB contract: conteneurs typés, non null et cohérents", () => {
  assertValidationFailure(validCommand({
    facts: [{
      fact_key: "cargo.containers",
      value_json: [{ type: null, quantity: 2 }],
    }],
  }));
  assertValidationFailure(validCommand({
    facts: [{ fact_key: "cargo.containers", value_json: [{ quantity: 2 }] }],
  }));
  assertValidationFailure(validCommand({
    facts: [
      { fact_key: "cargo.container_count", value_number: 2 },
      {
        fact_key: "cargo.containers",
        value_json: [{ type: "20'", quantity: 1 }],
      },
    ],
  }));
});

Deno.test("SIFB contract: bornes numériques et clés d'idempotence", () => {
  assertValidationFailure(validCommand({
    batch_key: "wrong:1234567890",
  }));
  assertValidationFailure(validCommand({
    facts: [{ fact_key: "cargo.container_count", value_number: 2.5 }],
  }));
  assertValidationFailure(validCommand({
    facts: [{
      fact_key: "cargo.weight_kg",
      value_number: Number.POSITIVE_INFINITY,
    }],
  }));
});

Deno.test("SIFB Edge: méthode refusée avant Auth et JWT absent refusé", async () => {
  const getResponse = await handleRequest(
    new Request("http://local.test", { method: "GET" }),
  );
  assertEquals(getResponse.status, 405);

  const postResponse = await handleRequest(
    new Request("http://local.test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validCommand()),
    }),
  );
  assertEquals(postResponse.status, 401);
});

Deno.test("SIFB Edge: mapping stable des erreurs RPC sensibles", () => {
  assertEquals(
    mapSifbRpcError("SIFB_CASE_ACCESS_DENIED").code,
    "FORBIDDEN_OWNER",
  );
  assertEquals(
    mapSifbRpcError("SIFB_IDEMPOTENCY_CONFLICT").code,
    "CONFLICT_INVALID_STATE",
  );
  assertEquals(
    mapSifbRpcError("SIFB_FACT_KEY_NOT_ALLOWED").code,
    "VALIDATION_FAILED",
  );
  assertEquals(mapSifbRpcError("connection reset").code, "UPSTREAM_DB_ERROR");
});

Deno.test("SIFB SQL: transaction, Auth, accès avant replay, verrou et grants prouvés", async () => {
  const sql = await Deno.readTextFile(
    "supabase/migrations/20260902120000_create_set_intake_facts_batch_rpc.sql",
  );
  const accessCheck = sql.indexOf("public.has_case_write_access(p_case_id)");
  const replayRead = sql.indexOf("SELECT * INTO v_replay");
  assert(
    accessCheck >= 0 && replayRead > accessCheck,
    "le contrôle d'accès doit précéder le replay",
  );
  assert(sql.includes("pg_advisory_xact_lock"));
  assert(sql.includes("SECURITY DEFINER"));
  assert(sql.includes("SET search_path = pg_catalog"));
  assert(sql.includes("auth.uid()"));
  assert(sql.includes("SIFB_IDEMPOTENCY_CONFLICT"));
  assert(sql.includes("v_replay.request IS DISTINCT FROM v_request"));
  assert(sql.includes("public.supersede_fact("));
  assert(!sql.includes("CREATE OR REPLACE FUNCTION public.supersede_fact"));
  assert(!sql.includes("CREATE OR REPLACE FUNCTION supersede_fact"));
  assert(
    sql.includes("GRANT EXECUTE ON FUNCTION public.set_intake_facts_batch"),
  );
  assert(sql.includes("TO authenticated"));
  assert(sql.includes("FROM PUBLIC, anon, authenticated, service_role"));
  assert(sql.includes("WHEN 'attachment_extracted' THEN 0.80 ELSE 0.70 END"));
  assert(!sql.includes("p_confidence := 1"));
});

Deno.test("SIFB frontend: ancien chemin non atomique retiré de Intake", async () => {
  const source = await Deno.readTextFile("src/pages/Intake.tsx");
  assert(
    source.includes(
      'supabase.functions.invoke(\n          "set-intake-facts-batch"',
    ),
  );
  assert(!source.includes('supabase.functions.invoke("set-case-fact"'));
  assert(!source.includes('supabase.functions.invoke("ensure-quote-case"'));
});
