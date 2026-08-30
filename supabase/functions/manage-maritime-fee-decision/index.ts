// P1-B1 — décisions humaines sur propositions maritimes.
//
// Ce lot écrit uniquement dans le registre append-only maritime_fee_decisions.
// Il ne modifie jamais quote_facts, quote_service_pricing, pricing_runs, les
// versions de devis ou un tarif. Aucune décision n'est encore consommée par le
// pricing : accounting_effect reste strictement "none" jusqu'au lot P1-B2.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { errorResponse, handleCors, jsonResponse } from "../_shared/cors.ts";
import {
  buildMaritimeFeeProposals,
  type MaritimeFeeInput,
  type MaritimeFeeProposal,
  type Parametrage,
} from "../_shared/maritime-fee-proposals/engine.ts";
import parametrageJson from "../_shared/maritime-fee-proposals/dcq_pad_parametrage.json" with {
  type: "json",
};
import {
  type FactRow,
  mapFactsToMaritimeInput,
} from "../maritime-fee-proposals/index.ts";
import {
  buildDecisionKey,
  buildProposalSnapshot,
  computeRequestFingerprint,
  type MaritimeDecisionRequest,
  type MutateMaritimeDecisionRequest,
  prepareProposalDecision,
  sha256Hex,
  validateMaritimeDecisionPayload,
} from "./domain.ts";

const PARAMETRAGE = parametrageJson as unknown as Parametrage;

interface DecisionRow {
  id: string;
  case_id: string;
  decision_key: string;
  proposal_id: string;
  proposal_category: string;
  decision_action: "confirm" | "adjust" | "reject" | "revoke";
  suggested_amount_xof: number | null;
  decided_amount_xof: number | null;
  currency: "XOF";
  evidence_level: string;
  source_reference: string;
  decision_source: string;
  justification: string;
  proposal_fingerprint: string;
  input_snapshot_hash: string;
  proposal_snapshot: Record<string, unknown>;
  decision_version: number;
  supersedes_id: string | null;
  idempotency_key: string;
  request_fingerprint: string;
  decided_by: string;
  created_at: string;
}

interface CaseContext {
  input: MaritimeFeeInput;
  requestType: string | null;
}

interface CaseContextRpcRow {
  request_type?: string | null;
  facts?: FactRow[];
}

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("MISSING_SERVICE_ENV");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function loadCaseContext(
  caseId: string,
  token: string,
  accessMode: "read" | "write",
): Promise<CaseContext | Response> {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    return errorResponse("Missing Supabase environment variables.", 503);
  }

  // Preuve d'accès sous le JWT appelant AVANT toute élévation service_role.
  const caller = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const accessFunction = accessMode === "write"
    ? "has_case_write_access"
    : "has_case_read_access";
  const { data: canAccess, error: accessError } = await caller.rpc(
    accessFunction,
    { _case_id: caseId },
  );
  if (accessError || canAccess !== true) {
    return errorResponse("Dossier introuvable ou accès refusé.", 403);
  }

  // Le reset canonique ne donne aucun GRANT SELECT direct sur quote_cases.
  // Après preuve explicite, une RPC service_role-only retourne strictement le
  // request_type et les quatre colonnes de faits nécessaires à ce moteur.
  const reader = serviceClient();
  const { data: rawContext, error: contextError } = await reader.rpc(
    "read_maritime_fee_case_context",
    { p_case_id: caseId },
  );
  if (contextError || !rawContext) {
    console.error("[P1-B1] minimal case context read failed", {
      code: contextError?.code ?? null,
      message: contextError?.message ?? "missing_row_after_access_grant",
    });
    return errorResponse("Lecture du dossier impossible.", 500);
  }
  const contextRow = rawContext as CaseContextRpcRow;
  const requestType = contextRow.request_type ?? null;
  const facts = Array.isArray(contextRow.facts) ? contextRow.facts : [];
  return {
    requestType,
    input: mapFactsToMaritimeInput(requestType, facts),
  };
}

async function readDecisionHistory(
  client: ReturnType<typeof serviceClient>,
  caseId: string,
): Promise<DecisionRow[]> {
  const { data, error, count } = await client
    .from("maritime_fee_decisions")
    .select(
      "id,case_id,decision_key,proposal_id,proposal_category,decision_action,suggested_amount_xof,decided_amount_xof,currency,evidence_level,source_reference,decision_source,justification,proposal_fingerprint,input_snapshot_hash,proposal_snapshot,decision_version,supersedes_id,idempotency_key,request_fingerprint,decided_by,created_at",
      { count: "exact" },
    )
    .eq("case_id", caseId)
    .order("decision_key", { ascending: true })
    .order("decision_version", { ascending: false });
  if (error) throw new Error(`DECISION_READ_FAILED:${error.message}`);
  // Historique tronqué ou décompte non attesté : ne jamais choisir de version
  // courante ni écrire une mutation sur un état partiel, comme run-pricing.
  if (!Array.isArray(data) || !Number.isSafeInteger(count) || count !== data.length) {
    throw new Error("DECISION_READ_FAILED:incomplete_or_unverifiable_count");
  }
  return data as DecisionRow[];
}

function currentByKey(history: DecisionRow[]): Map<string, DecisionRow> {
  const current = new Map<string, DecisionRow>();
  for (const row of history) {
    if (!current.has(row.decision_key)) current.set(row.decision_key, row);
  }
  return current;
}

async function buildDecisionEnvelope(
  input: MaritimeFeeInput,
  history: DecisionRow[],
) {
  const { proposals, warnings } = buildMaritimeFeeProposals(input, PARAMETRAGE);
  const current = currentByKey(history);
  const seen = new Set<string>();
  const proposalViews = [];

  for (const proposal of proposals) {
    const decisionKey = buildDecisionKey(proposal, input);
    if (!decisionKey) continue;
    const proposalSnapshot = buildProposalSnapshot(
      decisionKey,
      input,
      proposal,
    );
    const proposalFingerprint = await sha256Hex(proposalSnapshot);
    const decision = current.get(decisionKey) ?? null;
    seen.add(decisionKey);
    proposalViews.push({
      ...proposal,
      decision_key: decisionKey,
      proposal_fingerprint: proposalFingerprint,
      current_decision: decision
        ? {
          ...decision,
          is_stale: decision.proposal_fingerprint !== proposalFingerprint,
        }
        : null,
    });
  }

  const unmatchedCurrentDecisions = [...current.values()]
    .filter((decision) => !seen.has(decision.decision_key))
    .map((decision) => ({ ...decision, is_stale: true }));

  return {
    ok: true,
    mode: "human_decision_support" as const,
    accounting_effect: "none" as const,
    amount_policy: "DECISIONS_REQUIRE_NEXT_PRICING_AND_P1_B2_GUARDS" as const,
    proposals: proposalViews,
    current_decisions: [...current.values()],
    unmatched_current_decisions: unmatchedCurrentDecisions,
    decision_history: history,
    warnings,
  };
}

function rpcErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("SUPPLIER_INVOICE_TTC_ATTESTATION_REQUIRED")) {
    return errorResponse("Attestez le montant TTC de ce frais sur la facture fournisseur, TVA incluse, avant de confirmer ou ajuster.", 422);
  }
  if (message.includes("IDEMPOTENCY_CONFLICT")) {
    return errorResponse(message, 409);
  }
  if (
    message.includes("STALE_DECISION") || message.includes("STALE_PROPOSAL")
  ) {
    return errorResponse(message, 409);
  }
  if (
    message.includes("PROPOSAL_NOT_CONFIRMABLE") ||
    message.includes("INVALID_STATE") ||
    message.includes("DECISION_NOT_FOUND")
  ) {
    return errorResponse(message, 422);
  }
  if (message.includes("VALIDATION_FAILED")) return errorResponse(message, 400);
  return errorResponse("Échec de la décision maritime.", 500);
}

async function rpcArgsForProposal(
  request: MutateMaritimeDecisionRequest,
  input: MaritimeFeeInput,
  proposal: MaritimeFeeProposal,
  actorUserId: string,
) {
  const prepared = await prepareProposalDecision(request, input, proposal);
  return {
    p_case_id: request.case_id,
    p_decision_key: prepared.decisionKey,
    p_proposal_id: proposal.id,
    p_proposal_category: proposal.category,
    p_decision_action: request.operation,
    p_suggested_amount_xof: proposal.suggested_amount_xof,
    p_decided_amount_xof: prepared.decidedAmountXof,
    p_currency: proposal.currency,
    p_evidence_level: proposal.evidence_level,
    p_source_reference: proposal.source_reference,
    p_decision_source: request.decision_source,
    p_justification: request.justification,
    p_proposal_fingerprint: prepared.proposalFingerprint,
    p_input_snapshot_hash: prepared.inputSnapshotHash,
    p_proposal_snapshot: prepared.proposalSnapshot,
    p_expected_decision_version: null,
    p_idempotency_key: request.idempotency_key,
    p_request_fingerprint: await computeRequestFingerprint(request),
    p_actor_user_id: actorUserId,
  };
}

function rpcArgsForRevoke(
  request: Extract<MaritimeDecisionRequest, { operation: "revoke" }>,
  current: DecisionRow,
  actorUserId: string,
) {
  return computeRequestFingerprint(request).then((requestFingerprint) => ({
    p_case_id: request.case_id,
    p_decision_key: request.decision_key,
    p_proposal_id: current.proposal_id,
    p_proposal_category: current.proposal_category,
    p_decision_action: "revoke",
    p_suggested_amount_xof: current.suggested_amount_xof,
    p_decided_amount_xof: null,
    p_currency: current.currency,
    p_evidence_level: current.evidence_level,
    p_source_reference: current.source_reference,
    p_decision_source: request.decision_source,
    p_justification: request.justification,
    p_proposal_fingerprint: current.proposal_fingerprint,
    p_input_snapshot_hash: current.input_snapshot_hash,
    p_proposal_snapshot: current.proposal_snapshot,
    p_expected_decision_version: request.expected_decision_version,
    p_idempotency_key: request.idempotency_key,
    p_request_fingerprint: requestFingerprint,
    p_actor_user_id: actorUserId,
  }));
}

export async function handleRequest(req: Request): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") {
    return errorResponse("Method not allowed. Use POST.", 405);
  }

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse("Corps JSON invalide.", 400);
  }
  const validated = validateMaritimeDecisionPayload(raw);
  if (!validated.ok) return errorResponse(validated.message, 400);
  const request = validated.value;

  const context = await loadCaseContext(
    request.case_id,
    auth.token,
    request.operation === "list" ? "read" : "write",
  );
  if (context instanceof Response) return context;

  try {
    const svc = serviceClient();
    const historyBefore = await readDecisionHistory(svc, request.case_id);
    if (request.operation === "list") {
      return jsonResponse(
        await buildDecisionEnvelope(context.input, historyBefore),
        200,
      );
    }

    let args: Record<string, unknown>;
    if (request.operation === "revoke") {
      const replayCandidate = historyBefore.find((row) =>
        row.idempotency_key === request.idempotency_key
      );
      if (replayCandidate) {
        // Une idempotency_key déjà enregistrée pour ce dossier existe : la
        // RPC idempotente doit arbitrer (rejeu identique ou
        // IDEMPOTENCY_CONFLICT) plutôt que d'être bloquée ici par une
        // version courante qui a avancé depuis l'appel d'origine.
        args = await rpcArgsForRevoke(request, replayCandidate, auth.user.id);
      } else {
        const current = currentByKey(historyBefore).get(request.decision_key);
        if (
          !current ||
          current.decision_version !== request.expected_decision_version
        ) {
          return errorResponse(
            "STALE_DECISION: décision absente ou version différente.",
            409,
          );
        }
        args = await rpcArgsForRevoke(request, current, auth.user.id);
      }
    } else {
      const { proposals } = buildMaritimeFeeProposals(
        context.input,
        PARAMETRAGE,
      );
      const proposal = proposals.find((candidate) =>
        candidate.id === request.proposal_id
      );
      if (!proposal) {
        return errorResponse("Proposition maritime introuvable.", 404);
      }
      args = await rpcArgsForProposal(
        request,
        context.input,
        proposal,
        auth.user.id,
      );
    }

    const { data, error } = await svc.rpc("record_maritime_fee_decision", args);
    if (error) throw new Error(error.message);
    const historyAfter = await readDecisionHistory(svc, request.case_id);
    return jsonResponse({
      ...(await buildDecisionEnvelope(context.input, historyAfter)),
      mutation: data,
    }, 200);
  } catch (error) {
    return rpcErrorResponse(error);
  }
}

if (import.meta.main) Deno.serve(handleRequest);
