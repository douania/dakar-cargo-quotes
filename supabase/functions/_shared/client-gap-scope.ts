/** Transport scope evidence only. Not a new pricing or customer-necessity rule. */
export type ClientGapScope = Array<{ id: string; key: string; blocking: boolean }>;
export function clientGapScope(gaps: Array<{id?:unknown;gap_key?:unknown;is_blocking?:unknown}>): ClientGapScope {
  const seen = new Set<string>();
  const rows = gaps.map(g => {
    if (typeof g.id !== 'string' || !g.id || seen.has(g.id) || typeof g.gap_key !== 'string' || !g.gap_key)
      throw new Error('CLIENT_GAP_SCOPE_UNAVAILABLE');
    seen.add(g.id);
    return {id:g.id,key:g.gap_key,blocking:g.is_blocking === true};
  });
  return rows.sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export function clientGapGuard(gaps: Parameters<typeof clientGapScope>[0]) {
  return {version:1,scope:clientGapScope(gaps)};
}
export function hasClientGapGuard(data: Record<string,unknown>): boolean {
  const guard = data.client_gap_guard as {version?:unknown;scope?:unknown} | null;
  return data.client_gap_fence_version === 1 && guard?.version === 1 && Array.isArray(guard.scope) && guard.scope.every(row =>
    row && typeof row.id === 'string' && !!row.id && typeof row.key === 'string' && !!row.key && typeof row.blocking === 'boolean')
    && guard.scope.every((row,i,rows) => i === 0 || rows[i-1].id < row.id);
}
export function sameClientGapScope(data: Record<string,unknown>, scope: ClientGapScope): boolean {
  if (!hasClientGapGuard(data)) return false;
  const guard = data.client_gap_guard as {scope:ClientGapScope};
  return guard.scope.length === scope.length && guard.scope.every((row,i) =>
    row.id === scope[i].id && row.key === scope[i].key && row.blocking === scope[i].blocking);
}
