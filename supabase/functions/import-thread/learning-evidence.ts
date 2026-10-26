// Extraction evidence is documentary support, never business/operator approval.
export interface LearningSource { id: string; body_text?: string | null }
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
}
function normalize(value: string): string { return value.normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase(); }
function containsLiteral(text: string, value: string): boolean {
  if (!value) return false;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const literalPattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, 'gu');
  const numbers = [...text.matchAll(/[+\-\u2212]?\d(?:[\d., ]*\d)?(?:e[+-]?\d+)?/gu)];
  for (const match of text.matchAll(literalPattern)) {
    const start = match.index! + match[0].length - match[1].length, end = start + match[1].length;
    // Never certify only a prefix/suffix of a signed, decimal or grouped number.
    if (!numbers.some(number => (number.index! < start && number.index! + number[0].length > start) ||
      (number.index! < end && number.index! + number[0].length > end))) return true;
  }
  return false;
}
export function candidateLearningData(
  extraction: { data?: unknown; evidence?: unknown; category?: string },
  sources: LearningSource[], threadId: string, emailIds: string[],
): ObjectValue {
  const data = { ...object(extraction.data) }, proposed = object(extraction.evidence);
  // Provenance is server-owned; model-provided history must never be adopted.
  for (const key of ['prior_source_history', 'extraction_evidence', 'source_thread_id', 'source_email_ids', '__proto__', 'constructor', 'prototype']) delete data[key];
  const fields: Record<string, ObjectValue> = Object.create(null);
  for (const [key, value] of Object.entries(data)) {
    const proof = object(proposed[key]);
    const source = sources.find(source => source.id === proof.source_email_id && emailIds.includes(source.id));
    const excerpt = typeof proof.source_excerpt === 'string' ? proof.source_excerpt : '';
    const literal = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? normalize(String(value)) : '';
    const supported = proof.status === 'explicit' && source && normalize(excerpt) &&
      containsLiteral(normalize(source.body_text || ''), normalize(excerpt)) && containsLiteral(normalize(excerpt), literal);
    fields[key] = supported
      ? { status: 'explicit', verification: 'literal_match_only', source_email_id: source.id, source_excerpt: excerpt }
      : { status: proof.status === 'inferred' ? 'inferred' : 'unknown', reason: 'not_verified_against_source' };
  }
  // A bare measurement does not state whether it applies to each item or the lot.
  if (extraction.category === 'marchandise') {
    for (const key of ['weight_scope', 'dimensions_scope']) {
      if (!fields[key]) fields[key] = { status: 'unknown', reason: 'scope_not_documented' };
    }
  }
  return {
    ...data,
    source_thread_id: threadId,
    source_email_ids: [...emailIds],
    extraction_evidence: {
      method: 'ai_extraction', approval: 'not_reviewed', description_status: 'ai_generated_unreviewed', fields,
    },
  };
}
export function previousLearningSources(existing: { source_id?: unknown; data?: unknown }): unknown[] {
  const data = object(existing.data);
  const history = Array.isArray(data.prior_source_history) ? [...data.prior_source_history] : [];
  history.push({ source_id: existing.source_id ?? null, source_thread_id: data.source_thread_id ?? null,
    source_email_ids: Array.isArray(data.source_email_ids) ? data.source_email_ids : [] });
  return history;
}
