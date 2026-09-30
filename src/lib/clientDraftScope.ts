export interface ClientDraftRequest {
  id: string;
  gap_key: string;
  status: string;
  source_timeline_event_id?: string | null;
  draft_subject?: string | null;
  draft_body?: string | null;
}

export interface ClientDraftScope {
  sourceId: string;
  subject: string;
  body: string;
  gapKeys: string[];
  requestIds: string[];
}

// A displayed message owns only the requests with the same persisted source and text.
// Legacy rows without a source/body must be reviewed in the dossier, never bulk-marked.
export function clientDraftScopes(rows: ClientDraftRequest[]): ClientDraftScope[] {
  const scopes = new Map<string, ClientDraftScope>();
  for (const row of rows) {
    if (row.status !== 'drafted' || !row.source_timeline_event_id || !row.draft_body?.trim()) continue;
    const key = JSON.stringify([row.source_timeline_event_id, row.draft_subject ?? '', row.draft_body]);
    let scope = scopes.get(key);
    if (!scope) {
      scope = { sourceId: row.source_timeline_event_id, subject: row.draft_subject ?? '', body: row.draft_body, gapKeys: [], requestIds: [] };
      scopes.set(key, scope);
    }
    if (!scope.gapKeys.includes(row.gap_key)) scope.gapKeys.push(row.gap_key);
    scope.requestIds.push(row.id);
  }
  return [...scopes.values()];
}

export function isCurrentClientDraft(scope: ClientDraftScope, rows: ClientDraftRequest[]): boolean {
  return scope.gapKeys.length > 0 && scope.requestIds.every(id => rows.some(row =>
    row.id === id && row.status === 'drafted' && row.source_timeline_event_id === scope.sourceId
    && (row.draft_subject ?? '') === scope.subject && row.draft_body === scope.body
    && scope.gapKeys.includes(row.gap_key)))
    && rows.filter(row => scope.gapKeys.includes(row.gap_key)).every(row => scope.requestIds.includes(row.id));
}
