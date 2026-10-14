import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { deriveRequestServiceEvidence, documentVerificationAction, ownRequestText, readServiceScopeEvent, type RequestEmail, type ScopeFact } from './request-service-evidence.ts';
const source = 'partner@example.invalid';
const text = 'We are WCA member from an origin country and need DDP charges. Please let us know the DOOR Delivery charges for attached air shipment.\nPlease talk with above consignee. If they have proper customs documents and registration so we can proceed shipment from the origin.';
const root: RequestEmail = { id: 'root', from_address: source, sent_at: '2026-01-01T00:00:00Z', body_text: text };
const later = (body_text: string, from_address = source): RequestEmail => ({ id: 'later', from_address, sent_at: '2026-01-01T01:00:00Z', body_text });
const derive = (emails = [root], facts: ScopeFact[] = []) => deriveRequestServiceEvidence(emails, facts, [source]);

Deno.test('request evidence: origin/destination clauses produce sourced proposal without subject or client names', () => {
  const evidence = derive()!;
  assertEquals(evidence.freight_scope, false); assertEquals(evidence.freight_scope_basis, 'inferred_destination');
  assertEquals(evidence.services.map(s => s.service), ['AIR_HANDLING', 'CUSTOMS_DAKAR', 'TRUCKING', 'AGENCY']);
  for (const s of evidence.services) { assertEquals(s.email_id, 'root'); assert(text.includes(s.excerpt)); }
  assertEquals(evidence.document_request?.email_id, 'root');
});
Deno.test('request evidence: DDP alone, air alone and untrusted sender do not establish destination-only mission', () => {
  for (const body_text of ['DDP air shipment', 'Please quote air freight DDP', text.replace('proceed shipment from the origin', '')]) assertEquals(derive([{ ...root, body_text }]), null);
  assertEquals(deriveRequestServiceEvidence([root], [], []), null);
  assertEquals(derive([ { ...root, from_address: 'other@example.invalid' } ]), null);
});
Deno.test('request evidence: acknowledgement and quoted request do not change freight interpretation', () => {
  assertEquals(derive([root, later('Acknowledged. We will proceed and report back.')]), derive());
  assertEquals(derive([root, later('Acknowledged.\nOn yesterday, Partner wrote:\nPlease include air freight.')]), derive());
  assertEquals(ownRequestText('Acknowledged.\n> Please include air freight.'), 'Acknowledged.');
});
Deno.test('request evidence: explicit later freight addition is sourced, outbound text is not a client instruction', () => {
  const evidence = derive([root, later('Please include international freight.')])!;
  assertEquals(evidence.freight_scope, true); assertEquals(evidence.freight_scope_basis, 'explicit_request');
  assertEquals(evidence.services.at(-1)?.email_id, 'later'); assertEquals(evidence.services.at(-1)?.service, 'AIR_FREIGHT');
  assertEquals(derive([root, later('Please include international freight.', 'internal@example.invalid')]), derive());
});
Deno.test('request evidence: explicit exclusion differs from inferred scope; contradictory same-message signals remain unknown', () => {
  const excluded = derive([root, later('Do not include air freight.')])!;
  assertEquals(excluded.freight_scope, false); assertEquals(excluded.freight_scope_basis, 'explicit_exclusion');
  const conflict = derive([root, later('Include air freight. Do not include air freight.')])!;
  assertEquals(conflict.freight_scope, null); assertEquals(conflict.mode, 'conflicting');
});
Deno.test('request evidence: opposite freight clauses conflict in either order', () => {
  for (const body of ['Do not include air freight. Include air freight.', 'Include air freight. Do not include air freight.']) {
    assertEquals(derive([root, later(body)])!.freight_scope, null);
    assertEquals(derive([root, later(body)])!.freight_scope_basis, 'conflict');
  }
});
Deno.test('request evidence: repeating destination request does not erase a previous explicit freight addition', () => {
  const addition = later('Please include international freight.');
  const repeat = { ...root, id: 'repeat', sent_at: '2026-01-01T02:00:00Z' };
  const evidence = derive([root, addition, repeat])!;
  assertEquals(evidence.freight_scope, true); assertEquals(evidence.freight_scope_basis, 'explicit_request');
  assertEquals(evidence.services.find(s => s.service === 'AIR_FREIGHT')?.email_id, 'later');
});
Deno.test('request evidence: HTML blockquotes including nested quotes cannot override current instructions', () => {
  for (const body of ['<p>Include international freight.</p><blockquote>Do not include air freight.</blockquote>', '<p>Include international freight.</p><blockquote>old<blockquote>older</blockquote>Do not include air freight.</blockquote>']) {
    assertEquals(derive([root, later(body)])!.freight_scope, true);
  }
});
Deno.test('request evidence: negated initial door-delivery request does not propose four destination services', () => {
  for (const prefix of ['Please do not quote ', 'Do not include ']) assertEquals(derive([{ ...root, body_text: text.replace('DOOR Delivery charges', prefix + 'DOOR Delivery charges') }]), null);
});
Deno.test('request evidence: manual/validated scope facts and provenance dominate inferred request', () => {
  for (const authority of [{ source_type: 'operator' }, { is_validated: true }]) {
    assertEquals(derive([root], [{ fact_key: 'routing.incoterm', value_text: 'EXW', ...authority }]), null);
    assertEquals(derive([root], [{ fact_key: 'service.package', value_text: 'AIR_IMPORT_EXW', ...authority }]), null);
    const evidence = derive([root], [{ id: 'human-fact', fact_key: 'service.overrides', value_json: { add: ['AIR_FREIGHT'], remove: [] }, source_excerpt: 'Operator source', ...authority }])!;
    assertEquals(evidence.freight_scope, true); assertEquals(evidence.freight_scope_basis, 'operator');
    assertEquals(evidence.services.at(-1)?.fact_id, 'human-fact');
  }
});
Deno.test('request evidence: later service withdrawal and addition are proposals with their own provenance', () => {
  const evidence = derive([root, later('Do not include local delivery. Please quote customs clearance.')])!;
  assertEquals(evidence.services.some(s => s.service === 'TRUCKING'), false);
  assertEquals(evidence.services.find(s => s.service === 'CUSTOMS_DAKAR')?.email_id, 'later');
  assertEquals(evidence.service_changes?.find(s => s.service === 'TRUCKING')?.requested, false);
  const conflict = derive([root, later('Include local delivery. Do not include local delivery.')])!;
  assertEquals(conflict.mode, 'conflicting');
  assertEquals(conflict.service_changes?.find(s => s.service === 'TRUCKING')?.requested, null);
});
Deno.test('request evidence: protected explicit additions win withdrawals; empty overrides do not cancel later requests', () => {
  const fact: ScopeFact = { fact_key: 'service.overrides', value_json: { add: ['TRUCKING'], remove: [] }, source_type: 'operator', id: 'human' };
  assertEquals(derive([root, later('Exclude local delivery.')], [fact])!.services.find(s => s.service === 'TRUCKING')?.basis, 'operator');
  fact.value_json = { add: [], remove: [] };
  assertEquals(derive([root, later('Please include air freight.')], [fact])!.freight_scope, true);
});
Deno.test('document action: open, independent of gaps; acknowledged, replayed and operator-closed action never duplicated', () => {
  const request = derive()!.document_request!;
  const action = documentVerificationAction('case', request, [])!;
  const data = action.event_data as Record<string, unknown>;
  assertEquals(data.status, 'open'); assertEquals(data.requested_gap_keys, undefined); assertEquals(action.related_email_id, 'root');
  assertEquals(documentVerificationAction('case', derive([root, later('Noted.')])!.document_request!, [{ event_data: data }]), null);
  assertEquals(documentVerificationAction('case', request, [{ event_data: { ...data, status: 'done', done_by_user_id: 'operator' } }]), null);
});
Deno.test('document action: explicit cancellation requests review, does not attest documents or auto-close', () => {
  const request = derive([root, later('Cancel document verification.')])!.document_request!;
  assertEquals(request.cancellation_requested, true);
  const data = documentVerificationAction('case', request, [])!.event_data as Record<string, unknown>;
  assertEquals(data.status, 'open'); assertEquals(data.cancellation_requested, true);
  assertEquals(data.cancellation_email_id, 'later'); assertEquals(data.cancellation_excerpt, 'Cancel document verification');
  assert(text.includes(request.excerpt));
});
Deno.test('document action: cancellation updates the same open action with separate source, replay is inert', () => {
  const first = documentVerificationAction('case', derive()!.document_request!, [])!;
  const request = derive([root, later('Do not contact the consignee.')])!.document_request!;
  const update = documentVerificationAction('case', request, [{ event_data: first.event_data }])!;
  const old = first.event_data as Record<string, unknown>, current = update.event_data as Record<string, unknown>;
  assertEquals(current.dedupe_key, old.dedupe_key); assertEquals(current.status, 'open');
  assertEquals(current.source_email_id, 'root'); assertEquals(current.cancellation_email_id, 'later');
  assertEquals(update.related_email_id, 'later');
  assertEquals(documentVerificationAction('case', request, [{ event_data: current }, { event_data: old }]), null);
});
Deno.test('scope event: flat producer, legacy wrapper and unknown values retain booleans without coercion', () => {
  for (const scope of [{ freight_scope: false, customs_scope: true }, { freight_scope: null }]) {
    assertEquals(readServiceScopeEvent(scope), scope); assertEquals(readServiceScopeEvent({ scope }), scope);
  }
  for (const value of [null, [], {}, { freight_scope: 'false' }]) assertEquals(readServiceScopeEvent(value), null);
});
