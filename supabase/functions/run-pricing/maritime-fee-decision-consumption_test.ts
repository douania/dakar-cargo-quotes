import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { computeCommercialTotals } from "./commercial-totals.ts";
import { buildSupplierInvoiceTtcAttestation } from "../_shared/maritime-fee-decisions/attestation.ts";
import {
  buildMaritimeFeeConsumption,
  MARITIME_FEE_DECISION_BLOCKER_MESSAGES,
  MARITIME_FEE_DECISION_MULTI_LOT_UNSUPPORTED,
  MARITIME_FEE_DECISION_READ_FAILED,
  SUPPORTED_MARITIME_FEE_MAPPINGS,
  type PricingLineView,
} from "../_shared/maritime-fee-decisions/pricing-consumption.ts";

/**
 * P1-B2 — garde-fous côté run-pricing.
 *
 * Ce fichier épingle ce que le module PUR ne peut pas prouver seul :
 *  - toute erreur ou lecture partielle du registre bloque (fail-closed) ;
 *  - le fait que les codes de blocage émis par run-pricing portent tous un
 *    message opérateur ;
 *  - le fait que la couche `origin_layer` choisie pour la ligne ferme décidée
 *    est bien une couche COMPTÉE par `computeCommercialTotals` (une couche
 *    inconnue produirait une sous-facturation silencieuse) ;
 *  - le fait que les service_key canoniques de la table close correspondent
 *    exactement à ceux que run-pricing produit (`${CARRIER}_${CHARGE_CODE}`).
 *
 * L'Edge Function est importée pour ses helpers purs uniquement — aucun listener.
 */

Deno.env.set("RUN_PRICING_DISABLE_SERVE", "1");
const { readMaritimeFeeDecisions, canonicalizeLine } = await import("./index.ts") as unknown as {
  readMaritimeFeeDecisions: (client: unknown, caseId: string) => Promise<{readFailed: boolean; rows: unknown[]}>;
  canonicalizeLine: (
    line: Record<string, unknown>,
    context: { origin_layer: string },
  ) => Record<string, unknown>;
};

Deno.test("registre : erreur, cache absent ou lecture partielle bloquent ; vide prouvé accepté", async () => {
  for (const fixture of [
    {data: [], error: null, count: 0, blocked: false},
    {data: [], error: null, count: 1, blocked: true},
    {data: [], error: null, count: null, blocked: true},
    {data: null, error: null, count: 0, blocked: true},
    ...["42P01", "PGRST205", "42501", "57014"].map(code =>
      ({data: null, error: {code, message: "Lecture impossible"}, count: null, blocked: true})),
  ]) {
    const client = {from: (table: string) => {
      assertEquals(table, "maritime_fee_decisions");
      return {select: (columns: string, options: unknown) => {
        assert(columns.includes("proposal_snapshot"));
        assertEquals(options, {count: "exact"});
        return {eq: async (key: string, value: string) => {
          assertEquals([key, value], ["case_id", "sandbox-case"]);
          return fixture;
        }};
      }};
    }};
    const result = await readMaritimeFeeDecisions(client, "sandbox-case");
    assertEquals(result.readFailed, fixture.blocked);
  }
  const thrown = await readMaritimeFeeDecisions({from: () => {throw new Error("offline");}}, "sandbox-case");
  assertEquals(thrown.readFailed, true);
});

Deno.test("tout code de blocage émis par run-pricing porte un message opérateur", () => {
  for (const code of [MARITIME_FEE_DECISION_READ_FAILED, MARITIME_FEE_DECISION_MULTI_LOT_UNSUPPORTED]) {
    const message = MARITIME_FEE_DECISION_BLOCKER_MESSAGES[code];
    assert(typeof message === "string" && message.length > 20, `message manquant pour ${code}`);
  }
});

Deno.test("la ligne ferme décidée est comptée par computeCommercialTotals", () => {
  const decided = buildMaritimeFeeConsumption({
    decisions: [{
      id: "d1",
      decision_key: "CARRIER_DEBOURS_COMMISSION:CMA_CGM",
      proposal_id: "commission-debours",
      proposal_category: "commission_debours",
      decision_action: "confirm",
      suggested_amount_xof: 859,
      decided_amount_xof: 859,
      currency: "XOF",
      evidence_level: "validated_internal",
      source_reference: "CMA CGM local charges",
      decision_source: "Facture contrôlée",
      justification: "Commission vérifiée",
      proposal_fingerprint: "a".repeat(64),
      input_snapshot_hash: "b".repeat(64),
      decision_version: 1,
      decided_by: "11111111-1111-4111-8111-111111111111",
      created_at: "2026-08-30T10:00:00.000Z",
      proposal_snapshot: { attestation: buildSupplierInvoiceTtcAttestation({
        action: "confirm", decidedAmountXof: 859, decisionSource: "Facture contrôlée",
      }) },
    }],
    identities: [{
      decisionKey: "CARRIER_DEBOURS_COMMISSION:CMA_CGM",
      // Seule l'empreinte est lue par le module ; la proposition complète n'est
      // pas nécessaire pour ce garde-fou de totaux.
      proposal: {} as never,
      snapshot: {},
      fingerprint: "a".repeat(64),
    }],
    lines: [],
    carrierCode: "CMA_CGM",
  });

  assertEquals(decided.blockers, []);
  assertEquals(decided.lines.length, 1);

  const totals = computeCommercialTotals({
    engineTotals: { operationnel: 0, honoraires: 0, debours: 0, dap: 0, ddp: 0, local_transport_debours_ttc: 0 },
    lines: decided.lines as unknown[],
  });
  // Si la couche choisie sortait de DEBOURS_ENRICHMENT_LAYERS, ce total serait 0
  // et le montant décidé disparaîtrait du devis en silence.
  assertEquals(totals.enrichmentAmount, 859);
  assertEquals(totals.totalHt, 859);
});

Deno.test("table close : chaque service_key correspond à la clé canonique produite par run-pricing", () => {
  for (const mapping of SUPPORTED_MARITIME_FEE_MAPPINGS) {
    assertEquals(mapping.dedupGroup, mapping.serviceKey, mapping.decisionKey);
    if (mapping.kind === "commission") {
      // run-pricing nomme les lignes carrier `${normalizeCarrierCode}_${charge_code}`.
      assertEquals(
        mapping.serviceKey,
        `${mapping.carrierCode}_${mapping.chargeCode}`,
        mapping.decisionKey,
      );
      assertEquals(
        mapping.decisionKey,
        `CARRIER_DEBOURS_COMMISSION:${mapping.carrierCode}`,
      );
    }
  }

  // Correspondances INTERDITES : elles ne doivent jamais entrer dans la table.
  const keys = SUPPORTED_MARITIME_FEE_MAPPINGS.map((m) => m.decisionKey);
  for (const forbidden of ["ONE", "MSC", "MAERSK", "EVERGREEN"]) {
    assertEquals(keys.includes(`CARRIER_DEBOURS_COMMISSION:${forbidden}`), false, forbidden);
  }
  assertEquals(keys.length, 4);
});

Deno.test("la ligne PAD canonique de run-pricing porte bien le service_key attendu par la table close", () => {
  const padLine = canonicalizeLine(
    { category: "PAD_DROIT_PASSAGE", amount: 30690, source: { type: "OFFICIAL" } },
    { origin_layer: "enrichment_pad" },
  ) as unknown as PricingLineView;

  const padMapping = SUPPORTED_MARITIME_FEE_MAPPINGS.find((m) => m.kind === "pad");
  assert(padMapping);
  assertEquals(padLine.canonical?.service_key, padMapping.serviceKey);
  assertEquals(padLine.canonical?.dedup_group, padMapping.dedupGroup);
});

Deno.test("la ligne commission template de run-pricing porte bien CMA_CGM_COMM", () => {
  const commissionLine = canonicalizeLine(
    { category: "CMA_CGM_COMM", amount: 859, source: { type: "CALCULATED" } },
    { origin_layer: "enrichment_carrier_commission" },
  ) as unknown as PricingLineView;

  assertEquals(commissionLine.canonical?.service_key, "CMA_CGM_COMM");
  assertEquals(commissionLine.canonical?.dedup_group, "CMA_CGM_COMM");
});
