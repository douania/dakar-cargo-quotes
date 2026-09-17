import { assertEquals, assertThrows } from "jsr:@std/assert";
import { matchSourceUnits, proposalFingerprint } from "./source.ts";
import { proposeGroups } from "../_shared/scenario-proposal-domain.ts";
import { storageWeightCompatible } from "./domain.ts";
const mail = { id: "11111111-1111-4111-8111-111111111111", from_address: "client@example.com", body_text:
  "1.39 storage cabinets: 55t/unit, 20HQ SOC, UN3536\n2.13 transformers: 18t/unit, 20HQ SOC\n3.3 x 40HQ COC (spare parts): 10-15t/container" };
const units = proposeGroups(mail.from_address, [mail]).groups.map(g => ({ unit_ref: g.unit_ref, quantity: g.quantity,
  equipment_code: g.equipment.toLowerCase(), ownership: g.ownership, gross_weight_kg: g.weight_kg, weight_basis: g.weight_basis,
  un_number: g.un_number, dangerous_goods: g.dangerous, imo_class: g.imo_class, scenario_basis: `e-mail ${mail.id}; SHA256 référence` }));
Deno.test("v3-style references recover separate client descriptions, never neighbouring DG", () => {
  const result = matchSourceUnits(units, mail.from_address, [], [mail]);
  assertEquals(result.length, 3);
  assertEquals(result[0].scenario_basis, mail.body_text.split("\n")[0]);
  assertEquals(result[1].scenario_basis.includes("transformers"), true);
  assertEquals(result[2].un_number, null);
  assertEquals(storageWeightCompatible(result[1], "TRANSFORMATEURS plus de 5,000 kgs"), true);
  assertEquals(storageWeightCompatible(result[2], "PIECES plus de 5,000 kgs"), false);
});
Deno.test("exact container mass and upper bound of unit range are not a piece mass", () => {
  for (const body_text of ["1.3 x 40HQ COC (spare parts): 15t/container", "1.3 transformers: 10-15t/unit, 20HQ SOC"]) {
    const email = { ...mail, body_text };
    const groups = proposeGroups(mail.from_address, [email]).groups;
    assertEquals(groups.length, 1);
    const scope = groups.map(g => ({ unit_ref: g.unit_ref, quantity: g.quantity, equipment_code: g.equipment, ownership: g.ownership, gross_weight_kg: g.weight_kg, weight_basis: g.weight_basis, un_number: g.un_number, dangerous_goods: g.dangerous, imo_class: g.imo_class, scenario_basis: `e-mail ${mail.id}` }));
    const result = matchSourceUnits(scope, mail.from_address, [], [email]);
    assertEquals(storageWeightCompatible(result[0], "PIECES plus de 5,000 kgs"), false);
  }
});
Deno.test("source join refuses identity, quantity, weight, equipment, ONU, email and ambiguous revisions", () => {
  assertThrows(() => matchSourceUnits(units, "other@example.com", [], [mail]));
  for (const change of [{ quantity: 40 }, { gross_weight_kg: 1 }, { equipment_code: "40hq" }, { un_number: null }, { scenario_basis: "Mobilier de bureau" }, { scenario_basis: "e-mail 22222222-2222-4222-8222-222222222222" }]) {
    assertThrows(() => matchSourceUnits([{ ...units[0], ...change }, ...units.slice(1)], mail.from_address, [], [mail]));
  }
  assertThrows(() => matchSourceUnits(units, mail.from_address, [], [mail, { ...mail, id: "second" }]));
  assertThrows(() => matchSourceUnits(units, mail.from_address, [], [{ ...mail, body_text: "Correction\n" + mail.body_text }]));
});
Deno.test("source fingerprint changes even when only another group's description changes", async () => {
  assertEquals(await proposalFingerprint({}, [mail]) === await proposalFingerprint({}, [{ ...mail, body_text: mail.body_text.replace("transformers", "furniture") }]), false);
});
