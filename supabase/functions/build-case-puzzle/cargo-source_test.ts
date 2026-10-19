import { assertEquals, assert, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
Deno.env.set("BUILD_CASE_PUZZLE_DISABLE_SERVE", "1");
const { extractFactsBasic, injectAttachmentFacts, buildCasePuzzleHandler } = await import("./index.ts");
const email = { id: "fixture-email", from_address: "sender@example.invalid", body_text: "Cartons        30\nGross WT    190 KGS\n48 x 36 x 29 cm - 25 cartons\n44 x 27 x 24 cm - 05 cartons" };
const info = { total_cartons: 30, total_gross_weight_kg: 190, total_net_weight_kg: 151 };
const attachment = { id: "fixture-attachment", email_id: email.id, filename: "packing-list.pdf", extracted_data: { confidence: .9, extracted_info: info, documents: [{ doc_type: "packing_list", extracted_info: info }] } };

Deno.test("cargo source: explicit total precedes dimensional subgroup and KGS survives", () => {
  const facts = extractFactsBasic([email], []);
  assertEquals(facts.find(f => f.key === "cargo.pieces_count")?.value, 30);
  assertEquals(facts.find(f => f.key === "cargo.weight_kg")?.value, 190);
  assertEquals(facts.some(f => ["cargo.volume_cbm", "cargo.chargeable_weight_kg"].includes(f.key)), false);
  const dimensions = facts.find(f => f.key === "cargo.dimensions");
  assert(JSON.stringify(dimensions?.value).includes("44"), "Both groups remain visible");
});

function store(rows: Array<Record<string, unknown>> = [], attachments: unknown[] = [attachment], fail = false) {
  const calls: Array<Record<string, unknown>> = [];
  const timelines: unknown[] = [];
  const client = {
    from(table: string) {
      const query = { select() { return query; }, in() { return query; }, not() { return query; }, eq() { return query; },
        insert(value: unknown) { timelines.push(value); return Promise.resolve({ error: null }); },
        then(resolve: (v: unknown) => void) { resolve({ data: table === "email_attachments" ? attachments : rows, error: null }); } };
      return query;
    },
    rpc(name: string, args: Record<string, unknown>) {
      assertEquals(name, "supersede_fact"); calls.push(args);
      if (fail) return Promise.resolve({ error: { message: 'synthetic write failure' } });
      const old = rows.find(r => r.fact_key === args.p_fact_key);
      const value = { value_number: args.p_value_number, value_text: args.p_value_text, value_json: args.p_value_json, source_type: args.p_source_type };
      if (old) Object.assign(old, value);
      else rows.push({ fact_key: args.p_fact_key, ...value });
      return Promise.resolve({ data: "fixture-fact", error: null });
    },
  };
  return { client, calls, timelines };
}

Deno.test("cargo source: actual attachment injector keeps totals, confidence and provenance, replay is inert", async () => {
  const fixture = store([{ fact_key: "cargo.pieces_count", source_type: "email_body", value_number: 25 }]);
  await injectAttachmentFacts("fixture-case", fixture.client, [email.id]);
  for (const [key, value] of [["cargo.pieces_count", 30], ["cargo.weight_kg", 190], ["cargo.weight_net_kg", 151]]) {
    const call = fixture.calls.find(c => c.p_fact_key === key);
    assertEquals(call?.p_value_number, value);
    assertEquals(call?.p_confidence, .9);
    assertEquals(call?.p_source_email_id, email.id);
    assertEquals(call?.p_source_attachment_id, attachment.id);
  }
  const first = fixture.calls.length;
  await injectAttachmentFacts("fixture-case", fixture.client, [email.id]);
  assertEquals(fixture.calls.length, first);
});

Deno.test('cargo source: dimensional conflict keeps each source and replay does not duplicate evidence', async () => {
  const line_items = [{ no_of_cartons: 28, dimension_cm_carton: '48 x 36 x 29' }, { no_of_cartons: 2, dimension_cm_carton: '44 x 27 x 24' }];
  const doc = { ...attachment, extracted_data: { confidence: .9, documents: [{ doc_type: 'packing_list', confidence: .85, extracted_info: { ...info, line_items } }] } };
  const fixture = store([{ fact_key: 'cargo.dimensions', source_type: 'email_body', source_email_id: email.id, confidence: .8 }], [doc]);
  await injectAttachmentFacts('fixture-case', fixture.client, [email.id], [email]);
  const call = fixture.calls.find(c => c.p_fact_key === 'cargo.dimensions_evidence');
  const value = call?.p_value_json as { conflict: boolean; sources: Array<{ email_id: string; attachment_id: string | null; groups: Array<{count: number}> }> };
  assertEquals(value.conflict, true);
  assertEquals(value.sources.map(s => s.groups.map(g => g.count).sort((a,b) => b-a)), [[25,5], [28,2]]);
  assertEquals(value.sources[0].email_id, email.id);
  assertEquals(value.sources[1].attachment_id, doc.id);
  assertEquals(call?.p_confidence, .8);
  assertEquals(fixture.calls.find(c => c.p_fact_key === 'cargo.weight_net_kg')?.p_value_number, 151);
  assertEquals(fixture.calls.find(c => c.p_fact_key === 'cargo.weight_kg')?.p_confidence, .85);
  const first = fixture.calls.length;
  await injectAttachmentFacts('fixture-case', fixture.client, [email.id], [email]);
  assertEquals(fixture.calls.length, first);
  assertEquals(fixture.calls.some(c => ['cargo.volume_cbm', 'cargo.chargeable_weight_kg'].includes(String(c.p_fact_key))), false);
});

Deno.test('cargo source: FOC amounts remain declared evidence and HS8 is not promoted', async () => {
  const invoice = { ...attachment, filename: 'invoice.pdf', extracted_data: { confidence: .9,
    extracted_info: { document_type: 'NON-COMMERCIAL INVOICE', payment_terms: 'FOC', total_amount: 101.96, total_currency: 'EUR', value: 101.96, hs_code: '3004.9099' },
    tariff_lines: [{ service: 'FOB VALUE', amount: 89.72, currency: 'EUR' }, { service: 'CIF', amount: 101.96, currency: 'EUR' }, { service: 'FREIGHT', amount: 10.2, currency: 'EUR' }] } };
  const fixture = store([], [invoice]);
  await injectAttachmentFacts('fixture-case', fixture.client, [email.id]);
  assertEquals(fixture.calls.some(c => ['cargo.value', 'cargo.value_currency', 'cargo.hs_code'].includes(String(c.p_fact_key))), false);
  assertEquals(fixture.calls.find(c => c.p_fact_key === 'cargo.freight_cost')?.p_value_number, 10.2);
});

Deno.test('cargo source: failed RPC cannot report a successful injection', async () => {
  const fixture = store([], [attachment], true);
  await assertRejects(() => injectAttachmentFacts('fixture-case', fixture.client, [email.id]), Error, 'could not be recorded');
  assertEquals(fixture.timelines.length, 0);
});

Deno.test('cargo source: a later FOC sub-document blocks monetary promotion in the composite prepass', async () => {
  const doc = { ...attachment, extracted_data: { confidence: .9, documents: [
    { doc_type: 'packing_list', extracted_info: info },
    { doc_type: 'commercial_invoice', extracted_info: { payment_terms: 'FOC', document_type: 'NON-COMMERCIAL INVOICE', total_amount: 101.96, total_currency: 'EUR' }, tariff_lines: [{ service: 'CIF', amount: 101.96, currency: 'EUR' }] }] } };
  const fixture = store([], [doc]);
  await injectAttachmentFacts('fixture-case', fixture.client, [email.id]);
  assertEquals(fixture.calls.some(c => ['cargo.value','cargo.value_currency'].includes(String(c.p_fact_key))), false);
});

Deno.test('cargo source: normalized page-suffixed KG keys work in both nested and flat extraction', async () => {
  const info = { total_gross_weight_kg_Page_2: 190, total_net_weight_kg_Page_2: 151 };
  for (const extracted_data of [{ confidence: .9, extracted_info: info }, { confidence: .9, documents: [{ doc_type: 'packing_list', extracted_info: info }] }]) {
    const fixture = store([], [{ ...attachment, extracted_data }]);
    await injectAttachmentFacts('fixture-case', fixture.client, [email.id]);
    assertEquals(fixture.calls.find(c => c.p_fact_key === 'cargo.weight_kg')?.p_value_number, 190);
    assertEquals(fixture.calls.find(c => c.p_fact_key === 'cargo.weight_net_kg')?.p_value_number, 151);
  }
});

Deno.test('cargo source: full handler replay preserves attachment totals against contradictory email proposals', async () => {
  const keys = ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','LOVABLE_API_KEY'];
  const saved = keys.map(k => Deno.env.get(k));
  Deno.env.set(keys[0], 'https://fixture.invalid'); Deno.env.set(keys[1],'fixture-anon'); Deno.env.set(keys[2],'fixture-service'); Deno.env.delete(keys[3]);
  const fetchBefore = globalThis.fetch;
  const rows: Array<Record<string, unknown>> = [
    { id:'fixture-count',fact_key:'cargo.pieces_count',fact_category:'cargo',value_number:30,value_text:null,value_json:null,is_current:true,is_validated:false,source_type:'attachment_extracted',source_email_id:email.id,source_attachment_id:attachment.id },
    { id:'fixture-weight',fact_key:'cargo.weight_kg',fact_category:'cargo',value_number:190,value_text:null,value_json:null,is_current:true,is_validated:false,source_type:'attachment_extracted',source_email_id:email.id,source_attachment_id:attachment.id }];
  const writes: Array<Record<string,unknown>> = [];
  const fixtureEmail = { ...email, body_text: 'Cartons 25\nGross WT 200 KGS\n48 x 36 x 29 cm - 25 cartons\n44 x 27 x 24 cm - 5 cartons', subject:'Air shipment DDP', sent_at:'2026-01-01T00:00:00Z', to_addresses:['receiver@example.invalid'] };
  const doc = { ...attachment, is_analyzed:true,content_type:'application/pdf' };
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const payload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    const json = (data: unknown, count=0) => new Response(JSON.stringify(data), { headers:{'Content-Type':'application/json','Content-Range':`0-${Math.max(0,count-1)}/${count}`} });
    if(url.pathname === '/auth/v1/user') return json({id:'fixture-user',email:'operator@example.invalid'});
    if(url.pathname.endsWith('/rpc/has_workspace_access')) return json(true);
    if(url.pathname.endsWith('/rpc/case_document_analysis_inspect')) return json({contract:1,scope:'manual_case_documents',context_hash:'a'.repeat(32),documents:[],readable_email_count:0,latest:null});
    if(url.pathname.endsWith('/rpc/apply_case_email_fact_revisions')) {
      return json({decisions:payload.p_groups.map((g:{key:string})=>({key:g.key,status:'conflict',reason:'current_source_not_orderable',fact_id:rows.find(r=>r.fact_key===g.key)?.id??null,changed:false,replay:false}))});
    }
    if(url.pathname.endsWith('/rpc/supersede_fact')) {
      writes.push(payload); const old = rows.find(r=>r.fact_key === payload.p_fact_key);
      const value = { id:old?.id ?? `fixture-fact-${rows.length}`,fact_key:payload.p_fact_key,fact_category:payload.p_fact_category,is_current:true,is_validated:false,
        value_text:payload.p_value_text,value_number:payload.p_value_number,value_json:payload.p_value_json,source_type:payload.p_source_type,
        source_email_id:payload.p_source_email_id,source_attachment_id:payload.p_source_attachment_id,source_excerpt:payload.p_source_excerpt,confidence:payload.p_confidence };
      if(old)Object.assign(old,value);else rows.push(value); return json(value.id);
    }
    if(url.pathname.includes('/rpc/')) return json([]);
    const table = url.pathname.split('/').pop();
    if(method === 'HEAD') return new Response(null,{headers:{'Content-Range':'*/0'}});
    if(method !== 'GET') return json([]);
    const single = String(new Headers(init?.headers).get('Accept')).includes('vnd.pgrst.object');
    if(table === 'quote_cases') return json({id:'fixture-case',thread_id:'fixture-thread',status:'ANALYZING',request_type:'AIR_IMPORT_DDP',email_threads:{id:'fixture-thread',client_email:email.from_address,subject_normalized:'Air shipment DDP'}});
    if(table === 'emails') return json([fixtureEmail],1);
    if(table === 'email_attachments') return json([doc],1);
    if(table === 'quote_facts') {
      const key = url.searchParams.get('fact_key');
      const filtered = key?.startsWith('eq.') ? rows.filter(r=>r.fact_key === key.slice(3)) : rows;
      return json(single ? filtered[0] ?? null : filtered,filtered.length);
    }
    return json(single ? null : []);
  };
  try {
    for(let i=0;i<2;i++) {
      const response = await buildCasePuzzleHandler(new Request('https://fixture.invalid/build-case-puzzle', {method:'POST',headers:{Authorization:'Bearer fixture-token','Content-Type':'application/json'},body:JSON.stringify({case_id:'fixture-case'})}));
      const body = await response.json();
      assertEquals(response.status,200,JSON.stringify(body));
      assertEquals(body.facts_updated,0);
      if(i===1) assertEquals(body.facts_added,0);
      assertEquals(rows.find(r=>r.fact_key==='cargo.pieces_count')?.value_number,30);
      assertEquals(rows.find(r=>r.fact_key==='cargo.weight_kg')?.value_number,190);
    }
    assertEquals(writes.filter(p=>['cargo.pieces_count','cargo.weight_kg'].includes(String(p.p_fact_key))),[]);
  } finally {
    globalThis.fetch=fetchBefore;
    keys.forEach((k,i)=>saved[i] === undefined ? Deno.env.delete(k) : Deno.env.set(k,saved[i]!));
  }
});

Deno.test("cargo source: validated and operator facts are not superseded", async () => {
  const fixture = store([{ fact_key: "cargo.pieces_count", source_type: "operator", value_number: 40 },
    { fact_key: "cargo.weight_kg", source_type: "email_body", value_number: 220, is_validated: true }]);
  await injectAttachmentFacts("fixture-case", fixture.client, [email.id]);
  assertEquals(fixture.calls.some(c => ["cargo.weight_kg", "cargo.pieces_count"].includes(String(c.p_fact_key))), false);
});
