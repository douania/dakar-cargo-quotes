import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
Deno.env.set("MAIL_FUNCTION_DISABLE_SERVE", "1");
const { handler } = await import("./index.ts");

async function request(data: Record<string, unknown>, total: number | null = 164) {
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_EMAIL_ALLOWLIST'];
  const before = keys.map(key => Deno.env.get(key));
  ['https://fixture.invalid', 'fixture-anon', 'fixture-service', 'operator@fixture.invalid'].forEach((value, i) => Deno.env.set(keys[i], value));
  const originalFetch = globalThis.fetch;
  const reads: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assertEquals(url.hostname, 'fixture.invalid');
    const json = (value: unknown, headers = {}) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json', ...headers } });
    if (url.pathname.endsWith('/user')) return json({ id: 'fixture-admin', email: 'operator@fixture.invalid' });
    if (url.pathname.endsWith('/has_workspace_access')) return json(true);
    if (url.pathname.endsWith('/email_threads')) {
      reads.push(url);
      return json([{ id: 'fixture-thread', subject_normalized: 'request', first_message_at: '2026-10-01T00:00:00Z',
        last_message_at: '2026-10-18T00:00:00Z', client_company: 'Fixture', project_name: 'Projet fictif',
        participants: [], status: 'active', email_count: 57 }], total === null ? {} : { 'Content-Range': `0-0/${total}` });
    }
    throw new Error('Unexpected fixture read ' + url.pathname);
  };
  try {
    const response = await handler(new Request('https://fixture.invalid/email-admin', { method: 'POST',
      headers: { Authorization: 'Bearer fixture-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_threads_paginated', data }) }));
    return { status: response.status, body: await response.json(), reads };
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, i) => before[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, before[i]!));
  }
}

Deno.test('email-admin handler: explicit offset and stable ordering retain the metadata used by filters', async () => {
  const result = await request({ offset: 100, pageSize: 50 });
  assertEquals(result.status, 200); assertEquals(result.body.offset, 100); assertEquals(result.body.totalCount, 164);
  assertEquals(result.reads[0].searchParams.get('offset'), '100');
  assertEquals(result.reads[0].searchParams.get('limit'), '50');
  assertEquals(result.reads[0].searchParams.get('order'), 'last_message_at.desc,id.asc');
  for (const field of ['client_company', 'project_name', 'participants', 'first_message_at', 'status']) {
    assert(result.reads[0].searchParams.get('select')!.split(',').includes(field));
    assert(field in result.body.threads[0]);
  }
});
Deno.test('email-admin handler: existing page callers keep their offset and the page size stays bounded', async () => {
  const result = await request({ page: 2, pageSize: 200 });
  assertEquals(result.status, 200); assertEquals(result.body.pageSize, 50); assertEquals(result.body.offset, 100);
});
for (const input of [{ page: -1 }, { pageSize: 0 }, { offset: -1 }, { offset: '100' }, { offset: Number.MAX_SAFE_INTEGER }]) {
  Deno.test('email-admin handler: invalid pagination never queries business rows ' + JSON.stringify(input), async () => {
    const result = await request(input); assert(result.status >= 400); assertEquals(result.body.success, false); assertEquals(result.reads, []);
  });
}
Deno.test('email-admin handler: unavailable total is an error rather than a false empty result', async () => {
  const result = await request({ offset: 0 }, null); assert(result.status >= 400); assertEquals(result.body.success, false);
});
