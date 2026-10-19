import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
Deno.env.set('ANALYZE_SERVICE_SCOPE_DISABLE_SERVE', '1');
const { analyzeServiceScopeHandler } = await import('./index.ts');
const partner = 'partner@example.invalid';
const initial = { id: 'root', from_address: partner, sent_at: '2026-01-01T00:00:00Z', body_text: 'Please quote DDP charges and DOOR Delivery charges for attached air shipment.\nPlease talk with above consignee. If they have proper customs documents and registration so we can proceed shipment from the origin.' };

async function fixture(run: (state: { events: Record<string, unknown>[]; emails: typeof initial[]; facts: Record<string, unknown>[]; gaps:Record<string,unknown>[]; writes: Record<string, unknown>[]; failHistory: boolean; failAction: boolean; invoke: () => Promise<{ status: number; body: Record<string, unknown> }> }) => Promise<void>) {
  const oldFetch = globalThis.fetch, keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'LOVABLE_API_KEY'];
  const oldEnv = keys.map(k => Deno.env.get(k));
  Deno.env.set(keys[0], 'https://fixture.invalid'); Deno.env.set(keys[1], 'fixture-anon'); Deno.env.set(keys[2], 'fixture-service'); Deno.env.delete(keys[3]);
  const state = { events: [] as Record<string, unknown>[], emails: [{ ...initial, id: 'ack', from_address: 'destination@example.invalid', sent_at: '2026-01-01T01:00:00Z', body_text: 'Acknowledged. We will proceed.' }, initial], facts: [{ id: 'client', fact_key: 'contacts.client_email', value_text: partner, source_type: 'email_body', is_validated: false }] as Record<string, unknown>[], gaps:[] as Record<string,unknown>[], writes: [] as Record<string, unknown>[], failHistory: false, failAction: false,
    invoke: async () => { const response = await analyzeServiceScopeHandler(new Request('https://fixture.invalid/analyze-service-scope', { method: 'POST', headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ case_id: 'fixture-case', force_refresh: true }) })); return { status: response.status, body: await response.json() }; } };
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assertEquals(url.hostname, 'fixture.invalid', 'No external AI response or network request is allowed');
    const table = url.pathname.split('/').pop();
    const json = (data: unknown, count = 0, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Content-Range': `0-${Math.max(0, count - 1)}/${count}` } });
    if (url.pathname === '/auth/v1/user') return json({ id: 'fixture-user', email: 'operator@example.invalid' });
    if (url.pathname.endsWith('/rpc/has_workspace_access')) return json(true);
    if (init?.method === 'POST') {
      assertEquals(table, 'case_timeline_events');
      const row = JSON.parse(String(init.body));
      if (state.failAction && row.event_type === 'manual_action') return json({ message: 'fixture action write refused', code: '42501' }, 0, 403);
      state.writes.push(row); state.events.unshift({ id: `event-${state.events.length}`, ...row }); return json(null);
    }
    if (table === 'quote_cases') return json({ id: 'fixture-case', thread_id: 'fixture-thread', email_threads: { client_email: partner } });
    if (table === 'quote_facts') return json(state.facts, state.facts.length);
    if (table === 'quote_gaps') return json(state.gaps,state.gaps.length);
    if (table === 'emails') return json(state.emails, state.emails.length);
    if (table === 'case_timeline_events') {
      const filtered = state.events.filter(row => [...url.searchParams].every(([key, value]) => !value.startsWith('eq.') || String(key==='event_data->>kind'?(row.event_data as {kind?:unknown})?.kind:row[key]) === value.slice(3)));
      const limit = Number(url.searchParams.get('limit'));
      const rows = limit > 0 ? filtered.slice(0, limit) : filtered;
      return state.failHistory ? json({ message: 'fixture history denied' }, 0, 403) : json(rows, filtered.length);
    }
    throw Error(`Unexpected fixture request: ${url.pathname}`);
  };
  try { await run(state); } finally { globalThis.fetch = oldFetch; keys.forEach((key, i) => oldEnv[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, oldEnv[i]!)); }
}

Deno.test('scope handler: real deterministic path emits flat scope, exact per-service evidence and open document action without AI', async () => {
  await fixture(async state => {
    const result = await state.invoke(); assertEquals(result.status, 200); assertEquals(result.body.ok, true);
    assertEquals(result.body.created, ['service_scope_v1', 'case_reasoning_v1', 'manual_action']);
    const scope = state.events.find(e => e.event_type === 'service_scope_v1')!.event_data as Record<string, unknown>;
    assertEquals(scope.freight_scope, false); assertEquals(scope.freight_scope_basis, 'inferred_destination');
    const action = state.events.find(e => e.event_type === 'manual_action')!.event_data as Record<string, unknown>;
    assertEquals(action.status, 'open'); assertEquals(action.requested_gap_keys, undefined);
    assert(state.writes.every(e => e.actor_type === 'system'));
  });
});
Deno.test('scope handler: recorded email/document contradiction prevents AI scope selection',async()=>{
 await fixture(async state=>{
  state.events.unshift({id:'contract',case_id:'fixture-case',event_type:'case_reasoning_v1',actor_type:'system',event_data:{kind:'source_contract_review',version:1,conflicts:[{key:'source_contract.export_customs'}]}});
  const result=await state.invoke();assertEquals(result.status,409);assertEquals(result.body.error,'SOURCE_CONTRACT_REVIEW_REQUIRED');assertEquals(state.writes,[]);
 });
});
Deno.test('scope handler: later empty/incomplete evidence cannot hide a retained blocking contract gap',async()=>{
 await fixture(async state=>{
  state.events.unshift({id:'later',case_id:'fixture-case',event_type:'case_reasoning_v1',actor_type:'system',event_data:{kind:'source_contract_review',version:1,collectionComplete:false,conflicts:[]}});
  state.gaps.push({gap_key:'source_contract.export_customs'});
  const r=await state.invoke();assertEquals(r.status,409);assertEquals(r.body.error,'SOURCE_CONTRACT_REVIEW_REQUIRED');assertEquals(state.writes,[]);
 });
});
Deno.test('scope handler: contract review preserves explicit operator scope without claiming resolved disagreement',async()=>{
 await fixture(async state=>{
  const scope={shipment_type:'export',freight_scope:true,customs_scope:false};
  state.events.unshift({id:'contract',case_id:'fixture-case',event_type:'case_reasoning_v1',actor_type:'system',event_data:{kind:'source_contract_review',version:1,conflicts:[{key:'source_contract.export_customs'}]}},
   {id:'human',case_id:'fixture-case',event_type:'service_scope_v1',actor_type:'operator',event_data:scope});
  const result=await state.invoke();assertEquals(result.status,200);assertEquals(result.body.scope,scope);assertEquals(result.body.requires_contract_review,true);assertEquals(state.writes,[]);
 });
});
Deno.test('scope handler: forced replay and new acknowledgement are inert; human-closed action is preserved', async () => {
  await fixture(async state => {
    await state.invoke(); const first = state.writes.length;
    state.emails.unshift({ ...initial, id: 'ack-2', from_address: 'destination@example.invalid', sent_at: '2026-01-01T02:00:00Z', body_text: 'Noted. We will report back.' });
    assertEquals((await state.invoke()).body.idempotent, true); assertEquals(state.writes.length, first);
    const action = state.events.find(e => e.event_type === 'manual_action')!;
    state.events.unshift({ ...action, id: 'human-done', actor_type: 'operator', event_data: { ...(action.event_data as object), status: 'done' } });
    assertEquals((await state.invoke()).body.idempotent, true); assertEquals(state.writes.length, first);
  });
});
Deno.test('scope handler: explicit later inbound freight change creates a new proposal, not operator facts or duplicate actions', async () => {
  await fixture(async state => {
    await state.invoke();
    state.emails.unshift({ ...initial, id: 'change', sent_at: '2026-01-01T03:00:00Z', body_text: 'Please include international freight.' });
    const result = await state.invoke(); assertEquals(result.status, 200);
    assertEquals((result.body.scope as Record<string, unknown>).freight_scope, true);
    assertEquals(result.body.created, ['service_scope_v1', 'case_reasoning_v1']);
    assertEquals(state.writes.filter(e => e.event_type === 'manual_action').length, 1);
  });
});
Deno.test('scope handler: operator scope is not overwritten by a newer deterministic interpretation', async () => {
  await fixture(async state => {
    state.events.push({ case_id: 'fixture-case', event_type: 'service_scope_v1', actor_type: 'operator', event_data: { freight_scope: true, customs_scope: false }, related_email_id: 'human-source' });
    const result = await state.invoke(); assertEquals(result.status, 200);
    assertEquals((result.body.scope as Record<string, unknown>).freight_scope, true);
    assertEquals(state.writes.filter(e => e.event_type === 'service_scope_v1').length, 0);
    assertEquals(result.body.reasoning, null);
  });
});
Deno.test('scope handler: protected EXW facts cannot bypass operator scope through the old AI fallback', async () => {
  await fixture(async state => {
    state.facts.push({ id: 'incoterm', fact_key: 'routing.incoterm', value_text: 'EXW', source_type: 'operator', source_excerpt: 'Human source' });
    state.events.push({ case_id: 'fixture-case', event_type: 'service_scope_v1', actor_type: 'operator', event_data: { freight_scope: true, customs_scope: false }, related_email_id: 'human-source' });
    const result = await state.invoke(); assertEquals(result.status, 200); assertEquals(result.body.operator_scope_preserved, true);
    assertEquals((result.body.scope as Record<string, unknown>).customs_scope, false);
    assertEquals(result.body.request_proposal, null); assertEquals(result.body.reasoning, null);
    assertEquals(state.writes.map(e => e.event_type), ['manual_action']);
  });
});
Deno.test('scope handler: cancellation is visible on the same open documentary task, not a completed check', async () => {
  await fixture(async state => {
    await state.invoke();
    state.emails.unshift({ ...initial, id: 'cancel', sent_at: '2026-01-01T03:00:00Z', body_text: 'Do not contact the consignee.' });
    const result = await state.invoke(); assertEquals(result.status, 200);
    const actions = state.events.filter(e => e.event_type === 'manual_action');
    assertEquals(actions.length, 2);
    const latest = actions[0].event_data as Record<string, unknown>, first = actions[1].event_data as Record<string, unknown>;
    assertEquals(latest.dedupe_key, first.dedupe_key); assertEquals(latest.status, 'open');
    assertEquals(latest.cancellation_email_id, 'cancel');
    const count = state.writes.length; assertEquals((await state.invoke()).body.idempotent, true); assertEquals(state.writes.length, count);
  });
});
Deno.test('scope handler: history read failure refuses without writes or AI fallback', async () => {
  await fixture(async state => { state.failHistory = true; const result = await state.invoke(); assertEquals(result.status, 500); assertEquals(state.writes.length, 0); });
});
Deno.test('scope handler: partial event writes do not hide failed action; retry completes only missing action', async () => {
  await fixture(async state => {
    state.failAction = true; const refused = await state.invoke(); assertEquals(refused.status, 500); assert(String(refused.body.error).includes('fixture action write refused'));
    assertEquals(state.writes.length, 2); state.failAction = false;
    const retry = await state.invoke(); assertEquals(retry.status, 200); assertEquals(retry.body.created, ['manual_action']); assertEquals(state.writes.length, 3);
  });
});
