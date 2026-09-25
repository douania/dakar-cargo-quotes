import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadLotConfirmationState } from "./lot-confirmation-store.ts";

const H = "a".repeat(64);
const context = (patch: Record<string, unknown> = {}) => ({ case_id: "case", case_status: "READY_TO_PRICE", context_hash: H, request_count: 2,
  scenario: null, lines: [{ id: "l1", line_index: 1, line_label: "Lot 1", fingerprint: "1".repeat(64), extracted_facts: [] },
    { id: "l2", line_index: 2, line_label: "Lot 2", fingerprint: "2".repeat(64), extracted_facts: [] }], heads: [], pad_heads: [], weight_head_id: null, ...patch });
const client = (data: unknown, error: unknown = null) => {
  const calls: string[] = [];
  return { calls, rpc: (name: string) => { calls.push(name); return Promise.resolve({ data, error }); } };
};

Deno.test("LOT store: one service read, resolution attached, locked statuses read-only", async () => {
  const c = client(context());
  const state = await loadLotConfirmationState(c, "case");
  assertEquals(c.calls, ["read_lot_confirmation_context"]);
  assertEquals(state.resolution.issues.map(i => i.code), ["LOT_SCENARIO_REQUIRED"]);
  assertEquals(state.read_only, false);
  for (const status of ["SENT", "ACCEPTED", "REJECTED", "ARCHIVED", "PRICING_RUNNING"]) {
    assertEquals((await loadLotConfirmationState(client(context({ case_status: status })), "case")).read_only, true);
  }
});
Deno.test("LOT store: unreadable or foreign context is an error, never an absence of decisions", async () => {
  await assertRejects(() => loadLotConfirmationState(client(null), "case"), Error, "LOT_CONTEXT_UNAVAILABLE");
  await assertRejects(() => loadLotConfirmationState(client(context(), { message: "boom" }), "case"), Error, "LOT_CONTEXT_UNAVAILABLE");
  await assertRejects(() => loadLotConfirmationState(client(context()), "other"), Error, "LOT_CONTEXT_INVALID");
});
