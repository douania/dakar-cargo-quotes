import { CLIENT_QUESTION_POLICY_VERSION } from '../../supabase/functions/_shared/client-gap-policy';
export { isRequiredClientGap, isRequiredClientGapForCase } from "../../supabase/functions/_shared/client-gap-policy";
// Shared pure policy, plus frontend-only refresh of its independent readers.
export * from "../../supabase/functions/_shared/pad-gap-review";
export { PAD_WEIGHT_REVIEW_FR, PAD_WEIGHT_REVIEW_TITLE } from "../../supabase/functions/_shared/pad-weight-reconciliation";

import type { QueryClient } from "@tanstack/react-query";
import { PAD_REVIEW_GAP_KEY } from "../../supabase/functions/_shared/pad-gap-review";

export function needsPadReview(gaps: Array<{ gap_key: string; status?: string }>): boolean {
  return gaps.some(gap => gap.gap_key === PAD_REVIEW_GAP_KEY && gap.status === "open");
}

// Refresh every independent reader of the gap state after a dossier mutation.
export function refreshGapActionQueries(client: QueryClient, caseId: string): Promise<unknown[]> {
  return Promise.all(["ready-actions-panel", "next-action-banner", "cockpit-state"].map(key =>
    client.invalidateQueries({ queryKey: [key, caseId] })));
}

// Receipt for the deterministic client-gap path only, not a pricing approval.
export function isConfirmedClientGapDraftResponse(data: unknown): boolean {
  const result=data as {ok?:unknown;client_question_policy_version?:unknown;client_gap_fence_version?:unknown}|null;
  return result?.ok === true && result.client_question_policy_version === CLIENT_QUESTION_POLICY_VERSION && result.client_gap_fence_version === 1;
}

export const CLIENT_GAP_LEGACY_NOTICE="Ancien brouillon conservé. La préparation actualisée n’est pas encore disponible ; vérifiez l’état du dossier avant de réessayer.";
export const CLIENT_GAP_UNCONFIRMED_NOTICE="La préparation n’est pas confirmée. Actualisez le dossier pour vérifier son état avant de réessayer.";
