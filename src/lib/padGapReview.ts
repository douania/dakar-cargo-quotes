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
  return Promise.all(["ready-actions-panel", "cockpit-state"].map(key =>
    client.invalidateQueries({ queryKey: [key, caseId] })));
}
