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
export function isObsoletePadDraft(data: Record<string, unknown> | null | undefined): boolean {
  return !!data && hasPadGapReference(data.requested_gap_keys, data.source_action_dedupe_key ?? data.dedupe_key);
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

export function isCurrentGapDraft(data: Record<string, unknown> | null, keys: string[]): boolean {
  if (!data || isObsoletePadDraft(data) || !Array.isArray(data.requested_gap_keys)) return false;
  const old = [...new Set(data.requested_gap_keys)].sort();
  const current = [...new Set(keys)].sort();
  return current.length > 0 && old.length === current.length && old.every((key, i) => key === current[i]);
}

export function isUsableClientGapRequest(
  row: { gap_key: string; status: string; source_timeline_event_id?: string | null },
  sources: Array<{ id: string; event_data: unknown }>,
): boolean {
  if (row.gap_key === PAD_REVIEW_GAP_KEY) return false;
  // Sent/answered legitimate questions still need follow-up. No old body is
  // offered for sending; only an unsent draft needs proof of a clean source.
  if (row.status !== "drafted") return true;
  const source = sources.find(e => e.id === row.source_timeline_event_id)?.event_data as Record<string, unknown> | undefined;
  return !!source && source.kind === "reply_draft_v1" && !isObsoletePadDraft(source) &&
    Array.isArray(source.requested_gap_keys) && source.requested_gap_keys.includes(row.gap_key);
}
