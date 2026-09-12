import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { scopeImoFactsForLot } from "../_shared/imo-pricing-facts.ts";
import { isDangerousForEngine } from "../_shared/dangerous-goods.ts";
import { resolveImoTerminalRule } from "../_shared/imo-terminal-rules.ts";
import { resolveDpwDthcTariff, DPW_DTHC_SOURCE_DOCUMENT } from "../_shared/dpw-dthc-tariff.ts";

Deno.env.set("RUN_PRICING_DISABLE_SERVE", "1");
const { buildPricingInputs, mergeFactsForLot } = await import("./index.ts");

Deno.test("IMO-UN-AUTO : le vrai adaptateur run-pricing transmet classe, danger et source depuis ONU seul", () => {
  const facts = [{ fact_key: "cargo.un_number", value_text: "UN3536" }];
  const inputs = buildPricingInputs(facts);
  assertEquals(inputs.imoClass, "9");
  assertEquals(inputs.unNumber, "UN3536");
  assertEquals(isDangerousForEngine(inputs.dangerousGoods, inputs.dthcFamily, inputs.imoClass), true);
  assertEquals(inputs.imoResolution?.classification.source?.amendment, "42-24");
  assertEquals(inputs.imoResolution?.blockers, []);
  assertEquals(facts.length, 1);
  const storage = resolveImoTerminalRule([{
    imdg_class: "9", un_scope: "ALL", storage_regime: "MAX_3_DAYS", storage_max_days: 3,
    pad_prior_approval: "YES", firefighter_supervision: false, transshipment_max_days: 7,
  }], inputs.imoClass, inputs.unNumber);
  assertEquals(storage.storageMaxDays, 3);
});

Deno.test("IMO-UN-AUTO : contradiction détectable avant le moteur, sans classe effective trompeuse", () => {
  const inputs = buildPricingInputs([
    { fact_key: "cargo.un_number", value_text: "UN3536" },
    { fact_key: "cargo.imo_class", value_text: "3" },
  ]);
  assertEquals(inputs.imoClass, undefined);
  assertEquals(inputs.imoResolution?.blockers, ["IMO_CLASSIFICATION_CONFLICT"]);
});

Deno.test("IMO-UN-AUTO : vraie fusion de lot, aucune contamination de l'ONU/classe/danger globaux", () => {
  const global = [
    { fact_key: "cargo.un_number", value_text: "UN3536" },
    { fact_key: "cargo.imo_class", value_text: "9" },
    { fact_key: "cargo.dangerous_goods", value_text: "YES" },
  ];
  const local = [{ key: "cargo.dangerous_goods", value: "NO", valueType: "text" }];
  const scoped = scopeImoFactsForLot(mergeFactsForLot(global, local), local);
  const inputs = buildPricingInputs(scoped.facts);
  assertEquals(scoped.blockers, []);
  assertEquals(inputs.imoClass, undefined);
  assertEquals(inputs.unNumber, undefined);
  assertEquals(isDangerousForEngine(inputs.dangerousGoods, inputs.dthcFamily, inputs.imoClass), false);
  assertEquals(global[2].value_text, "YES");
});

Deno.test("IMO-UN-AUTO : l'adaptateur préserve un dossier historique sans numéro ONU", () => {
  const inputs = buildPricingInputs([{ fact_key: "cargo.imo_class", value_text: "9" }]);
  assertEquals(inputs.imoClass, "9");
  assertEquals(inputs.imoResolution?.classification.status, "DECLARED");
  assertEquals(inputs.imoResolution?.blockers, []);
});

Deno.test("IMO-UN-AUTO : ONU seul active le tarif dangereux existant, sans inventer le cumul spécial", () => {
  const inputs = buildPricingInputs([{ fact_key: "cargo.un_number", value_text: "UN3536" }]);
  const isDangerous = isDangerousForEngine(inputs.dangerousGoods, inputs.dthcFamily, inputs.imoClass);
  const tariffs = [{
    provider: "DPW", category: "THC", operation_type: "IMPORT", cargo_type: "DANGEROUS",
    classification: "Produits dangereux (IMDG classe 1-9)", amount: 155000, unit: "EVP",
    surcharge_percent: 50, source_document: DPW_DTHC_SOURCE_DOCUMENT,
    effective_date: "2024-04-06", is_active: true, evidence_level: "official",
  }];
  const standard = resolveDpwDthcTariff(tariffs, {
    scope: "import", containers: [{ type: "20HQ", quantity: 1 }], isDangerous, asOfDate: "2026-09-12",
  });
  assertEquals(standard.status, "RESOLVED");
  if (standard.status === "RESOLVED") {
    assertEquals(standard.family, "DANGEROUS");
    assertEquals(standard.amount, 232500);
  }
  assertEquals(resolveDpwDthcTariff(tariffs, {
    scope: "import", containers: [{ type: "20FL", quantity: 1 }], isDangerous, asOfDate: "2026-09-12",
  }).status, "TO_CONFIRM");
});
