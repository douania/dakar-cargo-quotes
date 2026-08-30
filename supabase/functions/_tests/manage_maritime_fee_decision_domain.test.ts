import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildDecisionKey,
  buildProposalSnapshot,
  computeRequestFingerprint,
  prepareProposalDecision,
  sha256Hex,
  stableJson,
  validateMaritimeDecisionPayload,
} from "../manage-maritime-fee-decision/domain.ts";
import type {
  MaritimeFeeInput,
  MaritimeFeeProposal,
} from "../_shared/maritime-fee-proposals/engine.ts";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const SHA = "a".repeat(64);

function valid(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    operation: "confirm",
    case_id: CASE_ID,
    proposal_id: "pad-taxe-de-port",
    expected_proposal_fingerprint: SHA,
    decision_source: "Facture fournisseur vérifiée",
    justification: "Montant contrôlé par l'opérateur",
    idempotency_key: "maritime-123456",
    ...overrides,
  };
}

const input: MaritimeFeeInput = {
  operation_type: "IMPORT",
  cargo_mode: "CONTENEUR",
  carrier: "CMA CGM",
  pad_category: "T02",
  tonnage: 10,
};

const proposal: MaritimeFeeProposal = {
  id: "pad-taxe-de-port",
  category: "taxe_de_port",
  label: "Droit de passage PAD",
  amount: null,
  currency: "XOF",
  suggested_amount_xof: 96_780,
  suggested_formula: "9678 × 10",
  source_reference: "Barème PAD officiel",
  evidence_level: "official",
  needs_human_confirmation: true,
  reason: "Calcul indicatif",
  missing_confirmation: [],
};

Deno.test("P1-B2 commission : attestation TTC explicite et montant inchangé", async () => {
  const commission: MaritimeFeeProposal = { ...proposal, id: "commission-debours",
    category: "commission_debours", suggested_amount_xof: 2800 };
  const key = buildDecisionKey(commission, input)!;
  const fp = await sha256Hex(buildProposalSnapshot(key, input, commission));
  for (const marker of [undefined, false]) {
    const parsed = validateMaritimeDecisionPayload(valid({ proposal_id: commission.id,
      expected_proposal_fingerprint: fp, supplier_invoice_ttc_confirmed: marker }));
    assert(parsed.ok && parsed.value.operation === "confirm");
    await assertRejects(() => prepareProposalDecision(parsed.value as Extract<typeof parsed.value, {operation: "confirm" | "adjust" | "reject"}>, input, commission),
      Error, "SUPPLIER_INVOICE_TTC_ATTESTATION_REQUIRED");
  }
  const parsed = validateMaritimeDecisionPayload(valid({ operation: "adjust", proposal_id: commission.id,
    expected_proposal_fingerprint: fp, amount_xof: 3304, supplier_invoice_ttc_confirmed: true }));
  assert(parsed.ok && parsed.value.operation === "adjust");
  const decision = await prepareProposalDecision(parsed.value, input, commission);
  assertEquals(decision.decidedAmountXof, 3304);
  assertEquals(decision.proposalFingerprint, fp);
  assertEquals(decision.proposalSnapshot.attestation, {
    schema_version: 1, amount_basis: "supplier_invoice_ttc", supplier_invoice_ttc_confirmed: true,
    decision_action: "adjust", decided_amount_xof: 3304,
    decision_source: parsed.value.decision_source, vat_added_by_sodatra: false,
  });
  assertNotEquals(await computeRequestFingerprint(parsed.value),
    await computeRequestFingerprint({...parsed.value, supplier_invoice_ttc_confirmed: false}));
  const confirmed = {...parsed.value, operation: "confirm" as const, amount_xof: null};
  assertEquals((await prepareProposalDecision(confirmed, input, commission)).decidedAmountXof, 2800);
  const rejected = {...parsed.value, operation: "reject" as const, amount_xof: null,
    supplier_invoice_ttc_confirmed: undefined};
  const rejection = await prepareProposalDecision(rejected, input, commission);
  assertEquals(rejection.decidedAmountXof, null);
  assertEquals(rejection.proposalSnapshot.attestation, undefined);
});

Deno.test("P1-B2 attestation : pas de coercition, snapshot client ou attestation PAD", () => {
  for (const value of ["true", 1, null, {}]) {
    assert(!validateMaritimeDecisionPayload(valid({proposal_id: "commission-debours",
      supplier_invoice_ttc_confirmed: value})).ok);
  }
  assert(!validateMaritimeDecisionPayload(valid({supplier_invoice_ttc_confirmed: true})).ok);
  assert(!validateMaritimeDecisionPayload(valid({proposal_id: "commission-debours",
    attestation: {amount_basis: "supplier_invoice_ttc"}})).ok);
});

Deno.test("P1-B1 domaine : list accepte uniquement case_id", () => {
  assert(
    validateMaritimeDecisionPayload({ operation: "list", case_id: CASE_ID }).ok,
  );
  assert(
    !validateMaritimeDecisionPayload({
      operation: "list",
      case_id: CASE_ID,
      amount_xof: 1,
    }).ok,
  );
});

Deno.test("P1-B1 domaine : Auth payload refuse identités et snapshots forgés", () => {
  for (
    const key of [
      "decided_by",
      "actor_user_id",
      "proposal_snapshot",
      "request_fingerprint",
    ]
  ) {
    assert(
      !validateMaritimeDecisionPayload(valid({ [key]: "forged" })).ok,
      key,
    );
  }
});

Deno.test("P1-B1 domaine : confirm/reject n'acceptent aucun montant client", () => {
  assert(validateMaritimeDecisionPayload(valid()).ok);
  assert(!validateMaritimeDecisionPayload(valid({ amount_xof: 10 })).ok);
  assert(validateMaritimeDecisionPayload(valid({ operation: "reject" })).ok);
  assert(
    !validateMaritimeDecisionPayload(
      valid({ operation: "reject", amount_xof: 10 }),
    ).ok,
  );
});

Deno.test("P1-B1 domaine : adjust exige un entier FCFA strictement positif", () => {
  assert(
    validateMaritimeDecisionPayload(
      valid({ operation: "adjust", amount_xof: 97_000 }),
    ).ok,
  );
  for (
    const amount of [null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]
  ) {
    assert(
      !validateMaritimeDecisionPayload(
        valid({ operation: "adjust", amount_xof: amount }),
      ).ok,
    );
  }
});

Deno.test("P1-B1 domaine : revoke exige clé et version, sans payload proposition", () => {
  const revoke = {
    operation: "revoke",
    case_id: CASE_ID,
    decision_key: "pad_droit_passage",
    expected_decision_version: 2,
    decision_source: "Contrôle opérateur",
    justification: "La pièce source a été annulée",
    idempotency_key: "revoke-12345678",
  };
  const parsed = validateMaritimeDecisionPayload(revoke);
  assert(parsed.ok);
  if (parsed.ok && parsed.value.operation === "revoke") {
    assertEquals(parsed.value.decision_key, "PAD_DROIT_PASSAGE");
  }
  assert(
    !validateMaritimeDecisionPayload({
      ...revoke,
      expected_decision_version: 0,
    }).ok,
  );
  assert(!validateMaritimeDecisionPayload({ ...revoke, proposal_id: "x" }).ok);
});

Deno.test("P1-B1 domaine : longueurs, UUID et SHA-256 sont fail-closed", () => {
  assert(!validateMaritimeDecisionPayload(valid({ case_id: "case-1" })).ok);
  assert(
    !validateMaritimeDecisionPayload(
      valid({ expected_proposal_fingerprint: "abc" }),
    ).ok,
  );
  assert(
    !validateMaritimeDecisionPayload(valid({ idempotency_key: "court" })).ok,
  );
  assert(!validateMaritimeDecisionPayload(valid({ decision_source: "x" })).ok);
  assert(!validateMaritimeDecisionPayload(valid({ justification: "x" })).ok);
});

Deno.test("P1-B1 domaine : sérialisation stable et SHA déterministe", async () => {
  assertEquals(
    stableJson({ b: 2, a: { d: 4, c: 3 } }),
    '{"a":{"c":3,"d":4},"b":2}',
  );
  assertEquals(
    await sha256Hex({ b: 2, a: 1 }),
    await sha256Hex({ a: 1, b: 2 }),
  );
  assert(/^[0-9a-f]{64}$/.test(await sha256Hex({ a: 1 })));
});

Deno.test("P1-B1 domaine : clés PAD et commission sont stables et distinctes", () => {
  assertEquals(buildDecisionKey(proposal, input), "PAD_DROIT_PASSAGE");
  const commission = {
    ...proposal,
    id: "commission-debours",
    category: "commission_debours",
  };
  assertEquals(
    buildDecisionKey(commission, { ...input, carrier: "Hapag-Lloyd" }),
    "CARRIER_DEBOURS_COMMISSION:HAPAG_LLOYD",
  );
  assertEquals(buildDecisionKey(commission, { ...input, carrier: null }), null);
});

Deno.test("P1-B1 domaine : snapshot contient la preuve mais jamais de montant ferme moteur", () => {
  const snapshot = buildProposalSnapshot("PAD_DROIT_PASSAGE", input, proposal);
  const snapProposal = snapshot.proposal as Record<string, unknown>;
  assertEquals(snapProposal.amount, null);
  assertEquals(snapProposal.suggested_amount_xof, 96_780);
  assertEquals(snapProposal.source_reference, "Barème PAD officiel");
});

Deno.test("P1-B1 domaine : confirm reprend exactement la suggestion entière", async () => {
  const snapshot = buildProposalSnapshot("PAD_DROIT_PASSAGE", input, proposal);
  const fingerprint = await sha256Hex(snapshot);
  const parsed = validateMaritimeDecisionPayload(
    valid({ expected_proposal_fingerprint: fingerprint }),
  );
  assert(parsed.ok && parsed.value.operation === "confirm");
  const prepared = await prepareProposalDecision(parsed.value, input, proposal);
  assertEquals(prepared.decidedAmountXof, 96_780);
  assertEquals(prepared.proposalFingerprint, fingerprint);
});

Deno.test("P1-B1 domaine : empreinte obsolète est refusée", async () => {
  const parsed = validateMaritimeDecisionPayload(valid());
  assert(parsed.ok && parsed.value.operation === "confirm");
  const request = parsed.value;
  await assertRejects(
    () => prepareProposalDecision(request, input, proposal),
    Error,
    "STALE_PROPOSAL",
  );
});

Deno.test("P1-B1 domaine : suggestion incomplète ne peut être ni confirmée ni ajustée", async () => {
  const incomplete = {
    ...proposal,
    suggested_amount_xof: null,
    missing_confirmation: ["tonnage"],
  };
  const snapshot = buildProposalSnapshot(
    "PAD_DROIT_PASSAGE",
    input,
    incomplete,
  );
  const fingerprint = await sha256Hex(snapshot);
  for (const operation of ["confirm", "adjust"] as const) {
    const parsed = validateMaritimeDecisionPayload(valid({
      operation,
      amount_xof: operation === "adjust" ? 50_000 : undefined,
      expected_proposal_fingerprint: fingerprint,
    }));
    assert(
      parsed.ok && parsed.value.operation !== "list" &&
        parsed.value.operation !== "revoke",
    );
    const request = parsed.value;
    await assertRejects(
      () => prepareProposalDecision(request, input, incomplete),
      Error,
      "PROPOSAL_NOT_CONFIRMABLE",
    );
  }
});

Deno.test("P1-B1 domaine : reject reste possible sur suggestion incomplète", async () => {
  const incomplete = {
    ...proposal,
    suggested_amount_xof: null,
    missing_confirmation: ["tonnage"],
  };
  const snapshot = buildProposalSnapshot(
    "PAD_DROIT_PASSAGE",
    input,
    incomplete,
  );
  const fingerprint = await sha256Hex(snapshot);
  const parsed = validateMaritimeDecisionPayload(valid({
    operation: "reject",
    expected_proposal_fingerprint: fingerprint,
  }));
  assert(parsed.ok && parsed.value.operation === "reject");
  const prepared = await prepareProposalDecision(
    parsed.value,
    input,
    incomplete,
  );
  assertEquals(prepared.decidedAmountXof, null);
});

Deno.test("P1-B1 domaine : empreinte requête change avec le fond, pas l'ordre JSON", async () => {
  const a = validateMaritimeDecisionPayload(valid());
  const b = validateMaritimeDecisionPayload({
    idempotency_key: "maritime-123456",
    justification: "Montant contrôlé par l'opérateur",
    decision_source: "Facture fournisseur vérifiée",
    expected_proposal_fingerprint: SHA,
    proposal_id: "pad-taxe-de-port",
    case_id: CASE_ID,
    operation: "confirm",
  });
  const c = validateMaritimeDecisionPayload(
    valid({ justification: "Autre justification" }),
  );
  assert(a.ok && a.value.operation !== "list");
  assert(b.ok && b.value.operation !== "list");
  assert(c.ok && c.value.operation !== "list");
  assertEquals(
    await computeRequestFingerprint(a.value),
    await computeRequestFingerprint(b.value),
  );
  assertNotEquals(
    await computeRequestFingerprint(a.value),
    await computeRequestFingerprint(c.value),
  );
});
