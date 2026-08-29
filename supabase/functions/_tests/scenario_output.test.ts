import { assert, assertEquals } from "jsr:@std/assert";
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
