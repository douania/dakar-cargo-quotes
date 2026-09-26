import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  evaluateLotRequirements, lotPadAllocationIssue, lotPadEmissionValid, lotPadScopeIssues, parseLotContext,
  lotPricingContainers, readLotContainers, resolveLotConfirmations, withConfirmedLotTerminalMode, type LotContext,
} from "./lot-confirmation.ts";
import { TERMINAL_OPERATION_MODE_FACT_KEY } from "./terminal-operation-mode.ts";
import type { ConfirmedPadLine, PadGroup } from "./pad-group-confirmation.ts";

const H = "a".repeat(64);
const unit = (unit_ref: string, equipment_code = "40hc", quantity = 2) => ({ unit_ref, unit_kind: "CONTAINER", equipment_code, quantity, scenario_basis: `Synthetic ${unit_ref}` });
const line = (id: string, index: number, fingerprint: string, facts: unknown[] = []) =>
  ({ id, line_index: index, line_label: `Lot ${index}`, request_type_hint: "SEA_FCL_IMPORT", fingerprint, extracted_facts: facts });
const decision = (unit_ref: string, kind: "line_binding" | "terminal_mode", patch: Record<string, unknown> = {}) => ({
  id: `${kind}-${unit_ref}`, case_id: "case", scenario_id: "scenario", scope_hash: H, context_hash: H, unit_ref, decision_kind: kind,
  action: "confirm", line_fingerprint: kind === "line_binding" ? (unit_ref === "a" ? "1".repeat(64) : "2".repeat(64)) : null,
  terminal_mode: kind === "terminal_mode" ? "LOLO" : null, source_reference: "Synthetic operator source", decided_by: "actor",
  created_at: kind === "line_binding" ? "2026-09-25T10:00:00Z" : "2026-09-25T11:00:00Z", decision_version: 1, ...patch,
});
function ctx(heads: unknown[], patch: Record<string, unknown> = {}): LotContext {
  return parseLotContext({ case_id: "case", case_status: "READY_TO_PRICE", context_hash: H, request_count: 2,
    scenario: { id: "scenario", scope_hash: H, status: "draft", superseded_by_scenario_id: null,
      scope_snapshot: { schema_version: 3, cargo_units: [unit("a"), unit("b", "20dv", 1)] } },
    lines: [line("l1", 1, "1".repeat(64)), line("l2", 2, "2".repeat(64))], heads, pad_heads: [], weight_head_id: null, ...patch }, "case");
}
const codes = (c: LotContext) => resolveLotConfirmations(c).issues.map(i => `${i.unit_ref}|${i.line_id}|${i.kind}|${i.code}`);

Deno.test("LOT: explicit bindings attach lots to lines by fingerprint, never by position", () => {
  const res = resolveLotConfirmations(ctx([decision("a", "line_binding"), decision("b", "line_binding")]));
  assertEquals(res.issues, []);
  assertEquals(res.bindings.map(b => `${b.unit_ref}->${b.line.id}`), ["a->l1", "b->l2"]);
  // Same lines listed in another order: the same lots stay with the same lines.
  const swapped = ctx([decision("a", "line_binding"), decision("b", "line_binding")],
    { lines: [line("l2", 1, "2".repeat(64)), line("l1", 2, "1".repeat(64))] });
  assertEquals(resolveLotConfirmations(swapped).bindings.map(b => `${b.unit_ref}->${b.line.id}`), ["a->l1", "b->l2"]);
});

Deno.test("LOT: no decision, revoked, stale, other scenario and invalid decisions never bind", () => {
  assertEquals(codes(ctx([])), ["a||line_binding|LOT_BINDING_REQUIRED", "b||line_binding|LOT_BINDING_REQUIRED",
    "|l1|line_binding|LOT_LINE_UNBOUND", "|l2|line_binding|LOT_LINE_UNBOUND"]);
  for (const [patch, code] of [[{ action: "revoke", line_fingerprint: null }, "LOT_CONFIRMATION_REVOKED"],
    [{ context_hash: "b".repeat(64) }, "LOT_CONFIRMATION_STALE"], [{ scenario_id: "other" }, "LOT_CONFIRMATION_STALE"],
    [{ scope_hash: "c".repeat(64) }, "LOT_CONFIRMATION_STALE"], [{ source_reference: "" }, "LOT_CONFIRMATION_INVALID"]] as const) {
    const res = resolveLotConfirmations(ctx([decision("a", "line_binding", patch), decision("b", "line_binding")]));
    assertEquals(res.bindings.map(b => b.unit_ref), ["b"]);
    assertEquals(res.issues.find(i => i.unit_ref === "a")?.code, code);
  }
});

Deno.test("LOT: indiscernible lines are refused, lines changed or claimed twice are not assigned", () => {
  const twins = ctx([decision("a", "line_binding"), decision("b", "line_binding", { line_fingerprint: "1".repeat(64) })],
    { lines: [line("l1", 1, "1".repeat(64)), line("l2", 2, "1".repeat(64))] });
  const res = resolveLotConfirmations(twins);
  assertEquals(res.bindings, []);
  assertEquals(res.issues.filter(i => i.code === "LOT_LINE_AMBIGUOUS").length, 4); // both lines + both lots
  const changed = resolveLotConfirmations(ctx([decision("a", "line_binding", { line_fingerprint: "9".repeat(64) }), decision("b", "line_binding")]));
  assertEquals(changed.issues.find(i => i.unit_ref === "a")?.code, "LOT_LINE_CHANGED");
  const claimed = resolveLotConfirmations(ctx([decision("a", "line_binding"), decision("b", "line_binding", { line_fingerprint: "1".repeat(64) })]));
  assertEquals(claimed.bindings, []);
  assertEquals(claimed.issues.filter(i => i.code === "LOT_LINE_ALREADY_BOUND").map(i => i.unit_ref), ["a", "b"]);
});

Deno.test("LOT: no selected, dead or non-multi-lot scenario means no binding at all", () => {
  assertEquals(codes(ctx([decision("a", "line_binding")], { scenario: null })), ["|||LOT_SCENARIO_REQUIRED"]);
  for (const patch of [{ status: "superseded" }, { superseded_by_scenario_id: "next" }]) {
    const c = ctx([decision("a", "line_binding")]); c.scenario = { ...c.scenario!, ...patch };
    assertEquals(codes(c), ["|||LOT_SCOPE_UNSUPPORTED"]);
  }
  assertEquals(codes(ctx([], { request_count: 1, lines: [line("l1", 1, "1".repeat(64))] })), ["|||LOT_SCOPE_UNSUPPORTED"]);
});

Deno.test("LOT: terminal mode needs a fresh decision recorded after the lot's current binding", () => {
  const ok = resolveLotConfirmations(ctx([decision("a", "line_binding"), decision("a", "terminal_mode")]));
  assertEquals(ok.terminals.map(t => `${t.unit_ref}:${t.mode}`), ["a:LOLO"]);
  for (const [patch, code] of [[{ created_at: "2026-09-25T09:00:00Z" }, "LOT_BINDING_CHANGED"], [{ terminal_mode: "RO-RO" }, "LOT_CONFIRMATION_INVALID"],
    [{ action: "revoke", terminal_mode: null }, "LOT_CONFIRMATION_REVOKED"], [{ context_hash: "b".repeat(64) }, "LOT_CONFIRMATION_STALE"]] as const) {
    const res = resolveLotConfirmations(ctx([decision("a", "line_binding"), decision("a", "terminal_mode", patch)]));
    assertEquals(res.terminals, []);
    assertEquals(res.issues.find(i => i.kind === "terminal_mode")?.code, code);
  }
  // A terminal decision without a valid binding is never applied.
  assertEquals(resolveLotConfirmations(ctx([decision("a", "terminal_mode")])).terminals, []);
});

Deno.test("LOT: per-line requirements expose the confirmed mode and precise diagnostics", () => {
  const res = resolveLotConfirmations(ctx([decision("a", "line_binding"), decision("a", "terminal_mode"), decision("b", "line_binding")]));
  const base = { resolution: res, terminalRequired: true, padGroupsRequired: false, padReady: false, padLines: [] };
  assertEquals(evaluateLotRequirements({ ...base, lineId: "l1" }), { unit_ref: "a", terminalMode: "LOLO", padLine: null, diagnostics: [] });
  assertEquals(evaluateLotRequirements({ ...base, lineId: "l2" }).diagnostics, ["LOT_TERMINAL_CONFIRMATION_REQUIRED"]);
  const unbound = resolveLotConfirmations(ctx([decision("a", "line_binding")]));
  assertEquals(evaluateLotRequirements({ ...base, resolution: unbound, lineId: "l2" }).diagnostics, ["LOT_LINE_UNBOUND"]);
  assertEquals(evaluateLotRequirements({ ...base, resolution: unbound, lineId: "l2", terminalRequired: false }).diagnostics, []);
});

Deno.test("LOT: the confirmed mode replaces the line value; the global fact is never an input", () => {
  const lineFacts = [{ key: "cargo.weight_kg", value: 1 }, { key: TERMINAL_OPERATION_MODE_FACT_KEY, value: "RORO" }];
  assertEquals(withConfirmedLotTerminalMode(lineFacts, "LOLO"), [{ key: "cargo.weight_kg", value: 1 }, { key: TERMINAL_OPERATION_MODE_FACT_KEY, value: "LOLO" }]);
  assertEquals(withConfirmedLotTerminalMode(lineFacts, null), lineFacts);
  assertEquals(withConfirmedLotTerminalMode([], null), []);
});

Deno.test("LOT: malformed contexts are rejected, never guessed", () => {
  const good = { case_id: "case", context_hash: H, request_count: 2, lines: [], heads: [] };
  for (const bad of [null, { ...good, case_id: "other" }, { ...good, context_hash: "x" }, { ...good, lines: [{ id: "l", line_index: 1, fingerprint: "bad" }] },
    { ...good, heads: [{ id: "h", unit_ref: "a", decision_kind: "other", action: "confirm" }] },
    { ...good, lines: [line("l", 1, H), line("l", 2, "b".repeat(64))] }]) {
    assertThrows(() => parseLotContext(bad, "case"));
  }
});

const group = (patch: Partial<PadGroup> = {}): PadGroup => ({ unit_ref: "a", equipment_code: "40hq", quantity: 2, ownership: "SOC",
  description: "Synthetic", total_weight_kg: 36000, ...patch });
Deno.test("LOT PAD: a group is compared with the facts of its own line only", () => {
  const facts = (containers: unknown, weight?: unknown) => line("l1", 1, H, [{ key: "cargo.containers", value: containers },
    ...(weight === undefined ? [] : [{ key: "cargo.weight_kg", value: weight }])]);
  assertEquals(lotPadAllocationIssue(group(), facts([{ type: "40HC", quantity: 2 }], 36000)), null);
  assertEquals(lotPadAllocationIssue(group(), facts(JSON.stringify([{ type: "40HC", quantity: 2, coc_soc: "SOC" }]))), null);
  assertEquals(lotPadAllocationIssue(group(), facts([{ type: "20DV", quantity: 2 }])), "LOT_PAD_ALLOCATION_MISMATCH");
  assertEquals(lotPadAllocationIssue(group(), facts([{ type: "40HC", quantity: 3 }])), "LOT_PAD_ALLOCATION_MISMATCH");
  assertEquals(lotPadAllocationIssue(group(), facts([{ type: "40HC", quantity: 2, coc_soc: "COC" }])), "LOT_PAD_ALLOCATION_MISMATCH");
  assertEquals(lotPadAllocationIssue(group(), facts([{ type: "40HC", quantity: 1 }, { type: "40HC", quantity: 1 }])), "LOT_PAD_ALLOCATION_MISMATCH");
  assertEquals(lotPadAllocationIssue(group(), facts([{ type: "40HC", quantity: 2 }], 30000)), "LOT_PAD_WEIGHT_MISMATCH");
  assertEquals(lotPadAllocationIssue(group(), line("l1", 1, H, [])), "LOT_PAD_ALLOCATION_MISMATCH");
});

Deno.test("LOT PAD: the strict single-group text written by the real extraction is compared like the JSON form", () => {
  const facts = (containers: unknown, weight?: unknown) => line("l1", 1, H, [{ key: "cargo.containers", value: containers },
    ...(weight === undefined ? [] : [{ key: "cargo.weight_kg", value: weight }])]);
  const dv = group({ unit_ref: "b", equipment_code: "20dv", quantity: 1, total_weight_kg: 12000 });
  // Forms observed on the deployed sandbox (valueType text).
  assertEquals(lotPadAllocationIssue(group(), facts("2x40HC", "36000")), null);
  assertEquals(lotPadAllocationIssue(dv, facts("1x20DV", "12000")), null);
  for (const ok of ["2X40HC", " 2 x 40HC ", "2x40'HC", "2 × 40 HQ", "2x40hc"]) assertEquals(lotPadAllocationIssue(group(), facts(ok)), null, ok);
  // Quantity and equipment are still checked against the bound group.
  assertEquals(lotPadAllocationIssue(group(), facts("3x40HC")), "LOT_PAD_ALLOCATION_MISMATCH");
  assertEquals(lotPadAllocationIssue(group(), facts("2x20DV")), "LOT_PAD_ALLOCATION_MISMATCH");
  assertEquals(lotPadAllocationIssue(group(), facts("2x40DV")), "LOT_PAD_ALLOCATION_MISMATCH");
  assertEquals(lotPadAllocationIssue(dv, facts("1x20GP")), "LOT_PAD_ALLOCATION_MISMATCH");
  assertEquals(lotPadAllocationIssue(group(), facts("2x40HC", "30000")), "LOT_PAD_WEIGHT_MISMATCH");
  // Invalid quantities, unknown equipment, several groups, extra or ambiguous text: refused.
  for (const bad of ["0x40HC", "02x40HC", "-2x40HC", "2.5x40HC", "1000x40HC", "x40HC", "40HC", "2", "2x40", "2x40XX", "2x30HC",
    "2x40HCX", "2x40 DRY", "2x40HC + 1x20DV", "2x40HC, 1x20DV", "2x40HC 1x20DV", "2x40HC SOC", "environ 2x40HC",
    "2x40HC ou 3x40HC", "2 conteneurs 40HC", "2x40HC\n1x20DV", ""]) {
    assertEquals(lotPadAllocationIssue(group(), facts(bad)), "LOT_PAD_ALLOCATION_MISMATCH", bad);
  }
  // Order: strict text first, otherwise the unchanged JSON path ("2" is not a list; a JSON string still works).
  assertEquals(lotPadAllocationIssue(group(), facts("2")), "LOT_PAD_ALLOCATION_MISMATCH");
  assertEquals(lotPadAllocationIssue(group(), facts(JSON.stringify([{ type: "40HC", quantity: 2 }]))), null);
  // Line breaks inside the value are not accepted; 45HQ is not an alias of 45HC (same as the JSON form).
  for (const bad of ["2\nx40HC", "2x\n40HC", "2x40\nHC"]) assertEquals(lotPadAllocationIssue(group(), facts(bad)), "LOT_PAD_ALLOCATION_MISMATCH", bad);
  assertEquals(lotPadAllocationIssue(group({ equipment_code: "45hc" }), facts("2x45HQ")), "LOT_PAD_ALLOCATION_MISMATCH");
  assertEquals(lotPadAllocationIssue(group({ equipment_code: "45hc" }), facts("2x45HC")), null);
  // The text form states no ownership: accepted as for a JSON entry without coc_soc (the group keeps its own).
  // Two container facts on the same line stay refused whatever their form.
  assertEquals(lotPadAllocationIssue(group(), line("l1", 1, H, [{ key: "cargo.containers", value: "2x40HC" },
    { key: "cargo.containers", value: "2x40HC" }])), "LOT_PAD_ALLOCATION_MISMATCH");
});

Deno.test("LOT CONTAINERS: one reader for PAD allocation and pricing; unreadable is explicit, never an empty list", () => {
  const read = (value: unknown) => readLotContainers([{ key: "cargo.weight_kg", value: "1" }, { key: "cargo.containers", value }]);
  // Absent: the unchanged path (no container fact on the lot).
  assertEquals(readLotContainers([{ key: "cargo.weight_kg", value: "1" }]), { status: "absent" });
  // Existing JSON forms are kept as they are (list or JSON string, several entries allowed for pricing).
  const json = [{ type: "40HC", quantity: 2, coc_soc: "SOC" }, { type: "20DV", quantity: 1 }];
  assertEquals(read(json), { status: "valid", containers: json });
  assertEquals(read(JSON.stringify(json)), { status: "valid", containers: json });
  assertEquals(read([{ type: "40HC", quantity: "2" }]), { status: "valid", containers: [{ type: "40HC", quantity: "2" }] });
  // Strict text: same shape and values as the extraction's JSON entry for the same lot.
  assertEquals(read("2x40HC"), { status: "valid", containers: [{ type: "40HC", quantity: 2, coc_soc: null }] });
  assertEquals(read("1x20DV"), { status: "valid", containers: [{ type: "20DV", quantity: 1, coc_soc: null }] });
  assertEquals(read("2 × 40' HQ"), { status: "valid", containers: [{ type: "40HC", quantity: 2, coc_soc: null }] });
  // Present but unreadable → invalid (pricing blocks the lot with LOT_CONTAINERS_UNREADABLE).
  for (const bad of ["deux conteneurs 40HC", "2x40HC + 1x20DV", "2x40HC SOC", "0x40HC", "", "2", "{}", JSON.stringify({ type: "40HC", quantity: 2 }),
    [], "[]", [{ type: "40HC", quantity: true }], [{ type: "40HC", quantity: "2 " }],
    [{ type: "40HC", quantity: 0 }], [{ type: "40HC", quantity: 1.5 }], [{ type: "40HC" }], [{ quantity: 2 }], [{ type: "", quantity: 2 }], ["40HC"], [null], 42, null, {}]) {
    assertEquals(read(bad), { status: "invalid" }, JSON.stringify(bad));
  }
  assertEquals(readLotContainers([{ key: "cargo.containers", value: "2x40HC" }, { key: "cargo.containers", value: "2x40HC" }]), { status: "invalid" });
});

Deno.test("LOT CONTAINERS: a lot is priced only with its own containers, never the dossier's or another lot's", () => {
  const own = readLotContainers([{ key: "cargo.containers", value: "2x40HC" }]);
  const absent = readLotContainers([{ key: "cargo.weight_kg", value: "12000" }]);
  const unreadable = readLotContainers([{ key: "cargo.containers", value: "deux conteneurs" }]);
  assertEquals(lotPricingContainers(own, "SEA_FCL_IMPORT", "DAP_PROJECT_IMPORT"), { containers: [{ type: "40HC", quantity: 2, coc_soc: null }] });
  assertEquals(lotPricingContainers(own, "AIR_IMPORT", "AIR_IMPORT_DAP"), { containers: [{ type: "40HC", quantity: 2, coc_soc: null }] });
  assertEquals(lotPricingContainers(unreadable, "AIR_IMPORT", "AIR_IMPORT_DAP"), { blocker: "LOT_CONTAINERS_UNREADABLE" });
  // Explicitly non-containerised (LCL/air hint AND LCL/air package): none, no block.
  for (const [hint, pkg] of [["SEA_LCL_IMPORT", "LCL_IMPORT_DAP"], ["AIR_IMPORT", "AIR_IMPORT_EXW"], ["AIR_LCL_IMPORT", "AIR_IMPORT_DDP"], [" air_import ", "air_import_dap"]]) {
    assertEquals(lotPricingContainers(absent, hint, pkg), { containers: [] }, hint);
  }
  // Containerised, undetermined or contradictory: blocked, never inherited.
  for (const [hint, pkg] of [["SEA_FCL_IMPORT", "DAP_PROJECT_IMPORT"], ["IMPORT_PROJECT_DAP", "DAP_PROJECT_IMPORT"], ["", undefined], ["UNKNOWN", undefined],
    ["SEA_IMPORT", undefined], ["AIR_FCL_IMPORT", undefined], [null, undefined], [42, "AIR_IMPORT_DAP"],
    ["SEA_LCL_IMPORT", "EXPORT_SENEGAL"], ["AIR_IMPORT", "DAP_PROJECT_IMPORT"], ["SEA_LCL_IMPORT", undefined], ["SEA_LCL_IMPORT", ""]]) {
    assertEquals(lotPricingContainers(absent, hint, pkg), { blocker: "LOT_CONTAINERS_REQUIRED" }, String(hint) + "/" + String(pkg));
  }
});

const padLine = (unit_ref: string, amount: number): ConfirmedPadLine => ({ unit_ref, category: "T02", quantity: 1, unit_price: amount, amount,
  tariff_id: `tariff-${unit_ref}`, tariff_source: "Synthetic tariff", decision_id: `pad-${unit_ref}`, context_hash: H });
Deno.test("LOT PAD (D5): one line per decision, in its lot, without engine or global PAD line", () => {
  const expected = [padLine("a", 3600), padLine("b", 1200)];
  const lots = new Map([[1, "a"], [2, "b"]]);
  const emitted = (l: ConfirmedPadLine, lot: number) => ({ category: "PAD_DROIT_PASSAGE", amount: l.amount, lot_index: lot,
    source: { decision_id: l.decision_id, unit_ref: l.unit_ref, tariff_id: l.tariff_id } });
  const good = [emitted(expected[0], 1), emitted(expected[1], 2), { category: "DTHC", amount: 5 }];
  assertEquals(lotPadEmissionValid(expected, good, lots), true);
  assertEquals(lotPadEmissionValid(expected, [...good, emitted(expected[0], 1)], lots), false); // double counting
  assertEquals(lotPadEmissionValid(expected, [...good, { category: "PAD_DROIT_PASSAGE", amount: 900, lot_index: 1 }], lots), false); // engine/global line
  assertEquals(lotPadEmissionValid(expected, [...good, { category: "PAD_DROIT_PASSAGE", amount: 0, lot_index: 3, source: { decision_id: null, unit_ref: null, tariff_id: null } }], lots), true); // 0 placeholder, no decision
  assertEquals(lotPadEmissionValid(expected, [emitted(expected[0], 2), emitted(expected[1], 1)], lots), false); // wrong lot
  assertEquals(lotPadEmissionValid(expected, [emitted(expected[0], 1)], lots), false); // missing decision
  assertEquals(lotPadEmissionValid([], [], lots), true);
});
Deno.test("LOT PAD (D5): a PAD decision whose lot is out of PAD scope or absent blocks before pricing", () => {
  const lines = [padLine("a", 3600), padLine("b", 1200)];
  assertEquals([...lotPadScopeIssues(lines, [{ lot_index: 1, unit_ref: "a", padInScope: true }, { lot_index: 2, unit_ref: "b", padInScope: true }])], []);
  assertEquals([...lotPadScopeIssues(lines, [{ lot_index: 1, unit_ref: "a", padInScope: true }, { lot_index: 2, unit_ref: "b", padInScope: false }])],
    [[2, ["LOT_PAD_SCOPE_MISMATCH"]]]);
  assertEquals([...lotPadScopeIssues(lines, [{ lot_index: 1, unit_ref: "a", padInScope: true }, { lot_index: 2, unit_ref: null, padInScope: true }])].map(([i]) => i), [1, 2]);
});
