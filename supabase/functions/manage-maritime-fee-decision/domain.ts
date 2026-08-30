import type {
  MaritimeFeeInput,
  MaritimeFeeProposal,
} from "../_shared/maritime-fee-proposals/engine.ts";
import {
  buildSupplierInvoiceTtcAttestation,
  requiresSupplierInvoiceTtcAttestation,
} from "../_shared/maritime-fee-decisions/attestation.ts";
// P1-B2 — l'empreinte de proposition est désormais définie UNE SEULE FOIS sous
// `_shared`, parce que run-pricing doit recalculer exactement la même pour juger
// de la fraîcheur d'une décision. Déplacement verbatim, aucune doctrine B1
// modifiée ; ces réexports gardent l'API de ce module inchangée.
import {
  buildDecisionKey,
  buildProposalSnapshot,
  sha256Hex,
  stableJson,
} from "../_shared/maritime-fee-decisions/proposal-identity.ts";

export {
  buildDecisionKey,
  buildProposalSnapshot,
  sha256Hex,
  stableJson,
};

export const MARITIME_DECISION_OPERATIONS = [
  "list",
  "confirm",
  "adjust",
  "reject",
  "revoke",
] as const;

export type MaritimeDecisionOperation =
  typeof MARITIME_DECISION_OPERATIONS[number];

export interface ListMaritimeDecisionRequest {
  operation: "list";
  case_id: string;
}

export interface MutateMaritimeDecisionRequest {
  operation: "confirm" | "adjust" | "reject";
  case_id: string;
  proposal_id: string;
  expected_proposal_fingerprint: string;
  amount_xof: number | null;
  supplier_invoice_ttc_confirmed?: boolean;
  decision_source: string;
  justification: string;
  idempotency_key: string;
}

export interface RevokeMaritimeDecisionRequest {
  operation: "revoke";
  case_id: string;
  decision_key: string;
  expected_decision_version: number;
  decision_source: string;
  justification: string;
  idempotency_key: string;
}

export type MaritimeDecisionRequest =
  | ListMaritimeDecisionRequest
  | MutateMaritimeDecisionRequest
  | RevokeMaritimeDecisionRequest;

export type ValidationResult =
  | { ok: true; value: MaritimeDecisionRequest }
  | { ok: false; message: string };

export interface PreparedProposalDecision {
  decisionKey: string;
  decidedAmountXof: number | null;
  proposalFingerprint: string;
  inputSnapshotHash: string;
  proposalSnapshot: Record<string, unknown>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const DECISION_KEY_RE = /^[A-Z0-9][A-Z0-9:_-]{1,127}$/;
const FORBIDDEN_KEYS = new Set([
  "actor_user_id",
  "decided_by",
  "proposal_snapshot",
  "proposal_fingerprint",
  "input_snapshot_hash",
  "request_fingerprint",
  "decision_version",
  "supersedes_id",
  "created_at",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/\s+/g, " ");
  return clean.length >= min && clean.length <= max ? clean : null;
}

function fail(message: string): ValidationResult {
  return { ok: false, message };
}

export function validateMaritimeDecisionPayload(
  raw: unknown,
): ValidationResult {
  if (!isRecord(raw)) return fail("Le corps doit être un objet JSON");
  const forged = Object.keys(raw).find((key) => FORBIDDEN_KEYS.has(key));
  if (forged) return fail(`Champ serveur interdit : ${forged}`);

  const operation = typeof raw.operation === "string"
    ? raw.operation.trim().toLowerCase()
    : "";
  if (
    !MARITIME_DECISION_OPERATIONS.includes(
      operation as MaritimeDecisionOperation,
    )
  ) {
    return fail("operation invalide");
  }
  if (typeof raw.case_id !== "string" || !UUID_RE.test(raw.case_id)) {
    return fail("case_id doit être un UUID");
  }

  if (operation === "list") {
    const allowed = new Set(["operation", "case_id"]);
    const extra = Object.keys(raw).find((key) => !allowed.has(key));
    if (extra) return fail(`Champ interdit pour list : ${extra}`);
    return { ok: true, value: { operation: "list", case_id: raw.case_id } };
  }

  const decisionSource = cleanText(raw.decision_source, 3, 500);
  const justification = cleanText(raw.justification, 3, 2000);
  const idempotencyKey = cleanText(raw.idempotency_key, 8, 128);
  if (!decisionSource) {
    return fail("decision_source doit faire 3 à 500 caractères");
  }
  if (!justification) {
    return fail("justification doit faire 3 à 2000 caractères");
  }
  if (!idempotencyKey) {
    return fail("idempotency_key doit faire 8 à 128 caractères");
  }

  if (operation === "revoke") {
    const decisionKey = cleanText(raw.decision_key, 2, 128)?.toUpperCase() ??
      null;
    if (!decisionKey || !DECISION_KEY_RE.test(decisionKey)) {
      return fail("decision_key invalide");
    }
    if (
      typeof raw.expected_decision_version !== "number" ||
      !Number.isInteger(raw.expected_decision_version) ||
      raw.expected_decision_version < 1
    ) {
      return fail("expected_decision_version doit être un entier positif");
    }
    const allowed = new Set([
      "operation",
      "case_id",
      "decision_key",
      "expected_decision_version",
      "decision_source",
      "justification",
      "idempotency_key",
    ]);
    const extra = Object.keys(raw).find((key) => !allowed.has(key));
    if (extra) return fail(`Champ interdit pour revoke : ${extra}`);
    return {
      ok: true,
      value: {
        operation: "revoke",
        case_id: raw.case_id,
        decision_key: decisionKey,
        expected_decision_version: raw.expected_decision_version,
        decision_source: decisionSource,
        justification,
        idempotency_key: idempotencyKey,
      },
    };
  }

  const proposalId = cleanText(raw.proposal_id, 2, 100);
  if (!proposalId) return fail("proposal_id invalide");
  if (
    typeof raw.expected_proposal_fingerprint !== "string" ||
    !SHA256_RE.test(raw.expected_proposal_fingerprint)
  ) {
    return fail("expected_proposal_fingerprint doit être un SHA-256");
  }

  let amountXof: number | null = null;
  if (operation === "adjust") {
    if (
      typeof raw.amount_xof !== "number" ||
      !Number.isSafeInteger(raw.amount_xof) ||
      raw.amount_xof <= 0
    ) {
      return fail("amount_xof doit être un entier FCFA strictement positif");
    }
    amountXof = raw.amount_xof;
  } else if (raw.amount_xof !== undefined && raw.amount_xof !== null) {
    return fail("amount_xof est autorisé uniquement pour adjust");
  }

  if (raw.supplier_invoice_ttc_confirmed !== undefined && (
    typeof raw.supplier_invoice_ttc_confirmed !== "boolean" ||
    proposalId !== "commission-debours" || operation === "reject"
  )) return fail("Attestation TTC autorisée uniquement pour confirmer ou ajuster une commission");

  const allowed = new Set([
    "operation",
    "case_id",
    "proposal_id",
    "expected_proposal_fingerprint",
    "amount_xof",
    "supplier_invoice_ttc_confirmed",
    "decision_source",
    "justification",
    "idempotency_key",
  ]);
  const extra = Object.keys(raw).find((key) => !allowed.has(key));
  if (extra) return fail(`Champ interdit : ${extra}`);

  return {
    ok: true,
    value: {
      operation: operation as "confirm" | "adjust" | "reject",
      case_id: raw.case_id,
      proposal_id: proposalId,
      expected_proposal_fingerprint: raw.expected_proposal_fingerprint,
      amount_xof: amountXof,
      ...(raw.supplier_invoice_ttc_confirmed === undefined ? {} : {
        supplier_invoice_ttc_confirmed: raw.supplier_invoice_ttc_confirmed as boolean,
      }),
      decision_source: decisionSource,
      justification,
      idempotency_key: idempotencyKey,
    },
  };
}

export async function prepareProposalDecision(
  request: MutateMaritimeDecisionRequest,
  input: MaritimeFeeInput,
  proposal: MaritimeFeeProposal,
): Promise<PreparedProposalDecision> {
  const decisionKey = buildDecisionKey(proposal, input);
  if (!decisionKey) throw new Error("PROPOSAL_NOT_DECIDABLE");
  const proposalSnapshot = buildProposalSnapshot(decisionKey, input, proposal);
  const proposalFingerprint = await sha256Hex(proposalSnapshot);
  if (proposalFingerprint !== request.expected_proposal_fingerprint) {
    throw new Error("STALE_PROPOSAL");
  }

  if (request.operation !== "reject") {
    if (
      proposal.suggested_amount_xof === null ||
      !Number.isSafeInteger(proposal.suggested_amount_xof) ||
      proposal.suggested_amount_xof <= 0 ||
      proposal.missing_confirmation.length > 0 ||
      !["official", "validated_internal"].includes(proposal.evidence_level)
    ) {
      throw new Error("PROPOSAL_NOT_CONFIRMABLE");
    }
  }

  const decidedAmountXof = request.operation === "confirm"
    ? proposal.suggested_amount_xof
    : request.operation === "adjust"
    ? request.amount_xof
    : null;

  if (request.operation !== "reject" &&
    requiresSupplierInvoiceTtcAttestation(decisionKey, proposal.category)) {
    if (request.supplier_invoice_ttc_confirmed !== true) {
      throw new Error("SUPPLIER_INVOICE_TTC_ATTESTATION_REQUIRED");
    }
    // L'attestation décrit la décision, pas la suggestion : elle n'entre pas
    // dans l'empreinte de fraîcheur calculée plus haut. Le hash de requête lie
    // le consentement à l'idempotence, et le snapshot stocke montant + source.
    proposalSnapshot.attestation = buildSupplierInvoiceTtcAttestation({
      action: request.operation,
      decidedAmountXof: decidedAmountXof as number,
      decisionSource: request.decision_source,
    });
  }

  return {
    decisionKey,
    decidedAmountXof,
    proposalFingerprint,
    inputSnapshotHash: await sha256Hex(proposalSnapshot.input),
    proposalSnapshot,
  };
}

export async function computeRequestFingerprint(
  request: Exclude<MaritimeDecisionRequest, ListMaritimeDecisionRequest>,
): Promise<string> {
  return await sha256Hex(request);
}
