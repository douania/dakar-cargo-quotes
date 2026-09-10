/**
 * H2-d2 — Tests du module de dérivation du contexte d'honoraires depuis les
 * faits d'un dossier (`fee-case-facts.ts`).
 *
 * Enjeu : ce module est partagé par le chiffrage réel (`price-service-lines`)
 * et la simulation (`simulate-fee-lines`). Toute divergence ferait mentir la
 * simulation. Les cas couvrent les faits canoniques lus, leurs pièges connus
 * (conteneurs doublement encodés, poids taxable prioritaire) et la primauté de
 * l'override multi-lot.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildFeeCaseContextFromFacts,
  readContainersFact,
  readDangerousGoodsFact,
  readScopeFact,
  type FeeFactRow,
} from "./fee-case-facts.ts";

const AS_OF = "2026-09-09";

function facts(entries: Record<string, FeeFactRow>): Map<string, FeeFactRow> {
  return new Map(Object.entries(entries));
}

Deno.test("dossier import FCL complet : tous les faits canoniques sont lus", () => {
  const ctx = buildFeeCaseContextFromFacts({
    factsMap: facts({
      "service.package": { value_text: " dap_project_import " },
      "cargo.containers": { value_json: [{ type: "40HC", quantity: 2 }, { type: "20GP", quantity: 1 }] },
      "cargo.weight_kg": { value_number: 48000 },
      "cargo.caf_value": { value_number: 120000000 },
      "cargo.value": { value_number: 100000000 },
      "client.code": { value_text: "ai0cargo" },
      "customs.regime_code": { value_text: " c100 " },
    }),
    requestType: "SEA_FCL_IMPORT",
    asOfDate: AS_OF,
  });

  assertEquals(ctx.transportMode, "SEA");
  assertEquals(ctx.direction, "IMPORT");
  assertEquals(ctx.shipmentType, "FCL");
  assertEquals(ctx.customsRegimeCode, "C100");
  assertEquals(ctx.clientCode, "AI0CARGO");
  assertEquals(ctx.weightKg, 48000);
  assertEquals(ctx.cafValue, 120000000);
  assertEquals(ctx.cargoValue, 100000000);
  assertEquals(ctx.containers?.length, 2);
  assertEquals(ctx.dangerousGoods, null);
  assertEquals(ctx.asOfDate, AS_OF);
});

Deno.test("poids taxable prioritaire sur le poids brut (aérien)", () => {
  const ctx = buildFeeCaseContextFromFacts({
    factsMap: facts({
      "cargo.chargeable_weight_kg": { value_number: 1500 },
      "cargo.weight_kg": { value_number: 900 },
    }),
    requestType: "AIR_IMPORT",
    asOfDate: AS_OF,
  });

  assertEquals(ctx.weightKg, 1500);
  assertEquals(ctx.transportMode, "AIR");
});

Deno.test("poids brut utilisé quand le poids taxable est absent", () => {
  const ctx = buildFeeCaseContextFromFacts({
    factsMap: facts({ "cargo.weight_kg": { value_number: 900 } }),
    requestType: "AIR_IMPORT",
    asOfDate: AS_OF,
  });

  assertEquals(ctx.weightKg, 900);
});

Deno.test("conteneurs doublement encodés (chaîne JSON dans un champ JSON)", () => {
  const containers = readContainersFact(
    facts({ "cargo.containers": { value_json: JSON.stringify([{ type: "20GP", quantity: 3 }]) } }),
  );

  assertEquals(containers, [{ type: "20GP", quantity: 3 }]);
});

Deno.test("conteneurs illisibles : tableau vide, jamais d'invention", () => {
  assertEquals(readContainersFact(facts({ "cargo.containers": { value_json: "{ pas du json" } })), []);
  assertEquals(readContainersFact(facts({ "cargo.containers": { value_json: null } })), []);
  assertEquals(readContainersFact(facts({})), []);
});

Deno.test("quantité de conteneur absente : 1 par défaut", () => {
  const containers = readContainersFact(
    facts({ "cargo.containers": { value_json: [{ type: "40HC" }] } }),
  );

  assertEquals(containers, [{ type: "40HC", quantity: 1 }]);
});

Deno.test("périmètre dérivé du type de flux puis du package", () => {
  assertEquals(readScopeFact(facts({ "service.flow_type": { value_text: "EXPORT_SENEGAL" } })), "export");
  assertEquals(readScopeFact(facts({ "service.flow_type": { value_text: "transit mali" } })), "transit");
  assertEquals(readScopeFact(facts({ "service.package": { value_text: "EXPORT_SENEGAL" } })), "export");
  assertEquals(readScopeFact(facts({})), "import");
});

Deno.test("le périmètre sert de repli au sens quand le type de demande ne le porte pas", () => {
  const ctx = buildFeeCaseContextFromFacts({
    factsMap: facts({ "service.flow_type": { value_text: "EXPORT" } }),
    requestType: "",
    asOfDate: AS_OF,
  });

  assertEquals(ctx.direction, "EXPORT");
});

Deno.test("valeurs nulles ou négatives : inconnues, jamais zéro", () => {
  const ctx = buildFeeCaseContextFromFacts({
    factsMap: facts({
      "cargo.caf_value": { value_number: 0 },
      "cargo.value": { value_number: -5 },
      "cargo.weight_kg": { value_number: 0 },
    }),
    requestType: "SEA_FCL_IMPORT",
    asOfDate: AS_OF,
  });

  assertEquals(ctx.cafValue, null);
  assertEquals(ctx.cargoValue, null);
  assertEquals(ctx.weightKg, null);
});

Deno.test("dossier sans aucun fait : contexte entièrement inconnu, aucune invention", () => {
  const ctx = buildFeeCaseContextFromFacts({
    factsMap: facts({}),
    requestType: "",
    asOfDate: AS_OF,
  });

  assertEquals(ctx.transportMode, null);
  assertEquals(ctx.shipmentType, null);
  assertEquals(ctx.direction, "IMPORT"); // repli du périmètre par défaut
  assertEquals(ctx.customsRegimeCode, null);
  assertEquals(ctx.clientCode, null);
  assertEquals(ctx.weightKg, null);
  assertEquals(ctx.cafValue, null);
  assertEquals(ctx.cargoValue, null);
  assertEquals(ctx.containers, []);
  assertEquals(ctx.dangerousGoods, null);
});

Deno.test("override multi-lot : les conteneurs et le poids du lot priment sur les faits du dossier", () => {
  const factsMap = facts({
    "cargo.containers": { value_json: [{ type: "20GP", quantity: 10 }] },
    "cargo.weight_kg": { value_number: 200000 },
    "client.code": { value_text: "AI0CARGO" },
  });

  const ctx = buildFeeCaseContextFromFacts({
    factsMap,
    requestType: "SEA_FCL_IMPORT",
    asOfDate: AS_OF,
    override: {
      containers: [{ type: "40HC", quantity: 1 }],
      weight_kg: 18000,
    },
  });

  assertEquals(ctx.containers, [{ type: "40HC", quantity: 1 }]);
  assertEquals(ctx.weightKg, 18000);
  // Les champs absents de l'override restent lus dans les faits.
  assertEquals(ctx.clientCode, "AI0CARGO");
});

Deno.test("override multi-lot : une valeur nulle explicite écrase le fait (elle n'est pas ignorée)", () => {
  const ctx = buildFeeCaseContextFromFacts({
    factsMap: facts({ "cargo.caf_value": { value_number: 120000000 } }),
    requestType: "SEA_FCL_IMPORT",
    asOfDate: AS_OF,
    override: { caf_value: null },
  });

  assertEquals(ctx.cafValue, null);
});

Deno.test("override sans le champ concerné : le fait est conservé", () => {
  const ctx = buildFeeCaseContextFromFacts({
    factsMap: facts({ "cargo.caf_value": { value_number: 120000000 } }),
    requestType: "SEA_FCL_IMPORT",
    asOfDate: AS_OF,
    override: { containers: [] },
  });

  assertEquals(ctx.cafValue, 120000000);
});

// ── DG-1 : caractère dangereux de la marchandise ──────────────────────

Deno.test("DG-1 : le fait explicite alimente le contexte, dans les deux sens", () => {
  const oui = buildFeeCaseContextFromFacts({
    factsMap: facts({ "cargo.dangerous_goods": { value_text: "YES" } }),
    requestType: "SEA_FCL_IMPORT",
    asOfDate: AS_OF,
  });
  assertEquals(oui.dangerousGoods, true);

  const non = buildFeeCaseContextFromFacts({
    factsMap: facts({ "cargo.dangerous_goods": { value_text: "NO" } }),
    requestType: "SEA_FCL_IMPORT",
    asOfDate: AS_OF,
  });
  assertEquals(non.dangerousGoods, false);
});

Deno.test("DG-1 : fait absent, le contexte reste inconnu (règle à confirmer)", () => {
  const ctx = buildFeeCaseContextFromFacts({
    factsMap: facts({ "cargo.weight_kg": { value_number: 1000 } }),
    requestType: "SEA_FCL_IMPORT",
    asOfDate: AS_OF,
  });

  assertEquals(ctx.dangerousGoods, null);
});

Deno.test("DG-1 : repli sur la famille DP World DANGEROUS, jamais sur une autre", () => {
  assertEquals(readDangerousGoodsFact(facts({ "pricing.dthc_family": { value_text: "DANGEROUS" } })), true);
  assertEquals(readDangerousGoodsFact(facts({ "pricing.dthc_family": { value_text: "STANDARD" } })), null);
  assertEquals(readDangerousGoodsFact(facts({ "pricing.dthc_family": { value_text: "REEFER" } })), null);
});

Deno.test("DG-1 : le fait explicite prime sur la famille tarifaire", () => {
  const ctx = buildFeeCaseContextFromFacts({
    factsMap: facts({
      "cargo.dangerous_goods": { value_text: "NO" },
      "pricing.dthc_family": { value_text: "DANGEROUS" },
    }),
    requestType: "SEA_FCL_IMPORT",
    asOfDate: AS_OF,
  });

  assertEquals(ctx.dangerousGoods, false);
});

Deno.test("DG-1 : valeur illisible en base, contexte inconnu plutôt que deviné", () => {
  assertEquals(readDangerousGoodsFact(facts({ "cargo.dangerous_goods": { value_text: "à confirmer" } })), null);
  assertEquals(readDangerousGoodsFact(facts({ "cargo.dangerous_goods": { value_text: "" } })), null);
});
