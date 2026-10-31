import { hasClientGapGuard, sameClientGapScope, type ClientGapScope } from './client-gap-scope.ts';
import { CLIENT_QUESTION_POLICY_VERSION } from "./client-gap-policy.ts";
/** PAD is an operator classification task, not evidence of a missing cargo description.
 * Missing/ambiguous client facts keep their own gaps. No classification or pricing here.
 */
export const PAD_REVIEW_GAP_KEY = "pricing.pad_category";
export const PAD_REVIEW_TITLE = "Vérifier la classification PAD en interne";
export const PAD_REVIEW_FR = "Revue interne : examiner les descriptions, groupes et sources déjà disponibles pour valider la catégorie et le tarif PAD du devis confirmé. Une proposition de scénario ne vaut pas validation du dossier. Demander au client uniquement une précision identifiée comme manquante après cette revue.";
export const PAD_REVIEW_EN = "Internal review: use the available descriptions, cargo groups and sources to validate the PAD category and rate for the confirmed quote. A scenario proposal is not a confirmed case fact. Ask the customer only for a specific detail identified as missing after this review.";

export function hasPadGapReference(keys: unknown, sourceKey?: unknown): boolean {
  return (Array.isArray(keys) && keys.includes(PAD_REVIEW_GAP_KEY)) ||
    (typeof sourceKey === "string" && sourceKey.split(/[:,]/).includes(PAD_REVIEW_GAP_KEY));
}

/** Entire mixed drafts are stale: removing a key does not remove its question from the body. */
export function isObsoletePadDraft(data: Record<string, unknown> | null | undefined, currentKeys?: string[]): boolean {
  if (!data) return false;
  const sourceKey = data.source_action_dedupe_key ?? data.dedupe_key;
  const clientBody = data.kind === "reply_draft_v1" &&
    ((Array.isArray(data.requested_gap_keys) && data.requested_gap_keys.length > 0) ||
      (typeof sourceKey === "string" && sourceKey.startsWith("REQUEST_CLIENT_INFO_FOR_GAPS:")));
  // Historical API name retained for all existing UI/mark-sent readers. Retire
  // whole outdated customer bodies, never generic replies or sent/answered history.
  if (hasPadGapReference(data.requested_gap_keys, sourceKey)) return true;
  if (!clientBody) return false;
  if (data.client_question_policy_version !== CLIENT_QUESTION_POLICY_VERSION || !hasClientGapGuard(data)) return true;
  if (currentKeys === undefined) return false;
  if (!Array.isArray(data.requested_gap_keys)) return true;
  const old = [...new Set(data.requested_gap_keys)].sort(), current = [...new Set(currentKeys)].sort();
  return !current.length || old.length !== current.length || old.some((key, i) => key !== current[i]);
}

/** Append-only action histories must be reduced BEFORE checking for an open action. */
export function latestGapActions<T extends { event_data: unknown }>(events: T[]): T[] {
  const seen = new Set<string>();
  return events.filter(event => {
    const data = event.event_data as Record<string, unknown> | null;
    if (data?.action_code !== "REQUEST_CLIENT_INFO_FOR_GAPS" || typeof data.dedupe_key !== "string") return false;
    if (seen.has(data.dedupe_key)) return false;
    seen.add(data.dedupe_key);
    return true;
  });
}

export function isCurrentGapDraft(data: Record<string, unknown> | null, keys: string[], scope?: ClientGapScope): boolean {
  if (!data || data.kind !== "reply_draft_v1" || data.client_question_policy_version !== CLIENT_QUESTION_POLICY_VERSION || isObsoletePadDraft(data) || !Array.isArray(data.requested_gap_keys)) return false;
  if (scope && !sameClientGapScope(data, scope)) return false;
  const old = [...new Set(data.requested_gap_keys)].sort();
  const current = [...new Set(keys)].sort();
  return current.length > 0 && old.length === current.length && old.every((key, i) => key === current[i]);
}

export function isUsableClientGapRequest(
  row: { gap_key: string; status: string; source_timeline_event_id?: string | null },
  sources: Array<{ id: string; event_data: unknown }>,
  currentKeys?: string[],
): boolean {
  if (row.gap_key === PAD_REVIEW_GAP_KEY) return false;
  // Sent/answered legitimate questions still need follow-up. No old body is
  // offered for sending; only an unsent draft needs proof of a clean source.
  if (row.status !== "drafted") return true;
  const source = sources.find(e => e.id === row.source_timeline_event_id)?.event_data as Record<string, unknown> | undefined;
  return !!source && source.kind === "reply_draft_v1" && !isObsoletePadDraft(source, currentKeys) &&
    Array.isArray(source.requested_gap_keys) && source.requested_gap_keys.includes(row.gap_key);
}
