import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { HS_TAX_FIELDS } from '../_shared/hs-tax-profile.ts';
type Row = Record<string, unknown>;
type Handler = (request: Request) => Promise<Response>;
const serve = Deno.serve;
let handler: Handler;
try {
  (Deno as unknown as { serve: (handler: Handler) => unknown }).serve = h => { handler = h; return {}; };
  await import('../import-hs-codes/index.ts');
} finally { Deno.serve = serve; }
async function importFixture(csvContent: string, mode: string) {
  const oldFetch = globalThis.fetch;
  const keys = ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'];
  const previous = keys.map(k => Deno.env.get(k));
  keys.forEach((k,i) => Deno.env.set(k, i === 0 ? 'https://fixture.invalid' : 'synthetic-key'));
  const writes: Row[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assertEquals(url.hostname, 'fixture.invalid');
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'synthetic-user' });
    if (url.pathname.endsWith('/rpc/has_workspace_access')) return Response.json(true);
    assert(url.pathname.endsWith('/hs_codes'));
    if ((init?.method ?? 'GET') === 'POST') {
      const body = JSON.parse(String(init!.body)); writes.push(...(Array.isArray(body) ? body : [body]));
    }
    return Response.json([]);
  };
  try {
    const response = await handler!(new Request('https://fixture.invalid/import', { method: 'POST',
      headers: { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ csvContent, mode }) }));
    return { status: response.status, data: await response.json(), writes };
  } finally { globalThis.fetch = oldFetch; keys.forEach((k,i) => previous[i] === undefined ? Deno.env.delete(k) : Deno.env.set(k,previous[i]!)); }
}
for (const mode of ['full','descriptions_only','update_zero_dd_only']) Deno.test(`HS importer preserves reviewed references in ${mode}`, async () => {
  const r = await importFixture('code;description;dd;tva\n3004.90.10.00;Wrong legacy ORASEL;99;99\n3004902000;Wrong;0;18\n3004909000;Wrong;0;18', mode);
  assertEquals(r.status,200); assertEquals(r.writes, []);
  assertEquals(r.data.protected_codes_preserved,['3004901000','3004902000','3004909000']);
});
Deno.test('HS importer description-only new row keeps all fiscal values and flags unknown', async () => {
  const r=await importFixture('code;description\n1234560000;SYNTHETIC ONLY', 'descriptions_only');
  assertEquals(r.status,200); assertEquals(r.writes.length,1);
  for(const key of [...HS_TAX_FIELDS,'bic','mercurialis']) assertEquals(r.writes[0][key],null,key);
  assertEquals(r.writes[0].tax_profile_status,'unknown');
});
Deno.test('HS importer missing or malformed rate is unknown; explicit zero survives without default 18', async () => {
  const r=await importFixture('code;description;dd;rs;tva\n1234560000;SYNTHETIC ONLY;;garbage;0', 'full');
  assertEquals(r.status,200);assertEquals(r.writes.length,1);
  assertEquals(r.writes[0].dd,null);assertEquals(r.writes[0].rs,null);assertEquals(r.writes[0].tva,0);
  assertEquals(r.writes[0].tax_profile_status,'unknown');
});
