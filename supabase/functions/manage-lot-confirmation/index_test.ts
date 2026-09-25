import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRequest } from "./index.ts";

const cid = "11111111-1111-4111-8111-111111111111";
const H = "a".repeat(64);
const context = { case_id: cid, case_status: "READY_TO_PRICE", context_hash: H, request_count: 2, scenario: null,
  lines: [{ id: "l1", line_index: 1, fingerprint: "1".repeat(64) }, { id: "l2", line_index: 2, fingerprint: "2".repeat(64) }],
  heads: [], pad_heads: [], weight_head_id: null };
function fixture(options: { denied?: boolean; anonymous?: boolean; refusal?: { code: string; message: string }; readFailure?: boolean; padFailure?: boolean } = {}) {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  let clients = 0;
  const dependencies = {
    authenticate: async () => options.anonymous ? new Response("unauthenticated", { status: 401 }) : { user: { id: "authenticated-actor" }, token: "synthetic" },
    client: () => {
      clients++;
      const caller = clients === 1;
      return { rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (caller) return { data: !options.denied, error: null };
        if (name === "record_lot_confirmation") return { data: {}, error: options.refusal ?? null };
        if (name === "read_lot_confirmation_context") return { data: options.readFailure ? null : context, error: options.readFailure ? {} : null };
        if (name === "read_pad_weight_context") {
          if (options.padFailure) return { data: null, error: {} };
          return { data: { case_id: cid, case_status: "READY_TO_PRICE", context_hash: H, request_count: 2, scenario: null, heads: [], facts: [] }, error: null };
        }
        throw new Error("unexpected RPC");
      }, from: () => { throw new Error("unexpected table access"); } };
    },
  };
  return { dependencies: dependencies as unknown as NonNullable<Parameters<typeof handleRequest>[1]>, calls, clients: () => clients };
}
const request = (body: unknown) => new Request("https://synthetic.invalid", { method: "POST", body: JSON.stringify(body) });

Deno.test("LOT writer: authentication and caller write access before any service client", async () => {
  for (const [options, expected, count] of [[{ anonymous: true }, 401, 0], [{ denied: true }, 403, 1]] as const) {
    const f = fixture(options);
    const r = await handleRequest(request({ case_id: cid, action: "record", decision: {} }), f.dependencies);
    assertEquals(r.status, expected); assertEquals(f.clients(), count);
    assertEquals(f.calls.some(c => c.name === "record_lot_confirmation"), false);
  }
});
Deno.test("LOT writer: actor comes from the verified JWT; forged fields and bad shapes are refused", async () => {
  const f = fixture();
  const r = await handleRequest(request({ case_id: cid, action: "record", decision: { unit_ref: "a" } }), f.dependencies);
  assertEquals(r.status, 200);
  assertEquals(f.calls.map(c => c.name), ["has_case_write_access", "record_lot_confirmation", "read_lot_confirmation_context", "read_pad_weight_context"]);
  assertEquals(f.calls[1].args?.p_actor, "authenticated-actor");
  for (const body of [{ case_id: cid, action: "record", actor: "forged", decision: {} }, { case_id: cid, action: "record", decision: [] },
    { case_id: "not-a-uuid", action: "read" }, { case_id: cid, action: "read", decision: {} }, { case_id: cid, action: "delete" }]) {
    const rejected = fixture();
    assertEquals((await handleRequest(request(body), rejected.dependencies)).status, 400);
    assertEquals(rejected.clients(), 0);
  }
});
Deno.test("LOT writer: conflicts are 409, explained refusals keep their code, others are generic", async () => {
  const conflict = fixture({ refusal: { code: "40001", message: "LOT_CONTEXT_CHANGED" } });
  const r = await handleRequest(request({ case_id: cid, action: "record", decision: {} }), conflict.dependencies);
  assertEquals(r.status, 409); assertEquals((await r.json()).code, "LOT_CONTEXT_CHANGED");
  const ambiguous = fixture({ refusal: { code: "22023", message: "LOT_LINE_AMBIGUOUS" } });
  const a = await handleRequest(request({ case_id: cid, action: "record", decision: {} }), ambiguous.dependencies);
  assertEquals(a.status, 422); assertEquals((await a.json()).code, "LOT_LINE_AMBIGUOUS");
  const other = fixture({ refusal: { code: "XX000", message: "internal detail" } });
  assertEquals((await (await handleRequest(request({ case_id: cid, action: "record", decision: {} }), other.dependencies)).json()).code, "LOT_DECISION_REFUSED");
});
Deno.test("LOT reader: read access only, no mutation, unreadable context is 503", async () => {
  const f = fixture();
  const r = await handleRequest(request({ case_id: cid, action: "read" }), f.dependencies);
  assertEquals(r.status, 200); assertEquals(f.calls.map(c => c.name), ["has_case_read_access", "read_lot_confirmation_context"]);
  assertEquals((await r.json()).context.context_hash, H);
  assertEquals((await handleRequest(request({ case_id: cid, action: "read" }), fixture({ readFailure: true }).dependencies)).status, 503);
});

Deno.test("LOT writer: the PAD gap sync never turns a recorded decision into a failure", async () => {
  const f = fixture({ padFailure: true });
  const r = await handleRequest(request({ case_id: cid, action: "record", decision: {} }), f.dependencies);
  assertEquals(r.status, 200); assertEquals((await r.json()).pad_gap_synced, false);
  const legacy = fixture();
  assertEquals((await (await handleRequest(request({ case_id: cid, action: "record", decision: {} }), legacy.dependencies)).json()).pad_gap_synced, null);
  const read = fixture();
  await handleRequest(request({ case_id: cid, action: "read" }), read.dependencies);
  assertEquals(read.calls.some(c => c.name === "read_pad_weight_context"), false);
});
