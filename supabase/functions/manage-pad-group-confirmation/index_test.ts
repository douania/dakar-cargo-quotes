import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRequest } from "./index.ts";
const cid = "11111111-1111-4111-8111-111111111111";
function fixture(options: { denied?: boolean; anonymous?: boolean; conflict?: boolean; readFailure?: boolean } = {}) {
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
        if (name === "record_pad_group_confirmation") return { data: {}, error: options.conflict ? { code: "40001" } : null };
        if (name === "read_pad_weight_context") return { data: { case_id: cid, scenario: null, heads: [], facts: [] }, error: options.readFailure ? {} : null };
        throw new Error("unexpected RPC");
      }, from: () => { throw new Error("unexpected table access"); } };
    },
  };
  return { dependencies: dependencies as unknown as NonNullable<Parameters<typeof handleRequest>[1]>, calls, clients: () => clients };
}
const request = (body: unknown) => new Request("https://synthetic.invalid", { method: "POST", body: JSON.stringify(body) });
Deno.test("PAD writer: authentication and caller write access before service client", async () => {
  for (const [options, expected, count] of [[{ anonymous: true }, 401, 0], [{ denied: true }, 403, 1]] as const) {
    const f = fixture(options); const r = await handleRequest(request({ case_id: cid, action: "record", decision: {} }), f.dependencies);
    assertEquals(r.status, expected); assertEquals(f.clients(), count); assertEquals(f.calls.some(c => c.name === "record_pad_group_confirmation"), false);
  }
});
Deno.test("PAD writer: actor comes from verified JWT, not request; conflict is 409", async () => {
  const f = fixture({ conflict: true });
  const r = await handleRequest(request({ case_id: cid, action: "record", decision: {} }), f.dependencies);
  assertEquals(r.status, 409); assertEquals(f.calls[0].name, "has_case_write_access");
  assertEquals(f.calls[1].args?.p_actor, "authenticated-actor");
  const rejected = fixture();
  assertEquals((await handleRequest(request({ case_id: cid, action: "record", actor: "forged", decision: {} }), rejected.dependencies)).status, 400);
  assertEquals(rejected.clients(), 0);
});
Deno.test("PAD reader: access checked, no mutation, failure not treated as missing confirmations", async () => {
  const f = fixture(); const r = await handleRequest(request({ case_id: cid, action: "read" }), f.dependencies);
  assertEquals(r.status, 200); assertEquals((await r.json()).mode, "legacy");
  assertEquals(f.calls.map(c => c.name), ["has_case_read_access", "read_pad_weight_context"]);
  const bad = fixture({ readFailure: true });
  assertEquals((await handleRequest(request({ case_id: cid, action: "read" }), bad.dependencies)).status, 503);
});

Deno.test("weight reconciliation requires write access, never a read-only authorization", async () => {
  const f = fixture({ denied: true });
  const r = await handleRequest(request({ case_id: cid, action: "reconcile_weight", decision: {} }), f.dependencies);
  assertEquals(r.status, 403); assertEquals(f.calls[0].name, "has_case_write_access"); assertEquals(f.clients(), 1);
});
