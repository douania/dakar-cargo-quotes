import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { padGroupsFromSnapshot, padGroupAllocationIssue, resolveConfirmedPadGroups, type PadGroupContext, type PadGroupDecision } from "./pad-group-confirmation.ts";

const snapshot = () => ({ schema_version: 3, transport_mode: "MARITIME", movement_direction: "IMPORT", cargo_units: [
  { unit_ref: "a", unit_kind: "CONTAINER", equipment_code: "20HQ", quantity: 2, ownership: "SOC", scenario_basis: "Synthetic electrical equipment", gross_weight_kg: 15000, weight_basis: "per_unit" },
  { unit_ref: "b", unit_kind: "CONTAINER", equipment_code: "20HQ", quantity: 3, ownership: "SOC", scenario_basis: "Synthetic other equipment", gross_weight_kg: 10000, weight_basis: "total" },
] });
const context = (): PadGroupContext => ({ case_id: "synthetic-case", scenario_id: "synthetic-scenario", scope_hash: "a".repeat(64), context_hash: "b".repeat(64), groups: padGroupsFromSnapshot(snapshot()) });
const decisions = (): PadGroupDecision[] => context().groups.map((g, i) => ({ id: `decision-${g.unit_ref}`, case_id: context().case_id,
  scenario_id: context().scenario_id, scope_hash: context().scope_hash, unit_ref: g.unit_ref, context_hash: context().context_hash,
  action: "confirm", category: i ? "T03" : "T02", total_weight_kg: g.total_weight_kg,
  source_reference: "Synthetic classification evidence", weight_source_reference: "Synthetic weight evidence",
  decided_by: "synthetic-operator", created_at: "2026-09-17T00:00:00Z" }));
const tariff = (classification: string, amount: number): Record<string, unknown> => ({ id: `tariff-${classification}`, provider: "PAD", category: "DROIT_PASSAGE",
  operation_type: "IMPORT", cargo_type: "CONTENEUR", classification, amount, unit: "PER_TONNE", source_document: "Synthetic official tariff",
  evidence_level: "official", effective_date: "2025-01-01", expiry_date: null, is_active: true });
const tariffs = () => [tariff("T02", 100), tariff("T03", 200)];
const run = (heads = decisions(), rates = tariffs(), c = context()) => resolveConfirmedPadGroups(c, heads, rates, "2026-09-17");

Deno.test("provisional PAD weight retains amount and reservation without confirming client weight", () => {
  const heads = decisions(); heads[1].weight_basis = "provisional";
  heads[1].weight_reservation = "Base haute retenue, révisable selon documents définitifs";
  const before = JSON.stringify(heads);
  assertEquals(run(heads).total, 5000);
  assertEquals(run(heads).lines[1].weight_basis, "provisional");
  assertEquals(run(heads).lines[1].weight_reservation, heads[1].weight_reservation);
  assertEquals(JSON.stringify(heads), before);
  heads[1].weight_reservation = "";
  assertEquals(run(heads).issues[0].code, "PAD_WEIGHT_BASIS_INVALID");
});

Deno.test("confirmed PAD: two same-equipment groups retain distinct categories and weight bases", () => {
  const c = context(); const ds = decisions(); const ts = tariffs(); const before = JSON.stringify([c, ds, ts]);
  const result = run(ds, ts, c);
  assertEquals(result.ready, true); assertEquals(result.total, 5000);
  assertEquals(result.lines.map(l => [l.unit_ref, l.quantity, l.unit_price, l.amount]), [["a", 30, 100, 3000], ["b", 10, 200, 2000]]);
  assertEquals(result.lines[0].decision_id, ds[0].id); assertEquals(result.lines[0].tariff_id, ts[0].id);
  assertEquals(JSON.stringify([c, ds, ts]), before);
});
Deno.test("scenario category proposals are not confirmations; partial coverage yields no firm lines", () => {
  for (const heads of [[], [decisions()[0]]]) {
    const result = run(heads); assertEquals(result.ready, false); assertEquals(result.lines, []); assertEquals(result.total, null);
    assertEquals(result.issues[0].code, "PAD_CONFIRMATION_REQUIRED");
  }
});
for (const field of ["case_id", "scenario_id", "scope_hash", "context_hash"] as const) {
  Deno.test(`confirmed PAD: drift/cross-case in ${field} cannot reuse confirmation`, () => {
    const heads = decisions(); heads[0][field] = "different";
    assertEquals(run(heads).issues[0].code, "PAD_CONFIRMATION_STALE"); assertEquals(run(heads).lines, []);
  });
}
Deno.test("confirmed PAD: revoked, duplicated and extra decisions fail closed", () => {
  const heads = decisions(); heads[0].action = "revoke";
  assertEquals(run(heads).issues[0].code, "PAD_CONFIRMATION_REVOKED");
  assertEquals(run([...decisions(), decisions()[0]]).issues[0].code, "PAD_DECISION_AMBIGUOUS");
  assertEquals(run([...decisions(), { ...decisions()[0], unit_ref: "other" }]).issues[0].code, "PAD_DECISION_OUTSIDE_SCOPE");
});
Deno.test("confirmed PAD: missing human/source evidence and invalid categories refused", () => {
  for (const key of ["id", "source_reference", "weight_source_reference", "decided_by", "created_at", "category"] as const) {
    const heads = decisions(); heads[0][key] = "";
    assertEquals(run(heads).issues[0].code, "PAD_CONFIRMATION_INVALID");
  }
  const heads = decisions(); heads[0].category = "T99";
  assertEquals(run(heads).issues[0].code, "PAD_CONFIRMATION_INVALID");
});
Deno.test("confirmed PAD: changed or missing weight never replaced with dossier weight", () => {
  const heads = decisions(); heads[0].total_weight_kg = 40000;
  assertEquals(run(heads).issues[0].code, "PAD_WEIGHT_CONFIRMATION_REQUIRED");
  const c = context(); c.groups[0].total_weight_kg = null;
  assertEquals(run(decisions(), tariffs(), c).issues[0].code, "PAD_WEIGHT_CONFIRMATION_REQUIRED");
});
Deno.test("confirmed PAD: exact unique applicable tariff mandatory", () => {
  assertEquals(run(decisions(), []).issues[0].code, "PAD_TARIFF_REQUIRED");
  assertEquals(run(decisions(), [...tariffs(), tariff("T02", 110)]).issues[0].code, "PAD_TARIFF_AMBIGUOUS");
  for (const patch of [{ operation_type: "EXPORT" }, { cargo_type: "VRAC" }, { evidence_level: "to_confirm" },
    { effective_date: "2027-01-01" }, { expiry_date: "2026-09-16" }, { amount: 0 }, { amount: -1 }, { currency: "EUR" }, { unit: "PER_CONTAINER" }]) {
    assertEquals(run(decisions(), [{ ...tariffs()[0], ...patch }, tariffs()[1]]).issues[0].code, "PAD_TARIFF_REQUIRED");
  }
});
Deno.test("confirmed PAD: scope invalid and unsafe amounts cannot clear gap", () => {
  for (const patch of [{ groups: [] }, { groups: [context().groups[0], context().groups[0]] }, { context_hash: "" }]) {
    assertEquals(run(decisions(), tariffs(), { ...context(), ...patch }).ready, false);
  }
  assertEquals(run(decisions(), [tariff("T02", Number.MAX_SAFE_INTEGER), tariffs()[1]]).issues[0].code, "PAD_AMOUNT_INVALID");
});
Deno.test("snapshot mapper refuses unsupported or duplicate scope; never invents missing weight", () => {
  for (const patch of [{ schema_version: 2 }, { transport_mode: "AIR" }, { movement_direction: "EXPORT" }, { cargo_units: [] },
    { cargo_units: [snapshot().cargo_units[0], snapshot().cargo_units[0]] }]) assertThrows(() => padGroupsFromSnapshot({ ...snapshot(), ...patch }));
  for (const patch of [{ gross_weight_kg: null }, { gross_weight_kg: -10 }, { weight_basis: "unknown" }, { gross_weight_kg: 1e13 }]) {
    assertEquals(padGroupsFromSnapshot({ ...snapshot(), cargo_units: [{ ...snapshot().cargo_units[0], ...patch }] })[0].total_weight_kg, null);
  }
});
Deno.test("allocation is a bijection, aliases normalized, no list-order or dossier-weight allocation", () => {
  const facts = [{ key: "cargo.containers", json: [{ type: "20HC", quantity: 3, coc_soc: "SOC" }, { type: "20HQ", quantity: 2, coc_soc: "SOC" }] }];
  assertEquals(padGroupAllocationIssue(context().groups, facts), null);
  assertEquals(padGroupAllocationIssue(context().groups, []), "PAD_GROUP_ALLOCATION_REQUIRED");
  assertEquals(padGroupAllocationIssue(context().groups, [...facts, { key: "cargo.weight_kg", json: 40000 }]), null);
  assertEquals(padGroupAllocationIssue(context().groups, [...facts, { key: "cargo.weight_kg", json: 41000 }]), "PAD_GROUP_WEIGHT_CONFLICT");
  const ambiguous = context().groups.map(g => ({ ...g, quantity: 2 }));
  assertEquals(padGroupAllocationIssue(ambiguous, [{ key: "cargo.containers", json: [{ type: "20HQ", quantity: 2, coc_soc: "SOC" }, { type: "20HQ", quantity: 2, coc_soc: "SOC" }] }]), "PAD_GROUP_ALLOCATION_REQUIRED");
});
