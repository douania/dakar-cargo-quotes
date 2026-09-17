import { assertEquals } from "jsr:@std/assert";
import { exactCandidates, aiCandidates, redact, storageContext, compatibleStorageCatalog } from "./domain.ts";
const catalog = [{ id: "a", designation_label: "Équipements électriques", storage_code_p1: "414", unit_basis: "tonne_per_day" },
  { id: "b", designation_label: "Véhicules", storage_code_p1: "421", unit_basis: "unit" }];
Deno.test("GoTrans structured target excludes furniture even when alias or AI selects it", () => {
  const furniture = { id: "f", designation_label: "Mobilier de bureau, armoires et placards", storage_code_p1: "419", unit_basis: "tonne_per_day" };
  const target = { scenario_basis: "storage cabinets", un_number: "UN3536", gross_weight_kg: 55000, weight_basis: "per_unit", quantity: 39, equipment_code: "20HQ", ownership: "SOC" };
  const allowed = compatibleStorageCatalog(target, [...catalog, furniture]);
  assertEquals(exactCandidates("storage cabinets", allowed, [{ normalized_term: "storage cabinets", terminal_designation_id: "f", is_validated: true }]), []);
  assertEquals(aiCandidates([{ designation_id: "f", justification: "cabinet signifie placard" }], allowed), []);
  assertEquals(storageContext(target).un_number, "UN3536");
  assertEquals(storageContext(target).gross_weight_kg, 55000);
  assertEquals(compatibleStorageCatalog(target, [{ id: "x", designation_label: "Armoires" }]), []);
  assertEquals(compatibleStorageCatalog(target, [{ id: "y", designation_label: "Armoires électriques" }]).length, 1);
});
Deno.test("real furniture remains eligible; neighbours never transfer electrical classification", () => {
  const furniture = { id: "f", designation_label: "Mobilier de bureau", storage_code_p1: "419", unit_basis: "tonne_per_day" };
  const target = { scenario_basis: "Wooden storage cabinets for office furniture", un_number: null };
  assertEquals(compatibleStorageCatalog(target, [furniture]), [furniture]);
  assertEquals(storageContext(target).un_number, null);
  assertEquals(compatibleStorageCatalog({ scenario_basis: "spare parts" }, [furniture]), [furniture]);
  assertEquals(compatibleStorageCatalog({ scenario_basis: "storage cabinets", gross_weight_kg: 55000 }, [furniture]), [furniture]);
});
Deno.test("storage proposal exact normalized designation and validated alias only", () => {
  assertEquals(exactCandidates("EQUIPEMENTS electriques", catalog, [])[0].method, "direct");
  assertEquals(exactCandidates("transformers", catalog, [{ normalized_term: "transformers", terminal_designation_id: "a", is_validated: false }]), []);
  assertEquals(exactCandidates("transformers", catalog, [{ normalized_term: "transformers", terminal_designation_id: "a", is_validated: true }])[0].code, "414");
  assertEquals(exactCandidates("équipements", catalog, []), []);
});
Deno.test("AI cannot invent code label or unit; unsupported units not adoptable", () => {
  const result = aiCandidates([{ designation_id: "a", code: "410", label: "invention", justification: "Nature électrique" },
    { designation_id: "b", justification: "Véhicule" }, { designation_id: "invented", justification: "Faux" }], catalog);
  assertEquals(result.length, 2); assertEquals(result[0].code, "414"); assertEquals(result[0].label, catalog[0].designation_label);
  assertEquals(result[0].applicable, true); assertEquals(result[1].applicable, false);
  assertEquals(aiCandidates([{ designation_id: "a", justification: "" }], catalog), []);
});
Deno.test("conflicting aliases remain multiple choices; redact email and links", () => {
  assertEquals(exactCandidates("x", catalog, catalog.map(d => ({ normalized_term: "x", terminal_designation_id: d.id, is_validated: true }))).length, 2);
  assertEquals(redact("test@example.com https://example.com"), "[adresse masquée] [lien masqué]");
});
