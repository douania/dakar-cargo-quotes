import { assertEquals } from 'jsr:@std/assert';
import { handleRequest } from './index.ts';
type Deps = NonNullable<Parameters<typeof handleRequest>[1]>;
const id = '11111111-1111-4111-8111-111111111111';
function fixture(access = true, configured = true) {
  let calls = 0; const reads: string[] = [];
  const deps: Deps = {
    authenticate: async () => ({ token: 'user-token', user: { id: 'operator' } }) as Awaited<ReturnType<Deps['authenticate']>>,
    client: ((_url: string, key: string, options: { global: { headers: { Authorization: string } } }) => {
      assertEquals(key, 'anon'); assertEquals(options.global.headers.Authorization, 'Bearer user-token');
      return { from(table: string) { reads.push(table); const q = { select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: access ? { id } : null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: [{ value_text: 'Ville dossier' }], error: null }) }; return q; } };
    }) as unknown as Deps['client'],
    env: key => ({ SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon', TOMTOM_API_KEY: 'secret-test',
      TOMTOM_DAKAR_ORIGIN: configured ? JSON.stringify({ lat: 14.7, lon: -17.4, source: 'fixture', verified_on: '2026-01-01' }) : undefined })[key],
    propose: async destination => { calls++; return { status: 'choose_destination', destination, candidates: [], message: 'fixture' }; },
  };
  return { deps, reads, count: () => calls };
}
const req = (body: unknown = { case_id: id, destination: 'Ville' }, method = 'POST') => new Request('https://example.test', { method, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
Deno.test('auth denied before DB or external service', async () => {
  const f = fixture(); f.deps.authenticate = async () => new Response(null, { status: 401 });
  assertEquals((await handleRequest(req(), f.deps)).status, 401); assertEquals(f.reads, []); assertEquals(f.count(), 0);
});
Deno.test('RLS denial prevents provider access', async () => {
  const f = fixture(false); assertEquals((await handleRequest(req(), f.deps)).status, 403); assertEquals(f.count(), 0);
});
Deno.test('origin absent uses approved reference; invalid override still refuses external calls', async () => {
  const f = fixture(true, false); assertEquals((await handleRequest(req(), f.deps)).status, 200); assertEquals(f.count(), 1);
  const previous = f.deps.env; f.deps.env = k => k === 'TOMTOM_DAKAR_ORIGIN' ? '{}' : previous(k);
  assertEquals((await handleRequest(req(), f.deps)).status, 503); assertEquals(f.count(), 1);
});
Deno.test('only supplied destination or single current dossier city is used; no writes', async () => {
  const f = fixture(); const response = await handleRequest(req({ case_id: id, destination: '' }), f.deps);
  assertEquals(response.status, 200); assertEquals((await response.json()).destination, 'Ville dossier');
  assertEquals(f.reads, ['quote_cases', 'quote_facts']); assertEquals(f.count(), 1);
});
Deno.test('invalid body/method/coordinates rejected before service', async () => {
  for (const body of [null, [], {}, { case_id: id, destination: 'Ville', lat: 12 }, { case_id: id, destination: 'x'.repeat(201) }]) {
    const f = fixture(); assertEquals((await handleRequest(req(body), f.deps)).status, 400); assertEquals(f.count(), 0);
  }
  const f = fixture(); assertEquals((await handleRequest(req(null, 'GET'), f.deps)).status, 405); assertEquals(f.reads, []);
});
