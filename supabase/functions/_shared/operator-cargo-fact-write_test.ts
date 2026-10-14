import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeOperatorCargoFactWrite as write, operatorCargoFactInput as input } from "./operator-cargo-fact-write.ts";

Deno.test("operator cargo: net kilograms, currency aliases and unit-bearing dimensions", () => {
  assertEquals(write("cargo.weight_net_kg", { value_number: 151 }), { ok: true, value: { value_number: 151, value_text: null, value_json: null } });
  assertEquals(input("cargo.weight_net_kg", "151,5"), write("cargo.weight_net_kg", { value_number: 151.5 }));
  assertEquals(write("cargo.weight_net_kg", { value_number: 0 }).ok, true);
  assertEquals(write("cargo.value_currency", { value_text: " eur " }), { ok: true, value: { value_number: null, value_text: "EUR", value_json: null } });
  assertEquals(write("cargo.value_currency", { value_text: "fcfa" }), { ok: true, value: { value_number: null, value_text: "XOF", value_json: null } });
  assertEquals(write("cargo.dimensions", { value_text: "48 × 36 × 29 CM x28; 44x27x24 cm x2" }), { ok: true, value: { value_number: null, value_text: "48x36x29 cm x28 ; 44x27x24 cm x2", value_json: null } });
  assertEquals(write("cargo.dimensions", { value_text: "0,48x0.36x0.29 m" }).ok, true);
  assertEquals(write("cargo.dimensions", { value_text: "480x360x290 mm x30" }).ok, true);
});

Deno.test("operator cargo: rejects absent, non-finite, negative, wrong-type and ambiguous values", () => {
  for (const value_number of [undefined, null, "151", NaN, Infinity, -1]) assertEquals(write("cargo.weight_net_kg", { value_number }).ok, false);
  for (const raw of ["", " ", "151 kg", "-1", "1e3", "Infinity"]) assertEquals(input("cargo.weight_net_kg", raw)?.ok, false);
  for (const value_text of [undefined, null, "", "GBP", "not a currency", 123]) assertEquals(write("cargo.value_currency", { value_text }).ok, false);
  for (const value_text of ["48x36x29", "48x36x29 in", "0x36x29 cm", "48x36x29 cm x0", "48x36x29 cm x1.5", "48x36x29 cm;", "48x36x29 cm arbitrary comment", "1x2x3 cm;".repeat(51)]) assertEquals(write("cargo.dimensions", { value_text }).ok, false);
  for (const key of ["cargo.dimensions", "cargo.value_currency"]) {
    assertEquals(write(key, { value_text: key.endsWith("currency") ? "EUR" : "1x2x3 cm", value_number: 1 }).ok, false);
    assertEquals(write(key, { value_text: "EUR", value_json: {} }).ok, false);
  }
  assertEquals(write("cargo.weight_net_kg", { value_number: 151, value_text: "151" }).ok, false);
  assertEquals(input("cargo.weight_kg", "unchanged legacy input"), null);
});
