import { readOverridesFromFacts, resolveEffectiveServiceKeys } from './service-scope.ts';

export type RequestEmail = { id: string; from_address?: string | null; body_text?: string | null; sent_at?: string | null };
export type ScopeFact = { id?: string; fact_key: string; value_text?: string | null; value_json?: unknown; value_number?: number | null; source_type?: string | null; source_excerpt?: string | null; is_validated?: boolean };
export type ServiceEvidence = { service: string; basis: 'explicit' | 'inferred' | 'package_default' | 'operator'; email_id: string | null; excerpt: string; reason?: string; fact_id?: string };
export type DocumentRequest = { email_id: string; excerpt: string; cancellation_requested: boolean; cancellation_email_id?: string; cancellation_excerpt?: string };
export type RequestServiceEvidence = { mode: 'destination' | 'conflicting'; freight_scope: boolean | null; freight_scope_basis: 'inferred_destination' | 'explicit_request' | 'explicit_exclusion' | 'operator' | 'conflict'; services: ServiceEvidence[]; service_changes?: Array<{ service: string; requested: boolean | null; email_id: string; excerpt: string }>; document_request: DocumentRequest | null; source_email_id: string };
const protectedFact = (f: ScopeFact) => f.is_validated === true || ['operator', 'operator_correction', 'manual_input'].includes(f.source_type ?? '');
const normalizedAddress = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** Own message content only; quoted requests must not reverse a later explicit change. */
export function ownRequestText(body: string): string {
  let depth = 0;
  const withoutQuotes = (body.match(/<!--[^]*?-->|<\/?blockquote\b[^>]*>|[^<]+|<[^>]*>/gi) ?? []).filter(token => {
    if (/^<blockquote\b/i.test(token)) { depth++; return false; }
    if (/^<\/blockquote\b/i.test(token)) { depth = Math.max(0, depth - 1); return false; }
    return depth === 0 && !token.startsWith('<!--');
  }).join('');
  const text = withoutQuotes.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<(?:br|\/p|\/div|\/tr)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&');
  return text.split(/\n(?:On .{0,200}wrote:|Le .{0,200}écrit\s*:|[- ]*Original Message[- ]*|From\s*:|De\s*:)/i)[0]
    .split(/\r?\n/).filter(line => !/^\s*>/.test(line)).join('\n');
}
const excerpt = (text: string, pattern: RegExp) => text.match(pattern)?.[0].trim() ?? '';
function positiveExcerpt(text: string, pattern: RegExp): string {
  for (const match of text.matchAll(new RegExp(pattern.source, 'gi'))) {
    const prefix = text.slice(Math.max(0, (match.index ?? 0) - 45), match.index);
    if (!/(?:do\s+not|don't|excluding|ne\s+pas|no)\s*(?:(?:include|quote|request|arrange|need|provide)\s*)?$/i.test(prefix)) return match[0].trim();
  }
  return '';
}
export function deriveConsigneeDocumentRequest(emails: RequestEmail[], externalAddresses: string[]): DocumentRequest | null {
  const trusted = new Set(externalAddresses.map(normalizedAddress).filter(Boolean));
  let request: DocumentRequest | null = null;
  for (const email of [...emails].sort((a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? '') || a.id.localeCompare(b.id))) {
    if (!trusted.has(normalizedAddress(email.from_address))) continue;
    const text = ownRequestText(email.body_text ?? '');
    const docs = positiveExcerpt(text, /(?:please\s+(?:talk|contact)[^\n.]{0,110}(?:consignee|receiver)|(?:contacter|vérifier)[^\n.]{0,90}destinataire)/i);
    const registration = excerpt(text, /(?:customs\s+documents\s+and\s+registration|documents\s+douaniers[^\n.]{0,40}immatriculation)/i);
    if (docs && registration) {
      const start = Math.min(text.indexOf(docs), text.indexOf(registration));
      const end = Math.max(text.indexOf(docs) + docs.length, text.indexOf(registration) + registration.length);
      request = { email_id: email.id, excerpt: text.slice(start, end), cancellation_requested: false };
    }
    const cancellation = excerpt(text, /(?:do\s+not\s+contact\s+(?:the\s+)?consignee|cancel[^\n.]{0,40}(?:document|registration)\s*(?:check|verification)|annuler[^\n.]{0,40}vérification)/i);
    if (request && cancellation) request = { ...request, cancellation_requested: true, cancellation_email_id: email.id, cancellation_excerpt: cancellation };
  }
  return request;
}

/** Narrow, sourced interpretation. No names/subject rules, tariff or operator-fact writes. */
export function deriveRequestServiceEvidence(emails: RequestEmail[], facts: ScopeFact[], externalAddresses: string[]): RequestServiceEvidence | null {
  const trusted = new Set(externalAddresses.map(normalizedAddress).filter(Boolean));
  if (!trusted.size) return null;
  let result: RequestServiceEvidence | null = null;
  const documentRequest = deriveConsigneeDocumentRequest(emails, externalAddresses);
  const ordered = [...emails].sort((a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? '') || a.id.localeCompare(b.id));
  for (const email of ordered) {
    if (!trusted.has(normalizedAddress(email.from_address))) continue;
    const text = ownRequestText(email.body_text ?? '');
    const door = positiveExcerpt(text, /(?:door\s+delivery\s+charges|destination\s+(?:delivery|charges)|livraison\s+(?:à|a)\s+domicile)[^\n.]{0,80}/i);
    const air = excerpt(text, /(?:attached\s+air\s+shipment|air\s+shipment|envoi\s+aérien)/i);
    const ddp = excerpt(text, /\bDDP\b[^\n.]{0,65}/i);
    const origin = excerpt(text, /(?:proceed\s+(?:the\s+)?shipment\s+from\s+(?:the\s+)?origin|(?:expédier|expédition)[^\n.]{0,40}(?:depuis|à)\s+l['’]origine)/i);
    if (door && air && ddp && origin && !result) {
      result = { mode: 'destination', freight_scope: false, freight_scope_basis: 'inferred_destination', source_email_id: email.id, document_request: documentRequest, services: [
        { service: 'AIR_HANDLING', basis: 'inferred', email_id: email.id, excerpt: air, reason: 'Prise en charge à l’arrivée pour la livraison demandée' },
        { service: 'CUSTOMS_DAKAR', basis: 'inferred', email_id: email.id, excerpt: ddp, reason: 'Prestation destination du périmètre DDP proposé' },
        { service: 'TRUCKING', basis: 'explicit', email_id: email.id, excerpt: door },
        { service: 'AGENCY', basis: 'package_default', email_id: email.id, excerpt: ddp, reason: 'Coordination du package destination proposé ; honoraires soumis au tarif applicable' },
      ] };
    }
    if (!result) continue;
    const includePattern = /(?:please\s+)?(?:include|add|quote|arrange|book)[^\n.]{0,45}(?:international|air)\s+freight|(?:ajouter|inclure|coter)[^\n.]{0,45}fret\s+(?:international|aérien)/i;
    const include = positiveExcerpt(text, includePattern);
    const exclude = excerpt(text, /(?:do\s+not|don't|exclude|excluding)[^\n.]{0,45}(?:international|air)\s+freight|(?:international|air)\s+freight[^\n.]{0,30}(?:already\s+(?:arranged|paid)|prepaid)|(?:exclure|ne\s+pas\s+inclure)[^\n.]{0,45}fret\s+(?:international|aérien)/i);
    if (include || exclude) {
      result = { ...result, source_email_id: email.id, freight_scope: include && exclude ? null : !!include, freight_scope_basis: include && exclude ? 'conflict' : include ? 'explicit_request' : 'explicit_exclusion', mode: include && exclude ? 'conflicting' : 'destination', services: result.services.filter(s => s.service !== 'AIR_FREIGHT') };
      if (include && !exclude) result.services.push({ service: 'AIR_FREIGHT', basis: 'explicit', email_id: email.id, excerpt: include });
    }
    for (const [service, words] of [['TRUCKING', '(?:door|local|road)\\s+delivery'], ['CUSTOMS_DAKAR', 'customs\\s+clearance'], ['AIR_HANDLING', '(?:air|airport)\\s+handling']] as const) {
      const remove = excerpt(text, new RegExp(`(?:do\\s+not|don't|exclude|excluding)[^\\n.]{0,35}${words}`, 'i'));
      const add = positiveExcerpt(text, new RegExp(`(?:include|add|quote)[^\\n.]{0,35}${words}`, 'i'));
      if (!remove && !add) continue;
      const requested = remove && add ? null : !!add;
      result.service_changes = [...(result.service_changes ?? []).filter(s => s.service !== service), { service, requested, email_id: email.id, excerpt: remove || add }];
      result.source_email_id = email.id;
      if (requested === null) { result.mode = 'conflicting'; continue; }
      result.services = result.services.filter(s => s.service !== service);
      if (requested) result.services.push({ service, basis: 'explicit', email_id: email.id, excerpt: add });
    }
    result.document_request = documentRequest;
  }
  if (!result) return null;
  const incoterm = facts.find(f => f.fact_key === 'routing.incoterm' && protectedFact(f));
  if (incoterm && incoterm.value_text?.toUpperCase() !== 'DDP') return null;
  const packageFact = facts.find(f => f.fact_key === 'service.package' && protectedFact(f));
  if (packageFact && packageFact.value_text?.toUpperCase() !== 'AIR_IMPORT_DDP') return null;
  const overrideFact = facts.find(f => f.fact_key === 'service.overrides' && protectedFact(f));
  if (overrideFact) {
    const overrides = readOverridesFromFacts([{ fact_key: overrideFact.fact_key, value_json: overrideFact.value_json, value_text: overrideFact.value_text ?? undefined }]);
    const selected = resolveEffectiveServiceKeys('AIR_IMPORT_DDP', overrides);
    // Only explicit add/remove overrides control a service; a protected empty override
    // must not silently cancel a later client request or re-add a withdrawn proposal.
    result.services = result.services.filter(s => !overrides.remove.includes(s.service) || overrides.add.includes(s.service));
    for (const service of overrides.add) if (!result.services.some(s => s.service === service)) result.services.push({ service, basis: 'operator', email_id: null, fact_id: overrideFact.id, excerpt: overrideFact.source_excerpt ?? 'Décision opérateur service.overrides' });
    if (overrides.add.includes('AIR_FREIGHT') || overrides.remove.includes('AIR_FREIGHT')) { result.freight_scope = selected.includes('AIR_FREIGHT'); result.freight_scope_basis = 'operator'; }
  }
  return result;
}

/** Producer uses flat event_data; legacy consumers also accepted a scope wrapper. */
export function readServiceScopeEvent(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const scope = record.scope && typeof record.scope === 'object' && !Array.isArray(record.scope) ? record.scope as Record<string, unknown> : record;
  return ['freight_scope', 'customs_scope', 'transit_scope', 'document_scope'].some(key => typeof scope[key] === 'boolean' || scope[key] === null) ? scope : null;
}

/** Reuse the existing append-only manual_action/close-manual-action workflow. */
export function documentVerificationAction(caseId: string, request: NonNullable<RequestServiceEvidence['document_request']>, events: Array<{ event_data?: unknown }>): Record<string, unknown> | null {
  const dedupeKey = `VERIFY_CONSIGNEE_DOCUMENTS:${caseId}`;
  const latest = events.find(e => e.event_data && typeof e.event_data === 'object' && (e.event_data as Record<string, unknown>).dedupe_key === dedupeKey)?.event_data as Record<string, unknown> | undefined;
  if (latest && (latest.status === 'done' || latest.cancellation_requested === request.cancellation_requested || !request.cancellation_requested)) return null;
  return { case_id: caseId, event_type: 'manual_action', actor_type: 'system', related_email_id: request.cancellation_email_id ?? request.email_id, event_data: { dedupe_key: dedupeKey, action_code: 'VERIFY_CONSIGNEE_DOCUMENTS', status: 'open', title_fr: 'Vérifier les documents et l’immatriculation du destinataire', description_fr: request.cancellation_requested ? 'Annulation demandée dans le fil : décision opérateur nécessaire ; aucune conformité attestée.' : 'Contacter le destinataire et vérifier les documents/immatriculation avant départ ; aucune conformité attestée.', source_email_id: request.email_id, source_excerpt: request.excerpt, cancellation_requested: request.cancellation_requested, cancellation_email_id: request.cancellation_email_id, cancellation_excerpt: request.cancellation_excerpt } };
}
