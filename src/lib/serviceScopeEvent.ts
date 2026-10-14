import { readServiceScopeEvent } from '../../supabase/functions/_shared/request-service-evidence';

export function parseServiceScopeEvent(data: unknown) {
  const scope = readServiceScopeEvent(data);
  if (!scope) return null;
  const bool = (value: unknown) => typeof value === 'boolean' ? value : null;
  return { freightScope: bool(scope.freight_scope), customsScope: bool(scope.customs_scope), transitScope: bool(scope.transit_scope), documentScope: bool(scope.document_scope), freightScopeBasis: typeof scope.freight_scope_basis === 'string' ? scope.freight_scope_basis : undefined };
}
