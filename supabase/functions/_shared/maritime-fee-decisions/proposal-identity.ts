// P1-B2 — identité canonique d'une proposition maritime (empreinte B1 partagée).
//
// Ces helpers viennent VERBATIM de `manage-maritime-fee-decision/domain.ts`
// (lot P1-B1). Ils sont remontés ici sans le moindre changement de doctrine pour
// une raison unique : `run-pricing` doit recalculer EXACTEMENT la même empreinte
// que celle figée à l'enregistrement de la décision. Deux implémentations = deux
// notions de fraîcheur, donc une décision périmée consommée comme fraîche (ou
// l'inverse). `domain.ts` réexporte désormais ce module : une seule source.
//
// Module PUR : pas de Supabase, pas de fetch, pas de Deno.env, pas d'écriture.
// `crypto.subtle` (WebCrypto standard) est la seule dépendance runtime.

import type {
  MaritimeFeeInput,
  MaritimeFeeProposal,
} from "../maritime-fee-proposals/engine.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

/** Sérialisation stable (clés triées récursivement) — base de toute empreinte. */
export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** SHA-256 hexadécimal de la sérialisation stable. */
export async function sha256Hex(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  )
    .join("");
}

/**
 * Clé de décision d'une proposition. `null` = proposition NON décidable
 * (donc jamais consommable par le pricing).
 */
export function buildDecisionKey(
  proposal: MaritimeFeeProposal,
  input: MaritimeFeeInput,
): string | null {
  if (
    proposal.id === "pad-taxe-de-port" && proposal.category === "taxe_de_port"
  ) {
    return "PAD_DROIT_PASSAGE";
  }
  if (
    proposal.id === "commission-debours" &&
    proposal.category === "commission_debours"
  ) {
    const carrier = String(input.carrier ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return carrier ? `CARRIER_DEBOURS_COMMISSION:${carrier}` : null;
  }
  return null;
}

/**
 * Snapshot figé d'une proposition. `proposal.amount` reste `null` : une
 * proposition n'est JAMAIS un montant ferme (doctrine B1, contrainte SQL
 * `maritime_fee_decisions_snapshot_identity`).
 */
export function buildProposalSnapshot(
  decisionKey: string,
  input: MaritimeFeeInput,
  proposal: MaritimeFeeProposal,
): Record<string, unknown> {
  return {
    schema_version: 1,
    decision_key: decisionKey,
    input: {
      operation_type: input.operation_type ?? null,
      cargo_mode: input.cargo_mode ?? null,
      carrier: input.carrier ?? null,
      pad_category: input.pad_category ?? null,
      tonnage: input.tonnage ?? null,
      seafreight: input.seafreight ?? null,
      usd_to_xof_rate: input.usdToXofRate ?? null,
    },
    proposal: {
      id: proposal.id,
      category: proposal.category,
      label: proposal.label,
      amount: null,
      currency: proposal.currency,
      suggested_amount_xof: proposal.suggested_amount_xof,
      suggested_formula: proposal.suggested_formula,
      source_reference: proposal.source_reference,
      evidence_level: proposal.evidence_level,
      needs_human_confirmation: true,
      reason: proposal.reason,
      missing_confirmation: [...proposal.missing_confirmation],
    },
  };
}

/** Identité courante d'une proposition, telle que le pricing la recalcule. */
export interface CurrentProposalIdentity {
  decisionKey: string;
  proposal: MaritimeFeeProposal;
  snapshot: Record<string, unknown>;
  fingerprint: string;
}

/**
 * Recalcule, pour les faits COURANTS du dossier, l'identité de chaque
 * proposition décidable. Une décision dont l'empreinte ne figure pas ici est
 * périmée par construction : les faits ont bougé depuis la décision humaine.
 *
 * Les propositions non décidables (`buildDecisionKey` = null) sont ignorées :
 * aucune décision n'a pu être enregistrée sur elles.
 */
export async function computeCurrentProposalIdentities(
  input: MaritimeFeeInput,
  proposals: MaritimeFeeProposal[],
): Promise<CurrentProposalIdentity[]> {
  const identities: CurrentProposalIdentity[] = [];
  for (const proposal of proposals ?? []) {
    const decisionKey = buildDecisionKey(proposal, input);
    if (!decisionKey) continue;
    const snapshot = buildProposalSnapshot(decisionKey, input, proposal);
    identities.push({
      decisionKey,
      proposal,
      snapshot,
      fingerprint: await sha256Hex(snapshot),
    });
  }
  return identities;
}
