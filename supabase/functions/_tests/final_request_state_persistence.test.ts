/** P1-C2-A : fixtures SYNTHETIQUES, zéro I/O, aucun prix ni état runtime. */
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type CalculatedFinalRequestCapture,
  type PersistedFinalRequestCaptureInput,
  resolvePersistedFinalRequestCapture as resolveCapture,
  RESOLVER_VERSION,
  type ReviewTarget,
} from "../_shared/final-request-state-persistence.ts";
import type {
  FieldKey,
  FieldScope,
  FieldValue,
  FinalRequestStateAssertionInput as Assertion,
  FinalRequestStateProtectedFactInput as Protected,
  FinalRequestStateSourceInput as Source,
} from "../_shared/final-request-state.ts";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const CAPTURE_ID = "22222222-2222-4222-8222-222222222222";
const HEAD_REVISION_ID = "33333333-3333-4333-8333-333333333333";
const INVENTORY_HASH = "a".repeat(64);
const ALT_INVENTORY_HASH = "b".repeat(64);

const t1 = "2026-08-01T10:00:00Z";
const t2 = "2026-08-02T10:00:00Z";

function source(
  id = "s1",
  sentAt: string | null = t1,
  changes: Partial<Source> = {},
): Source {
  return {
    id,
    caseId: CASE_ID,
    kind: "email",
    authorRole: "client",
    roleVerified: true,
    contentClass: "current",
    sentAt,
    text: "Instruction explicite de la fixture uniquement.",
    ...changes,
  };
}

function set(
  id = "a1",
  sourceId = "s1",
  field: FieldKey = "cargo.weight_kg",
  value: FieldValue = 1000,
  scope: FieldScope = "case",
): Assertion {
  return {
    id,
    sourceId,
    scope,
    operation: "set",
    field,
    value,
    excerpt: "Instruction explicite",
  };
}

function opAssertion(
  op: Assertion["operation"],
  id = "a2",
  sourceId = "s2",
  extra: Partial<Assertion> = {},
): Assertion {
  return {
    id,
    sourceId,
    scope: "case",
    operation: op,
    excerpt: "Instruction explicite",
    ...extra,
  };
}

function protectedFact(): Protected {
  return {
    scope: "case",
    field: "cargo.weight_kg",
    value: 1000,
    reference: "ref-1",
    validatedBy: "operator-test",
  };
}

function baseInput(
  overrides: Partial<PersistedFinalRequestCaptureInput["baseInput"]> = {},
): PersistedFinalRequestCaptureInput["baseInput"] {
  return {
    caseId: CASE_ID,
    lotIds: ["lot-a", "lot-b"],
    quotationVersionIds: ["quote-v1", "quote-v2"],
    sources: [source()],
    protectedFacts: [],
    ...overrides,
  };
}

function capture(
  overrides: Partial<PersistedFinalRequestCaptureInput> = {},
): PersistedFinalRequestCaptureInput {
  return {
    schemaVersion: 1,
    captureId: CAPTURE_ID,
    caseId: CASE_ID,
    headRevisionId: null,
    generation: 0,
    inventoryHash: INVENTORY_HASH,
    resolverVersion: RESOLVER_VERSION,
    baseInput: baseInput(),
    limitations: [],
    ...overrides,
  };
}

function expectCalculated(
  r: ReturnType<typeof resolveCapture>,
): CalculatedFinalRequestCapture {
  assertEquals(r.kind, "calculated");
  return r as CalculatedFinalRequestCapture;
}

function expectRejected(r: ReturnType<typeof resolveCapture>, code: string) {
  assertEquals(r.kind, "rejected");
  assertEquals((r as { code: string }).code, code);
}

function freezeDeep(v: unknown): void {
  if (v && typeof v === "object") {
    for (const child of Object.values(v)) freezeDeep(child);
    Object.freeze(v);
  }
}

Deno.test("P1-C2-A nominal : capture consistante, pricingAuthorized false, resolverVersion échoué", () => {
  const r = expectCalculated(resolveCapture(capture(), [set()]));
  assertEquals(r.result.kind, "consistent");
  assertEquals(r.pricingAuthorized, false);
  assertEquals(r.resolverVersion, RESOLVER_VERSION);
  assertEquals(r.captureId, CAPTURE_ID);
  assertEquals(r.caseId, CASE_ID);
  assertEquals(r.generation, 0);
  assertEquals(r.inventoryHash, INVENTORY_HASH);
  assertEquals(r.reviewTargets, []);
});

Deno.test("P1-C2-A no_request : aucune assertion, aucune reviewTarget", () => {
  const r = expectCalculated(resolveCapture(capture(), []));
  assertEquals(r.result.kind, "no_request");
  assertEquals(r.reviewTargets, []);
});

Deno.test("P1-C2-A needs_review : autorité ambiguë produit une reviewTarget de champ", () => {
  const r = expectCalculated(
    resolveCapture(
      capture({
        baseInput: baseInput({
          sources: [source(), source("s2", t2, { authorRole: "unknown" })],
        }),
      }),
      [set(), set("a2", "s2", "cargo.weight_kg", 9000)],
    ),
  );
  assertEquals(r.result.kind, "needs_review");
  assertEquals(r.reviewTargets.length, 1);
  assertEquals(r.reviewTargets[0].kind, "field");
});

Deno.test("P1-C2-A cancelled : lifecycle résolu, pas de reviewTarget", () => {
  const r = expectCalculated(
    resolveCapture(
      capture({
        baseInput: baseInput({
          sources: [source(), source("s2", t2)],
        }),
      }),
      [set(), opAssertion("cancel_request", "a2", "s2")],
    ),
  );
  assertEquals(r.result.kind, "cancelled");
  assertEquals(r.reviewTargets, []);
});

Deno.test("P1-C2-A invalid_input C1 (source cross-case) : rejet générique, aucune fuite de raison", () => {
  const r = resolveCapture(
    capture({
      baseInput: baseInput({
        sources: [source("s1", t1, { caseId: "other-case" })],
      }),
    }),
    [set()],
  );
  expectRejected(r, "INVALID_REQUEST_INPUT");
});

Deno.test("P1-C2-A assertion référence une source inconnue : rejet générique", () => {
  const r = resolveCapture(capture(), [set("a1", "unknown-source")]);
  expectRejected(r, "INVALID_REQUEST_INPUT");
});

Deno.test("P1-C2-A assertion référence un lot inconnu : rejet générique", () => {
  const r = resolveCapture(
    capture(),
    [set("a1", "s1", "lot.in_scope", true, { lotId: "unknown-lot" })],
  );
  expectRejected(r, "INVALID_REQUEST_INPUT");
});

Deno.test("P1-C2-A quote canonique acceptée", () => {
  const r = expectCalculated(
    resolveCapture(capture(), [
      opAssertion("accept_quote", "a1", "s1", {
        quotationVersionId: "quote-v1",
      }),
    ]),
  );
  assertEquals(r.result.kind, "consistent");
});

Deno.test("P1-C2-A quote inconnue/scénario rejetée à la frontière adaptateur, même si C1 l'aurait mise en needs_review", () => {
  const r = resolveCapture(
    capture(),
    [opAssertion("accept_quote", "a1", "s1", {
      quotationVersionId: "quote-scenario-inexistante",
    })],
  );
  expectRejected(r, "UNKNOWN_QUOTATION_REFERENCE");
});

Deno.test("P1-C2-A no_request avec quote inconnue reste rejetée (pas de contournement par kind)", () => {
  const r = resolveCapture(
    capture(),
    [opAssertion("reject_quote", "a1", "s1", {
      quotationVersionId: "quote-scenario-inexistante",
    })],
  );
  expectRejected(r, "UNKNOWN_QUOTATION_REFERENCE");
});

Deno.test("P1-C2-A cancelled avec quote inconnue reste rejetée (pas de contournement par kind)", () => {
  const r = resolveCapture(
    capture({
      baseInput: baseInput({ sources: [source(), source("s2", t2)] }),
    }),
    [
      opAssertion("cancel_request", "a1", "s1"),
      opAssertion("accept_quote", "a2", "s2", {
        quotationVersionId: "quote-scenario-inexistante",
      }),
    ],
  );
  expectRejected(r, "UNKNOWN_QUOTATION_REFERENCE");
});

Deno.test("P1-C2-A date source nulle : candidat non confirmable, clarification seule", () => {
  const r = expectCalculated(
    resolveCapture(
      capture({
        baseInput: baseInput({
          sources: [source(), source("s2", null)],
        }),
      }),
      [set(), set("a2", "s2", "cargo.weight_kg", 9000)],
    ),
  );
  const target = r.reviewTargets.find((
    t,
  ): t is Extract<ReviewTarget, { kind: "field" }> => t.kind === "field")!;
  const bad = target.candidates.find((c) => c.assertionId === "a2")!;
  assertEquals(bad.actions, ["request_clarification"]);
});

Deno.test("P1-C2-A date impossible (30 février) : candidat non confirmable", () => {
  const r = expectCalculated(
    resolveCapture(
      capture({
        baseInput: baseInput({
          sources: [source(), source("s2", "2026-02-30T10:00:00Z")],
        }),
      }),
      [set(), set("a2", "s2", "cargo.weight_kg", 9000)],
    ),
  );
  const target = r.reviewTargets.find((
    t,
  ): t is Extract<ReviewTarget, { kind: "field" }> => t.kind === "field")!;
  const bad = target.candidates.find((c) => c.assertionId === "a2")!;
  assertEquals(bad.actions, ["request_clarification"]);
});

for (const authorRole of ["partner", "operator"] as const) {
  Deno.test(`P1-C2-A ${authorRole} attesté n'est jamais une autorité client, jamais de reviewTarget pour lui`, () => {
    const r = expectCalculated(
      resolveCapture(
        capture({
          baseInput: baseInput({
            sources: [source(), source("s2", t2, { authorRole })],
          }),
        }),
        [set(), set("a2", "s2", "cargo.weight_kg", 9000)],
      ),
    );
    assertEquals(r.result.kind, "consistent");
    for (const target of r.reviewTargets) {
      assert(!target.candidates.some((c) => c.assertionId === "a2"));
    }
  });
}

Deno.test("P1-C2-A candidats au même instant : les deux présentés, aucun gagnant automatique", () => {
  const r = expectCalculated(
    resolveCapture(
      capture({
        baseInput: baseInput({
          sources: [source("s1", t1), source("s2", t1)],
        }),
      }),
      [
        set("a1", "s1", "cargo.weight_kg", 1000),
        set("a2", "s2", "cargo.weight_kg", 2000),
      ],
    ),
  );
  assertEquals(r.result.kind, "needs_review");
  const target = r.reviewTargets.find((t) => t.kind === "field") as Extract<
    ReviewTarget,
    { kind: "field" }
  >;
  assertEquals(target.candidates.length, 2);
  for (const c of target.candidates) {
    assert(c.actions.includes("confirm_instruction"));
  }
});

Deno.test("P1-C2-A conflit avec fait protégé : aucune mutation du fait, réconciliation requise", () => {
  const r = expectCalculated(
    resolveCapture(
      capture({
        baseInput: baseInput({
          protectedFacts: [protectedFact()],
        }),
      }),
      [set("a1", "s1", "cargo.weight_kg", 2000)],
    ),
  );
  assertEquals(r.result.kind, "needs_review");
  assert("protectedFacts" in r.result);
  assertEquals(
    (r.result as { protectedFacts: Protected[] }).protectedFacts[0].value,
    1000,
  );
  const target = r.reviewTargets.find((t) => t.kind === "field") as Extract<
    ReviewTarget,
    { kind: "field" }
  >;
  assertEquals(target.protectedFact?.value, 1000);
  assertEquals(target.protectedFact?.reference, "ref-1");
  const candidate = target.candidates.find((c) => c.assertionId === "a1")!;
  assertEquals(candidate.needsFactReconciliation, true);
  assert(candidate.actions.includes("keep_protected_fact"));
  assert(candidate.actions.includes("confirm_instruction"));
});

Deno.test("P1-C2-A limitations préservées intégralement et dans l'ordre", () => {
  const limitations = ["SOURCE_UNATTESTED", "PROTECTED_FACT_AMBIGUOUS:ref-123"];
  const r = expectCalculated(resolveCapture(capture({ limitations }), [set()]));
  assertEquals(r.limitations, limitations);
});

Deno.test("P1-C2-A forme fermée : clés exactes pour calculated et rejected", () => {
  const calculated = expectCalculated(resolveCapture(capture(), [set()]));
  assertEquals(
    Object.keys(calculated).sort(),
    [
      "caseId",
      "captureId",
      "generation",
      "headRevisionId",
      "input",
      "inventoryHash",
      "kind",
      "limitations",
      "pricingAuthorized",
      "resolverVersion",
      "result",
      "reviewTargets",
    ].sort(),
  );
  const rejected = resolveCapture({}, []);
  assertEquals(Object.keys(rejected).sort(), ["code", "kind"]);
});

Deno.test("P1-C2-A getters jamais exécutés sur une capture malicieuse", () => {
  const c: Record<string, unknown> = { ...capture() };
  Object.defineProperty(c, "captureId", {
    enumerable: true,
    get(): string {
      throw new Error("getter executed");
    },
  });
  const r = resolveCapture(c, [set()]);
  expectRejected(r, "INVALID_CAPTURE");
});

Deno.test("P1-C2-A getter dans un élément d'assertions n'est jamais exécuté", () => {
  const bad: Record<string, unknown> = { ...set() };
  Object.defineProperty(bad, "quotationVersionId", {
    enumerable: true,
    get(): string {
      throw new Error("getter executed");
    },
  });
  assertThrows(() => JSON.stringify(bad), Error, "getter executed");
  const r = resolveCapture(capture(), [bad]);
  expectRejected(r, "INVALID_REQUEST_INPUT");
});

Deno.test("P1-C2-A objet Object.create(null) rejeté (pas de prototype)", () => {
  const c = Object.create(null);
  const r = resolveCapture(c, []);
  expectRejected(r, "INVALID_CAPTURE");
});

Deno.test("P1-C2-A clé __proto__ explicite rejetée comme clé inconnue", () => {
  const c: Record<string, unknown> = { ...capture() };
  Object.defineProperty(c, "__proto__", { value: { x: 1 }, enumerable: true });
  const r = resolveCapture(c, [set()]);
  expectRejected(r, "INVALID_CAPTURE");
});

Deno.test("P1-C2-A clé symbole présente rejette la capture", () => {
  const c: Record<string | symbol, unknown> = { ...capture() };
  c[Symbol("x")] = 1;
  const r = resolveCapture(c, [set()]);
  expectRejected(r, "INVALID_CAPTURE");
});

Deno.test("P1-C2-A tableau creux (sparse) dans limitations rejeté", () => {
  const limitations: unknown[] = ["SOURCE_EMPTY"];
  limitations[5] = "INVENTORY_LIMIT";
  const r = resolveCapture(capture({ limitations: limitations as string[] }), [
    set(),
  ]);
  expectRejected(r, "INVALID_CAPTURE");
});

for (
  const generation of [NaN, Infinity, -Infinity, -1, 1.5]
) {
  Deno.test(`P1-C2-A generation non entière/négative/non finie (${generation}) rejetée`, () => {
    const r = resolveCapture(capture({ generation }), [set()]);
    expectRejected(r, "INVALID_CAPTURE");
  });
}

Deno.test("P1-C2-A generation à Number.MAX_SAFE_INTEGER acceptée et restituée telle quelle", () => {
  const r = expectCalculated(
    resolveCapture(capture({ generation: Number.MAX_SAFE_INTEGER }), [set()]),
  );
  assertEquals(r.generation, Number.MAX_SAFE_INTEGER);
});

Deno.test("P1-C2-A generation au-delà de MAX_SAFE_INTEGER rejetée", () => {
  const r = resolveCapture(
    capture({ generation: Number.MAX_SAFE_INTEGER + 2 }),
    [set()],
  );
  expectRejected(r, "INVALID_CAPTURE");
});

Deno.test("P1-C2-A ordre des assertions permuté : reviewTargets identiques (déterminisme)", () => {
  const data = capture({
    baseInput: baseInput({ sources: [source(), source("s2", t2)] }),
  });
  const assertions = [set(), set("a2", "s2", "cargo.weight_kg", 2000)];
  const a = expectCalculated(resolveCapture(data, assertions));
  const b = expectCalculated(resolveCapture(data, [...assertions].reverse()));
  assertEquals(
    JSON.stringify(a.reviewTargets),
    JSON.stringify(b.reviewTargets),
  );
});

Deno.test("P1-C2-A indépendance capture/assertions/sortie : gel profond de l'entrée sans mutation", () => {
  const data = capture();
  const assertions = [set()];
  freezeDeep(data);
  freezeDeep(assertions);
  const r = expectCalculated(resolveCapture(data, assertions));
  r.limitations.push("MUTATED");
  r.reviewTargets.push({ targetId: "x", kind: "lifecycle", candidates: [] });
  r.input.caseId = "MUTATED";
  const r2 = expectCalculated(resolveCapture(data, assertions));
  assertEquals(r2.limitations, []);
  assertEquals(r2.reviewTargets, []);
  assertEquals(r2.input.caseId, CASE_ID);
});

Deno.test("P1-C2-A texte et référence Unicode préservés verbatim", () => {
  const text = "Cargaison Ω中文🚢 vers Dakar";
  const r = expectCalculated(
    resolveCapture(
      capture({
        baseInput: baseInput({
          sources: [source("s1", t1, { text })],
        }),
        limitations: ["PROTECTED_FACT_AMBIGUOUS:réf-中文-🚢"],
      }),
      [{ ...set(), excerpt: text.slice(0, 10) }],
    ),
  );
  assertEquals(r.limitations, ["PROTECTED_FACT_AMBIGUOUS:réf-中文-🚢"]);
});

Deno.test("P1-C2-A inventoryHash reste opaque : deux hachages différents acceptés sans comparaison de contenu", () => {
  const r1 = expectCalculated(
    resolveCapture(capture({ inventoryHash: INVENTORY_HASH }), [set()]),
  );
  const r2 = expectCalculated(
    resolveCapture(capture({ inventoryHash: ALT_INVENTORY_HASH }), [set()]),
  );
  assertEquals(r1.inventoryHash, INVENTORY_HASH);
  assertEquals(r2.inventoryHash, ALT_INVENTORY_HASH);
  assertNotEquals(r1.inventoryHash, r2.inventoryHash);
});

Deno.test("P1-C2-A resolverVersion différent rejeté distinctement", () => {
  const r = resolveCapture(capture({ resolverVersion: "p1c1-other" }), [set()]);
  expectRejected(r, "RESOLVER_VERSION_MISMATCH");
});

Deno.test("P1-C2-A clé top-level inconnue rejetée", () => {
  const c: Record<string, unknown> = { ...capture(), extra: "nope" };
  const r = resolveCapture(c, [set()]);
  expectRejected(r, "INVALID_CAPTURE");
});

Deno.test("P1-C2-A headRevisionId invalide rejeté, headRevisionId uuid valide accepté", () => {
  const bad = resolveCapture(capture({ headRevisionId: "not-a-uuid" }), [
    set(),
  ]);
  expectRejected(bad, "INVALID_CAPTURE");
  const good = expectCalculated(
    resolveCapture(capture({ headRevisionId: HEAD_REVISION_ID }), [set()]),
  );
  assertEquals(good.headRevisionId, HEAD_REVISION_ID);
});

Deno.test("P1-C2-A baseInput.caseId incohérent avec caseId top-level rejeté", () => {
  const c = capture();
  const r = resolveCapture(
    { ...c, baseInput: { ...c.baseInput, caseId: "other-case-id" } },
    [set()],
  );
  expectRejected(r, "INVALID_CAPTURE");
});

Deno.test("P1-C2-A baseInput avec clé manquante ou en trop rejeté", () => {
  const c = capture();
  const missing = resolveCapture(
    {
      ...c,
      baseInput: {
        caseId: c.caseId,
        lotIds: [],
        quotationVersionIds: [],
        sources: [],
      },
    },
    [set()],
  );
  expectRejected(missing, "INVALID_CAPTURE");
  const extra = resolveCapture(
    { ...c, baseInput: { ...c.baseInput, extra: 1 } },
    [set()],
  );
  expectRejected(extra, "INVALID_CAPTURE");
});

Deno.test("P1-C2-A limitation avec code inconnu rejetée", () => {
  const r = resolveCapture(capture({ limitations: ["NOT_A_CODE"] }), [set()]);
  expectRejected(r, "INVALID_CAPTURE");
});

Deno.test("P1-C2-A limitation avec référence vide après ':' rejetée", () => {
  const r = resolveCapture(capture({ limitations: ["SOURCE_EMPTY:"] }), [
    set(),
  ]);
  expectRejected(r, "INVALID_CAPTURE");
});

Deno.test("P1-C2-A limitation avec caractère de contrôle dans la référence rejetée", () => {
  const r = resolveCapture(
    capture({ limitations: ["SOURCE_EMPTY:bad\u0000ref"] }),
    [set()],
  );
  expectRejected(r, "INVALID_CAPTURE");
});

Deno.test("P1-C2-A pricingAuthorized est toujours false, jamais une autre clé de tarification", () => {
  const r = expectCalculated(resolveCapture(capture(), [set()]));
  assertEquals(r.pricingAuthorized, false);
  assert(!("pricingAllowed" in r));
  assert(!("ready_to_price" in r));
});
