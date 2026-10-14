import { assertEquals, assertStringIncludes, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildPricingCargoBasis, buildRequestCargoBasis, quotationCargoBasisText, readQuotationCargoBasis } from "./quotation-cargo-basis.ts";
import { projectClientQuote } from "./client-quote-projection.ts";
const run = (first = 36, quantity = 2) => ({ id: "recorded-run", inputs_json: { mode: "multi_lot" }, facts_snapshot: [{ key: "cargo.weight_kg", value_number: 36000 }],
  engine_request: { mode: "multi_lot", lots: [{ lot_index: 2, params: { cargoWeight: 12, containers: [{ type: "20DV", quantity: 1 }] } }, { lot_index: 1, params: { cargoWeight: first, containers: [{ type: "40HC", quantity }] } }] },
  outputs_json: { multi_lot: true, lots: [{ lot_index: 1, label: "Lot A" }, { lot_index: 2, label: "Lot B" }] } });
const clean = (s: string) => s.replace(/\s/g, " ");

Deno.test("multi-lot retains exact run weights and containers by index, never old global or array order", () => {
  const original = run(45, 3), before = JSON.stringify(original);
  const b = buildPricingCargoBasis(original)!;
  assertEquals(b.lots.map(l => l.weight.kg), [45000, 12000]);
  assertEquals(b.lots.map(l => l.containers[0].quantity), [3, 1]);
  assertEquals(JSON.stringify(original), before);
  assertStringIncludes(clean(quotationCargoBasisText(b)[0]), "3 × 40HC ; poids total du lot : 45 000 kg");
});
Deno.test("revision produces its own bases without changing the previously recorded basis", () => {
  const v1 = buildPricingCargoBasis(run())!, before = JSON.stringify(v1);
  const v2 = buildPricingCargoBasis(run(45, 3))!;
  assertEquals(v1.lots[0].weight.kg, 36000);
  assertEquals(v2.lots[0].weight.kg, 45000);
  assertEquals(JSON.stringify(v1), before);
});
Deno.test("mono-lot named tonne contract and zero are retained with explicit kg conversion", () => {
  const b = buildPricingCargoBasis({ id: "mono", engine_request: { cargoWeight: 0, containers: [{ type: "20DV", quantity: 1 }] } })!;
  assertEquals(b.lots[0].weight, { status: "known", kg: 0, recorded_value: null, source_keys: ["engine.cargoWeight_t"] });
  assertStringIncludes(quotationCargoBasisText(b)[0], "0 kg");
});
Deno.test("missing or duplicate lot parameters never inherit the dossier weight", () => {
  const r = run(); r.engine_request.lots = [r.engine_request.lots[0], r.engine_request.lots[0]];
  const b = buildPricingCargoBasis(r)!;
  assertEquals(b.lots[0].weight.status, "missing");
  assertEquals(b.lots[1].weight.status, "conflict");
  assertEquals(b.lots.map(l => l.weight.kg), [null, null]);
});
Deno.test("duplicate output index is refused instead of associating by position", () => {
  const r = run(); r.outputs_json.lots[1].lot_index = 1;
  assertThrows(() => buildPricingCargoBasis(r), Error, "CARGO_BASIS_LOT_INDEX_INVALID");
});
Deno.test("legacy generic weight keeps absent unit and incompatible declarations remain unresolved", () => {
  const b = buildPricingCargoBasis({ engine_request: { cargo_weight: 36 } })!;
  assertEquals(b.lots[0].weight.status, "unit_unknown");
  assertStringIncludes(quotationCargoBasisText(b)[0], "36 (unité non précisée)");
  const conflict = buildPricingCargoBasis({ engine_request: { cargoWeight: 45, cargoWeightUnit: "kg" } })!;
  assertEquals(conflict.lots[0].weight.status, "conflict");
  assertEquals(conflict.lots[0].weight.kg, null);
});
Deno.test("request line weights use their own explicit units; extraction is never presented as confirmation", () => {
  const b = buildRequestCargoBasis([{ id: "line-a", line_index: 1, line_label: "Lot A", extracted_facts_json: [
    { key: "cargo.weight_kg", value: 45000 }, { key: "cargo.containers", value: [{ type: "40HC", quantity: 3 }] },
  ] }]);
  assertEquals(b.lots[0].weight.kg, 45000);
  assertStringIncludes(quotationCargoBasisText(b)[0], "extrait de la demande, à confirmer");
});
Deno.test("compatible explicit units agree while conflicting or absent units are never guessed", () => {
  const line = (facts: unknown[]) => buildRequestCargoBasis([{ line_index: 1, extracted_facts_json: facts }]).lots[0].weight;
  assertEquals(line([{ key: "cargo.weight_kg", value: 45000 }, { key: "cargo.weight_t", value: 45 }]).kg, 45000);
  assertEquals(line([{ key: "cargo.weight_kg", value: 45000 }, { key: "cargo.weight_t", value: 12 }]).status, "conflict");
  assertEquals(line([{ key: "cargo.weight_kg", value: 45, unit: "t" }]).status, "conflict");
  assertEquals(line([{ key: "cargo.weight", value: 45 }]).status, "unit_unknown");
  assertEquals(line([]).status, "missing");
});
Deno.test("client projection uses new immutable cargo bases while historical snapshot stays byte-identical", () => {
  const historical = { inputs: { origin: "Shanghai", destination: "Dakar", cargo_weight: 36, containers: [{ type: "20GP", quantity: 1 }] }, lines: [], raw_lines: [], totals: {} };
  const old = JSON.stringify(historical), oldProjection = projectClientQuote(historical);
  const snapshot = { ...historical, inputs: { ...historical.inputs, cargo_basis: buildPricingCargoBasis(run(45, 3)) } };
  const bases = clean(projectClientQuote(snapshot).bases.join(" "));
  assertStringIncludes(bases, "45 000 kg"); assertStringIncludes(bases, "12 000 kg"); assertStringIncludes(bases, "3 × 40HC");
  assertEquals(bases.includes("20GP"), false); assertEquals(bases.includes("non réparti"), false); assertEquals(bases.includes("57 000"), false);
  assertEquals(JSON.stringify(historical), old); assertEquals(projectClientQuote(historical), oldProjection);
  assertStringIncludes(oldProjection.bases.join(" "), "36 (unité non précisée)");
});
Deno.test("invalid saved new basis is rejected rather than silently restoring an old global weight", () => {
  assertEquals(readQuotationCargoBasis(undefined), null);
  assertThrows(() => readQuotationCargoBasis({ schema_version: 1, source: "pricing_run", lots: [{ lot_index: 1 }] }));
  assertThrows(() => projectClientQuote({ inputs: { cargo_weight: 36, cargo_basis: null }, lines: [] }));
});

Deno.test("request equipment accepts exact serialized JSON and NxEQUIPMENT, never ambiguous free text", () => {
  const equipment = (value: unknown) => buildRequestCargoBasis([{ line_index: 1, extracted_facts_json: [{ key: "cargo.containers", value }] }]).lots[0].containers;
  assertEquals(equipment('[{"type":"40HC","quantity":3}]'), [{ type: "40HC", quantity: 3 }]);
  assertEquals(equipment("2x40HC"), [{ type: "40HC", quantity: 2 }]);
  assertEquals(equipment("1 x 20DV"), [{ type: "20DV", quantity: 1 }]);
  assertEquals(equipment("3 conteneurs 40HC ou 20DV"), []);
});
Deno.test("missing and duplicate request indexes cannot be associated by array position", () => {
  assertThrows(() => buildRequestCargoBasis([{ extracted_facts_json: [] }]), Error, "CARGO_BASIS_LOT_INDEX_INVALID");
  assertThrows(() => buildRequestCargoBasis([{ line_index: 1 }, { line_index: "1" }]), Error, "CARGO_BASIS_LOT_INDEX_INVALID");
});
Deno.test("damaged saved unknown-unit value and container cannot fabricate zero or equipment", () => {
  const basis = buildPricingCargoBasis({ engine_request: { cargo_weight: 36, containers: [{ type: "20DV", quantity: 1 }] } })!;
  basis.lots[0].weight.recorded_value = null;
  assertThrows(() => quotationCargoBasisText(basis), Error, "CARGO_BASIS_INVALID");
  const bad = buildPricingCargoBasis(run())!;
  bad.lots[0].containers[0].quantity = NaN;
  assertThrows(() => quotationCargoBasisText(bad), Error, "CARGO_BASIS_INVALID");
});
Deno.test("old mono inputs do not fabricate engine provenance and an empty saved run basis is refused", () => {
  assertEquals(buildPricingCargoBasis({ inputs_json: { cargoWeight: 36, containers: [{ type: "20GP", quantity: 1 }] } }), null);
  assertThrows(() => readQuotationCargoBasis({ schema_version: 1, source: "pricing_run", source_id: "recorded-run", lots: [] }), Error, "CARGO_BASIS_INVALID");
  assertEquals(quotationCargoBasisText(buildRequestCargoBasis([])), []);
});
Deno.test("adopted operator bases keep priority over the scenario engine aggregate", () => {
  const operator = { schema_version: 1, title: "Operator scenario", revision_no: 1, calculated_at: "2026-10-08T00:00:00Z", source_run_id: "scenario-run", scope_hash: "a".repeat(64), scope: { cargo_units: [] }, assumptions: [], overlay: [], reservations: [], open_points: [] };
  assertEquals(buildPricingCargoBasis({ engine_request: { cargoWeight: 57 }, outputs_json: { operator_basis: operator } }), null);
  assertThrows(() => buildPricingCargoBasis({ engine_request: { cargoWeight: 57 }, outputs_json: { operator_basis: null } }), Error, "OPERATOR_BASIS_INVALID");
});

Deno.test("partial AIR recorded cargo stays immutable, duplicate facts stay unknown and no multi-lot globals leak", () => {
  const r = { id: "saved-air", inputs_json: { servicePackage: "AIR_IMPORT_DDP" }, engine_request: { cargoWeight: .19 },
    outputs_json: { quoteQualification: { level: "partial" } }, facts_snapshot: [
      { id: "gross", key: "cargo.weight_kg", value_number: 190 }, { id: "net", key: "cargo.weight_net_kg", value_number: 151 },
      { id: "colis", key: "cargo.pieces_count", value_number: 30 }, { id: "dim", key: "cargo.dimensions_evidence", value_json: { conflict: true } },
    ] };
  const basis = buildPricingCargoBasis(r)!;
  r.facts_snapshot[0].value_number = 999;
  assertEquals(basis.lots[0].recorded_details!.gross_kg, 190);
  assertEquals(basis.lots[0].recorded_details!.chargeable_kg, null);
  const words = quotationCargoBasisText(basis).join(" ");
  for (const text of ["poids brut 190 kg", "net 151 kg", "30 colis", "poids taxable non confirmé", "Dimensions contradictoires"]) assertStringIncludes(words, text);
  r.facts_snapshot.push({ id: "second-net", key: "cargo.weight_net_kg", value_number: 160 });
  assertEquals(buildPricingCargoBasis(r)!.lots[0].recorded_details!.net_kg, null);
  assertEquals(buildPricingCargoBasis(run())!.lots.some(l => l.recorded_details !== undefined), false);
  basis.lots[0].recorded_details!.chargeable_kg = NaN;
  assertThrows(() => readQuotationCargoBasis(basis), Error, "CARGO_BASIS_INVALID");
});

Deno.test("cargo PDF does not publish conflicted extracted taxable weight; recorded operator/validated choices survive", () => {
  const r = { engine_request: { cargoWeight: .19 }, inputs_json: { servicePackage: "AIR_IMPORT_DDP" }, outputs_json: { quoteQualification: { level: "partial" } },
    facts_snapshot: [{ key: "cargo.chargeable_weight_kg", value_number: 250, source_type: "attachment_extracted", is_validated: false },
      { key: "cargo.dimensions_evidence", value_json: { conflict: true } }] };
  assertEquals(buildPricingCargoBasis(r)!.lots[0].recorded_details!.chargeable_kg, null);
  r.facts_snapshot[0].source_type = "operator";
  assertEquals(buildPricingCargoBasis(r)!.lots[0].recorded_details!.chargeable_kg, 250);
  r.facts_snapshot[0].source_type = "attachment_extracted"; r.facts_snapshot[0].is_validated = true;
  assertEquals(buildPricingCargoBasis(r)!.lots[0].recorded_details!.chargeable_kg, 250);
});
