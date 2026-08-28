/**
 * Phase P1-A1 — Tests PURS du domaine de manage-scenario-assumption.
 *
 * Aucun réseau, aucune DB, aucun Deno.serve : l'import cible `domain.ts`, qui
 * ne dépend d'aucun client Supabase.
 *
 * Couvre les invariants P1-A1 côté Edge :
 *   - forme du payload et vocabulaires fermés
 *   - valeur explicitement typée, une seule représentation
 *   - transitions autorisées et champs autorisés par transition
 *   - promotion REJETÉE explicitement
 *   - identité / état non forgeables depuis le payload
 *   - empreinte de requête : stable, sensible au contenu, insensible à l'ordre
 *
 * Exécution :
 *   deno test supabase/functions/_tests/manage_scenario_assumption_domain.test.ts
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  ASSUMPTION_OPERATIONS,
  buildFingerprintInput,
  buildRpcArgs,
  computeRequestFingerprint,
  FORBIDDEN_PAYLOAD_KEYS,
  isRealIsoDate,
  mapRpcErrorCode,
  normalizeAssumptionValue,
  PROMOTION_OPERATIONS,
  stableStringify,
  validateManageAssumptionPayload,
} from "../manage-scenario-assumption/domain.ts";

const CASE_ID = "11111111-1111-1111-1111-111111111111";
const ASSUMPTION_ID = "22222222-2222-2222-2222-222222222222";
const GAP_REQUEST_ID = "33333333-3333-3333-3333-333333333333";
const KEY = "idem-key-0001";

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    case_id: CASE_ID,
    operation: "create",
    idempotency_key: KEY,
    assumption_type: "weight",
    statement: "Poids brut estimé à 12 tonnes",
    assumed_value_type: "number",
    assumed_value: 12000,
    ...overrides,
  };
}

function expectOk(raw: unknown) {
  const result = validateManageAssumptionPayload(raw);
  assert(result.ok, `attendu valide, obtenu: ${result.ok ? "" : result.message}`);
  return result.value;
}

function expectFail(raw: unknown) {
  const result = validateManageAssumptionPayload(raw);
  assert(!result.ok, "attendu invalide, obtenu valide");
  return result;
}

// ── Promotion : refus explicite ────────────────────────────────────────────

Deno.test("promotion: chaque alias de promotion est refusé avec un code dédié", () => {
  for (const op of PROMOTION_OPERATIONS) {
    const result = expectFail(createPayload({ operation: op }));
    assertEquals(result.code, "PROMOTION_NOT_ALLOWED", `opération ${op}`);
    assert(result.message.includes("quote_facts"));
  }
});

Deno.test("promotion: 'promote' n'est pas dans les opérations autorisées", () => {
  for (const op of PROMOTION_OPERATIONS) {
    assert(!(ASSUMPTION_OPERATIONS as readonly string[]).includes(op));
  }
  assertEquals([...ASSUMPTION_OPERATIONS], ["create", "revise", "confirm_client", "refute"]);
});

Deno.test("promotion: le refus prime même si le reste du payload est invalide", () => {
  const result = expectFail({ operation: "promote_to_fact" });
  assertEquals(result.code, "PROMOTION_NOT_ALLOWED");
});

// ── Identité / état non forgeables ─────────────────────────────────────────

Deno.test("identité: chaque champ réservé au serveur est refusé", () => {
  for (const key of FORBIDDEN_PAYLOAD_KEYS) {
    const result = expectFail(createPayload({ [key]: "00000000-0000-0000-0000-000000000000" }));
    assertEquals(result.code, "VALIDATION_FAILED", `champ ${key}`);
    assert(result.message.includes(key), `le message doit nommer ${key}`);
  }
});

Deno.test("identité: buildRpcArgs prend l'acteur du JWT, jamais du payload", () => {
  const request = expectOk(createPayload());
  const args = buildRpcArgs(request, "44444444-4444-4444-4444-444444444444", "a".repeat(64));
  assertEquals(args.p_actor_user_id, "44444444-4444-4444-4444-444444444444");
  assertEquals(Object.keys(args).some((k) => k === "p_created_by" || k === "p_status"), false);
});

// ── Valeur typée ───────────────────────────────────────────────────────────

Deno.test("valeur: chaque type accepte sa forme et rejette les autres", () => {
  assertEquals(normalizeAssumptionValue("text", " ACIER ").ok, true);
  assertEquals(normalizeAssumptionValue("text", "   ").ok, false);
  assertEquals(normalizeAssumptionValue("text", 12).ok, false);

  assertEquals(normalizeAssumptionValue("number", 0).ok, true);
  assertEquals(normalizeAssumptionValue("number", -3.5).ok, true);
  assertEquals(normalizeAssumptionValue("number", Number.NaN).ok, false);
  assertEquals(normalizeAssumptionValue("number", Number.POSITIVE_INFINITY).ok, false);
  assertEquals(normalizeAssumptionValue("number", "12").ok, false);

  assertEquals(normalizeAssumptionValue("boolean", false).ok, true);
  assertEquals(normalizeAssumptionValue("boolean", "false").ok, false);

  assertEquals(normalizeAssumptionValue("date", "2026-08-28").ok, true);
  assertEquals(normalizeAssumptionValue("date", "2026-02-30").ok, false);
  assertEquals(normalizeAssumptionValue("date", "28/08/2026").ok, false);

  assertEquals(normalizeAssumptionValue("json", { a: 1 }).ok, true);
  assertEquals(normalizeAssumptionValue("json", [1, 2]).ok, true);
  assertEquals(normalizeAssumptionValue("json", null).ok, false);
  assertEquals(normalizeAssumptionValue("json", "{}").ok, false);
});

Deno.test("valeur: le texte est trimé, une seule représentation est stockée", () => {
  const normalized = normalizeAssumptionValue("text", "  8704.21  ");
  assert(normalized.ok);
  assertEquals(normalized.value, "8704.21");

  const request = expectOk(
    createPayload({ assumed_value_type: "text", assumed_value: "  8704.21  " }),
  );
  assertEquals(request.assumed_value, "8704.21");
  assertEquals(request.assumed_value_type, "text");
});

Deno.test("valeur: type et valeur sont tous deux obligatoires", () => {
  const noType = createPayload();
  delete (noType as Record<string, unknown>).assumed_value_type;
  assert(expectFail(noType).message.includes("assumed_value_type"));

  const noValue = createPayload();
  delete (noValue as Record<string, unknown>).assumed_value;
  assert(expectFail(noValue).message.includes("assumed_value"));

  assert(expectFail(createPayload({ assumed_value_type: "money" })).message.includes("assumed_value_type"));
});

Deno.test("valeur: dates calendaires réelles seulement", () => {
  assert(isRealIsoDate("2024-02-29"));
  assert(!isRealIsoDate("2026-02-29"));
  assert(!isRealIsoDate("2026-13-01"));
  assert(!isRealIsoDate("2026-04-31"));
});

// ── Transitions et champs autorisés ────────────────────────────────────────

Deno.test("transitions: confirm_client et refute ne portent que le statut", () => {
  for (const operation of ["confirm_client", "refute"]) {
    const request = expectOk({
      case_id: CASE_ID,
      operation,
      idempotency_key: KEY,
      assumption_id: ASSUMPTION_ID,
    });
    assertEquals(request.operation, operation);
    assertEquals(request.assumption_id, ASSUMPTION_ID);
    assertEquals(request.statement, null);

    const withContent = expectFail({
      case_id: CASE_ID,
      operation,
      idempotency_key: KEY,
      assumption_id: ASSUMPTION_ID,
      statement: "tentative de modification",
    });
    assert(withContent.message.includes("statut"));
  }
});

Deno.test("transitions: revise hérite du périmètre et ne peut pas le déplacer", () => {
  const ok = expectOk({
    case_id: CASE_ID,
    operation: "revise",
    idempotency_key: KEY,
    assumption_id: ASSUMPTION_ID,
    statement: "Poids brut révisé à 14 tonnes",
    assumed_value_type: "number",
    assumed_value: 14000,
  });
  assertEquals(ok.scope_key, null);
  assertEquals(ok.assumption_type, null);

  const inheritedArgs = buildRpcArgs(ok, "actor-id", "d".repeat(64));
  assertEquals(inheritedArgs.p_source_type, null);
  assertEquals(inheritedArgs.p_source_refs, null);
  assertEquals(inheritedArgs.p_client_visible, null);
  assertEquals(inheritedArgs.p_risk_level, null);
  assertEquals(inheritedArgs.p_metadata, null);

  for (const key of ["scope_key", "assumption_type", "gap_key", "assumed_fact_key", "client_gap_request_id"]) {
    const result = expectFail({
      case_id: CASE_ID,
      operation: "revise",
      idempotency_key: KEY,
      assumption_id: ASSUMPTION_ID,
      statement: "Poids brut révisé",
      assumed_value_type: "number",
      assumed_value: 14000,
      [key]: key === "client_gap_request_id" ? GAP_REQUEST_ID : "lot:2",
    });
    assert(result.message.includes(key), `le message doit nommer ${key}`);
  }
});

Deno.test("transitions: la cible est obligatoire hors création, interdite en création", () => {
  for (const operation of ["revise", "confirm_client", "refute"]) {
    const missing = expectFail({ case_id: CASE_ID, operation, idempotency_key: KEY });
    assert(missing.message.includes("assumption_id"));
  }
  assert(
    expectFail(createPayload({ assumption_id: ASSUMPTION_ID })).message.includes("assumption_id"),
  );
});

Deno.test("transitions: opération inconnue refusée", () => {
  assert(expectFail(createPayload({ operation: "delete" })).message.includes("operation"));
  assert(expectFail(createPayload({ operation: 42 })).message.includes("operation"));
});

// ── Périmètre / scope_key ──────────────────────────────────────────────────

Deno.test("scope_key: défaut 'case', formats bornés, UUID interdit", () => {
  assertEquals(expectOk(createPayload()).scope_key, "case");
  assertEquals(expectOk(createPayload({ scope_key: "lot:2" })).scope_key, "lot:2");
  assertEquals(expectOk(createPayload({ scope_key: " commodity:bus " })).scope_key, "commodity:bus");

  for (const bad of ["Lot:2", "lot 2", "", "a".repeat(121), ":x", "lot:"]) {
    assert(!validateManageAssumptionPayload(createPayload({ scope_key: bad })).ok, `scope_key '${bad}'`);
  }
  // Arbitrage CTO n°4 : jamais un identifiant de ligne dans le périmètre.
  const withUuid = expectFail(createPayload({ scope_key: `line:${ASSUMPTION_ID}` }));
  assert(withUuid.message.includes("identifiant technique"));
});

// ── client_visible fail-closed ─────────────────────────────────────────────

Deno.test("client_visible: fail-closed par défaut, explicite sinon", () => {
  assertEquals(expectOk(createPayload()).client_visible, false);
  assertEquals(expectOk(createPayload({ client_visible: true })).client_visible, true);
  assert(!validateManageAssumptionPayload(createPayload({ client_visible: "true" })).ok);
  assertEquals(buildRpcArgs(expectOk(createPayload()), "u", "b".repeat(64)).p_client_visible, false);
});

// ── Idempotence / empreinte ────────────────────────────────────────────────

Deno.test("idempotence: la clé est bornée et n'entre jamais dans l'empreinte", () => {
  assert(!validateManageAssumptionPayload(createPayload({ idempotency_key: "court" })).ok);
  assert(!validateManageAssumptionPayload(createPayload({ idempotency_key: "x".repeat(129) })).ok);
  assert(!validateManageAssumptionPayload(createPayload({ idempotency_key: 12345678 })).ok);

  const input = buildFingerprintInput(expectOk(createPayload()));
  assertEquals("idempotency_key" in input, false);
});

Deno.test("empreinte: même contenu → même empreinte, quel que soit l'ordre des clés", async () => {
  const a = await computeRequestFingerprint(expectOk(createPayload()));
  const b = await computeRequestFingerprint(
    expectOk({
      assumed_value: 12000,
      assumed_value_type: "number",
      statement: "Poids brut estimé à 12 tonnes",
      assumption_type: "weight",
      idempotency_key: KEY,
      operation: "create",
      case_id: CASE_ID,
    }),
  );
  assertEquals(a, b);
  assert(/^[0-9a-f]{64}$/.test(a), "l'empreinte doit être un SHA-256 hex minuscule");
});

Deno.test("empreinte: les valeurs par défaut de create sont normalisées", async () => {
  const omitted = await computeRequestFingerprint(expectOk(createPayload()));
  const explicit = await computeRequestFingerprint(expectOk(createPayload({
    source_type: "operator_guidance",
    source_refs: [],
    risk_level: "medium",
    metadata: {},
    client_visible: false,
  })));
  assertEquals(omitted, explicit);
});

Deno.test("empreinte: une clé identique avec un contenu différent produit une empreinte différente", async () => {
  const base = await computeRequestFingerprint(expectOk(createPayload()));
  const otherValue = await computeRequestFingerprint(
    expectOk(createPayload({ assumed_value: 12001 })),
  );
  const otherStatement = await computeRequestFingerprint(
    expectOk(createPayload({ statement: "Poids brut estimé à 12 tonnes." })),
  );
  const otherVisibility = await computeRequestFingerprint(
    expectOk(createPayload({ client_visible: true })),
  );
  assertNotEquals(base, otherValue);
  assertNotEquals(base, otherStatement);
  assertNotEquals(base, otherVisibility);
});

Deno.test("empreinte: une chaîne ressemblant à du JSON reste une chaîne distincte", async () => {
  // Régression : un stringify qui reparse les chaînes JSON confondrait ces deux
  // statements et transformerait un conflit d'idempotence en faux rejeu.
  const a = await computeRequestFingerprint(
    expectOk(createPayload({ statement: '{"a":1}' })),
  );
  const b = await computeRequestFingerprint(
    expectOk(createPayload({ statement: '{ "a" : 1 }' })),
  );
  assertNotEquals(a, b);

  assertNotEquals(stableStringify('{"a":1}'), stableStringify({ a: 1 }));
});

Deno.test("empreinte: stableStringify trie récursivement", () => {
  assertEquals(
    stableStringify({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }),
    stableStringify({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }),
  );
  assertEquals(stableStringify(undefined), "null");
  assertEquals(stableStringify(Number.NaN), "null");
});

// ── Mapping RPC ────────────────────────────────────────────────────────────

Deno.test("rpc: les arguments sont complets et sans champ hors contrat", () => {
  const request = expectOk(
    createPayload({ gap_key: "cargo.weight_kg", assumed_fact_key: "cargo.weight_kg" }),
  );
  const args = buildRpcArgs(request, "actor-id", "c".repeat(64));
  assertEquals(args.p_case_id, CASE_ID);
  assertEquals(args.p_operation, "create");
  assertEquals(args.p_request_fingerprint, "c".repeat(64));
  assertEquals(args.p_scope_key, "case");
  assertEquals(args.p_source_type, "operator_guidance");
  assertEquals(args.p_risk_level, "medium");
  assertEquals(args.p_source_refs, []);
  assertEquals(args.p_metadata, {});
  assertEquals(args.p_gap_key, "cargo.weight_kg");
  // Aucun argument de promotion ni d'écriture de fact.
  for (const key of Object.keys(args)) {
    assert(!key.includes("fact_id"), `argument inattendu ${key}`);
    assert(!key.includes("promot"), `argument inattendu ${key}`);
    assert(!key.includes("price") && !key.includes("total"), `argument inattendu ${key}`);
  }
});

Deno.test("rpc: les erreurs préfixées sont traduites en codes runtime du projet", () => {
  assertEquals(mapRpcErrorCode("PROMOTION_NOT_ALLOWED: ..."), "VALIDATION_FAILED");
  assertEquals(mapRpcErrorCode("VALIDATION_FAILED: statement est obligatoire"), "VALIDATION_FAILED");
  assertEquals(mapRpcErrorCode("NOT_FOUND: hypothèse introuvable"), "VALIDATION_FAILED");
  assertEquals(mapRpcErrorCode("FORBIDDEN_CROSS_CASE: ..."), "FORBIDDEN_OWNER");
  assertEquals(mapRpcErrorCode("FORBIDDEN_IDENTITY: ..."), "FORBIDDEN_OWNER");
  assertEquals(mapRpcErrorCode("IDEMPOTENCY_CONFLICT: ..."), "CONFLICT_INVALID_STATE");
  assertEquals(mapRpcErrorCode("CONFLICT_INVALID_STATE: ..."), "CONFLICT_INVALID_STATE");
  assertEquals(mapRpcErrorCode("deadlock detected"), "UPSTREAM_DB_ERROR");
});

// ── Divers garde-fous ──────────────────────────────────────────────────────

Deno.test("payload: case_id doit être un UUID et le corps un objet", () => {
  assert(!validateManageAssumptionPayload(null).ok);
  assert(!validateManageAssumptionPayload([]).ok);
  assert(!validateManageAssumptionPayload("{}").ok);
  assert(!validateManageAssumptionPayload(createPayload({ case_id: "not-a-uuid" })).ok);
});

Deno.test("payload: vocabulaires fermés pour type, source et risque", () => {
  assert(!validateManageAssumptionPayload(createPayload({ assumption_type: "freight" })).ok);
  assert(!validateManageAssumptionPayload(createPayload({ source_type: "guess" })).ok);
  assert(!validateManageAssumptionPayload(createPayload({ risk_level: "critical" })).ok);
  assertEquals(expectOk(createPayload({ risk_level: "high" })).risk_level, "high");
});

Deno.test("payload: statement obligatoire, non vide et borné", () => {
  assert(!validateManageAssumptionPayload(createPayload({ statement: "   " })).ok);
  assert(!validateManageAssumptionPayload(createPayload({ statement: "x".repeat(2001) })).ok);
  assert(!validateManageAssumptionPayload(createPayload({ statement: 12 })).ok);
});
