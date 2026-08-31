import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { RESOLVER_VERSION } from "../_shared/final-request-state-persistence.ts";
import {
  executeFinalRequestCommand,
  type FinalRequestDeps,
  mapFinalRequestRpcError,
  OrchestratorError,
  validateFinalRequestCommand,
} from "./domain.ts";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const CAPTURE = "33333333-3333-4333-8333-333333333333";
const SOURCE = "44444444-4444-4444-8444-444444444444";
const REVISION = "55555555-5555-4555-8555-555555555555";
const EVENT = "66666666-6666-4666-8666-666666666666";

const capture = {
  schemaVersion: 1,
  captureId: CAPTURE,
  caseId: CASE,
  headRevisionId: null,
  generation: 1,
  inventoryHash: "a".repeat(64),
  resolverVersion: RESOLVER_VERSION,
  baseInput: {
    caseId: CASE,
    lotIds: [],
    quotationVersionIds: [],
    protectedFacts: [],
    sources: [{
      id: SOURCE,
      caseId: CASE,
      kind: "email",
      authorRole: "client",
      roleVerified: true,
      contentClass: "current",
      sentAt: "2026-08-01T10:00:00Z",
      text: "Poids confirmé à 1000 kg.",
    }],
  },
  limitations: [],
};
const assertion = {
  id: "weight",
  sourceId: SOURCE,
  scope: "case",
  operation: "set",
  field: "cargo.weight_kg",
  value: 1000,
  excerpt: "Poids confirmé à 1000 kg.",
};
function state(overrides: Record<string, unknown> = {}) {
  return {
    head: { generation: 1, revision_id: null, capture_id: CAPTURE },
    revision: null,
    captureRecord: {
      capture,
      inventory: { sources: [] },
      sourceAttestationRefs: [{
        originKind: "email",
        originId: SOURCE,
        sourceHash: "b".repeat(64),
      }],
    },
    reviews: [],
    history: [],
    historyTruncated: false,
    selectedRevisionMatchesHeadCapture: false,
    pricingAuthorized: false,
    ...overrides,
  };
}
function deps(readValue: unknown = state()) {
  const calls: unknown[] = [];
  const value: FinalRequestDeps = {
    async read(...args) {
      calls.push(["read", ...args]);
      return readValue;
    },
    async mutate(args) {
      calls.push(["mutate", args]);
      return { ok: true, pricingAuthorized: false };
    },
  };
  return { value, calls };
}
const common = {
  case_id: CASE,
  idempotency_key: "fixture-key",
  expected_revision_id: null,
  expected_generation: 1,
};

Deno.test("P1-C2-B refuse toute identité et tout résultat fournis par le navigateur", () => {
  for (
    const extra of [
      { actor: ACTOR },
      { result: {} },
      { resolverVersion: RESOLVER_VERSION },
      { inventory: {} },
      { expectedSourceHash: "b".repeat(64) },
      { pricingAuthorized: false },
    ]
  ) {
    assertThrows(
      () =>
        validateFinalRequestCommand({
          operation: "capture",
          ...common,
          ...extra,
        }),
      OrchestratorError,
      "Champ réservé",
    );
  }
});

Deno.test("P1-C2-B ferme les clés, opérations et CAS", () => {
  assertThrows(
    () =>
      validateFinalRequestCommand({
        operation: "capture",
        ...common,
        extra: true,
      }),
    OrchestratorError,
  );
  assertThrows(
    () => validateFinalRequestCommand({ operation: "unknown", case_id: CASE }),
    OrchestratorError,
  );
  assertThrows(
    () =>
      validateFinalRequestCommand({
        operation: "capture",
        ...common,
        expected_generation: -1,
      }),
    OrchestratorError,
  );
});

Deno.test("P1-C2-B read appelle seulement frs_read et force pricing false", async () => {
  const d = deps();
  const command = validateFinalRequestCommand({
    operation: "read",
    case_id: CASE,
  });
  const result = await executeFinalRequestCommand(command, ACTOR, d.value);
  assertEquals(d.calls, [["read", ACTOR, CASE, null]]);
  assertEquals(result.pricingAuthorized, false);
  const exposedRef = (result.captureRecord as {
    sourceAttestationRefs: Record<string, unknown>[];
  })
    .sourceAttestationRefs[0];
  assertEquals(exposedRef, { originKind: "email", originId: SOURCE });
  assertEquals(
    Object.hasOwn(
      (result.captureRecord as { capture: Record<string, unknown> }).capture,
      "inventoryHash",
    ),
    false,
  );
});

Deno.test("P1-C2-B capture transmet acteur JWT, CAS et payload vide", async () => {
  const d = deps();
  const command = validateFinalRequestCommand({
    operation: "capture",
    ...common,
  });
  await executeFinalRequestCommand(command, ACTOR, d.value);
  assertEquals(d.calls, [["mutate", {
    actorId: ACTOR,
    caseId: CASE,
    key: "fixture-key",
    action: "capture",
    expectedRevisionId: null,
    expectedGeneration: 1,
    payload: {},
  }]]);
});

Deno.test("P1-C2-B attestation prend le hash PostgreSQL de la capture, jamais du client", async () => {
  const d = deps();
  const command = validateFinalRequestCommand({
    operation: "attest_source",
    ...common,
    origin_kind: "email",
    origin_id: SOURCE,
    author_role: "client",
    content_class: "current",
    reason: "Source vérifiée par le cotateur",
  });
  await executeFinalRequestCommand(command, ACTOR, d.value);
  const mutation =
    (d.calls[1] as [string, { payload: Record<string, unknown> }])[1];
  assertEquals(mutation.payload.expectedSourceHash, "b".repeat(64));
  assertEquals(Object.hasOwn(mutation.payload, "actor"), false);
});

Deno.test("P1-C2-B attestation refuse une source absente ou une capture périmée", async () => {
  const command = validateFinalRequestCommand({
    operation: "attest_source",
    ...common,
    origin_kind: "email",
    origin_id: "77777777-7777-4777-8777-777777777777",
    author_role: "client",
    content_class: "current",
    reason: "Source vérifiée",
  });
  await assertRejects(
    () => executeFinalRequestCommand(command, ACTOR, deps().value),
    OrchestratorError,
    "Source absente",
  );
  const stale = deps(
    state({ head: { generation: 2, revision_id: null, capture_id: CAPTURE } }),
  );
  await assertRejects(
    () => executeFinalRequestCommand(command, ACTOR, stale.value),
    OrchestratorError,
    "demande a changé",
  );
});

Deno.test("P1-C2-B commit recalcule C1 et ne reçoit aucun verdict navigateur", async () => {
  const d = deps();
  const command = validateFinalRequestCommand({
    operation: "commit",
    ...common,
    capture_id: CAPTURE,
    assertions: [assertion],
  });
  await executeFinalRequestCommand(command, ACTOR, d.value);
  const mutation =
    (d.calls[1] as [string, { payload: Record<string, unknown> }])[1];
  assertEquals(mutation.payload.captureId, CAPTURE);
  assertEquals(mutation.payload.resolverVersion, RESOLVER_VERSION);
  assertEquals(
    (mutation.payload.result as { kind: string }).kind,
    "consistent",
  );
  assertEquals((mutation.payload.assertions as unknown[]).length, 1);
});

Deno.test("P1-C2-B commit refuse assertion invalide et capture différente", async () => {
  const invalid = validateFinalRequestCommand({
    operation: "commit",
    ...common,
    capture_id: CAPTURE,
    assertions: [{ ...assertion, excerpt: "absent" }],
  });
  await assertRejects(
    () => executeFinalRequestCommand(invalid, ACTOR, deps().value),
    OrchestratorError,
    "Calcul refusé",
  );
  const other = validateFinalRequestCommand({
    operation: "commit",
    ...common,
    capture_id: "77777777-7777-4777-8777-777777777777",
    assertions: [assertion],
  });
  await assertRejects(
    () => executeFinalRequestCommand(other, ACTOR, deps().value),
    OrchestratorError,
    "Capture périmée",
  );
});

Deno.test("P1-C2-B read enrichit une révision sans jamais autoriser le pricing", async () => {
  const d = deps(
    state({
      head: { generation: 2, revision_id: REVISION, capture_id: CAPTURE },
      revision: { id: REVISION, input: { assertions: [assertion] } },
      selectedRevisionMatchesHeadCapture: true,
    }),
  );
  const result = await executeFinalRequestCommand(
    validateFinalRequestCommand({ operation: "read", case_id: CASE }),
    ACTOR,
    d.value,
  );
  assertEquals(
    (result.calculationStatus as { kind: string }).kind,
    "calculated",
  );
  assertEquals(result.pricingAuthorized, false);
});

Deno.test("P1-C2-B revue refuse cible/candidat forgés avant la RPC", async () => {
  for (
    const [target_id, candidate_ref] of [[
      '["field","case","cargo.weight_kg"]',
      "fake",
    ], ['["unknown"]', null]]
  ) {
    const command = validateFinalRequestCommand({
      operation: "review",
      ...common,
      decision: candidate_ref ? "confirm_instruction" : "request_clarification",
      target_id,
      candidate_ref,
      previous_event_id: null,
      reason: "Décision explicite",
    });
    await assertRejects(
      () => executeFinalRequestCommand(command, ACTOR, deps().value),
      OrchestratorError,
      "périmée",
    );
  }
});

Deno.test("P1-C2-B revue de capture transmet la cible fermée exacte", async () => {
  const d = deps(
    state({
      head: { generation: 2, revision_id: REVISION, capture_id: CAPTURE },
    }),
  );
  const command = validateFinalRequestCommand({
    operation: "review",
    case_id: CASE,
    idempotency_key: "review-fixture",
    expected_revision_id: REVISION,
    expected_generation: 2,
    decision: "review_capture",
    target_id: '["capture"]',
    candidate_ref: null,
    previous_event_id: null,
    reason: "Capture complète vérifiée",
  });
  await executeFinalRequestCommand(command, ACTOR, d.value);
  const mutation =
    (d.calls[1] as [string, { payload: Record<string, unknown> }])[1];
  assertEquals(mutation.payload.target, ["capture"]);
  assertEquals(mutation.payload.previousEventId, null);
});

Deno.test("P1-C2-B mapping RPC ne divulgue pas les messages SQL", () => {
  assertEquals(
    mapFinalRequestRpcError("FRS_REVIEWER_REQUIRED secret").code,
    "FORBIDDEN_OWNER",
  );
  assertEquals(
    mapFinalRequestRpcError("FRS_STALE_HEAD details").code,
    "CONFLICT_INVALID_STATE",
  );
  assertEquals(
    mapFinalRequestRpcError("FRS_REVIEW_INVALID details").code,
    "VALIDATION_FAILED",
  );
  assertEquals(
    mapFinalRequestRpcError("postgres internals").message,
    "Service de demande consolidée indisponible",
  );
});

Deno.test("P1-C2-B acteur injecté invalide est refusé", async () => {
  await assertRejects(
    () =>
      executeFinalRequestCommand(
        validateFinalRequestCommand({ operation: "read", case_id: CASE }),
        "browser-actor",
        deps().value,
      ),
    OrchestratorError,
    "Identité invalide",
  );
  assertEquals(EVENT.length, 36); // fixture UUID sanity, aucun accès runtime.
});
