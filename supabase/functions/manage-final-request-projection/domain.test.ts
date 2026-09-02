import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  executeProjectionCommand,
  mapProjectionRpcError,
  OrchestratorError,
  type ProjectionDeps,
  validateProjectionCommand,
} from "./domain.ts";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const REVISION = "33333333-3333-4333-8333-333333333333";
const CAPTURE = "44444444-4444-4444-8444-444444444444";
const EVENT = "55555555-5555-4555-8555-555555555555";
const PROJECTION = "66666666-6666-4666-8666-666666666666";
const KEY = "idem-key-0001";

function projectBody(overrides: Record<string, unknown> = {}) {
  return {
    operation: "project",
    case_id: CASE,
    idempotency_key: KEY,
    expected_projection_id: null,
    expected_revision_id: REVISION,
    expected_generation: 4,
    reason: "Demande finale revue, preuve à archiver.",
    ...overrides,
  };
}

function revokeBody(overrides: Record<string, unknown> = {}) {
  return {
    operation: "revoke",
    case_id: CASE,
    idempotency_key: KEY,
    expected_projection_id: PROJECTION,
    reason: "Preuve obsolète.",
    ...overrides,
  };
}

const evidenceEntry = {
  scope: "case",
  field: "terminal.operation_mode",
  status: "set",
  value: "LOLO",
  assertionId: "a1",
  sourceId: "s1",
  sentAt: "2026-08-01T10:00:00+00:00",
  excerpt: "Opération LOLO confirmée.",
};

const artifact = {
  schemaVersion: 1,
  kind: "evidence_only",
  caseId: CASE,
  revisionId: REVISION,
  captureId: CAPTURE,
  reviewEventId: EVENT,
  headGeneration: 4,
  inventoryHash: "a".repeat(64),
  inputHash: "b".repeat(64),
  resultHash: "c".repeat(64),
  evidence: [evidenceEntry],
  pricingAuthorized: false,
};

function okResponse(overrides: Record<string, unknown> = {}) {
  return {
    projectionId: PROJECTION,
    caseId: CASE,
    version: 1,
    state: "active",
    revisionId: REVISION,
    captureId: CAPTURE,
    reviewEventId: EVENT,
    artifactHash: "d".repeat(64),
    artifact,
    pricingAuthorized: false,
    ...overrides,
  };
}

interface Harness {
  deps: ProjectionDeps;
  calls: unknown[];
}

/** Dépendances instrumentées : on observe EXACTEMENT ce qui part vers le SQL. */
function harness(response: unknown = okResponse()): Harness {
  const calls: unknown[] = [];
  const deps: ProjectionDeps = {
    read(actorId, caseId) {
      calls.push({ op: "read", actorId, caseId });
      return Promise.resolve({
        caseId,
        projection: null,
        history: [],
        historyTruncated: false,
        pricingAuthorized: false,
      });
    },
    mutate(args) {
      calls.push({ ...args });
      return Promise.resolve(response);
    },
  };
  return { deps, calls };
}

function invalid(body: unknown, label: string) {
  const error = assertThrows(
    () => validateProjectionCommand(body),
    OrchestratorError,
  );
  assertEquals(error.code, "VALIDATION_FAILED", label);
}

// ── Validation ──────────────────────────────────────────────────────────────

Deno.test("validate accepts a well formed project command", () => {
  assertEquals(validateProjectionCommand(projectBody()), {
    operation: "project",
    caseId: CASE,
    idempotencyKey: KEY,
    expectedProjectionId: null,
    reason: "Demande finale revue, preuve à archiver.",
    expectedRevisionId: REVISION,
    expectedGeneration: 4,
  });
});

Deno.test("validate accepts a well formed revoke command", () => {
  assertEquals(validateProjectionCommand(revokeBody()), {
    operation: "revoke",
    caseId: CASE,
    idempotencyKey: KEY,
    expectedProjectionId: PROJECTION,
    reason: "Preuve obsolète.",
  });
});

Deno.test("validate refuses every server-only field in the body", () => {
  for (
    const key of [
      "actor",
      "actor_id",
      "artifact",
      "artifact_hash",
      "evidence",
      "fields",
      "field",
      "value",
      "excerpt",
      "source_id",
      "sent_at",
      "assertion_id",
      "result",
      "result_hash",
      "input_hash",
      "inventory",
      "inventory_hash",
      "resolver_version",
      "review_event_id",
      "state",
      "version",
      "pricingAuthorized",
      "pricing_authorized",
    ]
  ) {
    invalid(projectBody({ [key]: "x" }), `server-only key ${key}`);
  }
});

Deno.test("validate refuses the promotion vocabulary at any depth", () => {
  invalid(projectBody({ targetFactKey: "routing.incoterm" }), "camel case");
  invalid(projectBody({ target_fact_key: "routing.incoterm" }), "snake case");
  invalid(projectBody({ TARGETFACTKEY: "x" }), "upper case");
  invalid(projectBody({ meta: { deep: [{ factKey: "x" }] } }), "nested");
  invalid(projectBody({ meta: { readyToPrice: true } }), "readyToPrice");
  invalid(projectBody({ meta: { pricingAllowed: true } }), "pricingAllowed");
});

Deno.test("validate refuses a head CAS on a revocation", () => {
  invalid(revokeBody({ expected_revision_id: REVISION }), "revision CAS");
  invalid(revokeBody({ expected_generation: 4 }), "generation CAS");
});

Deno.test("validate refuses a revocation without a projection tip", () => {
  invalid(revokeBody({ expected_projection_id: null }), "no tip");
});

Deno.test("validate refuses a project command whose CAS is incomplete", () => {
  invalid(projectBody({ expected_revision_id: undefined }), "missing revision");
  invalid(projectBody({ expected_revision_id: null }), "null revision");
  invalid(projectBody({ expected_generation: 0 }), "generation zero");
  invalid(projectBody({ expected_generation: 1.5 }), "non integer generation");
  invalid(projectBody({ expected_generation: "4" }), "generation as text");
});

Deno.test("validate refuses malformed identifiers, keys and reasons", () => {
  invalid(projectBody({ case_id: "not-a-uuid" }), "case id");
  invalid(projectBody({ idempotency_key: "short" }), "idempotency key");
  invalid(projectBody({ idempotency_key: " padded-key-0001 " }), "padded key");
  invalid(projectBody({ reason: "" }), "empty reason");
  invalid(projectBody({ reason: "a".repeat(1001) }), "reason too long");
  invalid(projectBody({ reason: "line\nbreak" }), "control character");
  invalid(projectBody({ extra: 1 }), "unknown key");
  invalid({ operation: "promote", case_id: CASE }, "unknown operation");
  invalid(null, "null body");
  invalid([], "array body");
});

Deno.test("validate accepts a read command and refuses extra keys", () => {
  assertEquals(
    validateProjectionCommand({ operation: "read", case_id: CASE }),
    { operation: "read", caseId: CASE },
  );
  invalid({ operation: "read", case_id: CASE, revision_id: REVISION }, "extra");
});

// ── Exécution ───────────────────────────────────────────────────────────────

Deno.test("project forwards identity, CAS and reason only", async () => {
  const h = harness();
  const result = await executeProjectionCommand(
    validateProjectionCommand(projectBody()),
    ACTOR,
    h.deps,
  );
  assertEquals(h.calls, [{
    actorId: ACTOR,
    caseId: CASE,
    key: KEY,
    action: "project",
    expectedProjectionId: null,
    expectedRevisionId: REVISION,
    expectedGeneration: 4,
    payload: { reason: "Demande finale revue, preuve à archiver." },
  }]);
  assertEquals(result.pricingAuthorized, false);
  assertEquals(result.artifact, artifact);
});

Deno.test("revoke sends null head CAS witnesses", async () => {
  const h = harness(
    okResponse({ state: "revoked", revokedProjectionId: PROJECTION }),
  );
  const result = await executeProjectionCommand(
    validateProjectionCommand(revokeBody()),
    ACTOR,
    h.deps,
  );
  assertEquals(h.calls, [{
    actorId: ACTOR,
    caseId: CASE,
    key: KEY,
    action: "revoke",
    expectedProjectionId: PROJECTION,
    expectedRevisionId: null,
    expectedGeneration: null,
    payload: { reason: "Preuve obsolète." },
  }]);
  assertEquals(result.state, "revoked");
});

Deno.test("read forwards only actor and case", async () => {
  const h = harness();
  const result = await executeProjectionCommand(
    validateProjectionCommand({ operation: "read", case_id: CASE }),
    ACTOR,
    h.deps,
  );
  assertEquals(h.calls, [{ op: "read", actorId: ACTOR, caseId: CASE }]);
  assertEquals(result.pricingAuthorized, false);
});

Deno.test("an invalid actor never reaches the ledger", async () => {
  const h = harness();
  await assertRejects(
    () =>
      executeProjectionCommand(
        validateProjectionCommand(projectBody()),
        "not-a-uuid",
        h.deps,
      ),
    OrchestratorError,
    "Identité invalide",
  );
  assertEquals(h.calls.length, 0);
});

Deno.test("a response claiming pricing authorization is refused", async () => {
  for (const claim of [true, "false", undefined, null, 0]) {
    const h = harness(okResponse({ pricingAuthorized: claim }));
    const error = await assertRejects(
      () =>
        executeProjectionCommand(
          validateProjectionCommand(projectBody()),
          ACTOR,
          h.deps,
        ),
      OrchestratorError,
    );
    assertEquals(error.code, "UPSTREAM_DB_ERROR", String(claim));
  }
});

Deno.test("a response carrying a promotion key is refused", async () => {
  const h = harness(okResponse({
    artifact: {
      ...artifact,
      evidence: [{
        ...evidenceEntry,
        targetFactKey: "routing.terminal_operation_mode",
      }],
    },
  }));
  const error = await assertRejects(
    () =>
      executeProjectionCommand(
        validateProjectionCommand(projectBody()),
        ACTOR,
        h.deps,
      ),
    OrchestratorError,
  );
  assertEquals(error.code, "UPSTREAM_DB_ERROR");
});

Deno.test("a non-object response is refused", async () => {
  for (const value of [null, [], "ok", 1]) {
    const h = harness(value);
    await assertRejects(
      () =>
        executeProjectionCommand(
          validateProjectionCommand(projectBody()),
          ACTOR,
          h.deps,
        ),
      OrchestratorError,
      "Réponse serveur invalide",
    );
  }
});

// ── Traduction des refus SQL ────────────────────────────────────────────────

Deno.test("rpc errors map to the closed orchestrator vocabulary", () => {
  const cases: Array<[string, string]> = [
    ["FRP_REVIEWER_REQUIRED", "FORBIDDEN_OWNER"],
    ["FRP_ACTOR_REQUIRED", "FORBIDDEN_OWNER"],
    ["FRP_STALE_HEAD", "CONFLICT_INVALID_STATE"],
    ["FRP_STALE_CAPTURE", "CONFLICT_INVALID_STATE"],
    ["FRP_STALE_PROJECTION", "CONFLICT_INVALID_STATE"],
    ["FRP_UPSTREAM_CHANGED", "CONFLICT_INVALID_STATE"],
    ["FRP_IDEMPOTENCY_CONFLICT", "CONFLICT_INVALID_STATE"],
    ["FRP_ALREADY_PROJECTED", "CONFLICT_INVALID_STATE"],
    ["FRP_FIELD_EXCLUDED", "VALIDATION_FAILED"],
    ["FRP_FIELD_STATUS_INVALID", "VALIDATION_FAILED"],
    ["FRP_UNRESOLVED_CONFLICT", "VALIDATION_FAILED"],
    ["FRP_NEEDS_FACT_RECONCILIATION", "VALIDATION_FAILED"],
    ["FRP_CAPTURE_NOT_REVIEWED", "VALIDATION_FAILED"],
    ["FRP_QUOTE_RESPONSE_PRESENT", "VALIDATION_FAILED"],
    ["FRP_LIMITATIONS_PRESENT", "VALIDATION_FAILED"],
    ["FRP_SOURCE_NOT_ATTESTED", "VALIDATION_FAILED"],
    ["FRP_NOTHING_TO_REVOKE", "VALIDATION_FAILED"],
    ["FRP_APPEND_ONLY", "VALIDATION_FAILED"],
    ["connection reset by peer", "UPSTREAM_DB_ERROR"],
  ];
  for (const [message, code] of cases) {
    assertEquals(mapProjectionRpcError(message).code, code, message);
  }
});
