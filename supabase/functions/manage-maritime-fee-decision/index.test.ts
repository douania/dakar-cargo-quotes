// P1-B recovery contract: real Edge handler, HTTP storage/auth fully mocked.
// No live database, token, tariff or email. Real SQL assertions live separately.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRequest } from "./index.ts";

const CASE_ID = "31000000-0000-4000-8000-000000000001";
const USER_ID = "31000000-0000-4000-8000-000000000002";
const PAD_KEY = "PAD_DROIT_PASSAGE";
type Row = Record<string, unknown> & {
  id: string; case_id: string; decision_key: string;
  decision_action: string; decision_version: number;
  idempotency_key: string; request_fingerprint: string;
};
function seed(overrides: Partial<Row> = {}): Row {
  return {
    id: "31000000-0000-4000-8000-000000000003", case_id: CASE_ID,
    decision_key: PAD_KEY, proposal_id: "pad-taxe-de-port",
    proposal_category: "taxe_de_port", decision_action: "confirm",
    suggested_amount_xof: 96780, decided_amount_xof: 96780,
    currency: "XOF", evidence_level: "official", source_reference: "SOURCE_FIXTURE",
    decision_source: "PIECE_FIXTURE", justification: "Fixture only",
    proposal_fingerprint: "a".repeat(64), input_snapshot_hash: "b".repeat(64),
    proposal_snapshot: {}, decision_version: 1, supersedes_id: null,
    idempotency_key: "fixture-confirm-0001", request_fingerprint: "c".repeat(64),
    decided_by: USER_ID, created_at: "2026-08-30T10:00:00Z", ...overrides,
  };
}
function revoke(overrides: Record<string, unknown> = {}) {
  return {
    operation: "revoke", case_id: CASE_ID, decision_key: PAD_KEY,
    expected_decision_version: 1, decision_source: "PIECE_FIXTURE",
    justification: "Annulation contrôlée", idempotency_key: "fixture-revoke-0001",
    ...overrides,
  };
}
function request(body: unknown, authenticated = true) {
  return new Request("https://p1b-fixture.invalid/manage-maritime-fee-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json",
      ...(authenticated ? { Authorization: "Bearer fixture-user-token" } : {}) },
    body: JSON.stringify(body),
  });
}
function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", ...headers },
  });
}
interface State {
  rows: Row[];
  calls: string[];
  rpcCalls: number;
  inserted: number;
  access: boolean;
  authValid: boolean;
  readMode: "complete" | "missing-count" | "truncated" | "error" | "non-array";
  failReadsAfterCommit: boolean;
}
async function withStorage(
  initial: Row[],
  run: (state: State) => Promise<void>,
) {
  const savedFetch = globalThis.fetch;
  const envNames = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const savedEnv = envNames.map((name) => Deno.env.get(name));
  Deno.env.set(envNames[0], "https://p1b-fixture.invalid");
  Deno.env.set(envNames[1], "fixture-anon-key");
  Deno.env.set(envNames[2], "fixture-service-key");
  const state: State = {
    rows: structuredClone(initial), calls: [], rpcCalls: 0, inserted: 0,
    access: true, authValid: true, readMode: "complete", failReadsAfterCommit: false,
  };
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input
      : input instanceof URL ? input.href : input.url);
    if (url.hostname !== "p1b-fixture.invalid") throw new Error("REAL_NETWORK_FORBIDDEN");
    state.calls.push(url.pathname);
    if (url.pathname === "/auth/v1/user") {
      return state.authValid
        ? response({ id: USER_ID, aud: "authenticated", role: "authenticated" })
        : response({ message: "Invalid JWT", status: 401 }, 401);
    }
    if (["/rest/v1/rpc/has_case_read_access", "/rest/v1/rpc/has_case_write_access"].includes(url.pathname)) {
      const args = JSON.parse(String(init?.body));
      assertEquals(args._case_id, CASE_ID);
      return response(state.access);
    }
    if (url.pathname === "/rest/v1/rpc/read_maritime_fee_case_context") {
      assert(state.access, "No elevation before case access");
      return response({ request_type: "SEA_FCL_IMPORT", facts: [
        { fact_key: "carrier.name", value_text: "GRIMALDI" },
        { fact_key: "cargo.containers", value_json: [{ type: "20DV", quantity: 1 }] },
        { fact_key: "cargo.pad_category", value_text: "T02" },
        { fact_key: "cargo.weight_kg", value_number: 10000 },
      ] });
    }
    if (url.pathname === "/rest/v1/maritime_fee_decisions") {
      assert(state.access);
      assertEquals(url.searchParams.get("case_id"), "eq." + CASE_ID);
      if (state.readMode === "error" || (state.failReadsAfterCommit && state.inserted > 0)) {
        return response({ code: "XX000", message: "Synthetic unavailable ledger" }, 500);
      }
      const rows = [...state.rows].sort((a, b) =>
        a.decision_key.localeCompare(b.decision_key) || b.decision_version - a.decision_version);
      if (state.readMode === "missing-count") return response(rows);
      const count = rows.length + (state.readMode === "truncated" ? 1 : 0);
      return response(state.readMode === "non-array" ? {} : rows, 200, {
        "Content-Range": (rows.length ? "0-" + (rows.length - 1) : "*") + "/" + count,
      });
    }
    if (url.pathname === "/rest/v1/rpc/record_maritime_fee_decision") {
      assert(state.access);
      state.rpcCalls++;
      const args = JSON.parse(String(init?.body));
      assertEquals(args.p_case_id, CASE_ID);
      assertEquals(args.p_actor_user_id, USER_ID);
      assertEquals(args.p_decision_action, "revoke");
      const replay = state.rows.find((r) => r.idempotency_key === args.p_idempotency_key);
      if (replay) {
        if (replay.request_fingerprint !== args.p_request_fingerprint) {
          return response({ code: "23505", message: "IDEMPOTENCY_CONFLICT: changed payload" }, 409);
        }
        return response({ decision: replay, idempotent_replay: true });
      }
      const current = state.rows.filter((r) => r.decision_key === args.p_decision_key)
        .sort((a, b) => b.decision_version - a.decision_version)[0];
      if (!current || current.decision_version !== args.p_expected_decision_version) {
        return response({ code: "40001", message: "STALE_DECISION: wrong version" }, 409);
      }
      if (!["confirm", "adjust", "reject"].includes(current.decision_action)) {
        return response({ code: "55000", message: "INVALID_STATE: already revoked" }, 422);
      }
      state.inserted++;
      const row: Row = {
        ...current, id: "31000000-0000-4000-8000-" + String(100 + state.inserted).padStart(12, "0"),
        decision_action: "revoke", decision_version: current.decision_version + 1,
        decided_amount_xof: null, supersedes_id: current.id,
        idempotency_key: args.p_idempotency_key, request_fingerprint: args.p_request_fingerprint,
      };
      state.rows.push(row);
      return response({ decision: row, idempotent_replay: false });
    }
    throw new Error("UNEXPECTED_HTTP_ROUTE:" + url.pathname);
  };
  try { await run(state); }
  finally {
    globalThis.fetch = savedFetch;
    envNames.forEach((name, i) => savedEnv[i] === undefined
      ? Deno.env.delete(name) : Deno.env.set(name, savedEnv[i]!));
  }
}

for (const rows of [[], [seed()]]) {
  Deno.test("P1-B recovery list attests complete cardinality " + rows.length, async () => {
    await withStorage(rows, async (s) => {
      const res = await handleRequest(request({ operation: "list", case_id: CASE_ID }));
      assertEquals(res.status, 200);
      const data = await res.json();
      assertEquals(data.decision_history.length, rows.length);
      assertEquals(s.rpcCalls, 0);
    });
  });
}
for (const readMode of ["missing-count", "truncated", "error", "non-array"] as const) {
  Deno.test("P1-B recovery incomplete ledger blocks list AND mutation: " + readMode, async () => {
    await withStorage([seed()], async (s) => {
      s.readMode = readMode;
      for (const body of [{ operation: "list", case_id: CASE_ID }, revoke()]) {
        const res = await handleRequest(request(body));
        assertEquals(res.status, 500);
        const data = await res.json();
        assertEquals(data.decision_history, undefined);
      }
      assertEquals(s.rpcCalls, 0);
      assertEquals(s.inserted, 0);
    });
  });
}
Deno.test("P1-B recovery missing/invalid auth and case denial precede elevation", async () => {
  await withStorage([seed()], async (s) => {
    const missing = await handleRequest(request(revoke(), false));
    assertEquals(missing.status, 401); await missing.text();
    assertEquals(s.calls.length, 0);
    s.authValid = false;
    const invalid = await handleRequest(request(revoke()));
    assertEquals(invalid.status, 401); await invalid.text();
    assertEquals(s.calls, ["/auth/v1/user"]);
    s.authValid = true; s.calls.length = 0; s.access = false;
    const denied = await handleRequest(request(revoke()));
    assertEquals(denied.status, 403); await denied.text();
    assertEquals(s.calls, ["/auth/v1/user", "/rest/v1/rpc/has_case_write_access"]);
  });
});
for (const action of ["confirm", "adjust", "reject"]) {
  Deno.test("P1-B recovery revoke " + action + " then identical replay", async () => {
    await withStorage([seed({ decision_action: action })], async (s) => {
      const first = await handleRequest(request(revoke()));
      assertEquals(first.status, 200);
      const a = await first.json();
      assertEquals(a.mutation.idempotent_replay, false);
      const second = await handleRequest(request(revoke()));
      assertEquals(second.status, 200);
      const b = await second.json();
      assertEquals(b.mutation.idempotent_replay, true);
      assertEquals(b.mutation.decision.id, a.mutation.decision.id);
      assertEquals(s.inserted, 1);
      assertEquals(s.rows.length, 2);
    });
  });
}
Deno.test("P1-B recovery failed read after commit can replay without a new event", async () => {
  await withStorage([seed()], async (s) => {
    s.failReadsAfterCommit = true;
    const failed = await handleRequest(request(revoke()));
    assertEquals(failed.status, 500); await failed.text();
    assertEquals(s.inserted, 1);
    s.failReadsAfterCommit = false;
    const retry = await handleRequest(request(revoke()));
    assertEquals(retry.status, 200);
    assertEquals((await retry.json()).mutation.idempotent_replay, true);
    assertEquals(s.inserted, 1);
  });
});
Deno.test("P1-B recovery changed payload/decision key conflicts, new stale key stays blocked", async () => {
  await withStorage([seed()], async (s) => {
    const first = await handleRequest(request(revoke())); await first.text();
    for (const overrides of [
      { justification: "Different intent" },
      { decision_key: "CARRIER_DEBOURS_COMMISSION:CMA_CGM" },
    ]) {
      const conflict = await handleRequest(request(revoke(overrides)));
      assertEquals(conflict.status, 409);
      assert(String((await conflict.json()).error).includes("IDEMPOTENCY_CONFLICT"));
    }
    const calls = s.rpcCalls;
    const stale = await handleRequest(request(revoke({ idempotency_key: "brand-new-stale-key" })));
    assertEquals(stale.status, 409); await stale.text();
    assertEquals(s.rpcCalls, calls);
    const already = await handleRequest(request(revoke({
      expected_decision_version: 2, idempotency_key: "brand-new-revoke-key",
    })));
    assertEquals(already.status, 422); await already.text();
    assertEquals(s.inserted, 1);
  });
});
Deno.test("P1-B recovery old-carrier decision is listed as unmatched and revocable", async () => {
  const key = "CARRIER_DEBOURS_COMMISSION:CMA_CGM";
  await withStorage([seed({ decision_key: key, proposal_id: "commission-debours",
    proposal_category: "commission_debours" })], async (s) => {
    const list = await handleRequest(request({ operation: "list", case_id: CASE_ID }));
    const body = await list.json();
    assertEquals(body.unmatched_current_decisions[0].decision_key, key);
    assertEquals(body.unmatched_current_decisions[0].is_stale, true);
    const revoked = await handleRequest(request(revoke({ decision_key: key })));
    assertEquals(revoked.status, 200); await revoked.text();
    assertEquals(s.inserted, 1);
    assertEquals(s.rows.at(-1)?.decision_action, "revoke");
  });
});
