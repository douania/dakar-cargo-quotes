/** P1-C1 : fixtures SYNTHETIQUES, zéro I/O, aucun prix ni état runtime. */
import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type FieldKey,
  type FieldScope,
  type FieldValue,
  type FinalRequestStateAssertionInput as Assertion,
  type FinalRequestStateInput as Input,
  type FinalRequestStateProtectedFactInput as Protected,
  type FinalRequestStateSourceInput as Source,
  resolveFinalRequestState as resolve,
} from "../_shared/final-request-state.ts";

const t1 = "2026-08-01T10:00:00Z";
const t2 = "2026-08-02T10:00:00Z";
const t3 = "2026-08-03T10:00:00Z";
function source(
  id = "s1",
  sentAt: string | null = t1,
  changes: Partial<Source> = {},
): Source {
  return {
    id,
    caseId: "case-test",
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
function operation(
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
function input(
  sources: Source[] = [source()],
  assertions: Assertion[] = [set()],
  protectedFacts: Protected[] = [],
): Input {
  return {
    caseId: "case-test",
    lotIds: ["lot-a", "lot-b", "case", "__proto__"],
    quotationVersionIds: ["quote-v1", "quote-v2"],
    sources,
    assertions,
    protectedFacts,
  };
}
function field(
  result: ReturnType<typeof resolve>,
  key: FieldKey = "cargo.weight_kg",
  scope: FieldScope = "case",
) {
  assert("fields" in result, `expected fields, got ${result.kind}`);
  return result.fields.find((f) =>
    f.field === key && JSON.stringify(f.scope) === JSON.stringify(scope)
  );
}
function value(
  result: ReturnType<typeof resolve>,
  key: FieldKey = "cargo.weight_kg",
  scope: FieldScope = "case",
) {
  const f = field(result, key, scope);
  return f?.status === "set" ? f.value : undefined;
}
function freezeDeep(v: unknown): void {
  if (v && typeof v === "object") {
    for (const child of Object.values(v)) freezeDeep(child);
    Object.freeze(v);
  }
}
function protectedFact(): Protected {
  return {
    scope: "case",
    field: "cargo.weight_kg",
    value: 1000,
    reference: "validation-operateur-fictive",
    validatedBy: "operator-test",
  };
}

Deno.test("P1-C1 nominal : demande cohérente, format v1 et aucune autorisation pricing", () => {
  const r = resolve(input());
  assertEquals(r.kind, "consistent");
  assertEquals(value(r), 1000);
  assertEquals(r.schemaVersion, 1);
  assert(!("pricingAllowed" in r));
  assert(!("ready_to_price" in r));
});
Deno.test("P1-C1 source et citation exactes restent dans résultat et historique", () => {
  const r = resolve(input());
  const f = field(r);
  assert(f);
  assertEquals(Reflect.get(f, "excerpt"), "Instruction explicite");
  assertEquals(Reflect.get(r, "caseId"), "case-test");
  assert("journal" in r);
  assertEquals(Reflect.get(r.journal[0], "sourceId"), "s1");
  assertEquals(Reflect.get(r.journal[0], "excerpt"), "Instruction explicite");
});
Deno.test("P1-C1 amendement ciblé puis merci : autres champs conservés", () => {
  const r = resolve(
    input([source(), source("s2", t2), source("s3", t3)], [
      set(),
      set("dest", "s1", "routing.destination_city", "Ville A"),
      set("weight", "s2", "cargo.weight_kg", 2000),
      operation("acknowledge", "merci", "s3"),
    ]),
  );
  assertEquals(r.kind, "consistent");
  assertEquals(value(r), 2000);
  assertEquals(value(r, "routing.destination_city"), "Ville A");
});
Deno.test("P1-C1 ordre tableau ne représente pas ordre d'envoi", () => {
  const data = input([source(), source("s2", t2)], [
    set(),
    set("a2", "s2", "cargo.weight_kg", 2000),
  ]);
  assertEquals(
    resolve(data),
    resolve({
      ...data,
      sources: [...data.sources].reverse(),
      assertions: [...data.assertions].reverse(),
    }),
  );
});
for (const contentClass of ["quoted", "historical", "hypothesis"] as const) {
  Deno.test(`P1-C1 contexte ${contentClass} jamais promu`, () => {
    const r = resolve(
      input([source(), source("s2", t2, { contentClass, kind: "document" })], [
        set(),
        set("a2", "s2", "cargo.weight_kg", 9000),
      ]),
    );
    assertEquals(r.kind, "consistent");
    assertEquals(value(r), 1000);
    assert("journal" in r);
    assertEquals(
      r.journal.find((j) => j.assertionId === "a2")?.outcome,
      "ignored",
    );
  });
}
for (const authorRole of ["partner", "operator"] as const) {
  Deno.test(`P1-C1 ${authorRole} attesté plus récent ne remplace pas client`, () => {
    const r = resolve(
      input([source(), source("s2", t2, { authorRole })], [
        set(),
        set("a2", "s2", "cargo.weight_kg", 9000),
      ]),
    );
    assertEquals(r.kind, "consistent");
    assertEquals(value(r), 1000);
  });
}
for (
  const changes of [{ authorRole: "unknown" as const }, { roleVerified: false }]
) {
  Deno.test(`P1-C1 autorité ambiguë ${JSON.stringify(changes)} retire le champ des résolutions`, () => {
    const r = resolve(
      input([source(), source("s2", t2, changes)], [
        set(),
        set("a2", "s2", "cargo.weight_kg", 9000),
      ]),
    );
    assertEquals(r.kind, "needs_review");
    assertEquals(field(r), undefined);
  });
}
for (
  const sentAt of [
    null,
    "",
    "2026-08-02",
    "2026-08-02T10:00:00",
    "2026-02-30T10:00:00Z",
    "2026-01-01T25:00:00Z",
    "2026-08-02T10:00:00+15:00",
  ]
) {
  Deno.test(`P1-C1 date non sûre ${sentAt} : revue sans ancien champ affiché comme résolu`, () => {
    const r = resolve(
      input([source(), source("s2", sentAt)], [
        set(),
        set("a2", "s2", "cargo.weight_kg", 9000),
      ]),
    );
    assertEquals(r.kind, "needs_review");
    assertEquals(field(r), undefined);
  });
}
Deno.test("P1-C1 aucun fallback date-ingestion/created_at", () => {
  const data = input();
  Object.assign(data.sources[0], { receivedAt: t2, created_at: t3 });
  assertEquals(resolve(data).kind, "invalid_input");
});
Deno.test("P1-C1 même instant exprimé avec deux fuseaux : conflit de valeurs", () => {
  const r = resolve(
    input([source(), source("s2", "2026-08-01T12:00:00+02:00")], [
      set(),
      set("a2", "s2", "cargo.weight_kg", 2000),
    ]),
  );
  assertEquals(r.kind, "needs_review");
  assertEquals(field(r), undefined);
});
Deno.test("P1-C1 même instant et même valeur : toutes preuves conservées, ordre stable", () => {
  const data = input([source(), source("s2")], [set(), set("a2", "s2")]);
  const r = resolve(data);
  assertEquals(r.kind, "consistent");
  assert("journal" in r);
  assertEquals(r.journal.length, 2);
  assertEquals(
    r,
    resolve({ ...data, assertions: [...data.assertions].reverse() }),
  );
});
Deno.test("P1-C1 deux siècles avec année basse : Date.UTC ne décale pas 0099 vers 1999", () => {
  const r = resolve(
    input([
      source("s1", "0099-01-01T00:00:00Z"),
      source("s2", "1900-01-01T00:00:00Z"),
    ], [set(), set("a2", "s2", "cargo.weight_kg", 2000)]),
  );
  assertEquals(value(r), 2000);
});
Deno.test("P1-C1 iso bissextile réel accepté", () => {
  assertEquals(
    resolve(input([source("s1", "2024-02-29T10:00:00Z")])).kind,
    "consistent",
  );
});
Deno.test("P1-C1 remove ciblé conserve les autres champs et le tombstone", () => {
  const r = resolve(
    input([source(), source("s2", t2)], [
      set(),
      set("dest", "s1", "routing.destination_city", "Ville A"),
      operation("remove", "r", "s2", { field: "cargo.weight_kg" }),
    ]),
  );
  assertEquals(field(r)?.status, "removed");
  assertEquals(value(r, "routing.destination_city"), "Ville A");
});
Deno.test("P1-C1 set/remove simultanés : revue, pas de gagnant lexical", () => {
  const r = resolve(
    input([source()], [
      set(),
      operation("remove", "r", "s1", { field: "cargo.weight_kg" }),
    ]),
  );
  assertEquals(r.kind, "needs_review");
  assertEquals(field(r), undefined);
});
Deno.test("P1-C1 scope dossier et lots case/__proto__ distincts, retrait d'un lot local", () => {
  const r = resolve(
    input([source()], [
      set(),
      set("lotcase", "s1", "cargo.weight_kg", 2000, { lotId: "case" }),
      set("proto", "s1", "cargo.weight_kg", 3000, { lotId: "__proto__" }),
      set("exclude", "s1", "lot.in_scope", false, { lotId: "lot-a" }),
    ]),
  );
  assertEquals(value(r), 1000);
  assertEquals(value(r, "cargo.weight_kg", { lotId: "case" }), 2000);
  assertEquals(value(r, "cargo.weight_kg", { lotId: "__proto__" }), 3000);
  assertEquals(value(r, "lot.in_scope", { lotId: "lot-a" }), false);
  assertEquals(field(r, "lot.in_scope", { lotId: "lot-b" }), undefined);
});
Deno.test("P1-C1 service exclu décrit la demande sans créer service.overrides", () => {
  const r = resolve(
    input([source()], [set("service", "s1", "service.TRUCKING", false)]),
  );
  assertEquals(value(r, "service.TRUCKING"), false);
  assert(!JSON.stringify(r).includes("service.overrides"));
});
for (
  const assertion of [
    set("a1", "s1", "cargo.weight_kg", 2000),
    operation("remove", "a1", "s1", { field: "cargo.weight_kg" }),
  ]
) {
  Deno.test(`P1-C1 fait protégé contre ${assertion.operation}`, () => {
    const r = resolve(input([source()], [assertion], [protectedFact()]));
    assertEquals(r.kind, "needs_review");
    assertEquals(field(r), undefined);
    assert("protectedFacts" in r);
    assertEquals(r.protectedFacts[0].value, 1000);
  });
}
Deno.test("P1-C1 un email ultérieur égal au fait protégé ne résout pas le conflit historique", () => {
  const r = resolve(
    input([source(), source("s2", t2)], [
      set("a1", "s1", "cargo.weight_kg", 2000),
      set("a2", "s2"),
    ], [protectedFact()]),
  );
  assertEquals(r.kind, "needs_review");
  assert("protectedFactConflicts" in r);
  assertEquals(r.protectedFactConflicts.length, 1);
});
Deno.test("P1-C1 faits protégés seuls conservés sans prétendre une demande client nouvelle", () => {
  const r = resolve(input([], [], [protectedFact()]));
  assertEquals(r.kind, "no_request");
  assertEquals(Reflect.get(r, "protectedFacts"), [protectedFact()]);
});
Deno.test("P1-C1 instruction client identique au fait protégé : demande cohérente, fait non réécrit", () => {
  const r = resolve(input([source()], [set()], [protectedFact()]));
  assertEquals(r.kind, "consistent");
  assertEquals(field(r), undefined);
  assert("protectedFacts" in r);
  assertEquals(r.protectedFacts, [protectedFact()]);
});
Deno.test("P1-C1 reprise explicite sans champs n'est pas perdue comme no_request", () => {
  const r = resolve(
    input([source(), source("s2", t2)], [
      operation("cancel_request", "c", "s1"),
      operation("resume_request", "r", "s2"),
    ]),
  );
  assertEquals(r.kind, "consistent");
  assert("requestStatus" in r);
  assertEquals(r.requestStatus.state, "open");
});
Deno.test("P1-C1 annulation puis simple amendement ou acceptation ne reprend pas la demande", () => {
  const r = resolve(
    input([source(), source("s2", t2), source("s3", t3)], [
      set(),
      operation("cancel_request"),
      set("new", "s3", "cargo.weight_kg", 2000),
      operation("accept_quote", "accept", "s3", {
        quotationVersionId: "quote-v1",
      }),
    ]),
  );
  assertEquals(r.kind, "cancelled");
  assert("requestStatus" in r);
  assertEquals(r.requestStatus.state, "cancelled");
});
Deno.test("P1-C1 reprise explicite postérieure à annulation seulement", () => {
  const r = resolve(
    input([source(), source("s2", t2), source("s3", t3)], [
      set(),
      operation("cancel_request"),
      operation("resume_request", "resume", "s3"),
    ]),
  );
  assertEquals(r.kind, "consistent");
  assert("requestStatus" in r);
  assertEquals(r.requestStatus.state, "open");
});
Deno.test("P1-C1 reprise sans annulation connue : revue", () => {
  assertEquals(
    resolve(input([source()], [operation("resume_request", "r", "s1")])).kind,
    "needs_review",
  );
});
Deno.test("P1-C1 annulation/reprise simultanées : état indéterminé, aucune préférence", () => {
  const r = resolve(
    input([source()], [
      operation("cancel_request", "c", "s1"),
      operation("resume_request", "r", "s1"),
    ]),
  );
  assertEquals(r.kind, "needs_review");
  assert("requestStatus" in r);
  assertEquals(r.requestStatus.state, "undetermined");
});
Deno.test("P1-C1 annulation ambiguë : état indéterminé", () => {
  const r = resolve(
    input([source(), source("s2", null)], [set(), operation("cancel_request")]),
  );
  assertEquals(r.kind, "needs_review");
  assert("requestStatus" in r);
  assertEquals(r.requestStatus.state, "undetermined");
});
Deno.test("P1-C1 annulations identiques au même instant : résultat déterministe", () => {
  const data = input([source(), source("s2")], [
    operation("cancel_request", "z", "s1"),
    operation("cancel_request", "a", "s2"),
  ]);
  assertEquals(
    resolve(data),
    resolve({ ...data, assertions: [...data.assertions].reverse() }),
  );
});
Deno.test("P1-C1 refus d'offre versionnée distinct de l'annulation de demande", () => {
  const r = resolve(
    input([source()], [
      set(),
      operation("reject_quote", "r", "s1", { quotationVersionId: "quote-v1" }),
    ]),
  );
  assertEquals(r.kind, "consistent");
  assert("requestStatus" in r);
  assertEquals(r.requestStatus.state, "open");
  assert("quoteResponses" in r);
  assertEquals(r.quoteResponses[0].response, "rejected");
});
Deno.test("P1-C1 acceptation d'une version n'affecte pas une autre", () => {
  const r = resolve(
    input([source()], [
      operation("accept_quote", "a", "s1", { quotationVersionId: "quote-v1" }),
    ]),
  );
  assert("quoteResponses" in r);
  assertEquals(r.quoteResponses.length, 1);
  assertEquals(r.quoteResponses[0].quotationVersionId, "quote-v1");
});
Deno.test("P1-C1 réponse sans version explicite refusée", () => {
  assertEquals(
    resolve(input([source()], [operation("accept_quote", "a", "s1")])).kind,
    "invalid_input",
  );
});
Deno.test("P1-C1 version inconnue jamais remplacée par la dernière", () => {
  assertEquals(
    resolve(
      input([source()], [
        operation("accept_quote", "a", "s1", { quotationVersionId: "unknown" }),
      ]),
    ).kind,
    "needs_review",
  );
});
Deno.test("P1-C1 accept/refus contradictoires au même instant", () => {
  const r = resolve(
    input([source()], [
      operation("accept_quote", "a", "s1", { quotationVersionId: "quote-v1" }),
      operation("reject_quote", "b", "s1", { quotationVersionId: "quote-v1" }),
    ]),
  );
  assertEquals(r.kind, "needs_review");
  assert("quoteResponses" in r);
  assertEquals(r.quoteResponses, []);
});
Deno.test("P1-C1 inventaire vide et simple accusé : no_request", () => {
  assertEquals(resolve(input([], [])).kind, "no_request");
  assertEquals(
    resolve(input([source()], [operation("acknowledge", "ack", "s1")])).kind,
    "no_request",
  );
});
Deno.test("P1-C1 rejeu source et assertion identiques avec clés permutées dédupliqué", () => {
  const data = input();
  const expected = resolve(data);
  data.sources.push(
    Object.fromEntries(
      Object.entries(data.sources[0]).reverse(),
    ) as unknown as Source,
  );
  data.assertions.push(
    Object.fromEntries(
      Object.entries(data.assertions[0]).reverse(),
    ) as unknown as Assertion,
  );
  assertEquals(resolve(data), expected);
});
for (const target of ["source", "assertion"]) {
  Deno.test(`P1-C1 collision d'identité ${target} refusée`, () => {
    const data = input();
    if (target === "source") data.sources.push(source("s1", t2));
    else data.assertions.push(set("a1", "s1", "cargo.weight_kg", 2000));
    assertEquals(resolve(data).kind, "invalid_input");
  });
}
Deno.test("P1-C1 fait protégé dupliqué identique dédupliqué, contradictoire refusé", () => {
  const data = input([], [], [protectedFact(), protectedFact()]);
  assertNotEquals(resolve(data).kind, "invalid_input");
  data.protectedFacts?.push({ ...protectedFact(), value: 2000 });
  assertEquals(resolve(data).kind, "invalid_input");
});
const invalidCases: [string, (i: Input) => unknown][] = [
  ["cross-case", (i) => {
    i.sources[0].caseId = "other-case";
    return i;
  }],
  ["source absente", (i) => {
    i.assertions[0].sourceId = "absent";
    return i;
  }],
  ["lot absent", (i) => {
    i.assertions[0].scope = { lotId: "absent" };
    return i;
  }],
  ["lot.in_scope au dossier", (i) => {
    i.assertions[0] = set("a1", "s1", "lot.in_scope", false);
    return i;
  }],
  ["citation absente", (i) => {
    i.assertions[0].excerpt = "absent";
    return i;
  }],
  ["citation blanche", (i) => {
    i.sources[0].text = " ";
    i.assertions[0].excerpt = " ";
    return i;
  }],
  ["ID blanc", (i) => {
    i.caseId = " ";
    i.sources[0].caseId = " ";
    return i;
  }],
  ["champ monétaire", (i) => {
    Object.assign(i.assertions[0], { field: "cargo.value" });
    return i;
  }],
  ["montant imbriqué", (i) => {
    Object.assign(i.assertions[0], { value: { amount: 100 } });
    return i;
  }],
  ["opération inconnue", (i) => {
    Object.assign(i.assertions[0], { operation: "promote" });
    return i;
  }],
  ["clé Auth", (i) => ({ ...i, user_id: "forged" })],
  ["protectedFacts null", (i) => ({ ...i, protectedFacts: null })],
  ["scope inconnu", (i) => {
    Object.assign(i.assertions[0], { scope: { lotId: "lot-a", all: true } });
    return i;
  }],
  ["source inconnue", (i) => {
    Object.assign(i.sources[0], { pricing_gate: true });
    return i;
  }],
  ["ack avec valeur", (i) => {
    i.assertions[0] = operation("acknowledge", "a1", "s1", { value: 42 });
    return i;
  }],
  ["remove avec valeur", (i) => {
    i.assertions[0] = operation("remove", "a1", "s1", {
      field: "cargo.weight_kg",
      value: 42,
    });
    return i;
  }],
  ["cancel scope lot", (i) => {
    i.assertions[0] = operation("cancel_request", "a1", "s1", {
      scope: { lotId: "lot-a" },
    });
    return i;
  }],
  ["entier non représentable", (i) => {
    i.assertions[0] = set(
      "a1",
      "s1",
      "cargo.pieces_count",
      Number.MAX_SAFE_INTEGER + 1,
    );
    return i;
  }],
  [
    "prototype objet",
    (i) => Object.assign(Object.create({ inherited: true }), i),
  ],
  ["prototype tableau", (i) => {
    Object.setPrototypeOf(i.sources, {
      [Symbol.iterator]: Array.prototype[Symbol.iterator],
    });
    return i;
  }],
  ["symbole caché", (i) => {
    Object.assign(i, { [Symbol("hidden")]: true });
    return i;
  }],
  [
    "trop de sources",
    (i) => ({
      ...i,
      sources: Array.from({ length: 501 }, (_, n) => source(`s${n}`)),
    }),
  ],
  ["texte trop long", (i) => {
    i.sources[0].text = "x".repeat(20001);
    return i;
  }],
  ["type source et rôle incohérents", (i) => {
    i.sources[0].kind = "operator";
    return i;
  }],
];
for (const [name, build] of invalidCases) {
  Deno.test(`P1-C1 schéma fermé : ${name}`, () =>
    assertEquals(resolve(build(input())).kind, "invalid_input"));
}
for (const badValue of [NaN, Infinity, -Infinity, 0, -1, "1000", null]) {
  Deno.test(`P1-C1 valeur poids invalide ${badValue}`, () => {
    const data = input();
    Object.assign(data.assertions[0], { value: badValue });
    assertEquals(resolve(data).kind, "invalid_input");
  });
}
Deno.test("P1-C1 accesseur refusé sans déclencher de code", () => {
  let called = false;
  const data = input();
  Object.defineProperty(data, "caseId", {
    enumerable: true,
    get() {
      called = true;
      return "case-test";
    },
  });
  assertEquals(resolve(data).kind, "invalid_input");
  assertEquals(called, false);
});
Deno.test("P1-C1 replay avec accesseur imbriqué refusé sans exécution", () => {
  const data = input([source()], [
    set("a1", "s1", "cargo.weight_kg", 1000, { lotId: "lot-a" }),
  ]);
  let called = false;
  const fakeScope = Object.defineProperty({}, "lotId", {
    enumerable: true,
    get() {
      called = true;
      return "lot-a";
    },
  });
  data.assertions.push({
    ...data.assertions[0],
    scope: fakeScope as FieldScope,
  });
  assertEquals(resolve(data).kind, "invalid_input");
  assertEquals(called, false);
});
Deno.test("P1-C1 somme des textes source bornée", () => {
  const sources = Array.from(
    { length: 51 },
    (_, n) => source(`s${n}`, t1, { text: "x".repeat(20000) }),
  );
  assertEquals(resolve(input(sources, [])).kind, "invalid_input");
});
Deno.test("P1-C1 offre avec réponse ambiguë ne conserve pas une réponse ancienne résolue", () => {
  const r = resolve(
    input([source(), source("s2", null)], [
      operation("accept_quote", "a", "s1", { quotationVersionId: "quote-v1" }),
      operation("reject_quote", "b", "s2", { quotationVersionId: "quote-v1" }),
    ]),
  );
  assertEquals(r.kind, "needs_review");
  assert("quoteResponses" in r);
  assertEquals(r.quoteResponses, []);
});
Deno.test("P1-C1 entrées protectedFacts permutées, aucun ordre commercial implicite", () => {
  const p2: Protected = {
    ...protectedFact(),
    scope: { lotId: "lot-b" },
    value: 2000,
  };
  const data = input([], [], [protectedFact(), p2]);
  assertEquals(
    resolve(data),
    resolve({ ...data, protectedFacts: [p2, protectedFact()] }),
  );
});
Deno.test("P1-C1 entrée gelée et mutations de sortie ne changent pas source", () => {
  const data = input([source()], [
    set("a1", "s1", "cargo.weight_kg", 1000, { lotId: "lot-a" }),
  ]);
  const before = JSON.stringify(data);
  freezeDeep(data);
  const r = resolve(data);
  const f = field(r, "cargo.weight_kg", { lotId: "lot-a" });
  assert(f);
  if (f.scope !== "case") f.scope.lotId = "mutated";
  assertEquals(JSON.stringify(data), before);
});
Deno.test("P1-C1 permutations complètes d'un inventaire multi-lots", () => {
  const data = input([source(), source("s2", t2), source("s3", t3)], [
    set(),
    set("a2", "s2", "cargo.weight_kg", 2000),
    set("lot", "s3", "routing.destination_city", "Ville B", { lotId: "lot-b" }),
  ]);
  const expected = resolve(data);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      assertEquals(
        resolve({
          ...data,
          sources: [...data.sources.slice(i), ...data.sources.slice(0, i)],
          assertions: [
            ...data.assertions.slice(j),
            ...data.assertions.slice(0, j),
          ],
        }),
        expected,
      );
    }
  }
});

const profiles: [string, [FieldKey, FieldValue, FieldScope?][]][] = [
  ["FCL LoLo", [["transport.mode", "MARITIME"], [
    "terminal.operation_mode",
    "LOLO",
  ], ["cargo.container_type", "40HC"]]],
  ["aérien", [["transport.mode", "AIR"], ["cargo.weight_kg", 420], [
    "cargo.volume_cbm",
    3,
  ]]],
  ["réexport", [["movement.direction", "REEXPORT"], [
    "routing.origin_port",
    "Port A",
  ], ["routing.destination_port", "Port B"]]],
  ["transit multimodal multi-destination", [
    ["transport.mode", "MULTIMODAL"],
    ["movement.direction", "TRANSIT"],
    ["routing.destination_city", "Ville A", { lotId: "lot-a" }],
    ["routing.destination_city", "Ville B", { lotId: "lot-b" }],
  ]],
  ["dangereux", [[
    "cargo.description",
    "Marchandise dangereuse explicitement déclarée dans une fixture fictive",
  ], ["cargo.pieces_count", 12]]],
  ["cross-trade", [["movement.direction", "CROSS_TRADE"], [
    "routing.origin_port",
    "Port A",
  ], ["routing.destination_port", "Port C"]]],
];
for (const [name, entries] of profiles) {
  Deno.test(`P1-C1 profil anonymisé : ${name}`, () => {
    const data = input(
      [source()],
      entries.map(([key, v, scope], n) =>
        set(`a${n}`, "s1", key, v, scope ?? "case")
      ),
    );
    const r = resolve(data);
    assertEquals(r.kind, "consistent");
    assert("fields" in r);
    assertEquals(r.fields.length, entries.length);
    for (const [key, v, scope] of entries) {
      assertEquals(value(r, key, scope ?? "case"), v);
    }
  });
}
