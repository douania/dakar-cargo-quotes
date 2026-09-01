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

Deno.test("P1-C2-B lecture normalise en null un head/revision PostgreSQL composites sans ligne", async () => {
  // frs_read utilise des locals %ROWTYPE (h, r) : sans ligne correspondante,
  // SELECT INTO laisse le record non-null avec toutes ses colonnes à null ;
  // to_jsonb() sérialise alors ce composite vide comme un objet, pas comme
  // un JSON null. C'est la réponse SQL réelle pour un dossier neuf.
  const emptyHead = {
    case_id: null,
    generation: null,
    revision_id: null,
    capture_id: null,
    review_event_id: null,
  };
  const emptyRevision = {
    id: null,
    case_id: null,
    version_number: null,
    parent_id: null,
    capture_id: null,
    resolver_version: null,
    input: null,
    raw_result: null,
    input_hash: null,
    result_hash: null,
    limitations: null,
    created_by: null,
    created_at: null,
  };
  const d = deps({
    head: emptyHead,
    revision: emptyRevision,
    captureRecord: null,
    reviews: [],
    history: [],
    historyTruncated: false,
    selectedRevisionMatchesHeadCapture: false,
    pricingAuthorized: false,
  });
  const result = await executeFinalRequestCommand(
    validateFinalRequestCommand({ operation: "read", case_id: CASE }),
    ACTOR,
    d.value,
  );
  // Exposition publique : le faux head/faux revision composites ne doivent
  // jamais fuiter vers le frontend comme des objets tronqués.
  assertEquals(result.head, null);
  assertEquals(result.revision, null);
  assertEquals(
    (result.calculationStatus as { kind: string }).kind,
    "not_calculated",
  );
});

Deno.test("P1-C2-B capture initiale avec expected_generation:0 réussit après normalisation du head vide", async () => {
  const d = deps();
  const command = validateFinalRequestCommand({
    operation: "capture",
    case_id: CASE,
    idempotency_key: "fixture-key-initial",
    expected_revision_id: null,
    expected_generation: 0,
  });
  await executeFinalRequestCommand(command, ACTOR, d.value);
  assertEquals(d.calls, [["mutate", {
    actorId: ACTOR,
    caseId: CASE,
    key: "fixture-key-initial",
    action: "capture",
    expectedRevisionId: null,
    expectedGeneration: 0,
    payload: {},
  }]]);
});

Deno.test("P1-C2-B une mutation avec expected_generation:null reste rejetée fail-closed", () => {
  assertThrows(
    () =>
      validateFinalRequestCommand({
        operation: "capture",
        case_id: CASE,
        idempotency_key: "fixture-key",
        expected_revision_id: null,
        expected_generation: null,
      }),
    OrchestratorError,
    "Commande ou CAS invalide",
  );
});

const ATTACHMENT = "88888888-8888-4888-8888-888888888888";
const DOCUMENT = "99999999-9999-4999-8999-999999999999";
function attachmentState() {
  return state({
    captureRecord: {
      capture,
      inventory: { sources: [] },
      sourceAttestationRefs: [
        { originKind: "email", originId: SOURCE, sourceHash: "b".repeat(64) },
        {
          originKind: "attachment",
          originId: ATTACHMENT,
          sourceHash: "c".repeat(64),
        },
        {
          originKind: "document",
          originId: DOCUMENT,
          sourceHash: "d".repeat(64),
        },
      ],
    },
  });
}
function attestation(extra: Record<string, unknown> = {}) {
  return {
    operation: "attest_source",
    ...common,
    origin_kind: "attachment",
    origin_id: ATTACHMENT,
    author_role: "client",
    content_class: "current",
    reason: "Original consulté par le cotateur",
    ...extra,
  };
}

Deno.test("P1-C2-H1 une pièce jointe sans complétude explicite est refusée", () => {
  assertThrows(
    () => validateFinalRequestCommand(attestation()),
    OrchestratorError,
    "Complétude de la source invalide",
  );
  for (const value of [null, "", "full", "COMPLETE", true, 1, "unknown"]) {
    assertThrows(
      () => validateFinalRequestCommand(attestation({ completeness: value })),
      OrchestratorError,
      "Complétude de la source invalide",
    );
  }
});

Deno.test("P1-C2-H1 un document sans complétude explicite est refusé", () => {
  assertThrows(
    () =>
      validateFinalRequestCommand(
        attestation({ origin_kind: "document" }),
      ),
    OrchestratorError,
    "Complétude de la source invalide",
  );
});

Deno.test("P1-C2-H1 un email ne peut jamais porter de complétude humaine", () => {
  for (const value of ["complete", "partial", null]) {
    assertThrows(
      () =>
        validateFinalRequestCommand(attestation({
          origin_kind: "email",
          origin_id: SOURCE,
          completeness: value,
        })),
      OrchestratorError,
      "Complétude de la source invalide",
    );
  }
  // Contrat historique strictement préservé : sans le champ, l'email passe.
  const command = validateFinalRequestCommand(
    attestation({ origin_kind: "email", origin_id: SOURCE }),
  );
  assertEquals(Object.hasOwn(command, "completeness"), false);
});

Deno.test("P1-C2-H1 la complétude attestée est transmise telle quelle à la RPC", async () => {
  for (const completeness of ["complete", "partial"] as const) {
    const d = deps(attachmentState());
    const command = validateFinalRequestCommand(attestation({ completeness }));
    const result = await executeFinalRequestCommand(command, ACTOR, d.value);
    const mutation =
      (d.calls[1] as [string, { payload: Record<string, unknown> }])[1];
    assertEquals(Object.keys(mutation.payload).sort(), [
      "authorRole",
      "completeness",
      "contentClass",
      "expectedSourceHash",
      "originId",
      "originKind",
      "reason",
    ]);
    assertEquals(mutation.payload.completeness, completeness);
    assertEquals(mutation.payload.expectedSourceHash, "c".repeat(64));
    assertEquals(result.pricingAuthorized, false);
  }
});

Deno.test("P1-C2-H1 une attestation d'email n'envoie aucune clé de complétude", async () => {
  const d = deps(attachmentState());
  const command = validateFinalRequestCommand(
    attestation({ origin_kind: "email", origin_id: SOURCE }),
  );
  const result = await executeFinalRequestCommand(command, ACTOR, d.value);
  const mutation =
    (d.calls[1] as [string, { payload: Record<string, unknown> }])[1];
  assertEquals(Object.hasOwn(mutation.payload, "completeness"), false);
  assertEquals(mutation.payload.expectedSourceHash, "b".repeat(64));
  assertEquals(result.pricingAuthorized, false);
});

Deno.test("P1-C2-H1 la date attestée d'un document autonome est transmise telle quelle", async () => {
  const d = deps(attachmentState());
  const command = validateFinalRequestCommand(attestation({
    origin_kind: "document",
    origin_id: DOCUMENT,
    completeness: "complete",
    sent_at: "2026-08-30T12:30:00.000Z",
  }));
  const result = await executeFinalRequestCommand(command, ACTOR, d.value);
  const mutation =
    (d.calls[1] as [string, { payload: Record<string, unknown> }])[1];
  assertEquals(mutation.payload.sentAt, "2026-08-30T12:30:00.000Z");
  assertEquals(mutation.payload.completeness, "complete");
  assertEquals(result.pricingAuthorized, false);
  // Sans date attestée, aucune clé n'est inventée côté serveur.
  const bare = deps(attachmentState());
  await executeFinalRequestCommand(
    validateFinalRequestCommand(attestation({ completeness: "partial" })),
    ACTOR,
    bare.value,
  );
  assertEquals(
    Object.hasOwn(
      (bare.calls[1] as [string, { payload: Record<string, unknown> }])[1]
        .payload,
      "sentAt",
    ),
    false,
  );
});

Deno.test("P1-C2-H1 la complétude ne contourne pas le contrôle de source ni le CAS", async () => {
  const absent = validateFinalRequestCommand(attestation({
    completeness: "complete",
  }));
  await assertRejects(
    () => executeFinalRequestCommand(absent, ACTOR, deps().value),
    OrchestratorError,
    "Source absente",
  );
  const stale = deps(
    state({
      head: { generation: 2, revision_id: null, capture_id: CAPTURE },
      captureRecord: attachmentState().captureRecord,
    }),
  );
  await assertRejects(
    () => executeFinalRequestCommand(absent, ACTOR, stale.value),
    OrchestratorError,
    "demande a changé",
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
