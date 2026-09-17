import { assertEquals } from "jsr:@std/assert";
import { groupEvidence } from "./evidence.ts";
const id = "11111111-1111-4111-8111-111111111111";
const mail = { id, from_address: "client@example.test", body_text: "1.13 transformers: 18t/unit, 20HQ SOC\n2.3 x 40HQ COC (spare parts): 10-15t/container" };
const groups = [
  { unit_ref: "lot-1", equipment_code: "20hq", quantity: 13, ownership: "SOC" as const, total_weight_kg: 234000, description: `e-mail ${id}; SHA256 ${"a".repeat(64)}` },
  { unit_ref: "lot-2", equipment_code: "40hq", quantity: 3, ownership: "COC" as const, total_weight_kg: 45000, description: `e-mail ${id}; SHA256 ${"a".repeat(64)}` },
];
Deno.test("PAD assistance: exact source and formula, range remains unconfirmed", () => {
  const result = groupEvidence(groups, mail.from_address, [], [mail], "a".repeat(64));
  assertEquals(result["lot-1"].excerpt, "1.13 transformers: 18t/unit, 20HQ SOC");
  assertEquals(result["lot-1"].weightDraft.includes("234"), true);
  assertEquals(result["lot-2"].weightDraft, "");
  assertEquals(result["lot-2"].warnings.some(w => w.includes("borne haute")), true);
});
Deno.test("PAD assistance: changed source hash and missing hash fail closed despite identical IDs and numbers", () => {
  assertEquals(groupEvidence(groups, mail.from_address, [], [{ ...mail, body_text: mail.body_text.replace("transformers", "furniture") }], "b".repeat(64)), {});
  assertEquals(groupEvidence(groups, mail.from_address, [], [mail]), {});
  assertEquals(groupEvidence(groups.map(g => ({ ...g, description: `e-mail ${id}` })), mail.from_address, [], [mail], "a".repeat(64)), {});
});
Deno.test("PAD assistance: wrong weight, source, sender and duplicate sources never prefill", () => {
  assertEquals(groupEvidence(groups, "other@example.test", [], [mail], "a".repeat(64)), {});
  assertEquals(groupEvidence(groups, mail.from_address, [], [mail, { ...mail, id: "other" }], "a".repeat(64)), {});
  const changed = groups.map(g => ({ ...g, total_weight_kg: 5 }));
  assertEquals(groupEvidence(changed, mail.from_address, [], [mail], "a".repeat(64)), {});
  assertEquals(groupEvidence(groups.map(g => ({ ...g, description: `e-mail 22222222-2222-4222-8222-222222222222; SHA256 ${"a".repeat(64)}` })), mail.from_address, [], [mail], "a".repeat(64)), {});
});
