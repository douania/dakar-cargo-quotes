import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeDemurrageContainerType,
  resolveDemurrageEquipment,
  resolveDemurragePendingProvenance,
  selectDemurrageRate,
} from "./demurrage-selection.ts";

const row = (carrier: string, container_type: string, id = `${carrier}-${container_type}`) => ({
  id,
  carrier,
  container_type,
  is_active: true,
});

Deno.test("surestaries: normalisation déterministe des seuls types couverts", () => {
  const cases: Array<[string, string]> = [
    ["20' Dry", "20DV"],
    ["20GP", "20DV"],
    ["40' Dry", "40DV"],
    ["40 High Cube", "40HC"],
    ["40HQ", "40HC"],
    ["20 Reefer", "20RF"],
    ["40RF", "40RF"],
    ["20 Open Top", "20OT"],
    ["40HC-OT", "40OT"],
  ];

  for (const [input, expected] of cases) {
    assertEquals(normalizeDemurrageContainerType(input), expected, input);
  }
  assertEquals(normalizeDemurrageContainerType("40FR"), null);
  assertEquals(normalizeDemurrageContainerType("palette"), null);
});

Deno.test("surestaries: équipement absent, inconnu ou mixte bloque la sélection", () => {
  assertEquals(resolveDemurrageEquipment([]).containerType, null);
  assertStringIncludes(resolveDemurrageEquipment([]).reason || "", "aucun conteneur");

  const unsupported = resolveDemurrageEquipment([{ type: "40FR", quantity: 1 }]);
  assertEquals(unsupported.containerType, null);
  assertStringIncludes(unsupported.reason || "", "non couvert");

  const mixed = resolveDemurrageEquipment([
    { type: "40DV", quantity: 1 },
    { type: "40HC", quantity: 1 },
  ]);
  assertEquals(mixed.containerType, null);
  assertStringIncludes(mixed.reason || "", "mixtes");
});

Deno.test("surestaries: plusieurs conteneurs du même type donnent un type exact", () => {
  assertEquals(
    resolveDemurrageEquipment([
      { type: "20GP", quantity: 1 },
      { type: "20DV", quantity: 2 },
    ]),
    { containerType: "20DV", reason: null },
  );
});

Deno.test("surestaries: armateur absent ne choisit jamais la première ligne ni GENERIC", () => {
  const result = selectDemurrageRate(
    [row("CMA_CGM", "20DV"), row("GENERIC", "20DV")],
    null,
    "20DV",
  );
  assertEquals(result.row, null);
  assertStringIncludes(result.reason || "", "Armateur non détecté");
});

Deno.test("surestaries: alias sûr CMA CGM et type exact sélectionnent une seule ligne", () => {
  const cma20 = row("CMA_CGM", "20DV", "cma-20");
  const result = selectDemurrageRate(
    [row("MSC", "20DV"), cma20, row("CMA CGM", "40HC")],
    "CMA CGM",
    "20DV",
  );
  assertEquals(result, { row: cma20, matchKind: "exact", reason: null });
});

Deno.test("surestaries: aucun rapprochement par sous-chaîne, type ou GENERIC", () => {
  const rows = [
    row("CMA_CGM", "20DV"),
    row("CMA_CGM", "40HC"),
    row("GENERIC", "40DV"),
  ];

  assertEquals(selectDemurrageRate(rows, "CMA", "20DV").row, null);
  assertEquals(selectDemurrageRate(rows, "CMA CGM", "40DV").row, null);
  assertEquals(selectDemurrageRate(rows, "UNKNOWN LINE", "40DV").row, null);
});

Deno.test("surestaries: collision exacte bloque au lieu de choisir arbitrairement", () => {
  const result = selectDemurrageRate(
    [row("MSC", "20DV", "a"), row("MSC", "20DV", "b")],
    "MSC",
    "20DV",
  );
  assertEquals(result.row, null);
  assertStringIncludes(result.reason || "", "Collision");
});

Deno.test("surestaries: un barème officiel reste à confirmer tant que la durée est inconnue", () => {
  assertEquals(resolveDemurragePendingProvenance("official"), {
    type: "TO_CONFIRM",
    confidence: 0.9,
  });
  assertEquals(resolveDemurragePendingProvenance("validated_internal").type, "TO_CONFIRM");
  assertEquals(resolveDemurragePendingProvenance("observed").type, "TO_CONFIRM");
});
