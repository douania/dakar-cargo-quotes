import { assert, assertEquals } from "jsr:@std/assert";
import { storageStayInformation, unknownCarrierStayInformation } from "../_shared/stay-information.ts";
import {
  buildScenarioEmailBody,
  buildScenarioEmailSubject,
  isScenarioOutputSnapshot,
  readScenarioOutputContext,
} from "../_shared/scenario-output.ts";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    meta: {
      source_kind: "scenario",
      quoteQualification: {
        level: "partial",
        reasons: [{ code: "RATE_PENDING_CONFIRMATION" }],
        firmTotalPolicy: "excludes_reserved_items",
      },
    },
    client: { company: "Client Sandbox" },
    scenario: {
      reference: "SC-11223344-R2-E3",
      title: "Option aérienne",
      revision_no: 2,
      pricing_run_seq: 3,
      assumptions: [{ statement: "Poids supposé 1 000 kg" }],
      reservations: [{ code: "RATE_PENDING_CONFIRMATION", service_key: "TRUCKING" }],
      exclusions: [{ description: "Livraison locale", reason: "À confirmer" }],
    },
    totals: {
      firm_total_ht: 100000,
      firm_total_ttc: 118000,
      indicative_total_ht: 150000,
      indicative_total_ttc: 177000,
      currency: "XOF",
    },
    ...overrides,
  };
}

Deno.test("P1-A5 snapshot: lit le contexte non ferme et les réserves", () => {
  const source = snapshot();
  assert(isScenarioOutputSnapshot(source));
  const context = readScenarioOutputContext(source);
  assert(context);
  assertEquals(context.reference, "SC-11223344-R2-E3");
  assertEquals(context.assumptions, ["Poids supposé 1 000 kg"]);
  assertEquals(context.reservations, ["RATE_PENDING_CONFIRMATION — TRUCKING"]);
  assertEquals(context.exclusions, ["Livraison locale — À confirmer"]);
});

Deno.test("P1-A5 snapshot: refuse firm et des doubles totaux incohérents", () => {
  const firm = snapshot({
    meta: { source_kind: "scenario", quoteQualification: { level: "firm" } },
  });
  assertEquals(readScenarioOutputContext(firm), null);

  const inconsistent = snapshot({
    totals: {
      firm_total_ht: 200,
      firm_total_ttc: 200,
      indicative_total_ht: 100,
      indicative_total_ttc: 100,
      currency: "XOF",
    },
  });
  assertEquals(readScenarioOutputContext(inconsistent), null);
});

Deno.test("P1-A5 email: identifie scénario, hypothèses et caractère non ferme", () => {
  const source = snapshot();
  const context = readScenarioOutputContext(source)!;
  const subject = buildScenarioEmailSubject(context);
  const body = buildScenarioEmailBody(source, context, true);
  assert(subject.includes("partielle"));
  assert(subject.includes(context.reference));
  assert(body.includes("document de travail non ferme"));
  assert(body.includes("Hypothèses appliquées"));
  assert(body.includes("Éléments sous réserve"));
  assert(body.includes("Total indicatif du scénario TTC"));
});

Deno.test("stay output: immutable raw-line information reaches PDF context and email without altering totals", () => {
  const info = storageStayInformation({ unit_ref: "sample", equipment_code: "40HQ", quantity: 3, ownership: "COC", provider: "DPW", storage_p1_code: "412", storage_days: 10, demurrage_days: null }, 30000, true, "Sous hypothèse");
  const source = snapshot({ raw_lines: [{ category: "Magasinage", description: "Magasinage lot exemple", amount: 0, stay_information: info }] });
  const before = JSON.stringify(source);
  const context = readScenarioOutputContext(source)!;
  const body = buildScenarioEmailBody(source, context, true);
  assertEquals(context.stayInformation?.length, 1);
  for (const content of ["Franchise : 10 jours", "Du jour 11 au jour 25", "À partir du jour 41", "Non ajouté au total", "P2/P3 historiques"]) assert(body.includes(content));
  assertEquals(context.indicativeTotalHt, 150000);
  assertEquals(JSON.stringify(source), before);
  assertEquals(readScenarioOutputContext(snapshot())?.stayInformation, []);
});

Deno.test("reference output: sources and conditional examples preserved in PDF context/email, never repriced", () => {
  const info = unknownCarrierStayInformation({ carrier: null, equipment: "40HC", unit: { unit_kind: "CONTAINER", ownership: "COC", quantity: 3,
    dangerous_goods: null, temperature_control_required: false }, movement_direction: "IMPORT", destination_country: "SN", discharge_port: "Dakar", is_transit: false, as_of: "2026-09-21" })!;
  const source = snapshot({ raw_lines: [{ description: "Surestaries — lot exemple", amount: null, stay_information: info }] });
  const before = JSON.stringify(source); const context = readScenarioOutputContext(source)!;
  const body = buildScenarioEmailBody(source, context, true);
  for (const content of ["CMA CGM", "Hapag-Lloyd", "2026-09-21", "2025-01-01", "2024-05-01", "HYPOTHÉTIQUE de 25 jours", "Danger du lot inconnu", "Non ajouté au total", "https://www.bceao.int/"]) assert(body.includes(content));
  assertEquals(context.indicativeTotalHt, 150000); assertEquals(context.firmTotalHt, 100000);
  assertEquals(JSON.stringify(source), before);
});
