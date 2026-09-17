import { proposeGroups, type Row } from "../_shared/scenario-proposal-domain.ts";
import { proposalClient } from "../_shared/scenario-source.ts";
import type { PadGroup } from "../_shared/pad-group-confirmation.ts";

export type GroupEvidence = { excerpt: string; reference: string; calculation: string; weightDraft: string; warnings: string[] };
/** Presentation only: no category, weight or decision is written or promoted. */
export function groupEvidence(groups: PadGroup[], client: unknown, facts: Row[], emails: Row[], fingerprint?: string): Record<string, GroupEvidence> {
  const identity = proposalClient(client, facts);
  if (identity.reason || !identity.email) return {};
  const proposal = proposeGroups(identity.email, emails);
  if (proposal.status !== "proposed" || proposal.groups.length !== groups.length) return {};
  const result: Record<string, GroupEvidence> = {};
  for (const group of groups) {
    const matches = proposal.groups.filter(g => g.unit_ref === group.unit_ref && g.quantity === group.quantity &&
      g.equipment.toUpperCase() === group.equipment_code.toUpperCase() && g.ownership === group.ownership &&
      g.weight_kg !== null && g.weight_kg * g.quantity === group.total_weight_kg);
    if (matches.length !== 1) continue;
    const g = matches[0];
    const refs: string[] = group.description.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi) ?? [];
    const hashes = [...group.description.matchAll(/SHA256\s+([a-f0-9]{64})\b/gi)];
    if (refs.length ? !refs.includes(g.source_email_id) || hashes.length !== 1 || !fingerprint || hashes[0][1] !== fingerprint
      : group.description.trim() !== g.excerpt.trim()) continue;
    const range = g.assumptions.some(a => a.includes("fourchette"));
    const reference = `E-mail ${g.source_email_id}`;
    const calculation = `${g.quantity} × ${g.weight_kg!.toLocaleString("fr-FR")} kg = ${group.total_weight_kg!.toLocaleString("fr-FR")} kg`;
    result[group.unit_ref] = { excerpt: g.excerpt, reference, calculation,
      weightDraft: range ? "" : `${reference} : ${g.excerpt}. Calcul : ${calculation}. Allocation au groupe à vérifier.`,
      warnings: [...g.assumptions, ...(range ? ["La borne haute du scénario n’est pas un poids exact confirmé. Précisez une source de poids exact avant le devis."] : [])] };
  }
  return result;
}
