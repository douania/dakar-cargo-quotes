import { proposeGroups, proposalFingerprint } from "../_shared/scenario-proposal-domain.ts";
import { proposalClient } from "../_shared/scenario-source.ts";
import { normalize, type Row } from "./domain.ts";

/** Strict source-to-scenario join, never ordinal alone. No facts or classifications written. */
export function matchSourceUnits(units: Row[], client: unknown, facts: Row[], emails: Row[]) {
  const identity = proposalClient(client, facts);
  if (identity.reason || !identity.email) throw new Error("SOURCE_CLIENT_UNVERIFIED");
  const proposal = proposeGroups(identity.email, emails);
  if (proposal.status !== "proposed" || proposal.groups.length !== units.length) throw new Error("SOURCE_CARGO_REVIEW_REQUIRED");
  return units.map(u => {
    const matches = proposal.groups.filter(g => g.unit_ref === u.unit_ref);
    const g = matches[0];
    if (matches.length !== 1 || !g || g.quantity !== u.quantity || g.equipment.toLowerCase() !== String(u.equipment_code).toLowerCase() ||
      g.ownership !== u.ownership || g.weight_kg !== u.gross_weight_kg || g.weight_basis !== u.weight_basis ||
      g.un_number !== u.un_number || g.dangerous !== u.dangerous_goods || (g.imo_class ?? null) !== (u.imo_class ?? null)) throw new Error("SOURCE_GROUP_MISMATCH");
    const refs: string[] = String(u.scenario_basis ?? "").match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi) ?? [];
    if (refs.length ? !refs.includes(g.source_email_id) : normalize(u.scenario_basis) !== normalize(g.excerpt)) throw new Error("SOURCE_EMAIL_MISMATCH");
    return { ...u, scenario_basis: g.excerpt, source_email_id: g.source_email_id,
      source_note: "Extrait client ; affectation au lot rapprochée au scénario, non confirmation de la classification." };
  });
}
export { proposalFingerprint };
