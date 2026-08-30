/**
 * P1-B2 — tests de la consommation des décisions humaines maritimes.
 *
 * Ce qui est épinglé ici, frais par frais :
 *  - PAD : une confirmation FRAÎCHE et STRICTEMENT ÉGALE atteste la ligne
 *    officielle sans en changer un centime ; tout le reste (périmé, divergent,
 *    ajusté, rejeté) bloque ; révocation/absence laissent UNE seule ligne PAD,
 *    non annotée ;
 *  - commissions CMA / Grimaldi / Hapag : jamais fermes sans décision courante
 *    et fraîche, exactement UNE ligne ferme avec décision, dédoublonnage des
 *    lignes template/structurelles, rejet = frais exclu non compté ;
 *  - ONE / MSC / carrier inconnu : toute décision active bloque ;
 *  - `service.overrides.remove` gagne toujours ;
 *  - multi-lot avec décision active : fail-closed ;
 *  - totaux : aucun double comptage, aucune contamination par les états
 *    provisoires/exclus.
 *
 * Les empreintes ne sont jamais écrites en dur : elles sont RECALCULÉES par le
 * module partagé B1, donc un test vert prouve que run-pricing et
 * manage-maritime-fee-decision parlent bien de la même proposition.
 *
 * Run:
 *   deno test --allow-env --no-check --node-modules-dir=none --no-lock \
 *     supabase/functions/_shared/maritime-fee-decisions/pricing-consumption_test.ts
 */

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildMaritimeFeeProposals,
  type MaritimeFeeInput,
  type Parametrage,
} from "../maritime-fee-proposals/engine.ts";
import parametrageJson from "../maritime-fee-proposals/dcq_pad_parametrage.json" with {
  type: "json",
};
import {
  computeCurrentProposalIdentities,
  type CurrentProposalIdentity,
} from "./proposal-identity.ts";
import {
  buildMaritimeFeeConsumption,
  hasActiveMaritimeDecision,
  MARITIME_FEE_DECISION_AMBIGUOUS_TARGET,
  MARITIME_FEE_DECISION_AMOUNT_MISMATCH,
  MARITIME_FEE_DECISION_DUPLICATE_FIRM_LINE,
  MARITIME_FEE_DECISION_INCOHERENT,
  MARITIME_FEE_DECISION_PAD_NOT_ATTESTABLE,
  MARITIME_FEE_DECISION_STALE,
  MARITIME_FEE_DECISION_TARGET_LINE_MISSING,
  MARITIME_FEE_DECISION_UNSUPPORTED_MAPPING,
  type MaritimeFeeConsumptionEntry,
  type MaritimeFeeConsumptionResult,
  type MaritimeFeeDecisionRow,
  type PricingLineView,
  selectCurrentMaritimeDecisions,
} from "./pricing-consumption.ts";
import { computeCommercialTotals } from "../../run-pricing/commercial-totals.ts";
import { buildSupplierInvoiceTtcAttestation } from "./attestation.ts";
import { readOverridesFromFacts, resolveExplicitlyRemovedServiceKeys } from "../service-scope.ts";

const PARAMETRAGE = parametrageJson as unknown as Parametrage;

const PAD_KEY = "PAD_DROIT_PASSAGE";
const CMA_KEY = "CARRIER_DEBOURS_COMMISSION:CMA_CGM";
const GRIMALDI_KEY = "CARRIER_DEBOURS_COMMISSION:GRIMALDI";
const HAPAG_KEY = "CARRIER_DEBOURS_COMMISSION:HAPAG_LLOYD";
const ONE_KEY = "CARRIER_DEBOURS_COMMISSION:ONE";
const MSC_KEY = "CARRIER_DEBOURS_COMMISSION:MSC";

// T04 / import_conteneurs = 3069 FCFA/t × 10 t = 30 690 FCFA.
const PAD_AMOUNT = 30690;
// CMA : 2,8 % de la taxe de port = round(0.028 × 30690) = 859.
const CMA_SUGGESTED = 859;

function importInput(overrides: Partial<MaritimeFeeInput> = {}): MaritimeFeeInput {
  return {
    operation_type: "IMPORT",
    cargo_mode: "CONTENEUR",
    carrier: "CMA CGM",
    pad_category: "T04",
    tonnage: 10,
    seafreight: null,
    usdToXofRate: null,
    ...overrides,
  };
}

async function identitiesFor(
  input: MaritimeFeeInput,
): Promise<CurrentProposalIdentity[]> {
  const { proposals } = buildMaritimeFeeProposals(input, PARAMETRAGE);
  return await computeCurrentProposalIdentities(input, proposals);
}

function identity(
  identities: CurrentProposalIdentity[],
  decisionKey: string,
): CurrentProposalIdentity {
  const found = identities.find((i) => i.decisionKey === decisionKey);
  assert(found, `identité absente pour ${decisionKey}`);
  return found;
}

function decisionRow(
  overrides: Partial<MaritimeFeeDecisionRow> & { decision_key: string },
): MaritimeFeeDecisionRow {
  const row: MaritimeFeeDecisionRow = {
    id: "decision-1",
    proposal_id: "pad-taxe-de-port",
    proposal_category: "taxe_de_port",
    decision_action: "confirm",
    suggested_amount_xof: null,
    decided_amount_xof: null,
    currency: "XOF",
    evidence_level: "official",
    source_reference: "PAD Redevances Portuaires 2006",
    decision_source: "Facture fournisseur contrôlée",
    justification: "Montant vérifié par l'opérateur",
    proposal_fingerprint: "0".repeat(64),
    input_snapshot_hash: "1".repeat(64),
    decision_version: 1,
    decided_by: "11111111-1111-4111-8111-111111111111",
    created_at: "2026-08-30T10:00:00.000Z",
    ...overrides,
  };
  if (row.proposal_category === "commission_debours" &&
    (row.decision_action === "confirm" || row.decision_action === "adjust") &&
    overrides.proposal_snapshot === undefined) {
    row.proposal_snapshot = { attestation: buildSupplierInvoiceTtcAttestation({
      action: row.decision_action,
      decidedAmountXof: row.decided_amount_xof as number,
      decisionSource: row.decision_source,
    }) };
  }
  return row;
}

/** Ligne PAD officielle telle que `enrichment_pad` la produit. */
function padLine(amount: number, sourceType = "OFFICIAL"): PricingLineView {
  return {
    category: "PAD_DROIT_PASSAGE",
    label: "Droit de passage PAD T04",
    description: "Droit de passage PAD T04",
    amount,
    currency: "FCFA",
    unit: "tonne",
    quantity: 10,
    unitPrice: 3069,
    source: { type: sourceType, reference: "Fact dossier PAD", confidence: 1 },
    isEditable: false,
    canonical: {
      service_key: "PAD_DROIT_PASSAGE",
      dedup_group: "PAD_DROIT_PASSAGE",
      origin_layer: "enrichment_pad",
      source_system: "fact_dossier",
      source_table: null,
      pricing_method: "fact_based",
    },
  };
}

/** Ligne CMA FERME telle que le template la produisait avant P1-B2. */
function cmaTemplateLine(amount: number): PricingLineView {
  return {
    category: "CMA_CGM_COMM",
    label: "Commission sur débours CMA CGM",
    description: "Commission sur débours CMA CGM — 2.8% sur PAD_DROIT_PASSAGE",
    amount,
    currency: "FCFA",
    source: {
      type: "CALCULATED",
      reference: "CMA CGM/CNC SENEGAL LOCAL CHARGES",
      confidence: 1,
      table: "carrier_billing_templates",
    },
    isEditable: false,
    canonical: {
      service_key: "CMA_CGM_COMM",
      dedup_group: "CMA_CGM_COMM",
      origin_layer: "enrichment_carrier_commission",
      source_system: "carrier_billing_templates",
      source_table: "carrier_billing_templates",
      pricing_method: "percentage_on_pad",
    },
  };
}

/** Ligne PERCENTAGE non ferme telle que `enrichment_carrier_charges` la produit. */
function carrierChargeToConfirmLine(serviceKey: string): PricingLineView {
  return {
    category: serviceKey,
    label: serviceKey,
    description: `${serviceKey} — À confirmer : PERCENTAGE`,
    amount: 0,
    currency: "XOF",
    source: {
      type: "TO_CONFIRM",
      reference: "carrier_billing_templates",
      confidence: 0,
      table: "carrier_billing_templates",
    },
    isEditable: true,
    canonical: {
      service_key: serviceKey,
      dedup_group: serviceKey,
      origin_layer: "enrichment_carrier_charges",
      source_system: "carrier_billing_templates",
      source_table: "carrier_billing_templates",
      pricing_method: "to_confirm",
    },
  };
}

/** Ligne structurelle moteur du même frais : service_key canonique `null`. */
function engineCommLine(
  amount: number | null,
  sourceType = "TO_CONFIRM",
): PricingLineView {
  return {
    id: "carrier_comm_to_confirm_3",
    bloc: "operationnel",
    category: "Compagnie Maritime",
    description: "Commission sur débours",
    amount,
    currency: "XOF",
    source: { type: sourceType, reference: "quotation-engine", confidence: 0 },
    isEditable: true,
    canonical: {
      service_key: null,
      dedup_group: null,
      origin_layer: "engine_structural",
      source_system: "quotation-engine",
      source_table: null,
      pricing_method: "to_confirm",
    },
  };
}

function lineFor(
  lines: PricingLineView[],
  serviceKey: string,
): PricingLineView[] {
  return lines.filter((l) => l?.canonical?.service_key === serviceKey);
}

function entryFor(
  result: MaritimeFeeConsumptionResult,
  key: string,
): MaritimeFeeConsumptionEntry | undefined {
  return result.entries.find((e) => e.decision_key === key);
}

// ═══════════════════════════════════════════════════════════════════════════
// PAD — la ligne canonique est souveraine
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("PAD confirm frais + montant exact : atteste sans aucun delta", async () => {
  const input = importInput();
  const identities = await identitiesFor(input);
  const padIdentity = identity(identities, PAD_KEY);
  assertEquals(padIdentity.proposal.suggested_amount_xof, PAD_AMOUNT);

  const lines = [padLine(PAD_AMOUNT)];
  const result = buildMaritimeFeeConsumption({
    decisions: [decisionRow({
      decision_key: PAD_KEY,
      decision_action: "confirm",
      suggested_amount_xof: PAD_AMOUNT,
      decided_amount_xof: PAD_AMOUNT,
      proposal_fingerprint: padIdentity.fingerprint,
    })],
    identities,
    lines,
    carrierCode: "CMA_CGM",
  });

  assertEquals(result.blockers, []);
  assertEquals(result.lines.length, 1);
  const attested = lineFor(result.lines, "PAD_DROIT_PASSAGE")[0];
  // Montant, source et bloc canonique STRICTEMENT inchangés.
  assertEquals(attested.amount, PAD_AMOUNT);
  assertEquals(attested.source?.type, "OFFICIAL");
  assertEquals(attested.canonical?.origin_layer, "enrichment_pad");
  const provenance = attested.maritime_fee_decision as MaritimeFeeConsumptionEntry;
  assert(provenance.decision);
  assertEquals(provenance.state, "attested");
  assertEquals(provenance.decision.action, "confirm");
  assertEquals(provenance.decision.version, 1);
  assertEquals(provenance.decision.proposal_fingerprint, padIdentity.fingerprint);
  assertEquals(entryFor(result, PAD_KEY)?.state, "attested");
});

Deno.test("PAD confirm au mauvais montant : bloque, ligne intacte", async () => {
  const input = importInput();
  const identities = await identitiesFor(input);
  const padIdentity = identity(identities, PAD_KEY);
  const lines = [padLine(PAD_AMOUNT)];

  const result = buildMaritimeFeeConsumption({
    decisions: [decisionRow({
      decision_key: PAD_KEY,
      decision_action: "confirm",
      suggested_amount_xof: PAD_AMOUNT + 1,
      decided_amount_xof: PAD_AMOUNT + 1,
      proposal_fingerprint: padIdentity.fingerprint,
    })],
    identities,
    lines,
  });

  assertEquals(result.blockers, [MARITIME_FEE_DECISION_AMOUNT_MISMATCH]);
  assertStrictEquals(result.lines[0], lines[0]);
  assertEquals(result.lines[0].maritime_fee_decision, undefined);
});

Deno.test("PAD confirm périmé (faits modifiés depuis) : bloque", async () => {
  const before = await identitiesFor(importInput({ tonnage: 10 }));
  const staleFingerprint = identity(before, PAD_KEY).fingerprint;
  // Le tonnage a changé après la décision : l'empreinte courante diffère.
  const after = await identitiesFor(importInput({ tonnage: 12 }));
  assert(identity(after, PAD_KEY).fingerprint !== staleFingerprint);

  const result = buildMaritimeFeeConsumption({
    decisions: [decisionRow({
      decision_key: PAD_KEY,
      decision_action: "confirm",
      suggested_amount_xof: PAD_AMOUNT,
      decided_amount_xof: PAD_AMOUNT,
      proposal_fingerprint: staleFingerprint,
    })],
    identities: after,
    lines: [padLine(3069 * 12)],
  });

  assertEquals(result.blockers, [MARITIME_FEE_DECISION_STALE]);
});

Deno.test("PAD adjust et PAD reject bloquent : le barème officiel fait foi", async () => {
  const identities = await identitiesFor(importInput());
  const fingerprint = identity(identities, PAD_KEY).fingerprint;

  for (const action of ["adjust", "reject"] as const) {
    const result = buildMaritimeFeeConsumption({
      decisions: [decisionRow({
        decision_key: PAD_KEY,
        decision_action: action,
        suggested_amount_xof: action === "adjust" ? PAD_AMOUNT : null,
        decided_amount_xof: action === "adjust" ? 25000 : null,
        proposal_fingerprint: fingerprint,
      })],
      identities,
      lines: [padLine(PAD_AMOUNT)],
    });
    assertEquals(
      result.blockers,
      [MARITIME_FEE_DECISION_PAD_NOT_ATTESTABLE],
      `action=${action}`,
    );
  }
});

Deno.test("PAD revoke et absence : une seule ligne officielle, non annotée", async () => {
  const identities = await identitiesFor(importInput());
  const fingerprint = identity(identities, PAD_KEY).fingerprint;

  const revoked = buildMaritimeFeeConsumption({
    decisions: [
      decisionRow({
        decision_key: PAD_KEY,
        id: "d1",
        decision_version: 1,
        decision_action: "confirm",
        suggested_amount_xof: PAD_AMOUNT,
        decided_amount_xof: PAD_AMOUNT,
        proposal_fingerprint: fingerprint,
      }),
      decisionRow({
        decision_key: PAD_KEY,
        id: "d2",
        decision_version: 2,
        decision_action: "revoke",
        suggested_amount_xof: PAD_AMOUNT,
        decided_amount_xof: null,
        proposal_fingerprint: fingerprint,
      }),
    ],
    identities,
    lines: [padLine(PAD_AMOUNT)],
  });

  assertEquals(revoked.blockers, []);
  assertEquals(lineFor(revoked.lines, "PAD_DROIT_PASSAGE").length, 1);
  assertEquals(revoked.lines[0].amount, PAD_AMOUNT);
  assertEquals(entryFor(revoked, PAD_KEY)?.state, "canonical_unattested");
  assertEquals(entryFor(revoked, PAD_KEY)?.amount_xof, null);

  const absent = buildMaritimeFeeConsumption({
    decisions: [],
    identities: [],
    lines: [padLine(PAD_AMOUNT)],
  });
  assertEquals(absent.blockers, []);
  assertEquals(lineFor(absent.lines, "PAD_DROIT_PASSAGE").length, 1);
  assertEquals(absent.lines[0].amount, PAD_AMOUNT);
  assertEquals(entryFor(absent, PAD_KEY)?.state, "canonical_unattested");
});

Deno.test("PAD confirm sans ligne PAD produite : bloque au lieu d'inventer", async () => {
  const identities = await identitiesFor(importInput());
  const result = buildMaritimeFeeConsumption({
    decisions: [decisionRow({
      decision_key: PAD_KEY,
      decision_action: "confirm",
      suggested_amount_xof: PAD_AMOUNT,
      decided_amount_xof: PAD_AMOUNT,
      proposal_fingerprint: identity(identities, PAD_KEY).fingerprint,
    })],
    identities,
    lines: [],
  });
  assertEquals(result.blockers, [MARITIME_FEE_DECISION_TARGET_LINE_MISSING]);
  assertEquals(result.lines.length, 0);
});

Deno.test("PAD confirm avec deux lignes PAD : ambiguïté bloquante, jamais de 2e ligne PAD", async () => {
  const identities = await identitiesFor(importInput());
  const result = buildMaritimeFeeConsumption({
    decisions: [decisionRow({
      decision_key: PAD_KEY,
      decision_action: "confirm",
      suggested_amount_xof: PAD_AMOUNT,
      decided_amount_xof: PAD_AMOUNT,
      proposal_fingerprint: identity(identities, PAD_KEY).fingerprint,
    })],
    identities,
    lines: [padLine(PAD_AMOUNT), padLine(0, "TO_CONFIRM")],
  });
  assertEquals(result.blockers, [MARITIME_FEE_DECISION_AMBIGUOUS_TARGET]);
  assertEquals(lineFor(result.lines, "PAD_DROIT_PASSAGE").length, 2);
});

// ═══════════════════════════════════════════════════════════════════════════
// Commissions supportées — jamais fermes sans décision
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("CMA sans décision : la ligne template cesse d'être ferme et n'est plus comptée", () => {
  const lines = [padLine(PAD_AMOUNT), cmaTemplateLine(CMA_SUGGESTED)];
  const result = buildMaritimeFeeConsumption({
    decisions: [],
    identities: [],
    lines,
    carrierCode: "CMA_CGM",
  });

  assertEquals(result.blockers, []);
  const cma = lineFor(result.lines, "CMA_CGM_COMM");
  assertEquals(cma.length, 1);
  assertEquals(cma[0].amount, 0);
  assertEquals(cma[0].source?.type, "TO_CONFIRM");
  assertEquals((cma[0].maritime_fee_decision as Record<string, unknown>).state, "not_firm");
  // Le montant template reste lisible pour l'opérateur, sans peser un centime.
  assertEquals((cma[0].maritime_fee_decision as Record<string, unknown>).neutralized_amount_xof, CMA_SUGGESTED);
  assertEquals(entryFor(result, CMA_KEY)?.state, "not_firm");
});

Deno.test("CMA revoke : retour à l'état non ferme, non compté", async () => {
  const identities = await identitiesFor(importInput());
  const fingerprint = identity(identities, CMA_KEY).fingerprint;
  const result = buildMaritimeFeeConsumption({
    decisions: [
      decisionRow({
        decision_key: CMA_KEY,
        id: "c1",
        decision_version: 1,
        proposal_id: "commission-debours",
        proposal_category: "commission_debours",
        decision_action: "confirm",
        suggested_amount_xof: CMA_SUGGESTED,
        decided_amount_xof: CMA_SUGGESTED,
        proposal_fingerprint: fingerprint,
      }),
      decisionRow({
        decision_key: CMA_KEY,
        id: "c2",
        decision_version: 2,
        proposal_id: "commission-debours",
        proposal_category: "commission_debours",
        decision_action: "revoke",
        suggested_amount_xof: CMA_SUGGESTED,
        decided_amount_xof: null,
        proposal_fingerprint: fingerprint,
      }),
    ],
    identities,
    lines: [padLine(PAD_AMOUNT), cmaTemplateLine(CMA_SUGGESTED)],
    carrierCode: "CMA_CGM",
  });

  assertEquals(result.blockers, []);
  const cma = lineFor(result.lines, "CMA_CGM_COMM");
  assertEquals(cma.length, 1);
  assertEquals(cma[0].amount, 0);
  assertEquals(entryFor(result, CMA_KEY)?.state, "not_firm");
});

Deno.test("CMA reject : frais explicitement exclu, non compté", async () => {
  const identities = await identitiesFor(importInput());
  const result = buildMaritimeFeeConsumption({
    decisions: [decisionRow({
      decision_key: CMA_KEY,
      proposal_id: "commission-debours",
      proposal_category: "commission_debours",
      decision_action: "reject",
      suggested_amount_xof: CMA_SUGGESTED,
      decided_amount_xof: null,
      proposal_fingerprint: identity(identities, CMA_KEY).fingerprint,
    })],
    identities,
    lines: [padLine(PAD_AMOUNT), cmaTemplateLine(CMA_SUGGESTED)],
    carrierCode: "CMA_CGM",
  });

  assertEquals(result.blockers, []);
  const cma = lineFor(result.lines, "CMA_CGM_COMM");
  assertEquals(cma.length, 1);
  assertEquals(cma[0].amount, 0);
  assertEquals(cma[0].source?.type, "TO_CONFIRM");
  assertEquals(entryFor(result, CMA_KEY)?.state, "excluded");
  assertEquals(entryFor(result, CMA_KEY)?.amount_xof, null);
});

Deno.test("CMA confirm : exactement UNE ligne ferme, template et ligne moteur dédoublonnés", async () => {
  const identities = await identitiesFor(importInput());
  const result = buildMaritimeFeeConsumption({
    decisions: [decisionRow({
      decision_key: CMA_KEY,
      proposal_id: "commission-debours",
      proposal_category: "commission_debours",
      decision_action: "confirm",
      suggested_amount_xof: CMA_SUGGESTED,
      decided_amount_xof: CMA_SUGGESTED,
      proposal_fingerprint: identity(identities, CMA_KEY).fingerprint,
    })],
    identities,
    lines: [padLine(PAD_AMOUNT), cmaTemplateLine(CMA_SUGGESTED), engineCommLine(null)],
    carrierCode: "CMA_CGM",
  });

  assertEquals(result.blockers, []);
  const cma = lineFor(result.lines, "CMA_CGM_COMM");
  assertEquals(cma.length, 1);
  assertEquals(cma[0].amount, CMA_SUGGESTED);
  assertEquals(cma[0].currency, "XOF");
  assertEquals(cma[0].canonical?.dedup_group, "CMA_CGM_COMM");
  assertEquals(cma[0].canonical?.origin_layer, "enrichment_carrier_commission");
  assertEquals(cma[0].canonical?.source_system, "maritime_fee_decisions");
  assertEquals(cma[0].canonical?.pricing_method, "human_decision");
  // La ligne structurelle « Compagnie Maritime » du même frais a disparu.
  assertEquals(result.lines.filter((l) => l.id === "carrier_comm_to_confirm_3").length, 0);
  assertEquals(result.lines.length, 2);
  assertEquals(entryFor(result, CMA_KEY)?.state, "firm");
});

Deno.test("CMA adjust : la ligne ferme porte le montant humain, pas la suggestion", async () => {
  const identities = await identitiesFor(importInput());
  const result = buildMaritimeFeeConsumption({
    decisions: [decisionRow({
      decision_key: CMA_KEY,
      proposal_id: "commission-debours",
      proposal_category: "commission_debours",
      decision_action: "adjust",
      suggested_amount_xof: CMA_SUGGESTED,
      decided_amount_xof: 1200,
      proposal_fingerprint: identity(identities, CMA_KEY).fingerprint,
    })],
    identities,
    lines: [padLine(PAD_AMOUNT), cmaTemplateLine(CMA_SUGGESTED)],
    carrierCode: "CMA_CGM",
  });

  assertEquals(result.blockers, []);
  const cma = lineFor(result.lines, "CMA_CGM_COMM");
  assertEquals(cma.length, 1);
  assertEquals(cma[0].amount, 1200);
  assertEquals(entryFor(result, CMA_KEY)?.amount_xof, 1200);
});

Deno.test("Grimaldi et Hapag : non fermes sans décision, une seule ligne ferme avec décision", async () => {
  const grimaldiInput = importInput({ carrier: "GRIMALDI" });
  const grimaldiIdentities = await identitiesFor(grimaldiInput);
  const grimaldiSuggested = identity(grimaldiIdentities, GRIMALDI_KEY).proposal
    .suggested_amount_xof;
  assert(typeof grimaldiSuggested === "number" && grimaldiSuggested > 0);

  const withoutDecision = buildMaritimeFeeConsumption({
    decisions: [],
    identities: [],
    lines: [padLine(PAD_AMOUNT), carrierChargeToConfirmLine("GRIMALDI_COMM")],
    carrierCode: "GRIMALDI",
  });
  assertEquals(withoutDecision.blockers, []);
  assertEquals(lineFor(withoutDecision.lines, "GRIMALDI_COMM")[0].amount, 0);
  assertEquals(entryFor(withoutDecision, GRIMALDI_KEY)?.state, "not_firm");

  const withDecision = buildMaritimeFeeConsumption({
    decisions: [decisionRow({
      decision_key: GRIMALDI_KEY,
      proposal_id: "commission-debours",
      proposal_category: "commission_debours",
      decision_action: "confirm",
      evidence_level: "validated_internal",
      suggested_amount_xof: grimaldiSuggested,
      decided_amount_xof: grimaldiSuggested,
      proposal_fingerprint: identity(grimaldiIdentities, GRIMALDI_KEY).fingerprint,
    })],
    identities: grimaldiIdentities,
    lines: [padLine(PAD_AMOUNT), carrierChargeToConfirmLine("GRIMALDI_COMM")],
    carrierCode: "GRIMALDI",
  });
  assertEquals(withDecision.blockers, []);
  const grimaldiLines = lineFor(withDecision.lines, "GRIMALDI_COMM");
  assertEquals(grimaldiLines.length, 1);
  assertEquals(grimaldiLines[0].amount, grimaldiSuggested);

  // Hapag : base seafreight, donc un fret est nécessaire à la proposition.
  const hapagInput = importInput({
    carrier: "Hapag-Lloyd",
    seafreight: { value: 2000000, currency: "XOF" },
  });
  const hapagIdentities = await identitiesFor(hapagInput);
  const hapagSuggested = identity(hapagIdentities, HAPAG_KEY).proposal
    .suggested_amount_xof;
  assertEquals(hapagSuggested, 70000); // 3,5 % × 2 000 000

  const hapagResult = buildMaritimeFeeConsumption({
    decisions: [decisionRow({
      decision_key: HAPAG_KEY,
      proposal_id: "commission-debours",
      proposal_category: "commission_debours",
      decision_action: "confirm",
      suggested_amount_xof: hapagSuggested,
      decided_amount_xof: hapagSuggested,
      proposal_fingerprint: identity(hapagIdentities, HAPAG_KEY).fingerprint,
    })],
    identities: hapagIdentities,
    lines: [padLine(PAD_AMOUNT), carrierChargeToConfirmLine("HAPAG_LLOYD_COLL")],
    carrierCode: "HAPAG_LLOYD",
  });
  assertEquals(hapagResult.blockers, []);
  const hapagLines = lineFor(hapagResult.lines, "HAPAG_LLOYD_COLL");
  assertEquals(hapagLines.length, 1);
  assertEquals(hapagLines[0].amount, 70000);
});

Deno.test("commission confirm périmée ou incohérente avec la compagnie : bloque", async () => {
  const identities = await identitiesFor(importInput());
  const fingerprint = identity(identities, CMA_KEY).fingerprint;

  const stale = buildMaritimeFeeConsumption({
    decisions: [decisionRow({
      decision_key: CMA_KEY,
      proposal_id: "commission-debours",
      proposal_category: "commission_debours",
      decision_action: "confirm",
      suggested_amount_xof: CMA_SUGGESTED,
      decided_amount_xof: CMA_SUGGESTED,
      proposal_fingerprint: "f".repeat(64),
    })],
    identities,
    lines: [padLine(PAD_AMOUNT), cmaTemplateLine(CMA_SUGGESTED)],
    carrierCode: "CMA_CGM",
  });
  assertEquals(stale.blockers, [MARITIME_FEE_DECISION_STALE]);

  const wrongCarrier = buildMaritimeFeeConsumption({
    decisions: [decisionRow({
      decision_key: CMA_KEY,
      proposal_id: "commission-debours",
      proposal_category: "commission_debours",
      decision_action: "confirm",
      suggested_amount_xof: CMA_SUGGESTED,
      decided_amount_xof: CMA_SUGGESTED,
      proposal_fingerprint: fingerprint,
    })],
    identities,
    lines: [padLine(PAD_AMOUNT)],
    carrierCode: "MAERSK",
  });
  assertEquals(wrongCarrier.blockers, [MARITIME_FEE_DECISION_INCOHERENT]);

  const badAmount = buildMaritimeFeeConsumption({
    decisions: [decisionRow({
      decision_key: CMA_KEY,
      proposal_id: "commission-debours",
      proposal_category: "commission_debours",
      decision_action: "adjust",
      suggested_amount_xof: CMA_SUGGESTED,
      decided_amount_xof: 1200.5,
      proposal_fingerprint: fingerprint,
    })],
    identities,
    lines: [padLine(PAD_AMOUNT)],
    carrierCode: "CMA_CGM",
  });
  assertEquals(badAmount.blockers, [MARITIME_FEE_DECISION_INCOHERENT]);
});

Deno.test("ligne ferme structurelle du même frais : bloque plutôt que fausser les totaux moteur", async () => {
  const identities = await identitiesFor(importInput());
  const result = buildMaritimeFeeConsumption({
    decisions: [decisionRow({
      decision_key: CMA_KEY,
      proposal_id: "commission-debours",
      proposal_category: "commission_debours",
      decision_action: "confirm",
      suggested_amount_xof: CMA_SUGGESTED,
      decided_amount_xof: CMA_SUGGESTED,
      proposal_fingerprint: identity(identities, CMA_KEY).fingerprint,
    })],
    identities,
    lines: [padLine(PAD_AMOUNT), engineCommLine(4000, "CALCULATED")],
    carrierCode: "CMA_CGM",
  });
  assertEquals(result.blockers, [MARITIME_FEE_DECISION_DUPLICATE_FIRM_LINE]);
  assertEquals(result.lines.length, 2);
});

// ═══════════════════════════════════════════════════════════════════════════
// Correspondances interdites — ONE / MSC / carrier inconnu
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("ONE, MSC et carrier inconnu : toute décision active bloque", () => {
  for (const key of [ONE_KEY, MSC_KEY, "CARRIER_DEBOURS_COMMISSION:EVERGREEN"]) {
    for (const action of ["confirm", "adjust", "reject"] as const) {
      const result = buildMaritimeFeeConsumption({
        decisions: [decisionRow({
          decision_key: key,
          proposal_id: "commission-debours",
          proposal_category: "commission_debours",
          decision_action: action,
          suggested_amount_xof: action === "reject" ? 1000 : 1000,
          decided_amount_xof: action === "reject" ? null : 1000,
        })],
        identities: [],
        lines: [padLine(PAD_AMOUNT)],
      });
      assertEquals(
        result.blockers,
        [MARITIME_FEE_DECISION_UNSUPPORTED_MAPPING],
        `${key}/${action}`,
      );
    }
  }
});

Deno.test("décision non mappée mais RÉVOQUÉE : ne bloque plus", () => {
  const result = buildMaritimeFeeConsumption({
    decisions: [
      decisionRow({ decision_key: MSC_KEY, id: "m1", decision_version: 1, decision_action: "confirm", suggested_amount_xof: 800, decided_amount_xof: 800 }),
      decisionRow({ decision_key: MSC_KEY, id: "m2", decision_version: 2, decision_action: "revoke", suggested_amount_xof: 800, decided_amount_xof: null }),
    ],
    identities: [],
    lines: [padLine(PAD_AMOUNT)],
  });
  assertEquals(result.blockers, []);
});

// ═══════════════════════════════════════════════════════════════════════════
// Périmètre, multi-lot, versions concurrentes
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("service.overrides.remove gagne : aucune ligne P1-B2 produite", async () => {
  const identities = await identitiesFor(importInput());
  const result = buildMaritimeFeeConsumption({
    decisions: [decisionRow({
      decision_key: CMA_KEY,
      proposal_id: "commission-debours",
      proposal_category: "commission_debours",
      decision_action: "confirm",
      suggested_amount_xof: CMA_SUGGESTED,
      decided_amount_xof: CMA_SUGGESTED,
      proposal_fingerprint: identity(identities, CMA_KEY).fingerprint,
    })],
    identities,
    lines: [padLine(PAD_AMOUNT)],
    removedServiceKeys: new Set(["CMA_CGM_COMM"]),
    carrierCode: "CMA_CGM",
  });

  assertEquals(result.blockers, []);
  assertEquals(lineFor(result.lines, "CMA_CGM_COMM").length, 0);
  assertEquals(result.lines.length, 1);
  assertEquals(entryFor(result, CMA_KEY)?.state, "excluded_by_scope_override");
});

Deno.test("hasActiveMaritimeDecision : vrai tant qu'une version courante n'est pas révoquée", () => {
  assertEquals(hasActiveMaritimeDecision([]), false);
  assertEquals(
    hasActiveMaritimeDecision([
      decisionRow({ decision_key: PAD_KEY, decision_version: 1, decision_action: "confirm" }),
    ]),
    true,
  );
  assertEquals(
    hasActiveMaritimeDecision([
      decisionRow({ decision_key: PAD_KEY, id: "a", decision_version: 1, decision_action: "confirm" }),
      decisionRow({ decision_key: PAD_KEY, id: "b", decision_version: 2, decision_action: "revoke" }),
    ]),
    false,
  );
  // Une clé révoquée n'efface pas une autre clé encore active.
  assertEquals(
    hasActiveMaritimeDecision([
      decisionRow({ decision_key: PAD_KEY, id: "a", decision_version: 1, decision_action: "confirm" }),
      decisionRow({ decision_key: PAD_KEY, id: "b", decision_version: 2, decision_action: "revoke" }),
      decisionRow({ decision_key: CMA_KEY, id: "c", decision_version: 1, decision_action: "reject" }),
    ]),
    true,
  );
});

Deno.test("versions concurrentes : seule la plus haute version compte, quel que soit l'ordre du SELECT", () => {
  const rows = [
    decisionRow({ decision_key: CMA_KEY, id: "v2", decision_version: 2, decision_action: "reject", decided_amount_xof: null }),
    decisionRow({ decision_key: CMA_KEY, id: "v1", decision_version: 1, decision_action: "confirm", decided_amount_xof: CMA_SUGGESTED }),
    decisionRow({ decision_key: CMA_KEY, id: "v3", decision_version: 3, decision_action: "revoke", decided_amount_xof: null }),
  ];
  assertEquals(selectCurrentMaritimeDecisions(rows).get(CMA_KEY)?.id, "v3");
  assertEquals(selectCurrentMaritimeDecisions([...rows].reverse()).get(CMA_KEY)?.id, "v3");
});

Deno.test("registre indisponible : pricing bloqué et lignes intactes", () => {
  const result = buildMaritimeFeeConsumption({
    decisions: [decisionRow({
      decision_key: CMA_KEY,
      decision_action: "confirm",
      suggested_amount_xof: CMA_SUGGESTED,
      decided_amount_xof: CMA_SUGGESTED,
    })],
    identities: [],
    lines: [padLine(PAD_AMOUNT), cmaTemplateLine(CMA_SUGGESTED)],
    carrierCode: "CMA_CGM",
    registryAvailable: false,
  });

  assertEquals(result.blockers, ["MARITIME_FEE_DECISION_READ_FAILED"]);
  assertEquals(lineFor(result.lines, "CMA_CGM_COMM")[0].amount, CMA_SUGGESTED);
  assertEquals(result.entries, []);
});

Deno.test("TTC facture 3304 : copie exacte, une seule fois, TVA SODATRA seulement sur honoraires", async () => {
  const identities = await identitiesFor(importInput());
  const row = decisionRow({decision_key: CMA_KEY, proposal_id: "commission-debours",
    proposal_category: "commission_debours", decision_action: "adjust",
    suggested_amount_xof: CMA_SUGGESTED, decided_amount_xof: 3304,
    proposal_fingerprint: identity(identities, CMA_KEY).fingerprint});
  const result = buildMaritimeFeeConsumption({decisions: [row], identities,
    lines: [cmaTemplateLine(CMA_SUGGESTED), engineCommLine(null)], carrierCode: "CMA_CGM"});
  assertEquals(result.blockers, []);
  assertEquals(result.lines.length, 1);
  assertEquals(result.lines[0].amount, 3304);
  const totals = computeCommercialTotals({engineTotals: {honoraires: 10000, dap: 10000, ddp: 10000}, lines: result.lines});
  assertEquals([totals.deboursEnrichment, totals.honorairesTva, totals.totalPayable], [3304, 1800, 15104]);
  const repeated = buildMaritimeFeeConsumption({decisions: [row], identities,
    lines: result.lines, carrierCode: "CMA_CGM"});
  assertEquals(repeated.lines, result.lines);
  const snapshot = JSON.parse(JSON.stringify({raw_lines: result.lines}));
  assertEquals(snapshot.raw_lines[0].maritime_fee_decision.decision.supplier_invoice_attestation,
    (row.proposal_snapshot as Record<string, unknown>).attestation);

  for (const badSnapshot of [{}, {attestation: {}}, ...[
    {schema_version: 2}, {amount_basis: "supplier_ht"}, {supplier_invoice_ttc_confirmed: false},
    {decided_amount_xof: 2800}, {decision_source: "Autre facture"}, {vat_added_by_sodatra: true},
  ].map(change => ({attestation: {
    ...(row.proposal_snapshot as {attestation: object}).attestation, ...change,
  }}))]) {
    const blocked = buildMaritimeFeeConsumption({decisions: [{...row, proposal_snapshot: badSnapshot}],
      identities, lines: [], carrierCode: "CMA_CGM"});
    assertEquals(blocked.blockers, ["MARITIME_FEE_DECISION_TTC_UNVERIFIED"]);
  }
});

Deno.test("retrait réel depuis service.overrides : PAD et commission existants supprimés sans réapparition", async () => {
  const identities = await identitiesFor(importInput());
  const decisions = [decisionRow({decision_key: CMA_KEY, proposal_id: "commission-debours",
    proposal_category: "commission_debours", decision_action: "adjust", decided_amount_xof: 3304,
    proposal_fingerprint: identity(identities, CMA_KEY).fingerprint})];
  const overrides = readOverridesFromFacts([{fact_key: "service.overrides",
    value_json: {add: ["CMA_CGM_COMM", "UNKNOWN"], remove: ["PORT_DAKAR_HANDLING", "CMA_CGM_COMM", "UNKNOWN"]}}]);
  assertEquals(overrides.add, []); // frais canoniques jamais ajoutables au package
  assertEquals(overrides.remove, ["PORT_DAKAR_HANDLING", "CMA_CGM_COMM"]);
  const result = buildMaritimeFeeConsumption({decisions, identities,
    lines: [padLine(PAD_AMOUNT), cmaTemplateLine(CMA_SUGGESTED)], carrierCode: "CMA_CGM",
    removedServiceKeys: resolveExplicitlyRemovedServiceKeys(overrides)});
  assertEquals(result.blockers, []);
  assertEquals(result.lines, []);
  assertEquals(result.entries.every(e => e.state === "excluded_by_scope_override"), true);
  const addWins = readOverridesFromFacts([{fact_key: "service.overrides",
    value_json: {add: ["PORT_DAKAR_HANDLING"], remove: ["PORT_DAKAR_HANDLING"]}}]);
  const kept = buildMaritimeFeeConsumption({decisions: [], identities: [], lines: [padLine(PAD_AMOUNT)],
    removedServiceKeys: resolveExplicitlyRemovedServiceKeys(addWins)});
  assertEquals(kept.lines.length, 1);
});

Deno.test("aucun montant structurel caché après absence, révocation, rejet ou retrait", () => {
  for (const action of [null, "revoke", "reject", "confirm", "adjust"] as const) {
    for (const removed of [false, true]) {
      const original = engineCommLine(4000, "CALCULATED");
      const result = buildMaritimeFeeConsumption({
        decisions: action ? [decisionRow({decision_key: CMA_KEY, decision_action: action,
          proposal_id: "commission-debours", proposal_category: "commission_debours"})] : [],
        identities: [], lines: [original], carrierCode: "CMA_CGM",
        removedServiceKeys: new Set(removed ? ["CMA_CGM_COMM"] : []),
      });
      assertEquals(result.blockers, [MARITIME_FEE_DECISION_DUPLICATE_FIRM_LINE]);
      assertEquals(result.lines, [original]);
    }
  }
});

Deno.test("PAD : identité exacte et montant non arrondi exigés", async () => {
  const identities = await identitiesFor(importInput());
  const row = decisionRow({decision_key: PAD_KEY, decided_amount_xof: PAD_AMOUNT,
    proposal_fingerprint: identity(identities, PAD_KEY).fingerprint});
  const badIdentity = buildMaritimeFeeConsumption({decisions: [{...row, proposal_id: "commission-debours"}],
    identities, lines: [padLine(PAD_AMOUNT)]});
  assertEquals(badIdentity.blockers, [MARITIME_FEE_DECISION_INCOHERENT]);
  for (const line of [padLine(PAD_AMOUNT + 0.4), padLine(PAD_AMOUNT, "TO_CONFIRM")]) {
    assertEquals(buildMaritimeFeeConsumption({decisions: [row], identities, lines: [line]}).blockers,
      [MARITIME_FEE_DECISION_AMOUNT_MISMATCH]);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Totaux et déterminisme
// ═══════════════════════════════════════════════════════════════════════════

const NEUTRAL_ENGINE_TOTALS = {
  operationnel: 0,
  honoraires: 0,
  debours: 0,
  border: 0,
  terminal: 0,
  local_transport_debours_ttc: 0,
  dap: 0,
  ddp: 0,
};

Deno.test("totaux : sans décision la commission sort des totaux, avec décision elle y entre une seule fois", async () => {
  const before = computeCommercialTotals({
    engineTotals: NEUTRAL_ENGINE_TOTALS,
    lines: [padLine(PAD_AMOUNT), cmaTemplateLine(CMA_SUGGESTED)],
  });
  assertEquals(before.enrichmentAmount, PAD_AMOUNT + CMA_SUGGESTED);

  const withoutDecision = buildMaritimeFeeConsumption({
    decisions: [],
    identities: [],
    lines: [padLine(PAD_AMOUNT), cmaTemplateLine(CMA_SUGGESTED)],
    carrierCode: "CMA_CGM",
  });
  const totalsWithout = computeCommercialTotals({
    engineTotals: NEUTRAL_ENGINE_TOTALS,
    lines: withoutDecision.lines,
  });
  assertEquals(totalsWithout.enrichmentAmount, PAD_AMOUNT);

  const identities = await identitiesFor(importInput());
  const confirmed = buildMaritimeFeeConsumption({
    decisions: [decisionRow({
      decision_key: CMA_KEY,
      proposal_id: "commission-debours",
      proposal_category: "commission_debours",
      decision_action: "confirm",
      suggested_amount_xof: CMA_SUGGESTED,
      decided_amount_xof: CMA_SUGGESTED,
      proposal_fingerprint: identity(identities, CMA_KEY).fingerprint,
    })],
    identities,
    lines: [padLine(PAD_AMOUNT), cmaTemplateLine(CMA_SUGGESTED), engineCommLine(null)],
    carrierCode: "CMA_CGM",
  });
  const totalsWith = computeCommercialTotals({
    engineTotals: NEUTRAL_ENGINE_TOTALS,
    lines: confirmed.lines,
  });
  // Exactement une fois : le template a été remplacé, pas additionné.
  assertEquals(totalsWith.enrichmentAmount, PAD_AMOUNT + CMA_SUGGESTED);
});

Deno.test("PAD attesté : totaux strictement identiques à l'absence de décision", async () => {
  const identities = await identitiesFor(importInput());
  const attested = buildMaritimeFeeConsumption({
    decisions: [decisionRow({
      decision_key: PAD_KEY,
      decision_action: "confirm",
      suggested_amount_xof: PAD_AMOUNT,
      decided_amount_xof: PAD_AMOUNT,
      proposal_fingerprint: identity(identities, PAD_KEY).fingerprint,
    })],
    identities,
    lines: [padLine(PAD_AMOUNT)],
  });
  const unattested = buildMaritimeFeeConsumption({
    decisions: [],
    identities: [],
    lines: [padLine(PAD_AMOUNT)],
  });

  assertEquals(
    computeCommercialTotals({ engineTotals: NEUTRAL_ENGINE_TOTALS, lines: attested.lines }),
    computeCommercialTotals({ engineTotals: NEUTRAL_ENGINE_TOTALS, lines: unattested.lines }),
  );
});

Deno.test("double exécution : lignes, états et provenance strictement identiques", async () => {
  const identities = await identitiesFor(importInput());
  const decisions = [
    decisionRow({
      decision_key: PAD_KEY,
      decision_action: "confirm",
      suggested_amount_xof: PAD_AMOUNT,
      decided_amount_xof: PAD_AMOUNT,
      proposal_fingerprint: identity(identities, PAD_KEY).fingerprint,
    }),
    decisionRow({
      decision_key: CMA_KEY,
      id: "cma-1",
      proposal_id: "commission-debours",
      proposal_category: "commission_debours",
      decision_action: "confirm",
      suggested_amount_xof: CMA_SUGGESTED,
      decided_amount_xof: CMA_SUGGESTED,
      proposal_fingerprint: identity(identities, CMA_KEY).fingerprint,
    }),
  ];
  const build = () =>
    buildMaritimeFeeConsumption({
      decisions,
      identities,
      lines: [padLine(PAD_AMOUNT), cmaTemplateLine(CMA_SUGGESTED), engineCommLine(null)],
      carrierCode: "CMA_CGM",
    });

  const first = build();
  const second = build();
  assertEquals(first.blockers, []);
  assertEquals(JSON.stringify(first.lines), JSON.stringify(second.lines));
  assertEquals(JSON.stringify(first.entries), JSON.stringify(second.entries));

  // Ré-appliquer le plan sur ses PROPRES lignes ne crée pas de doublon.
  const rerun = buildMaritimeFeeConsumption({
    decisions,
    identities,
    lines: first.lines,
    carrierCode: "CMA_CGM",
  });
  assertEquals(rerun.blockers, []);
  assertEquals(lineFor(rerun.lines, "CMA_CGM_COMM").length, 1);
  assertEquals(lineFor(rerun.lines, "CMA_CGM_COMM")[0].amount, CMA_SUGGESTED);
  assertEquals(lineFor(rerun.lines, "PAD_DROIT_PASSAGE").length, 1);
});

Deno.test("plusieurs blockers : lignes rendues INCHANGÉES, aucun chiffrage à moitié consommé", async () => {
  const identities = await identitiesFor(importInput());
  const sourceLines = [padLine(PAD_AMOUNT), cmaTemplateLine(CMA_SUGGESTED)];
  const result = buildMaritimeFeeConsumption({
    decisions: [
      decisionRow({
        decision_key: PAD_KEY,
        decision_action: "adjust",
        suggested_amount_xof: PAD_AMOUNT,
        decided_amount_xof: 25000,
        proposal_fingerprint: identity(identities, PAD_KEY).fingerprint,
      }),
      decisionRow({
        decision_key: MSC_KEY,
        id: "msc-1",
        decision_action: "confirm",
        suggested_amount_xof: 800,
        decided_amount_xof: 800,
      }),
    ],
    identities,
    lines: sourceLines,
    carrierCode: "CMA_CGM",
  });

  assertEquals(result.blockers.sort(), [
    MARITIME_FEE_DECISION_PAD_NOT_ATTESTABLE,
    MARITIME_FEE_DECISION_UNSUPPORTED_MAPPING,
  ].sort());
  assertStrictEquals(result.lines[0], sourceLines[0]);
  assertStrictEquals(result.lines[1], sourceLines[1]);
  assert(result.message && result.message.length > 0);
});
