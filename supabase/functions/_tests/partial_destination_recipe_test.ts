import { airTariffSeed } from '../_shared/air-tariff-seed.ts';
import { equivalentHsTaxation, HS_TAX_FIELDS, HS_TAX_BASIS_VERSION } from "../_shared/hs-tax-profile.ts";
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { generateDraftPdf } from '../export-quotation-version-pdf/index.ts';
import { classifyClientLine } from '../_shared/client-quote-projection.ts';

// Execute production handlers and renderer against an explicitly synthetic HTTP
// boundary. No SQL/RLS/runtime/AI correctness is inferred from this fixture.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Synthetic heterogeneous PostgREST rows, checked at each test boundary.
type Row = Record<string, any>;
type Handler = (req: Request) => Promise<Response>;
const handlers: Record<string, Handler> = {};
const serve = Deno.serve;
const disable = Deno.env.get('RUN_PRICING_DISABLE_SERVE');
try {
  Deno.env.delete('RUN_PRICING_DISABLE_SERVE');
  for (const name of ['price-service-lines', 'run-pricing', 'generate-quotation-version']) {
    (Deno as unknown as { serve: (handler: Handler) => unknown }).serve = handler => { handlers[name] = handler; return {}; };
    if (name === 'price-service-lines') await import('../price-service-lines/index.ts');
    else if (name === 'run-pricing') await import('../run-pricing/index.ts');
    else await import('../generate-quotation-version/index.ts');
    assert(handlers[name], `Production handler not captured: ${name}`);
  }
} finally {
  Deno.serve = serve;
  if (disable === undefined) Deno.env.delete('RUN_PRICING_DISABLE_SERVE');
  else Deno.env.set('RUN_PRICING_DISABLE_SERVE', disable);
}
const fact = (key: string, value: string | number | object, source = 'email_body'): Row => ({
  id: key, case_id: 'fixture-case', fact_key: key, is_current: true, is_validated: false, source_type: source,
  value_text: typeof value === 'string' ? value : null, value_number: typeof value === 'number' ? value : null,
  value_json: typeof value === 'object' ? value : null,
});
async function pdfText(bytes: Uint8Array): Promise<string> {
  const raw = new TextDecoder('latin1').decode(bytes), out: string[] = [];
  for (const m of raw.matchAll(/\/Length (\d+)\s*>>\s*stream\r?\n/g)) {
    try {
      const start = m.index! + m[0].length;
      const decoded = new TextDecoder('latin1').decode(await new Response(new Blob([bytes.slice(start, start + Number(m[1]))]).stream()
        .pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
      for (const t of decoded.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(t[1].replace(/../g, h => String.fromCharCode(parseInt(h, 16))));
    } catch { /* non-text streams */ }
  }
  return out.join(' ').replace(/\s+/g, ' ');
}
type State = { tables: Record<string, Row[]>; calls: string[]; failTable: string | null; failSelect: string | null; failService: boolean; engineCalls: number;
  airState: Row | null;
  engineResponse: Row | null; engineRequests: Row[]; engineTaxMutation: string | null; serviceMode: string | null;
  invoke: (name: string, body: Row) => Promise<{ status: number; body: Row }> };
async function fixture(run: (state: State) => Promise<void>) {
  const oldFetch = globalThis.fetch;
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'LOVABLE_API_KEY'];
  const oldEnv = keys.map(key => Deno.env.get(key));
  Deno.env.set(keys[0], 'https://fixture.invalid'); Deno.env.set(keys[1], 'fixture-anon'); Deno.env.set(keys[2], 'fixture-service'); Deno.env.delete(keys[3]);
  const tables: Record<string, Row[]> = Object.fromEntries([
    'quote_request_lines', 'pricing_runs', 'quotation_versions', 'quotation_version_lines', 'runtime_events', 'case_timeline_events',
    'external_quote_requests', 'external_quote_response_facts', 'client_gap_requests', 'fee_lines', 'fee_rules', 'service_quantity_rules',
    'unit_conversions', 'pricing_rate_cards', 'pricing_service_catalogue', 'pricing_modifiers', 'pricing_customs_tiers', 'pricing_client_overrides',
    'local_transport_rates', 'port_tariffs', 'maritime_fee_decisions', 'hs_codes', 'pad_designation_aliases', 'pad_nst_recommendation_rules',
    'nst_cn_mappings', 'nst_nhm_mappings', 'quote_service_pricing',
  ].map(name => [name, []]));
  tables.quote_cases = [{ id: 'fixture-case', request_type: 'AIR_IMPORT', status: 'NEED_INFO', created_by: 'fixture-user', assigned_to: 'fixture-user', thread_id: null }];
  tables.quote_facts = [fact('service.package', 'AIR_IMPORT_DDP'), fact('routing.incoterm', 'DDP'), fact('routing.final_destination', 'Dakar'),
    fact('cargo.weight_kg', 190), fact('cargo.weight_net_kg', 151), fact('cargo.pieces_count', 30), fact('cargo.dimensions_evidence', { conflict: true })];
  tables.quote_gaps = ['cargo.hs_code', 'cargo.value'].map(gap_key => ({ case_id: 'fixture-case', gap_key, is_blocking: true, status: 'open' }));
  tables.case_timeline_events = [{ id: 'scope', case_id: 'fixture-case', event_type: 'service_scope_v1', actor_type: 'system',
    created_at: '2026-01-01T00:00:00Z', event_data: { freight_scope: false, customs_scope: true, request_evidence: { mode: 'destination' } } }];
  tables.service_quantity_rules = ['AIR_HANDLING', 'TRUCKING', 'CUSTOMS_DAKAR', 'AGENCY'].map(service_key => ({
    id: service_key, service_key, quantity_basis: service_key === 'AIR_HANDLING' ? 'KG' : 'FLAT', default_unit: service_key === 'AIR_HANDLING' ? 'kg' : 'forfait',
    requires_fact_key: service_key === 'AIR_HANDLING' ? 'cargo.chargeable_weight_kg' : null, notes: null,
  }));
  // Test-only tariffs; no real catalogue value is read, changed or claimed.
  tables.pricing_service_catalogue = ['AIR_HANDLING', 'TRUCKING', 'CUSTOMS_DAKAR', 'AGENCY'].map((service_code, i) => ({
    id: service_code, service_code, service_name: `SYNTHETIC ${service_code}`, active: true, pricing_mode: service_code === 'AIR_HANDLING' ? 'UNIT_RATE' : 'FLAT',
    unit_type: service_code === 'AIR_HANDLING' ? 'kg' : 'forfait', base_price: (i + 1) * 100, min_price: 0, currency: 'XOF', mode_scope: 'AIR', description: 'SYNTHETIC TEST TARIFF',
  }));
  tables.fee_lines = ['CUSTOMS_DAKAR', 'AGENCY'].map(code => ({ id: code, code, label_fr: `SYNTHETIC ${code}`, is_active: true }));
  tables.fee_rules = tables.fee_lines.map((line, i) => ({ id: line.id, fee_line_id: line.id, is_active: true,
    effective_from: '2026-01-01', direction: 'IMPORT', transport_mode: 'AIR', method: 'FIXED', amount: 300 + i * 100, currency: 'XOF' }));
  const state: State = { tables, calls: [], failTable: null, failSelect: null, failService: false, engineCalls: 0, engineResponse: null, engineRequests: [], engineTaxMutation: null, serviceMode: null, airState: null,
    invoke: async (name, body) => {
      const response = await handlers[name](new Request(`https://fixture.invalid/functions/v1/${name}`, { method: 'POST',
        headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
      return { status: response.status, body: await response.json() };
    } };
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assertEquals(url.hostname, 'fixture.invalid', 'External network/AI is forbidden in this fixture');
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const body: Row = init?.body ? JSON.parse(String(init.body)) : {};
    const name = url.pathname.split('/').pop()!; state.calls.push(`${method} ${url.pathname}`);
    const json = (data: unknown, count = 0, status = 200) => new Response(method === 'HEAD' ? null : JSON.stringify(data), {
      status, headers: { 'Content-Type': 'application/json', 'Content-Range': `0-${Math.max(0, count - 1)}/${count}` },
    });
    if (url.pathname === '/auth/v1/user') return json({ id: 'fixture-user', email: 'operator@example.invalid' });
    if (url.pathname.includes('/functions/v1/')) {
      if (name === 'quotation-engine') {
        state.engineCalls++; state.engineRequests.push(body);
        if (state.engineResponse) {
          if (body.params.hsEstimate?.enabled) {
            if (state.engineTaxMutation === 'rates') tables.hs_codes.forEach(r => r.dd++);
            if (state.engineTaxMutation === 'candidates') tables.hs_codes.splice(1);
            if (state.engineTaxMutation === 'regime') tables.customs_regimes[0].tva = false;
            const actual = equivalentHsTaxation(tables.hs_codes, tables.hs_codes.length, { sourceDigits:body.params.hsCode,
              allowEstimate:true, cargoValue:body.params.cargoValue, currency:body.params.cargoCurrency,
              regimeCode:body.params.regimeCode, regime:tables.customs_regimes[0] ?? null,
              exemptionsReviewed:true, transportMode:'aerien' });
            return json({ ...state.engineResponse, lines:[{ id:'duties_total', category:'Droits & Taxes', amount:123,
              currency:'XOF', source:{ type:'CALCULATED',firm_eligible:false,hs_tax_equivalence:actual } }] });
          }
          return json(state.engineResponse);
        }
        throw Error('Customs engine must not be called for missing customs inputs');
      }
      assertEquals(name, 'price-service-lines');
      if (state.failService) return json({ error: 'Synthetic service failure' }, 0, 503);
      const response = await handlers[name](new Request(url, { method: 'POST', headers, body: JSON.stringify(body) }));
      if (!state.serviceMode || !response.ok) return response;
      const data = await response.json(); const lines = data.data.priced_lines;
      if (state.serviceMode === 'malformed') delete data.data.priced_lines;
      if (state.serviceMode === 'incomplete') lines.pop();
      if (state.serviceMode === 'duplicate') lines[1] = lines[0];
      if (state.serviceMode === 'reserved-finite') { lines[0].rate = 987654; lines[0].source = 'TO_CONFIRM+synthetic-note'; }
      if (state.serviceMode === 'strip-air') lines.forEach((l: Row) => { delete l.air_handling; });
      return json(data);
    }
    if (url.pathname.includes('/rpc/')) {
      if (name === 'has_workspace_access') return json(true);
      if (name === 'air_tariff_read') {
        if (state.failTable === name) return json({message:'Synthetic read unavailable'},0,503);
        return json(state.airState ? { ...state.airState, facts: tables.quote_facts, request_type: tables.quote_cases[0].request_type, lot_count: tables.quote_request_lines.length } : {selection:null});
      }
      if (name === 'air_handling_finish' || name === 'air_tariff_finish') {
        if (state.serviceMode === 'air-finish-race') state.airState!.selection.id='concurrent-selection';
        if (body.p_selection_id !== state.airState?.selection.id || body.p_context_hash !== state.airState?.context_hash) return json({message:'Synthetic context conflict'},0,409);
        Object.assign(tables.pricing_runs.find(r=>r.id===body.p_run_id)!,body.p_result);return json(null);
      }
      if (name === 'read_pad_weight_context') return json({ case_id: 'fixture-case', case_status: tables.quote_cases[0].status, context_hash: 'fixture', request_count: tables.quote_request_lines.length,
        heads: [], facts: tables.quote_facts.map(f => ({ key: f.fact_key, text: f.value_text, number: f.value_number, json: f.value_json })), scenario: null, weight_facts: [], weight_reconciliation: null });
      if (name === 'get_next_pricing_run_number') return json(tables.pricing_runs.length + 1);
      if (name === 'get_next_quotation_version_number') return json(tables.quotation_versions.length + 1);
      if (name === 'insert_quotation_version_atomic') {
        tables.quotation_versions.forEach(v => v.is_selected = false);
        tables.quotation_versions.push({ id: body.p_id, case_id: body.p_case_id, pricing_run_id: body.p_pricing_run_id, version_number: body.p_version_number,
          snapshot: body.p_snapshot, created_by: body.p_created_by, is_selected: true });
        return json(null);
      }
      throw Error(`Unexpected RPC: ${name}`);
    }
    assert(Array.isArray(tables[name]), `Unexpected table: ${name}`);
    if (state.failTable === name || (state.failSelect && url.searchParams.get('select') === state.failSelect)) return json({ code: '42501', message: `Synthetic ${name} denied` }, 0, 403);
    let rows = tables[name].filter(row => [...url.searchParams].every(([key, value]) => {
      if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
      if (value.startsWith('in.')) return value.slice(4, -1).split(',').map(s => s.replaceAll('"', '')).includes(String(row[key]));
      if (value.startsWith('is.')) return value === 'is.null' ? row[key] == null : String(row[key]) === value.slice(3);
      return true;
    }));
    if (method === 'POST') {
      rows = (Array.isArray(body) ? body : [body]).map(row => ({ id: `fixture-${name}-${tables[name].length}`, created_at: new Date().toISOString(), ...row }));
      tables[name].push(...rows);
    } else if (method === 'PATCH') rows.forEach(row => Object.assign(row, body));
    else if (method === 'DELETE') tables[name] = tables[name].filter(row => !rows.includes(row));
    const count = rows.length;
    const order = url.searchParams.get('order');
    if (order) { const [key, direction] = order.split('.'); rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (direction === 'desc' ? -1 : 1)); }
    const limit = Number(url.searchParams.get('limit')); if (limit > 0) rows = rows.slice(0, limit);
    return json(headers.get('Accept')?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows, count);
  };
  try { await run(state); } finally { globalThis.fetch = oldFetch; keys.forEach((key, i) => oldEnv[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, oldEnv[i]!)); }
}

Deno.test('partial destination: real pricing → immutable snapshot → real PDF preserves unknowns and known synthetic forfaits', async () => {
  await fixture(async state => {
    const before = JSON.stringify(state.tables.quote_facts);
    const result = await state.invoke('run-pricing', { case_id: 'fixture-case', allow_provisional: true });
    assertEquals(result.status, 200, JSON.stringify(result.body)); assertEquals(result.body.partial_mode, true);
    assertEquals(result.body.quoteQualification.level, 'partial'); assertEquals(state.engineCalls, 0);
    const run = state.tables.pricing_runs.find(r => r.status === 'success')!; assert(run, JSON.stringify(state.tables.pricing_runs));
    const air = run.tariff_lines.find((line: Row) => line.category === 'AIR_HANDLING');
    assert(air); assertEquals(air.quantity, null); assertEquals(air.source.type, 'TO_CONFIRM');
    for (const [key, amount] of [['TRUCKING', 200], ['CUSTOMS_DAKAR', 300], ['AGENCY', 400]]) {
      const line = run.tariff_lines.find((l: Row) => l.category === key); assert(line, String(key)); assertEquals(line.amount, amount);
    }
    assertEquals(run.outputs_json.quoteQualification.level, 'partial');
    const version = await state.invoke('generate-quotation-version', { case_id: 'fixture-case', pricing_run_id: run.id });
    assertEquals(version.status, 200, JSON.stringify(version.body));
    const snap = state.tables.quotation_versions[0].snapshot;
    assertEquals(snap.meta.quoteQualification.level, 'partial'); assertEquals(snap.raw_lines.find((l: Row) => l.category === 'AIR_HANDLING').quantity, null);
    assertEquals(snap.lines.find((l: Row) => l.category === 'AIR_HANDLING').quantity, null);
    const storedAir = state.tables.quotation_version_lines.find(l => l.line_order === snap.lines.findIndex((line: Row) => line.category === 'AIR_HANDLING'))!;
    assertEquals(storedAir.quantity, 1); assertEquals(storedAir.breakdown.quantity_known, false);
    const frozen = JSON.stringify(snap);
    const bytes = await generateDraftPdf(snap, 'SYNTHETIC-PARTIAL-DESTINATION'); const text = await pdfText(bytes);
    assertStringIncludes(text.toLowerCase(), 'partiel'); assertStringIncludes(text.toLowerCase(), 'confirmer');
    assertStringIncludes(text, '?');
    assertEquals(JSON.stringify(snap), frozen); assertEquals(JSON.stringify(state.tables.quote_facts), before);
    const replay = await state.invoke('generate-quotation-version', { case_id: 'fixture-case', pricing_run_id: run.id });
    assertEquals(replay.body.data.idempotent, true); assertEquals(state.tables.quotation_versions.length, 1);
    const outputDir = Deno.env.get('PARTIAL_RECIPE_ARTIFACT_DIR');
    if (outputDir) {
      await Deno.writeTextFile(`${outputDir}/partial-recipe.json`, JSON.stringify({ kind: 'SYNTHETIC_IN_MEMORY_BACKEND', result, run, snapshot: snap, calls: state.calls }, null, 2));
      await Deno.writeFile(`${outputDir}/partial-recipe.pdf`, bytes); await Deno.writeTextFile(`${outputDir}/partial-recipe-pdf.txt`, text);
    }
  });
});

for (const [name, change] of [
  ['firm request', (s: State) => { s.tables.quote_cases[0].status = 'ACK_READY_FOR_PRICING'; }],
  ['other flow', (s: State) => { s.tables.quote_cases[0].request_type = 'SEA_IMPORT'; s.tables.quote_facts[0].value_text = 'IMPORT_DDP'; }],
  ['multiple lots', (s: State) => { s.tables.quote_request_lines.push({ id: 'lot1', case_id: 'fixture-case' }, { id: 'lot2', case_id: 'fixture-case' }); }],
  ['unknown freight scope', (s: State) => { s.tables.case_timeline_events[0].event_data.freight_scope = null; }],
  ['unrelated blocking gap', (s: State) => { s.tables.quote_gaps.push({ case_id: 'fixture-case', gap_key: 'cargo.description', is_blocking: true, status: 'open' }); }],
  ['IMO scope blocker', (s: State) => { s.tables.quote_gaps.push({ case_id: 'fixture-case', gap_key: 'cargo.imo_goods_scope_confirmation', is_blocking: true, status: 'open' }); }],
] as const) Deno.test(`partial destination: ${name} retains blocking guard without calculation`, async () => fixture(async state => {
  change(state);
  const result = await state.invoke('run-pricing', { case_id: 'fixture-case', allow_provisional: name !== 'firm request' });
  assertEquals(result.status, 400, JSON.stringify(result.body)); assertEquals(result.body.error, 'Blocking gaps still open');
  assertEquals(state.tables.pricing_runs.length, 0); assertEquals(state.engineCalls, 0);
}));

const airInput = { id: 'air', service: 'AIR_HANDLING', unit: 'kg', quantity: 1, currency: 'XOF' };
function selectSyntheticAirProfile(state: State) {
  state.airState = { selection: { id:'selected-air-v1',profile_id:'synthetic-air-profile',context_hash:'air-context',warehouse_bracket_confirmed:true,source_reference:'Synthetic explicit cargo and supplier source' },
    profile: { id:'synthetic-air-profile',revision:1,supplier:'2AS',airport:'DSS',direction:'IMPORT',cargo_class:'GENERAL_CARGO',effective_from:'2026-10-16',effective_to:null,
      rates:{collection_per_kg:20,security_per_kg:10,documents:25000,warehouse_passage:6000,it:1500},source_reference:'Synthetic source transcription',evidence:{kind:'test-only'} },context_hash:'air-context' };
  state.tables.quote_facts.push(fact('cargo.chargeable_weight_kg',64,'operator'));
}
Deno.test('AIR_HANDLING selected source precedes catalogue/client overrides and keeps purchase outside commercial totals',async()=>fixture(async state=>{
  selectSyntheticAirProfile(state);
  state.tables.quote_facts.push(fact('client.code','SYNTHETIC'));
  state.tables.pricing_client_overrides.push({id:'wrong-generic',client_code:'SYNTHETIC',service_code:'AIR_HANDLING',pricing_mode:'FIXED',base_price:999999,min_price:0,currency:'XOF',active:true});
  const r=await state.invoke('price-service-lines',{case_id:'fixture-case',service_lines:[airInput]});
  assertEquals(r.status,200);const line=r.body.data.priced_lines[0];
  assertEquals(line.rate,null);assertEquals(line.source,'TO_CONFIRM');assertEquals(line.air_handling.supplier_complete_ht_xof,34420);
  assertEquals(line.air_handling.selling_amount_xof,null);
}));
Deno.test('AIR_HANDLING pricing to immutable snapshot and real PDF preserves purchase evidence without changing payable',async()=>fixture(async state=>{
  selectSyntheticAirProfile(state);const factsBefore=JSON.stringify(state.tables.quote_facts);
  const result=await state.invoke('run-pricing',{case_id:'fixture-case',allow_provisional:true});
  assertEquals(result.status,200,JSON.stringify(result.body));
  const run=state.tables.pricing_runs.find(r=>r.status==='success')!;assert(run);
  const line=run.tariff_lines.find((l:Row)=>l.category==='AIR_HANDLING');assertEquals(line.amount,null);
  assertEquals(line.source.air_handling.supplier_complete_ht_xof,34420);assertEquals(line.source.air_handling.supplier_ttc_xof,null);
  assert(run.total_ttc < 34420,'Purchase estimate must not be charged to customer');
  assertEquals(run.outputs_json.quoteQualification.level,'partial');
  const version=await state.invoke('generate-quotation-version',{case_id:'fixture-case',pricing_run_id:run.id});assertEquals(version.status,200,JSON.stringify(version.body));
  const snap=state.tables.quotation_versions[0].snapshot;
  const saved=snap.raw_lines.find((l:Row)=>l.category==='AIR_HANDLING');assertEquals(saved.source.air_handling.selection_id,'selected-air-v1');
  assertEquals(saved.source.air_handling.profile.rates.collection_per_kg,20);
  const frozen=JSON.stringify(snap);state.airState!.profile.rates.collection_per_kg=777;
  assertEquals(JSON.stringify(snap),frozen,'Persisted evidence cannot track current profile');
  const text=await pdfText(await generateDraftPdf(snap,'SYNTHETIC-AIR-HANDLING'));
  assertStringIncludes(text,'confirmer');assert(!text.includes('34420'),'Internal supplier HT is not a client selling amount');
  assertEquals(JSON.stringify(state.tables.quote_facts),factsBefore);
}));
Deno.test('AIR_HANDLING atomic finish conflict refuses result and restores pre-pricing status',async()=>fixture(async state=>{
  selectSyntheticAirProfile(state);state.serviceMode='air-finish-race';
  const before=state.tables.quote_cases[0].status;
  const result=await state.invoke('run-pricing',{case_id:'fixture-case',allow_provisional:true});
  assertEquals(result.status,409,JSON.stringify(result.body));assertEquals(state.tables.quote_cases[0].status,before);
  assertEquals(state.tables.pricing_runs.some(r=>r.status==='success'),false);assertEquals(state.tables.quotation_versions.length,0);
}));
Deno.test('AIR_HANDLING unavailable source cannot fall back to a generic catalogue price',async()=>fixture(async state=>{
  state.failTable='air_tariff_read';const r=await state.invoke('price-service-lines',{case_id:'fixture-case',service_lines:[airInput]});
  assertEquals(r.status,500);assertEquals(state.tables.quote_service_pricing.length,0);
}));
for(const failure of ['read','service','malformed','incomplete','covered','covered-raw','strip-air'] as const) Deno.test(`AIR_HANDLING standard DAP ${failure}: never returns successful empty or untraced quote`,async()=>fixture(async state=>{
  selectSyntheticAirProfile(state);state.tables.quote_gaps=[];state.tables.quote_cases[0].status='ACK_READY_FOR_PRICING';
  state.tables.quote_facts.find(f=>f.fact_key==='service.package')!.value_text='AIR_IMPORT_DAP';
  state.tables.quote_facts.find(f=>f.fact_key==='routing.incoterm')!.value_text='DAP';
  state.tables.quote_facts.push(fact('cargo.hs_code','1234567890'),fact('cargo.value',10000),fact('cargo.value_currency','XOF'),fact('customs.regime_code','TEST'));
  state.engineResponse={lines:[],totals:{honoraires:0,debours:0,operationnel:0},currency:'XOF',duty_breakdown:[]};
  if(failure==='read')state.failTable='air_tariff_read';
  if(failure==='service')state.failService=true;
  if(['malformed','incomplete','strip-air'].includes(failure))state.serviceMode=failure;
  if(failure==='covered'||failure==='covered-raw')state.engineResponse.lines=[{category:'AIR_HANDLING',amount:123,currency:'XOF',bloc:'operationnel',source:{type:'internal'},
    ...(failure==='covered'?{canonical:{service_key:'AIR_HANDLING',origin_layer:'engine_structural'}}:{})}];
  const previous=state.tables.quote_cases[0].status;const r=await state.invoke('run-pricing',{case_id:'fixture-case'});
  assert(r.status>=400,JSON.stringify(r.body));assertEquals(state.tables.pricing_runs.some(run=>run.status==='success'),false);
  assertEquals(state.engineCalls,failure==='read'?0:1,'The negative test must reach the intended production boundary, not a preceding FSM guard');
  if(['service','malformed','incomplete','strip-air'].includes(failure))assert(state.calls.some(c=>c.endsWith('/functions/v1/price-service-lines')));
  assertEquals(state.tables.quote_cases[0].status,previous);assertEquals(state.tables.quotation_versions.length,0);
}));
Deno.test('partial destination: complete customs inputs keep the standard engine path but never gross→taxable fallback', async () => fixture(async state => {
  state.tables.quote_gaps = [];
  state.tables.quote_facts.push(fact('cargo.hs_code', '1234567890'), fact('cargo.value', 10000), fact('cargo.value_currency', 'XOF'), fact('customs.regime_code', 'TEST'));
  state.tables.hs_codes.push({ code_normalized: '1234567890', dd: 0, rs: 1, pcs: 0.8, pcc: 0.5, cosec: 0.4, surtaxe: 0, tin: 0, t_conj: 0, tva: 18 });
  // Deliberately empty upstream engine double: tests P5/qualification propagation,
  // never the unchanged customs engine's business calculations.
  state.engineResponse = { lines: [], totals: { honoraires: 0, debours: 0, operationnel: 0 }, currency: 'XOF', duty_breakdown: [] };
  const result = await state.invoke('run-pricing', { case_id: 'fixture-case', allow_provisional: true });
  assertEquals(result.status, 200, JSON.stringify(result.body)); assertEquals(state.engineCalls, 1);
  assertEquals(result.body.quoteQualification.level, 'partial');
  const run = state.tables.pricing_runs.find(r => r.status === 'success')!;
  assertEquals(run.tariff_lines.find((l: Row) => l.category === 'AIR_HANDLING').quantity, null);
  assertEquals(run.tariff_lines.some((l: Row) => l.category === 'CUSTOMS_RESERVE'), false);
  assertEquals(run.outputs_json.quoteQualification.level, 'partial');
}));
for (const mode of ['failure', 'malformed', 'incomplete', 'duplicate']) Deno.test(`partial destination: service ${mode} fails visibly and restores the case`, async () => fixture(async state => {
  state.failService = mode === 'failure'; state.serviceMode = mode;
  const result = await state.invoke('run-pricing', { case_id: 'fixture-case', allow_provisional: true });
  assertEquals(result.status, 500); assertEquals(state.tables.pricing_runs[0].status, 'failed');
  assertEquals(state.tables.quote_cases[0].status, 'NEED_INFO'); assertEquals(state.tables.quotation_versions.length, 0);
}));
Deno.test('partial destination: reserved finite upstream amount never contributes to partial total', async () => fixture(async state => {
  state.serviceMode = 'reserved-finite';
  const result = await state.invoke('run-pricing', { case_id: 'fixture-case', allow_provisional: true });
  assertEquals(result.status, 200, JSON.stringify(result.body));
  const run = state.tables.pricing_runs[0];
  assertEquals(run.tariff_lines.find((l: Row) => l.category === 'AIR_HANDLING').source.type, 'TO_CONFIRM+synthetic-note');
  assertEquals(run.total_ht, 900); assertEquals(run.total_ttc, 1026); // Existing 18% TVA on 700 internal fees only.
}));
for (const [name, configure] of [
  ['HS registry error', (s: State) => { s.tables.quote_facts.push(fact('cargo.hs_code', '1234567890')); s.failTable = 'hs_codes'; }],
  ['regime read error', (s: State) => { s.failSelect = 'fact_key,value_text'; }],
  ['gap read error', (s: State) => { s.failTable = 'quote_gaps'; }],
] as const) Deno.test(`partial destination: ${name} remains an error before run persistence`, async () => fixture(async state => {
  configure(state); const result = await state.invoke('run-pricing', { case_id: 'fixture-case', allow_provisional: true });
  assertEquals(result.status, 500); assertEquals(state.tables.pricing_runs.length, 0);
}));
for (const [name, configure] of [
  ['multi-lot', (s: State) => { s.tables.quote_request_lines.push({ id: 'lot1', case_id: 'fixture-case' }, { id: 'lot2', case_id: 'fixture-case' }); }],
  ['freight added', (s: State) => { s.tables.quote_facts.push(fact('service.overrides', { add: ['AIR_FREIGHT'], remove: [] }, 'operator')); }],
  ['unknown destination scope', (s: State) => { s.tables.case_timeline_events[0].event_data.freight_scope = null; }],
  ['export', (s: State) => { s.tables.quote_cases[0].request_type = 'AIR_EXPORT'; }],
] as const) Deno.test(`partial service: direct ${name} call cannot enable the new reserved KG mode`, async () => fixture(async state => {
  configure(state); const result = await state.invoke('price-service-lines', { case_id: 'fixture-case', service_lines: [airInput], provisional_destination_quote: true });
  assertEquals(result.status, 500); assertEquals(state.tables.quote_service_pricing.length, 0);
}));
Deno.test('partial service: override injection alone cannot change historical KG behavior', async () => fixture(async state => {
  const result = await state.invoke('price-service-lines', { case_id: 'fixture-case', service_lines: [airInput], pricing_context_override: { partial_kg_facts: [] } });
  assertEquals(result.status, 200); assertEquals(result.body.data.priced_lines[0].quantity_used, 190);
}));

Deno.test('partial service: explicit gross, taxable, net and forfait rules differ per line; a generic KG base is never invented', async () => fixture(async state => {
  const rule = state.tables.service_quantity_rules.find(r => r.service_key === 'AIR_HANDLING')!;
  const body = { case_id: 'fixture-case', service_lines: [airInput], provisional_destination_quote: true, pricing_context_override: { weight_kg: 999 } };
  for (const [basis, quantity, label] of [['cargo.weight_kg', 190, 'poids brut'], ['cargo.weight_net_kg', 151, 'poids net'],
    ['cargo.chargeable_weight_kg', null, 'poids taxable'], [null, null, 'non documentée']] as const) {
    rule.requires_fact_key = basis; const result = await state.invoke('price-service-lines', body);
    assertEquals(result.status, 200); const line = result.body.data.priced_lines[0];
    assertEquals(line.quantity_used, quantity); assertStringIncludes(line.explanation, label);
    assertEquals(line.rate, quantity === null ? null : quantity * 100); // Same synthetic unit rate, unchanged formula.
  }
  rule.quantity_basis = 'KG'; rule.requires_fact_key = 'cargo.chargeable_weight_kg';
  state.tables.pricing_service_catalogue.find(c => c.service_code === 'AIR_HANDLING')!.pricing_mode = 'FIXED';
  const flat = await state.invoke('price-service-lines', body);
  assertEquals(flat.body.data.priced_lines[0].quantity_used, 1); assertEquals(flat.body.data.priced_lines[0].rate, 100);
  state.tables.quote_facts.push(fact('client.code', 'SYNTHETIC'));
  state.tables.pricing_client_overrides.push({ id: 'override', client_code: 'SYNTHETIC', service_code: 'AIR_HANDLING', pricing_mode: 'FIXED', base_price: 200,
    min_price: 0, currency: 'XOF', mode_scope: 'AIR', active: true, valid_from: null, valid_to: null });
  const fixedOverride = await state.invoke('price-service-lines', body);
  assertEquals(fixedOverride.body.data.priced_lines[0].quantity_used, 1); assertEquals(fixedOverride.body.data.priced_lines[0].rate, 200);
  state.tables.pricing_client_overrides = []; state.tables.quote_facts.pop();
  rule.quantity_basis = 'FLAT'; rule.default_unit = 'forfait';
  state.tables.service_quantity_rules = [];
  const fixedWithoutRule = await state.invoke('price-service-lines', body);
  assertEquals(fixedWithoutRule.body.data.priced_lines[0].quantity_used, 1); assertEquals(fixedWithoutRule.body.data.priced_lines[0].rate, 100);
  state.tables.pricing_service_catalogue.find(c => c.service_code === 'AIR_HANDLING')!.pricing_mode = 'UNIT_RATE';
  const absent = await state.invoke('price-service-lines', body);
  assertEquals(absent.body.data.priced_lines[0].quantity_used, null); assertEquals(absent.body.data.priced_lines[0].rate, null);
  state.failTable = 'service_quantity_rules';
  const error = await state.invoke('price-service-lines', body); assertEquals(error.status, 500);
}));
Deno.test('partial destination: automatic caller forfait cannot turn a KG tariff without basis into quantity1; real fixed forfait remains known', async () => fixture(async state => {
  state.tables.service_quantity_rules = [];
  const body = { case_id: 'fixture-case', allow_provisional: true };
  const result = await state.invoke('run-pricing', body); assertEquals(result.status, 200);
  const air = state.tables.pricing_runs[0].tariff_lines.find((line: Row) => line.category === 'AIR_HANDLING');
  assertEquals(air.quantity, null); assertEquals(air.amount, null); assertStringIncludes(air.explanation, 'non documentée');
  state.tables.pricing_service_catalogue.find(c => c.service_code === 'AIR_HANDLING')!.pricing_mode = 'FIXED';
  const fixed = await state.invoke('run-pricing', body); assertEquals(fixed.status, 200);
  const flat = state.tables.pricing_runs[1].tariff_lines.find((line: Row) => line.category === 'AIR_HANDLING');
  assertEquals(flat.quantity, 1); assertEquals(flat.amount, 100);
}));
Deno.test('partial service: selected forfait card survives another KG card, including AIR-excluded or other-currency cards', async () => fixture(async state => {
  const rule = state.tables.service_quantity_rules.find(r => r.service_key === 'AIR_HANDLING')!;
  rule.quantity_basis = 'FLAT'; rule.default_unit = 'FORFAIT';
  state.tables.pricing_service_catalogue = [];
  state.tables.pricing_rate_cards = [{ id: 'flat', service_key: 'AIR_HANDLING', scope: 'import', currency: 'XOF', unit: 'FORFAIT', value: 100,
    source: 'synthetic', confidence: 1, status: 'active', container_type: null }];
  const body = { case_id: 'fixture-case', service_lines: [airInput], provisional_destination_quote: true };
  for (const variant of [{ container_type: '20DV', currency: 'XOF' }, { container_type: null, currency: 'USD' }, { container_type: null, currency: 'XOF' }]) {
    state.tables.pricing_rate_cards.push({ ...state.tables.pricing_rate_cards[0], id: 'kg', unit: 'KG', ...variant });
    const result = await state.invoke('price-service-lines', body); assertEquals(result.status, 200);
    assertEquals(result.body.data.priced_lines[0].rate, 100); assertEquals(result.body.data.priced_lines[0].quantity_used, 1);
    state.tables.pricing_rate_cards.pop();
  }
}));
Deno.test('partial destination: gross-based handling prices190 despite conflicting dimensions; taxable-based handling remains reserved', async () => fixture(async state => {
  state.tables.service_quantity_rules.find(r => r.service_key === 'AIR_HANDLING')!.requires_fact_key = 'cargo.weight_kg';
  const result = await state.invoke('run-pricing', { case_id: 'fixture-case', allow_provisional: true });
  assertEquals(result.status, 200); assertEquals(state.engineCalls, 0);
  const air = state.tables.pricing_runs[0].tariff_lines.find((line: Row) => line.category === 'AIR_HANDLING');
  assertEquals(air.quantity, 190); assertEquals(air.amount, 19000); assertStringIncludes(air.explanation, 'poids brut');
  assertEquals(air.source.type === 'TO_CONFIRM', false);
}));
Deno.test('partial service: protected operator taxable weight wins dimensions conflict; unvalidated derived value stays reserved', async () => fixture(async state => {
  state.tables.quote_facts.push(fact('cargo.chargeable_weight_kg', 250, 'operator'));
  const body = { case_id: 'fixture-case', service_lines: [airInput], provisional_destination_quote: true, pricing_context_override: { weight_kg: 999 } };
  const known = await state.invoke('price-service-lines', body); assertEquals(known.status, 200); assertEquals(known.body.data.priced_lines[0].quantity_used, 250);
  state.tables.quote_facts.at(-1)!.source_type = 'deterministic_calc';
  const unknown = await state.invoke('price-service-lines', body); assertEquals(unknown.status, 200); assertEquals(unknown.body.data.priced_lines[0].quantity_used, null);
}));

for (const missing of ['cargo.hs_code', 'customs.regime_code']) Deno.test(`partial destination: ${missing} alone reserves duties without requesting the customs engine`, async () => fixture(async state => {
  state.tables.quote_gaps = [];
  for (const [key, value] of [['cargo.hs_code', '1234567890'], ['customs.regime_code', 'TEST'], ['cargo.value', 10000], ['cargo.value_currency', 'XOF']] as const) {
    if (key !== missing) state.tables.quote_facts.push(fact(key, value));
  }
  state.tables.hs_codes.push({ code_normalized: '1234567890', dd: 0, rs: 1, pcs: 0.8, pcc: 0.5, cosec: 0.4, surtaxe: 0, tin: 0, t_conj: 0, tva: 18 });
  const result = await state.invoke('run-pricing', { case_id: 'fixture-case', allow_provisional: true });
  assertEquals(result.status, 200, JSON.stringify(result.body)); assertEquals(state.engineCalls, 0);
  const run = state.tables.pricing_runs[0]; assertEquals(run.outputs_json.quoteQualification.level, 'partial');
  assert(run.tariff_lines.some((line: Row) => line.category === 'CUSTOMS_RESERVE'));
}));
Deno.test('partial destination: pending partner communication remains blocked', async () => fixture(async state => {
  state.tables.external_quote_requests.push({ id: 'pending', case_id: 'fixture-case', status: 'sent' });
  const result = await state.invoke('run-pricing', { case_id: 'fixture-case', allow_provisional: true });
  assertEquals(result.status, 400, JSON.stringify(result.body)); assertEquals(result.body.error, 'Open communication loops still pending');
  assertEquals(state.tables.pricing_runs.length, 0);
}));
Deno.test('partial destination: PAD or intent blocker cannot be bypassed by customs exceptions', async () => fixture(async state => {
  state.tables.quote_gaps.push({ case_id: 'fixture-case', gap_key: 'pricing.pad_group_scope', is_blocking: true, status: 'open' });
  const blocked = await state.invoke('run-pricing', { case_id: 'fixture-case', allow_provisional: true });
  assertEquals(blocked.status, 400); assertEquals(state.tables.pricing_runs.length, 0);
  state.tables.case_timeline_events.push({ case_id: 'fixture-case', event_type: 'thread_intent_v1', created_at: '2026-02-01', event_data: { pricing_gate: false } });
  const intent = await state.invoke('run-pricing', { case_id: 'fixture-case', allow_provisional: true });
  assertEquals(intent.status, 400); assertEquals(intent.body.blocked_by_intent, true);
}));
Deno.test('partial destination: complete firm request retains previous engine and KG path with no partial flag', async () => fixture(async state => {
  state.tables.quote_cases[0].status = 'ACK_READY_FOR_PRICING'; state.tables.quote_gaps = [];
  state.tables.quote_facts.push(fact('cargo.hs_code', '1234567890'), fact('cargo.value', 10000), fact('cargo.value_currency', 'XOF'), fact('customs.regime_code', 'TEST'));
  state.tables.hs_codes.push({ code_normalized: '1234567890', dd: 0, rs: 1, pcs: 0.8, pcc: 0.5, cosec: 0.4, surtaxe: 0, tin: 0, t_conj: 0, tva: 18 });
  state.engineResponse = { lines: [], totals: { honoraires: 0, debours: 0, operationnel: 0 }, currency: 'XOF', duty_breakdown: [] };
  const result = await state.invoke('run-pricing', { case_id: 'fixture-case', allow_provisional: false });
  assertEquals(result.status, 200, JSON.stringify(result.body)); assertEquals(result.body.partial_mode, undefined); assertEquals(state.engineCalls, 1);
  assertEquals(state.tables.pricing_runs[0].tariff_lines.find((line: Row) => line.category === 'AIR_HANDLING').quantity, 190);
}));

Deno.test('partial destination: failed scope reads do not become an empty safe scope', async () => fixture(async state => {
  state.failTable = 'case_timeline_events';
  const result = await state.invoke('run-pricing', { case_id: 'fixture-case', allow_provisional: true });
  assertEquals(result.status, 500); assertEquals(state.tables.pricing_runs.length, 0);
}));

Deno.test('partial AIR delivery: maritime COUNT or absent rule stays unknown, while the actually selected AIR forfait is independent', async () => fixture(async state => {
  state.tables.pricing_service_catalogue = [];
  const rule = state.tables.service_quantity_rules.find(r => r.service_key === 'TRUCKING')!;
  rule.quantity_basis = 'COUNT'; rule.default_unit = 'voyage'; rule.requires_fact_key = 'cargo.containers';
  const body = { case_id: 'fixture-case', service_lines: [{ ...airInput, id: 'delivery', service: 'TRUCKING' }], provisional_destination_quote: true };
  const reserved = await state.invoke('price-service-lines', body);
  assertEquals(reserved.status, 200);
  assertEquals(reserved.body.data.priced_lines[0].rate, null);
  assertEquals(reserved.body.data.priced_lines[0].quantity_used, null);
  assertStringIncludes(reserved.body.data.priced_lines[0].explanation, 'maritime');
  state.tables.service_quantity_rules = state.tables.service_quantity_rules.filter(r => r.service_key !== 'TRUCKING');
  const absent = await state.invoke('price-service-lines', body);
  assertEquals(absent.body.data.priced_lines[0].quantity_used, null);
  state.tables.pricing_rate_cards = [{ id: 'synthetic-air-delivery-forfait', service_key: 'TRUCKING', scope: 'import', currency: 'XOF', unit: 'FORFAIT', value: 123,
    source: 'internal', confidence: 1, status: 'active', container_type: null, notes: 'SYNTHETIC TEST ONLY' }];
  const fixed = await state.invoke('price-service-lines', body);
  assertEquals(fixed.status, 200, JSON.stringify(fixed.body));
  const line = fixed.body.data.priced_lines[0];
  assertEquals(line.rate, 123); assertEquals(line.quantity_used, 1);
  assertEquals(line.tariff_reference.id, 'synthetic-air-delivery-forfait');
  for (const conflict of [{ corridor: 'DAKAR_BAMAKO' }, { origin_port: 'UNRELATED_PORT' }, { notes: 'Tarif maritime conteneur' }, { currency: 'USD' }]) {
    const saved = { ...state.tables.pricing_rate_cards[0] };
    Object.assign(state.tables.pricing_rate_cards[0], conflict);
    const refused = await state.invoke('price-service-lines', body);
    assertEquals(refused.body.data.priced_lines[0].rate, null, JSON.stringify(conflict));
    assertEquals(refused.body.data.priced_lines[0].quantity_used, null);
    state.tables.pricing_rate_cards[0] = saved;
  }
  state.tables.pricing_client_overrides.push({ id: 'synthetic-priority-override', client_code: 'TEST', service_code: 'TRUCKING', pricing_mode: 'FIXED', base_price: 456, min_price: 0,
    currency: 'XOF', active: true, mode_scope: 'AIR' });
  state.tables.quote_facts.push(fact('client.code', 'TEST'));
  const priority = await state.invoke('price-service-lines', body);
  assertEquals(priority.body.data.priced_lines[0].rate, 456);
  assertEquals(priority.body.data.priced_lines[0].tariff_reference.id, 'synthetic-priority-override');
}));

Deno.test('partial pricing: selected provisional fee IDs and rule state survive run/version/PDF and later tariff edits without changing totals', async () => fixture(async state => {
  state.tables.fee_rules.forEach(r => { r.label = 'SYNTHETIC forfait provisoire'; r.source_reference = 'SYNTHETIC provenance'; });
  state.tables.quote_facts.find(f => f.fact_key === 'cargo.dimensions_evidence')!.value_json = { conflict: true, sources: [
    { groups: [{ count: 25, length: 48, width: 36, height: 29, unit: 'cm' }, { count: 5, length: 44, width: 27, height: 24, unit: 'cm' }] },
    { filename: 'SYNTHETIC_PL.pdf', groups: [{ count: 28, length: 48, width: 36, height: 29, unit: 'cm' }, { count: 2, length: 44, width: 27, height: 24, unit: 'cm' }] },
  ] };
  const originalFacts = JSON.stringify(state.tables.quote_facts);
  const priced = await state.invoke('run-pricing', { case_id: 'fixture-case', allow_provisional: true });
  assertEquals(priced.status, 200, JSON.stringify(priced.body));
  const run = state.tables.pricing_runs[0];
  const capturedRun = JSON.stringify(run);
  for (const key of ['CUSTOMS_DAKAR', 'AGENCY']) {
    const source = run.tariff_lines.find((l: Row) => l.category === key).source;
    assertEquals(source.tariff_reference.table, 'fee_rules');
    assertEquals(source.tariff_reference.id, key);
    assertEquals(source.tariff_reference.validation_status, 'provisional');
    assertEquals(source.firm_eligible, false);
  }
  state.tables.fee_rules.forEach(r => { r.id = 'changed-after-run'; r.amount = 99999; r.label = 'changed-after-run'; });
  const generated = await state.invoke('generate-quotation-version', { case_id: 'fixture-case', pricing_run_id: run.id });
  assertEquals(generated.status, 200, JSON.stringify(generated.body));
  const snap = state.tables.quotation_versions[0].snapshot;
  assertEquals(snap.totals.total_ttc, run.total_ttc);
  assertEquals(snap.meta.quoteQualification.level, 'partial');
  assert(snap.meta.quoteQualification.reasons.some((r: Row) => r.code === 'TARIFF_VALIDATION_UNCONFIRMED'));
  for (const key of ['CUSTOMS_DAKAR', 'AGENCY']) {
    const saved = snap.lines.find((l: Row) => l.category === key);
    assertEquals(saved.source, run.tariff_lines.find((l: Row) => l.category === key).source);
    assertStringIncludes(classifyClientLine(saved, {}).label, 'provisoire');
  }
  const frozen = JSON.stringify(snap);
  const text = await pdfText(await generateDraftPdf(snap, 'SYNTHETIC-TRACE'));
  for (const value of ['poids brut 190 kg', 'net 151 kg', '30 colis', 'poids taxable non confirme', 'contradictoires', '25 × 48 × 36 × 29 cm', '28 × 48 × 36 × 29 cm', 'Forfait provisoire']) assertStringIncludes(text, value);
  assertEquals(JSON.stringify(snap), frozen); assertEquals(JSON.stringify(run), capturedRun);
  assertEquals(JSON.stringify(state.tables.quote_facts), originalFacts);
}));

Deno.test('eligible AIR destination: fully known quantities do not make provisional fees firm in the run or version', async () => fixture(async state => {
  state.tables.quote_gaps = [];
  state.tables.quote_facts.push(fact('cargo.hs_code', '1234567890'), fact('cargo.value', 10000), fact('cargo.value_currency', 'XOF'), fact('customs.regime_code', 'TEST'));
  state.tables.hs_codes.push({ code_normalized: '1234567890', dd: 0, rs: 1, pcs: 0.8, pcc: 0.5, cosec: 0.4, surtaxe: 0, tin: 0, t_conj: 0, tva: 18 });
  state.tables.service_quantity_rules.find(r => r.service_key === 'AIR_HANDLING')!.requires_fact_key = 'cargo.weight_kg';
  state.tables.fee_rules.forEach(r => { r.label = 'SYNTHETIC forfait provisoire'; });
  state.engineResponse = { lines: [], totals: { honoraires: 0, debours: 0, operationnel: 0 }, currency: 'XOF', duty_breakdown: [] };
  const result = await state.invoke('run-pricing', { case_id: 'fixture-case', allow_provisional: true });
  assertEquals(result.status, 200, JSON.stringify(result.body)); assertEquals(state.engineCalls, 1);
  const run = state.tables.pricing_runs[0];
  assertEquals(run.tariff_lines.some((l: Row) => l.source.type === 'TO_CONFIRM'), false);
  assertEquals(result.body.quoteQualification.level, 'provisional');
  assertEquals(run.outputs_json.quoteQualification.level, 'provisional');
  assertEquals(run.tariff_lines.find((l: Row) => l.category === 'CUSTOMS_DAKAR').amount, 300);
  assertEquals(run.tariff_lines.find((l: Row) => l.category === 'AGENCY').amount, 400);
  const version = await state.invoke('generate-quotation-version', { case_id: 'fixture-case', pricing_run_id: run.id });
  assertEquals(version.status, 200);
  assertEquals(state.tables.quotation_versions[0].snapshot.meta.quoteQualification.level, 'provisional');
}));

// Fiscal profiles and values below are explicitly synthetic, never real rates or approvals.
function syntheticHsSetup(state: State) {
  state.tables.quote_gaps = [{ gap_key: 'cargo.hs_code', is_blocking: true, status: 'open', case_id: 'fixture-case' }];
  state.tables.quote_facts.push(fact('cargo.hs_code_documentary', '3004.9099', 'attachment_extracted'),
    fact('cargo.value', 10000, 'operator'), fact('cargo.value_currency', 'XOF', 'operator'),
    fact('customs.regime_code', 'TEST', 'operator'), fact('customs.exemptions_reviewed', 'none', 'operator'));
  state.tables.hs_codes = ['3004901000','3004902000','3004909000'].map(code_normalized => ({
    ...Object.fromEntries(HS_TAX_FIELDS.map(k => [k, 0])), code_normalized,
    dd: 4, rs: 2, tva: 7, bic: false, mercurialis: false, tax_profile_status: 'verified',
    tax_evidence: { source_ref: 'SYNTHETIC-ONLY', verified_at: '2026-01-01', basis_version: HS_TAX_BASIS_VERSION, exemptions: 'none', regime_codes: ['TEST'] },
  }));
  state.tables.customs_regimes = [{ code: 'TEST', is_active: true, ...Object.fromEntries(
    ['dd','stx','rs','tin','tva','cosec','pcs','pcc','tpast','ta'].map(k => [k, true])), hors_promad: false, hors_bic: false }];
  state.engineResponse = { lines: [], totals: { honoraires: 0, debours: 0, operationnel: 0 }, currency: 'XOF', duty_breakdown: [] };
}
Deno.test('HS estimate orchestration: proven synthetic equivalence reaches engine without creating a national HS fact or resolving gap', async () => fixture(async state => {
  syntheticHsSetup(state);
  const before = JSON.stringify(state.tables.quote_facts);
  const result = await state.invoke('run-pricing', { case_id: 'fixture-case', allow_provisional: true });
  assertEquals(result.status, 200, JSON.stringify(result.body)); assertEquals(state.engineCalls, 1, JSON.stringify(state.tables.pricing_runs));
  const request = state.engineRequests[0].params;
  assertEquals(request.hsCode, '30049099'); assertEquals(request.hsEstimate, { enabled: true, exemptionsReviewed: true, caseId:'fixture-case' });
  assertEquals(JSON.stringify(state.tables.quote_facts), before);
  assertEquals(state.tables.quote_gaps[0].status, 'open');
  const run = state.tables.pricing_runs.find(r => r.status === 'success')!;
  assertEquals(run.inputs_json.hsCode, undefined);
  assertEquals(run.inputs_json.customsHsEstimate.validated_hs_code, null);
  assertEquals(run.inputs_json.customsHsEstimate.candidate_codes.length, 3);
  assert(run.outputs_json.quoteQualification.reasons.some((r: Row) => r.code === 'HS_CLASSIFICATION_PENDING_EQUIVALENT_TAXATION'));
  const version = await state.invoke('generate-quotation-version', { case_id: 'fixture-case', pricing_run_id: run.id });
  assertEquals(version.status, 200, JSON.stringify(version.body));
  const snap = state.tables.quotation_versions[0].snapshot;
  const estimatedDuty = snap.raw_lines.find((l: Row) => l.source?.hs_tax_equivalence);
  assert(estimatedDuty, JSON.stringify(snap.raw_lines));
  assertEquals(estimatedDuty.source.firm_eligible, false);
  assertEquals(estimatedDuty.source.hs_tax_equivalence.validated_hs_code, null);
  assertEquals(estimatedDuty.source.hs_tax_equivalence.candidate_codes.length, 3);
  assert(snap.meta.quoteQualification.level !== 'firm');
  assert(snap.meta.quoteQualification.reasons.some((r: Row) => r.code === 'HS_CLASSIFICATION_PENDING_EQUIVALENT_TAXATION'));
  const text = (await pdfText(await generateDraftPdf(snap, 'SYNTHETIC-HS'))).toLowerCase();
  assertStringIncludes(text, 'confirmer');
  assertEquals(JSON.stringify(state.tables.quote_facts), before);
  assertEquals(state.tables.quote_gaps[0].status, 'open');
}));
for (const failure of ['unknown', 'different', 'valuation', 'regime', 'exemptions']) Deno.test(`HS estimate orchestration reserves only customs when ${failure}`, async () => fixture(async state => {
  syntheticHsSetup(state);
  if (failure === 'unknown') state.tables.hs_codes[1].tax_profile_status = 'unknown';
  if (failure === 'different') state.tables.hs_codes[1].pcs = 9;
  if (failure === 'valuation') state.tables.quote_facts.find(f => f.fact_key === 'cargo.value')!.source_type = 'attachment_extracted';
  if (failure === 'regime') state.tables.customs_regimes = [];
  if (failure === 'exemptions') state.tables.quote_facts = state.tables.quote_facts.filter(f => f.fact_key !== 'customs.exemptions_reviewed');
  const result = await state.invoke('run-pricing', { case_id: 'fixture-case', allow_provisional: true });
  assertEquals(result.status, 200, JSON.stringify(result.body)); assertEquals(state.engineCalls, 0);
  const run = state.tables.pricing_runs.find(r => r.status === 'success')!;
  assert(run.tariff_lines.some((l: Row) => l.category === 'CUSTOMS_RESERVE' && l.source?.type === 'TO_CONFIRM'));
  assert(run.tariff_lines.some((l: Row) => l.amount > 0), 'Other services must remain priced');
  assertEquals(state.tables.quote_facts.some(f => f.fact_key === 'cargo.hs_code'), false);
}));
Deno.test('HS equivalence DB read failure restores status and creates no successful run', async () => fixture(async state => {
  syntheticHsSetup(state); state.failTable = 'customs_regimes';
  const result = await state.invoke('run-pricing', { case_id: 'fixture-case', allow_provisional: true });
  assertEquals(result.status, 500); assertEquals(state.tables.quote_cases[0].status, 'NEED_INFO');
  assertEquals(state.tables.pricing_runs.some(r => r.status === 'success'), false);
}));

for (const mutation of ['rates','candidates','regime']) Deno.test(`HS equivalence refuses concurrent ${mutation} changes and restores status`, async () => fixture(async state => {
  syntheticHsSetup(state); state.engineTaxMutation = mutation;
  const before = JSON.stringify(state.tables.quote_facts);
  const result = await state.invoke('run-pricing', { case_id:'fixture-case', allow_provisional:true });
  assertEquals(result.status,500); assertEquals(state.tables.quote_cases[0].status,'NEED_INFO');
  assertEquals(state.tables.pricing_runs.some(r => r.status === 'success'),false);
  assertEquals(JSON.stringify(state.tables.quote_facts),before);
  assertEquals(state.tables.quotation_versions.length,0);
}));

Deno.test('AIR full catalogue and ordinary storage reach run, immutable version and PDF without supplier selling leakage',async()=>fixture(async state=>{
  selectSyntheticAirProfile(state);
  state.airState!.catalogue={id:'catalogue-v2',parent_id:null,revision:1,effective_from:'2026-10-16',effective_to:null,source_reference:'Synthetic full source catalogue',payload:structuredClone(airTariffSeed)};
  state.airState!.basis={general_cargo_confirmed:true,warehouse_bracket_confirmed:true,ordinary_storage:{enabled:true,tariff_key:'storage_0',weight_fact_id:'cargo.weight_kg',billable_days:2,days_status:'confirmed',source_reference:'Synthetic confirmed gross weight and billable days'}};
  state.airState!.selection.profile_id=null;
  state.tables.quote_facts.find(f=>f.fact_key==='cargo.weight_kg')!.is_validated=true;
  const historical=JSON.stringify(state.tables.quotation_versions);
  const response=await state.invoke('run-pricing',{case_id:'fixture-case',allow_provisional:true});assertEquals(response.status,200,JSON.stringify(response.body));
  const run=state.tables.pricing_runs.find(r=>r.status==='success')!,line=run.tariff_lines.find((l:Row)=>l.category==='AIR_HANDLING');
  assertEquals(line.amount,null);assertEquals(line.source.air_handling.schema_version,2);assertEquals(line.source.air_handling.components.at(-1).supplier_ht_xof,7600);
  assertEquals(line.source.air_handling.supplier_known_ht_xof,42020);assertEquals(run.inputs_json.airHandling.catalogue.payload.entries.length,180);
  assert(state.calls.some(c=>c.includes('air_tariff_finish')));assertEquals(JSON.stringify(state.tables.quotation_versions),historical);
  const version=await state.invoke('generate-quotation-version',{case_id:'fixture-case',pricing_run_id:run.id});assertEquals(version.status,200,JSON.stringify(version.body));
  const snapshot=state.tables.quotation_versions[0].snapshot,pinned=snapshot.raw_lines.find((l:Row)=>l.category==='AIR_HANDLING').source.air_handling;
  assertEquals(pinned.catalogue.payload.entries.length,180);assertEquals(pinned.basis.ordinary_storage.billable_days,2);
  const before=JSON.stringify(snapshot);state.airState!.catalogue.payload.entries.find((e:Row)=>e.key==='storage_0').value=999;
  assertEquals(JSON.stringify(snapshot),before);const text=await pdfText(await generateDraftPdf(snapshot,'SYNTHETIC-FULL-AIR'));
  assertStringIncludes(text,'confirmer');assert(!text.includes('42020'));assert(!text.includes('7600'));
}));
