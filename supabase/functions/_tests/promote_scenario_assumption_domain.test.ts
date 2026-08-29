/**
 * Phase P1-A3 — Tests PURS du domaine de promote-scenario-assumption.
 *
 * Aucun réseau, aucune DB, aucun Deno.serve : l'import cible `domain.ts`, qui
 * ne dépend d'aucun client Supabase.
 *
 * Couvre les invariants P1-A3 côté Edge :
 *   - allowlist FERMÉE : aucune clé monétaire, tarifaire, à montant imbriqué ou
 *     à workflow de classification dédié n'est promouvable
 *   - jeton monétaire comparé EXACTEMENT, jamais en sous-chaîne
 *   - types promouvables bornés à text et number (aucun json)
 *   - promotion jamais automatique : attestation vraie + base fermée
 *   - aucun batch, aucune dé-promotion
 *   - identité, état, provenance et valeur écrite non forgeables
 *   - échos obligatoires : statut, valeur, fait courant, périmètre de scénario
 *   - empreinte de requête : stable, sensible au contenu, insensible à l'ordre
 *
 * Exécution :
 *   deno test supabase/functions/_tests/promote_scenario_assumption_domain.test.ts
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  BATCH_PAYLOAD_KEYS,
  buildFingerprintInput,
  buildRpcArgs,
  computeRequestFingerprint,
  findPromotableFactKey,
  FORBIDDEN_PAYLOAD_KEYS,
  hasControlCharacter,
  isMonetaryFactKey,
  mapRpcErrorCode,
  PROMOTABLE_FACT_KEYS,
  PROMOTABLE_STATUSES,
  PROMOTABLE_VALUE_TYPES,
  PROMOTION_BASES,
  promotionViolation,
  stableStringify,
  validatePromotionPayload,
} from "../promote-scenario-assumption/domain.ts";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const ASSUMPTION_ID = "22222222-2222-4222-8222-222222222222";
const FACT_ID = "33333333-3333-4333-8333-333333333333";
const SCENARIO_ID = "44444444-4444-4444-8444-444444444444";
const SCOPE_HASH = "a".repeat(64);

/** Payload nominal : poids promu, aucun fait courant, hors scénario. */
function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    case_id: CASE_ID,
    assumption_id: ASSUMPTION_ID,
    idempotency_key: "promote-key-0001",
    fact_key: "cargo.weight_kg",
    promotion_basis: "document_evidence",
    attested: true,
    expected_assumption_status: "active",
    expected_value_type: "number",
    expected_value: 12000,
    expect_no_current_fact: true,
    ...overrides,
  };
}

function ok(payload: Record<string, unknown>) {
  const result = validatePromotionPayload(payload);
  assert(result.ok, `payload refusé : ${result.ok ? "" : result.message}`);
  return result.value;
}

function rejected(payload: Record<string, unknown>) {
  const result = validatePromotionPayload(payload);
  assert(!result.ok, "payload accepté alors qu'il devait être refusé");
  return result;
}

// ── Allowlist : ce qui ne peut JAMAIS être promu ───────────────────────────

Deno.test("allowlist — aucune clé monétaire ou tarifaire n'est promouvable", () => {
  for (const key of [
    "cargo.value",
    "cargo.caf_value",
    "cargo.freight_cost",
    "cargo.pad_rate_fcfa_per_ton",
    "cargo.freight_exchange_rate",
  ]) {
    assertEquals(findPromotableFactKey(key), null, `${key} figure dans l'allowlist`);
    assertEquals(promotionViolation(key, "number", 1000), `fact_key_not_promotable:${key}`);
    const result = rejected(basePayload({ fact_key: key }));
    assertEquals(result.code, "MONETARY_KEY_NOT_PROMOTABLE");
  }
});

Deno.test("allowlist — aucune entrée ne porte un jeton monétaire", () => {
  for (const entry of PROMOTABLE_FACT_KEYS) {
    assert(
      !isMonetaryFactKey(entry.factKey),
      `${entry.factKey} contient un jeton monétaire`,
    );
    assert(
      (PROMOTABLE_VALUE_TYPES as readonly string[]).includes(entry.valueType),
      `${entry.factKey} déclare un type non promouvable`,
    );
  }
});

Deno.test("allowlist — les classifications à workflow dédié sont exclues", () => {
  // HS et PAD passent par commodity_classification_candidates ->
  // propagate_classification_candidate_to_fact. Les promouvoir ici
  // court-circuiterait ce chemin.
  for (const key of ["cargo.hs_code", "cargo.pad_category"]) {
    assertEquals(findPromotableFactKey(key), null);
  }
});

Deno.test("allowlist — les clés à montants imbriqués sont exclues", () => {
  // Un `unit_price` / `line_total` y voyagerait à l'intérieur d'un json,
  // hors de portée d'un contrôle par clé.
  for (const key of ["cargo.articles_detail", "cargo.containers", "service.overrides"]) {
    assertEquals(findPromotableFactKey(key), null);
  }
  // Le mode/package service modifie directement le périmètre tarifé : il ne
  // passe jamais par cette promotion générique.
  for (const key of ["service.mode", "service.package"]) {
    assertEquals(findPromotableFactKey(key), null);
  }
  // Et le type json n'est de toute façon pas promouvable.
  assert(!(PROMOTABLE_VALUE_TYPES as readonly string[]).includes("json"));
  assert(!(PROMOTABLE_VALUE_TYPES as readonly string[]).includes("boolean"));
  assert(!(PROMOTABLE_VALUE_TYPES as readonly string[]).includes("date"));
});

Deno.test("jeton monétaire — comparaison EXACTE, jamais en sous-chaîne", () => {
  // Le défaut à ne pas réintroduire : `chargeable` contient `charge`,
  // `container` contient `contain`. Ces clés sont légitimes.
  assert(!isMonetaryFactKey("cargo.chargeable_weight_kg"));
  assert(!isMonetaryFactKey("cargo.container_count"));
  assert(!isMonetaryFactKey("cargo.container_type"));
  assert(!isMonetaryFactKey("customs.regime_code"));
  // Découpage sur `.` ET `_` : sans le point, `cargo.caf_value` passerait.
  assert(isMonetaryFactKey("cargo.caf_value"));
  assert(isMonetaryFactKey("cargo.value"));
  assert(isMonetaryFactKey("cargo.freight_exchange_rate"));
  assert(isMonetaryFactKey("pricing.total_amount"));
});

// ── Validateur de valeur ───────────────────────────────────────────────────

Deno.test("valeur — type, bornes et vocabulaires fermés", () => {
  assertEquals(promotionViolation("cargo.weight_kg", "number", 12000), null);
  assertEquals(
    promotionViolation("cargo.weight_kg", "text", "12000"),
    "value_type_mismatch:cargo.weight_kg:attendu=number:fourni=text",
  );
  assertEquals(
    promotionViolation("cargo.container_count", "number", 2.5),
    "non_integer_value:cargo.container_count",
  );
  assertEquals(
    promotionViolation("cargo.weight_kg", "number", -1),
    "value_out_of_range:cargo.weight_kg:-1",
  );
  assertEquals(
    promotionViolation("cargo.weight_kg", "number", Number.POSITIVE_INFINITY),
    "invalid_value_shape:cargo.weight_kg:number attendu",
  );
  assertEquals(
    promotionViolation("routing.terminal_operation_mode", "text", "LOLO"),
    null,
  );
  assertEquals(
    promotionViolation("routing.terminal_operation_mode", "text", "RO-RO"),
    "value_not_allowed:routing.terminal_operation_mode:RO-RO",
  );
  assertEquals(
    promotionViolation("routing.incoterm", "text", "CIF"),
    null,
  );
  assertEquals(promotionViolation("cargo.description", "text", "   "), "empty_value:cargo.description");
  assertEquals(
    promotionViolation("cargo.description", "text", "x".repeat(501)),
    "value_too_long:cargo.description",
  );
  assertEquals(promotionViolation("cargo.weight_kg", "number", 0), "value_out_of_range:cargo.weight_kg:0");
  assertEquals(promotionViolation("cargo.weight_kg", "number", 1.2345), "too_many_decimals:cargo.weight_kg");
  assertEquals(promotionViolation("cargo.container_count", "number", 501), "value_out_of_range:cargo.container_count:501");
  assertEquals(promotionViolation("cargo.container_type", "text", "40HC"), null);
  assertEquals(
    promotionViolation("cargo.container_type", "text", "40 pieds"),
    "value_not_allowed:cargo.container_type:40 pieds",
  );
  assertEquals(
    promotionViolation("cargo.description", "text", `bus${String.fromCharCode(7)}`),
    "control_character:cargo.description",
  );
  assertEquals(promotionViolation("cargo.weight_kg", "number", null), "missing:value");
});

Deno.test("hasControlCharacter — miroir ASCII du CHECK SQL", () => {
  assert(hasControlCharacter(String.fromCharCode(1)));
  assert(hasControlCharacter(String.fromCharCode(31)));
  assert(hasControlCharacter(String.fromCharCode(127)));
  assert(!hasControlCharacter("Bus 40 places"));
  assert(!hasControlCharacter("conteneur 40' HC"));
});

// ── Promotion jamais automatique ───────────────────────────────────────────

Deno.test("attestation — absente ou fausse : refus nommé", () => {
  for (const attested of [undefined, false, "true", 1, null]) {
    const payload = basePayload();
    if (attested === undefined) delete payload.attested;
    else payload.attested = attested;
    assertEquals(rejected(payload).code, "ATTESTATION_REQUIRED");
  }
});

Deno.test("base de promotion — obligatoire et fermée", () => {
  assertEquals(PROMOTION_BASES.length, 5);
  for (const basis of PROMOTION_BASES) {
    ok(basePayload({ promotion_basis: basis }));
  }
  for (const basis of [undefined, "", "parce que", "promote_all", null, 42]) {
    const payload = basePayload();
    if (basis === undefined) delete payload.promotion_basis;
    else payload.promotion_basis = basis;
    const result = rejected(payload);
    assertEquals(
      result.code,
      basis === "promote_all" ? "AUTO_PROMOTION_NOT_ALLOWED" : "VALIDATION_FAILED",
    );
  }
});

Deno.test("aucun batch — les formes de masse sont refusées par un code dédié", () => {
  for (const key of BATCH_PAYLOAD_KEYS) {
    const result = rejected(basePayload({ [key]: ["x"] }));
    assertEquals(result.code, "BATCH_NOT_ALLOWED", `${key} accepté`);
  }
});

Deno.test("identité, état, provenance et valeur écrite ne sont jamais fournis", () => {
  for (const key of FORBIDDEN_PAYLOAD_KEYS) {
    const result = rejected(basePayload({ [key]: "x" }));
    assertEquals(result.code, "VALIDATION_FAILED", `${key} accepté`);
    assert(result.ok === false && result.message.includes(key));
  }
});

Deno.test("statut attendu — seuls active et client_confirmed sont promouvables", () => {
  assertEquals([...PROMOTABLE_STATUSES], ["active", "client_confirmed"]);
  for (const status of PROMOTABLE_STATUSES) {
    ok(basePayload({ expected_assumption_status: status }));
  }
  for (const status of ["refuted", "superseded", "promoted_to_fact", "", undefined]) {
    const payload = basePayload();
    if (status === undefined) delete payload.expected_assumption_status;
    else payload.expected_assumption_status = status;
    rejected(payload);
  }
});

// ── Échos : fait courant et périmètre de scénario ──────────────────────────

Deno.test("fait courant — exactement l'absence OU un identifiant, jamais les deux", () => {
  ok(basePayload({ expect_no_current_fact: true }));
  ok(basePayload({ expect_no_current_fact: false, expected_current_fact_id: FACT_ID }));

  // Les deux : ambigu, donc refusé.
  rejected(basePayload({ expect_no_current_fact: true, expected_current_fact_id: FACT_ID }));
  // Ni l'un ni l'autre : une omission ne peut pas se lire comme « rien vu ».
  rejected(basePayload({ expect_no_current_fact: false }));
  const missing = basePayload();
  delete missing.expect_no_current_fact;
  rejected(missing);
});

Deno.test("périmètre de scénario — scenario_id et empreinte sont indissociables", () => {
  ok(basePayload({ scenario_id: SCENARIO_ID, expected_scope_hash: SCOPE_HASH }));
  rejected(basePayload({ scenario_id: SCENARIO_ID }));
  rejected(basePayload({ expected_scope_hash: SCOPE_HASH }));
  rejected(basePayload({ scenario_id: SCENARIO_ID, expected_scope_hash: "A".repeat(64) }));
  rejected(basePayload({ scenario_id: "pas-un-uuid", expected_scope_hash: SCOPE_HASH }));
});

Deno.test("identifiants — UUID obligatoires, clé d'idempotence bornée", () => {
  rejected(basePayload({ case_id: "nope" }));
  rejected(basePayload({ assumption_id: "nope" }));
  rejected(basePayload({ idempotency_key: "court" }));
  rejected(basePayload({ idempotency_key: "x".repeat(129) }));
  assertEquals(ok(basePayload({ idempotency_key: "  promote-key-0001  " })).idempotency_key,
    "promote-key-0001");
  rejected("pas un objet" as unknown as Record<string, unknown>);
});

// ── Empreinte de requête ───────────────────────────────────────────────────

Deno.test("empreinte — insensible à l'ordre des clés, sensible au contenu", async () => {
  const a = ok(basePayload());
  const b = ok({
    expect_no_current_fact: true,
    expected_value: 12000,
    expected_value_type: "number",
    expected_assumption_status: "active",
    attested: true,
    promotion_basis: "document_evidence",
    fact_key: "cargo.weight_kg",
    idempotency_key: "promote-key-0001",
    assumption_id: ASSUMPTION_ID,
    case_id: CASE_ID,
  });
  assertEquals(await computeRequestFingerprint(a), await computeRequestFingerprint(b));

  // La clé d'idempotence n'entre PAS dans l'empreinte : même contenu, autre clé
  // → même empreinte (c'est ce qui rend le conflit sémantique détectable).
  const otherKey = ok(basePayload({ idempotency_key: "promote-key-0002" }));
  assertEquals(await computeRequestFingerprint(a), await computeRequestFingerprint(otherKey));

  // Tout le reste change l'empreinte.
  for (const variant of [
    basePayload({ expected_value: 12001 }),
    basePayload({ promotion_basis: "operator_expertise" }),
    basePayload({ fact_key: "cargo.chargeable_weight_kg" }),
    basePayload({ expected_assumption_status: "client_confirmed" }),
    basePayload({ expect_no_current_fact: false, expected_current_fact_id: FACT_ID }),
    basePayload({ scenario_id: SCENARIO_ID, expected_scope_hash: SCOPE_HASH }),
  ]) {
    assertNotEquals(
      await computeRequestFingerprint(a),
      await computeRequestFingerprint(ok(variant)),
    );
  }

  assert(/^[0-9a-f]{64}$/.test(await computeRequestFingerprint(a)));
});

Deno.test("empreinte — une chaîne reste une chaîne", () => {
  // Le piège de _shared/canonical-hash.ts : reparser une chaîne qui ressemble à
  // du JSON ferait collisionner deux valeurs textuelles distinctes.
  assertNotEquals(stableStringify('{"a":1}'), stableStringify({ a: 1 }));
  assertEquals(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
  assertEquals(stableStringify(undefined), "null");
  assertEquals(stableStringify(Number.NaN), "null");
});

Deno.test("empreinte — couvre tout le payload sauf la clé d'idempotence", () => {
  const input = buildFingerprintInput(ok(basePayload()));
  assert(!("idempotency_key" in input));
  for (const key of [
    "assumption_id", "attested", "case_id", "expect_no_current_fact",
    "expected_assumption_status", "expected_current_fact_id", "expected_scope_hash",
    "expected_value", "expected_value_type", "fact_key", "promotion_basis", "scenario_id",
  ]) {
    assert(key in input, `${key} absent de l'empreinte`);
  }
});

// ── Arguments RPC ──────────────────────────────────────────────────────────

Deno.test("arguments RPC — identité du JWT, aucune valeur d'écriture, aucune confiance", () => {
  const actor = "99999999-9999-4999-8999-999999999999";
  const args = buildRpcArgs(ok(basePayload()), actor, "b".repeat(64));

  assertEquals(args.p_actor_user_id, actor);
  assertEquals(args.p_attested, true);
  assertEquals(args.p_fact_key, "cargo.weight_kg");
  assertEquals(args.p_expected_value, 12000);
  assertEquals(args.p_request_fingerprint, "b".repeat(64));
  assertEquals(args.p_scenario_id, null);
  assertEquals(args.p_expected_current_fact_id, null);

  // La provenance, la confiance et la valeur écrite appartiennent à la base.
  for (const forbidden of [
    "p_confidence", "p_source_type", "p_value_text", "p_value_number",
    "p_value_json", "p_fact_category", "p_status",
  ]) {
    assert(!(forbidden in args), `${forbidden} transmis à la RPC`);
  }
});

// ── Traduction des erreurs ─────────────────────────────────────────────────

Deno.test("mapRpcErrorCode — les états périmés exigent un rechargement", () => {
  for (const message of [
    "CONFLICT_STALE_ASSUMPTION: ...",
    "CONFLICT_STALE_VALUE: ...",
    "CONFLICT_STALE_FACT: ...",
    "CONFLICT_STALE_SCENARIO: ...",
    "SCENARIO_CONTEXT_REQUIRED: ...",
    "SCENARIO_CONTEXT_AMBIGUOUS: ...",
    "IDEMPOTENCY_CONFLICT: ...",
    "CONFLICT_INVALID_STATE: ...",
  ]) {
    assertEquals(mapRpcErrorCode(message), "CONFLICT_INVALID_STATE", message);
  }
  for (const message of [
    "ATTESTATION_REQUIRED: ...",
    "BATCH_NOT_ALLOWED: ...",
    "FACT_KEY_NOT_PROMOTABLE: ...",
    "PROMOTION_REJECTED: ...",
    "VALIDATION_FAILED: ...",
    "NOT_FOUND: ...",
  ]) {
    assertEquals(mapRpcErrorCode(message), "VALIDATION_FAILED", message);
  }
  assertEquals(mapRpcErrorCode("FORBIDDEN_CROSS_CASE: ..."), "FORBIDDEN_OWNER");
  assertEquals(mapRpcErrorCode("FORBIDDEN_IDENTITY: ..."), "FORBIDDEN_OWNER");
  assertEquals(mapRpcErrorCode("deadlock detected"), "UPSTREAM_DB_ERROR");
});
