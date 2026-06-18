/**
 * MULTI-CARGO-LINES-ARCHITECTURE-1 — Phase 2-N
 * Tests PURS (aucun réseau, aucune DB) du consommateur canonicalize-cargo-from-case.
 *
 * Couvre :
 *   - validateConsumerInput : case_id/mode, cargo_payload obligatoire, anti no-op,
 *     refus source_excerpt trop long
 *   - canonicalizeCore : dry_run n'appelle PAS le writer ; commit appelle le writer
 *     avec le header Authorization ORIGINAL ; dépendances injectées (réseau mocké)
 *   - garde architecturale statique : le consommateur n'appelle aucun RPC
 *     (.rpc(...)) et n'utilise aucune clé service_role (SERVICE_ROLE)
 *
 * NB : l'import dynamique charge index.ts ; `Deno.serve` n'est PAS déclenché
 * (gardé par `import.meta.main`).
 *
 * Exécution :
 *   deno test --allow-read \
 *     supabase/functions/_tests/canonicalize_cargo_from_case_validation.test.ts
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const {
  validateConsumerInput,
  buildWriterPayload,
  canonicalizeCore,
} = await import("../canonicalize-cargo-from-case/index.ts");

const VALID_CASE = "11111111-1111-1111-1111-111111111111";
const ORIGINAL_AUTH = "Bearer original-user-token";
const CORR = "00000000-0000-0000-0000-0000000000aa";

function minimalCargoPayload() {
  return {
    cargo_lines: [{ line_index: 1, status: "to_confirm", equipment: [] }],
    unallocated_equipment: [],
  };
}

function minimalValid(mode: string) {
  return {
    case_id: VALID_CASE,
    mode,
    source: { source_email_id: null, source_quote_request_line_id: null, source_excerpt: null },
    cargo_payload: minimalCargoPayload(),
  };
}

const ALWAYS_OWNER = () => Promise.resolve(true);

// ── validateConsumerInput ──────────────────────────────────────────────────
Deno.test("2-N validate — payload minimal valide est accepté", () => {
  const r = validateConsumerInput(minimalValid("dry_run"));
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.value.case_id, VALID_CASE);
    assertEquals(r.value.mode, "dry_run");
    assertEquals(r.value.cargo_lines.length, 1);
  }
});

Deno.test("2-N validate — case_id manquant/invalide rejeté", () => {
  assertEquals(validateConsumerInput({ mode: "commit", cargo_payload: minimalCargoPayload() }).ok, false);
  assertEquals(
    validateConsumerInput({ case_id: "nope", mode: "commit", cargo_payload: minimalCargoPayload() }).ok,
    false,
  );
  assertEquals(validateConsumerInput(null).ok, false);
});

Deno.test("2-N validate — mode whitelist stricte (dry_run|commit)", () => {
  for (const m of ["", "DRY_RUN", "write", "preview", undefined]) {
    const p = minimalValid("commit") as Record<string, unknown>;
    p.mode = m as unknown;
    assertEquals(validateConsumerInput(p).ok, false, `mode=${m}`);
  }
  for (const m of ["dry_run", "commit"]) {
    assert(validateConsumerInput(minimalValid(m)).ok, `mode=${m}`);
  }
});

Deno.test("2-N validate — cargo_payload obligatoire", () => {
  assertEquals(validateConsumerInput({ case_id: VALID_CASE, mode: "commit" }).ok, false);
  assertEquals(
    validateConsumerInput({ case_id: VALID_CASE, mode: "commit", cargo_payload: null }).ok,
    false,
  );
  assertEquals(
    validateConsumerInput({ case_id: VALID_CASE, mode: "commit", cargo_payload: [] }).ok,
    false,
  );
});

Deno.test("2-N validate — no-op rejeté (cargo_lines et unallocated_equipment vides)", () => {
  const p = {
    case_id: VALID_CASE,
    mode: "commit",
    cargo_payload: { cargo_lines: [], unallocated_equipment: [] },
  };
  assertEquals(validateConsumerInput(p).ok, false);
  // cargo_payload vide (les deux absents) → no-op également
  assertEquals(
    validateConsumerInput({ case_id: VALID_CASE, mode: "commit", cargo_payload: {} }).ok,
    false,
  );
});

Deno.test("2-N validate — cargo_lines vide accepté si unallocated_equipment présent", () => {
  const p = {
    case_id: VALID_CASE,
    mode: "commit",
    cargo_payload: { cargo_lines: [], unallocated_equipment: [{ equipment_type: "20GP", quantity: 1 }] },
  };
  assert(validateConsumerInput(p).ok);
});

Deno.test("2-N validate — source.source_excerpt trop long est rejeté (pas de troncature)", () => {
  const p = minimalValid("commit") as Record<string, unknown>;
  p.source = { source_email_id: null, source_quote_request_line_id: null, source_excerpt: "a".repeat(2001) };
  assertEquals(validateConsumerInput(p).ok, false);
});

Deno.test("2-N validate — cargo_lines non-tableau rejeté", () => {
  const p = {
    case_id: VALID_CASE,
    mode: "commit",
    cargo_payload: { cargo_lines: {}, unallocated_equipment: [] },
  };
  assertEquals(validateConsumerInput(p).ok, false);
});

// ── buildWriterPayload ─────────────────────────────────────────────────────
Deno.test("2-N build — writer_payload aplatit cargo_payload au niveau racine", () => {
  const r = validateConsumerInput(minimalValid("commit"));
  assert(r.ok);
  if (!r.ok) return;
  const wp = buildWriterPayload(r.value);
  assertEquals(Object.keys(wp).sort(), ["cargo_lines", "case_id", "source", "unallocated_equipment"]);
  assertEquals(wp.case_id, VALID_CASE);
  assert(Array.isArray(wp.cargo_lines));
  assert(Array.isArray(wp.unallocated_equipment));
  // mode ne doit PAS fuiter dans le payload writer
  assertEquals((wp as Record<string, unknown>).mode, undefined);
});

// ── canonicalizeCore (réseau mocké) ────────────────────────────────────────
Deno.test("2-N core — dry_run n'appelle PAS le writer et renvoie writer_payload", async () => {
  let writerCalled = false;
  const resp = await canonicalizeCore(
    minimalValid("dry_run"),
    ORIGINAL_AUTH,
    CORR,
    {
      verifyOwnership: ALWAYS_OWNER,
      callWriter: () => {
        writerCalled = true;
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    },
  );
  assertEquals(writerCalled, false);
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.ok, true);
  assertEquals(body.mode, "dry_run");
  assertEquals(body.writer_payload.case_id, VALID_CASE);
});

Deno.test("2-N core — commit appelle le writer avec le header Authorization ORIGINAL", async () => {
  let seenAuth: string | null = null;
  let seenPayload: unknown = null;
  const resp = await canonicalizeCore(
    minimalValid("commit"),
    ORIGINAL_AUTH,
    CORR,
    {
      verifyOwnership: ALWAYS_OWNER,
      callWriter: (payload, authHeader) => {
        seenAuth = authHeader;
        seenPayload = payload;
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, data: { case_id: VALID_CASE } }), { status: 200 }),
        );
      },
    },
  );
  assertEquals(seenAuth, ORIGINAL_AUTH);
  assertEquals((seenPayload as { case_id: string }).case_id, VALID_CASE);
  // Réponse writer renvoyée telle quelle
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.ok, true);
});

Deno.test("2-N core — dry_run rejette un payload que le writer refuserait (line_index=0)", async () => {
  let writerCalled = false;
  const p = {
    case_id: VALID_CASE,
    mode: "dry_run",
    cargo_payload: {
      cargo_lines: [{ line_index: 0, status: "to_confirm", equipment: [] }],
      unallocated_equipment: [],
    },
  };
  const resp = await canonicalizeCore(p, ORIGINAL_AUTH, CORR, {
    verifyOwnership: ALWAYS_OWNER,
    callWriter: () => {
      writerCalled = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });
  assertEquals(resp.status, 400);
  assertEquals(writerCalled, false);
});

Deno.test("2-N core — dry_run rejette un payload que le writer refuserait (equipment.quantity=0)", async () => {
  let writerCalled = false;
  const p = {
    case_id: VALID_CASE,
    mode: "dry_run",
    cargo_payload: {
      cargo_lines: [
        { line_index: 1, status: "to_confirm", equipment: [{ equipment_type: "40HC", quantity: 0 }] },
      ],
      unallocated_equipment: [],
    },
  };
  const resp = await canonicalizeCore(p, ORIGINAL_AUTH, CORR, {
    verifyOwnership: ALWAYS_OWNER,
    callWriter: () => {
      writerCalled = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });
  assertEquals(resp.status, 400);
  assertEquals(writerCalled, false);
});

Deno.test("2-N core — dry_run rejette equipment.source_excerpt > 2000", async () => {
  let writerCalled = false;
  const p = {
    case_id: VALID_CASE,
    mode: "dry_run",
    cargo_payload: {
      cargo_lines: [
        {
          line_index: 1,
          status: "to_confirm",
          equipment: [{ equipment_type: "40HC", quantity: 1, source_excerpt: "a".repeat(2001) }],
        },
      ],
      unallocated_equipment: [],
    },
  };
  const resp = await canonicalizeCore(p, ORIGINAL_AUTH, CORR, {
    verifyOwnership: ALWAYS_OWNER,
    callWriter: () => {
      writerCalled = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });
  assertEquals(resp.status, 400);
  assertEquals(writerCalled, false);
});

Deno.test("2-N core — commit : callWriter qui throw renvoie UPSTREAM_WRITER_ERROR (502)", async () => {
  const resp = await canonicalizeCore(minimalValid("commit"), ORIGINAL_AUTH, CORR, {
    verifyOwnership: ALWAYS_OWNER,
    callWriter: () => {
      throw new Error("connexion writer impossible");
    },
  });
  assertEquals(resp.status, 502);
  const body = await resp.json();
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "UPSTREAM_WRITER_ERROR");
});

Deno.test("2-N core — payload invalide → 400 sans appel writer", async () => {
  let writerCalled = false;
  const resp = await canonicalizeCore(
    { case_id: "bad", mode: "commit", cargo_payload: minimalCargoPayload() },
    ORIGINAL_AUTH,
    CORR,
    {
      verifyOwnership: ALWAYS_OWNER,
      callWriter: () => {
        writerCalled = true;
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    },
  );
  assertEquals(resp.status, 400);
  assertEquals(writerCalled, false);
});

Deno.test("2-N core — ownership refusé → 403 sans appel writer", async () => {
  let writerCalled = false;
  const resp = await canonicalizeCore(
    minimalValid("commit"),
    ORIGINAL_AUTH,
    CORR,
    {
      verifyOwnership: () => Promise.resolve(false),
      callWriter: () => {
        writerCalled = true;
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    },
  );
  assertEquals(resp.status, 403);
  assertEquals(writerCalled, false);
});

// ── Garde architecturale statique ──────────────────────────────────────────
Deno.test("2-N garde — le consommateur n'appelle aucun RPC ni service_role", async () => {
  const src = await Deno.readTextFile(
    new URL("../canonicalize-cargo-from-case/index.ts", import.meta.url),
  );
  // Aucun appel RPC direct (ni upsert_cargo_line / upsert_cargo_equipment, ni autre).
  assertEquals(src.includes(".rpc("), false, "le consommateur ne doit appeler aucun RPC");
  // Aucune clé service-role (env var lue uniquement par le writer Phase 2-M).
  assertEquals(
    src.includes("SUPABASE_SERVICE_ROLE_KEY"),
    false,
    "le consommateur ne doit pas utiliser service_role",
  );
});
