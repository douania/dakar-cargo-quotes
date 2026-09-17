import { assertEquals } from "jsr:@std/assert";
import { exactCandidates, aiCandidates, redact, storageContext, compatibleStorageCatalog, storageWeightCompatible } from "./domain.ts";
const catalog = [{ id: "a", designation_label: "Équipements électriques", storage_code_p1: "414", unit_basis: "tonne_per_day" },
  { id: "b", designation_label: "Véhicules", storage_code_p1: "421", unit_basis: "unit" }];
const piece = (weight: unknown) => ({ gross_weight_kg: weight, weight_basis: "per_unit", source_quantity_basis: "one_unit_per_container", scenario_basis: `1.1 motors: ${weight}kg/unit, 20GP SOC` });
Deno.test("18t transformers exclude both lighter bands even for alias and AI IDs", () => {
  const rows = ["plus de 1,500 à 3,000 kgs", "plus de 3,001 à 5,000 kgs", "plus de 5,000 kgs"].map((s, i) => ({ ...catalog[0], id: String(i), designation_label: `TRANSFORMATEURS électriques ${s}` }));
  const allowed = compatibleStorageCatalog(piece(18000), rows);
  assertEquals(allowed, [rows[2]]);
  assertEquals(exactCandidates("transformers", allowed, [{ is_validated: true, normalized_term: "transformers", terminal_designation_id: "0" }]), []);
  assertEquals(aiCandidates(rows.map(r => ({ designation_id: r.id, justification: "proche" })), allowed).map(r => r.id), ["2"]);
});
Deno.test("weight limits respect inclusive upper and strict plus-de lower bounds", () => {
  for (const [weight, expected] of [[1500, false], [1501, true], [3000, true], [3001, false]] as const) {
    assertEquals(storageWeightCompatible(piece(weight), "MOTEURS plus de 1,500 à 3,000 kgs"), expected);
  }
  assertEquals(storageWeightCompatible(piece(5000), "MOTEURS plus de 5,000 kgs"), false);
});
Deno.test("kg grouping and explicit inclusive ranges; no invented missing weight", () => {
  for (const n of ["5,000", "5.000", "5 000", "5000"]) assertEquals(storageWeightCompatible(piece(18000), `MOTEURS plus de ${n} kg`), true);
  assertEquals(storageWeightCompatible(piece(100), "MOTEURS de 100 à 200 kg"), true);
  for (const weight of [null, 0, -1, NaN, Infinity, "18000"]) assertEquals(storageWeightCompatible(piece(weight), "MOTEURS plus de 5,000 kgs"), false);
});
Deno.test("total or unspecified weight never becomes parcel weight by division", () => {
  for (const basis of ["total", null, undefined]) assertEquals(storageWeightCompatible({ gross_weight_kg: 234000, quantity: 13, weight_basis: basis }, "TRANSFORMATEURS plus de 5,000 kgs"), false);
});
Deno.test("unquantified exclusions fail closed without inventing heavy parcel threshold", () => {
  for (const weight of [100, 55000, null]) for (const label of ["APPAREILS ELECTRIQUES (sauf colis lourds)", "MOTEURS hors colis lourds", "Marchandises sauf produits dangereux"]) {
    assertEquals(storageWeightCompatible({ gross_weight_kg: weight, weight_basis: "per_unit" }, label), false);
  }
});
Deno.test("unrecognized or malformed weight restriction is not silently ignored", () => {
  for (const label of ["MOTEURS poids spécial", "MOTEURS de 5 à 3 kg", "MOTEURS plus de 1,5 kg", "MOTEURS plus de 5 tonnes", "MOTEURS 100 kg maximum", "MOTEURS plus de 5 t", "MOTEURS de moins de 3,000 kg et plus de 5,000 kg", "MOTEURS poids total moins de 10,000 kg, poids unitaire plus de 5,000 kg"]) {
    assertEquals(storageWeightCompatible(piece(18000), label), false);
  }
  assertEquals(storageWeightCompatible({}, "BATTERIES D'ACCUMULATEURS"), true);
});
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
